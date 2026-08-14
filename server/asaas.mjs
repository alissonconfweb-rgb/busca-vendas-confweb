import { db, getSetting, setSetting } from "./db.mjs";
import { lookupBrazilianPostalCode } from "./postal-code.mjs";
import { randomToken } from "./security.mjs";

const SANDBOX_URL = "https://api-sandbox.asaas.com/v3";
const PRODUCTION_URL = "https://api.asaas.com/v3";
const PAID_STATUSES = new Set(["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"]);
const FAILED_STATUSES = new Set([
  "CANCELED",
  "DELETED",
  "OVERDUE",
  "REFUNDED",
  "REFUND_REQUESTED",
  "CHARGEBACK_REQUESTED",
  "CHARGEBACK_DISPUTE",
  "AWAITING_CHARGEBACK_REVERSAL",
  "DUNNING_REQUESTED",
  "DUNNING_RECEIVED",
  "CREDIT_CARD_CAPTURE_REFUSED",
  "REPROVED_BY_RISK_ANALYSIS",
]);
const PAYMENT_FAILURE_EVENTS = new Set([
  "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED",
  "PAYMENT_REPROVED_BY_RISK_ANALYSIS",
  "PAYMENT_OVERDUE",
  "PAYMENT_DELETED",
  "PAYMENT_REFUNDED",
]);
const SUBSCRIPTION_CANCELED_EVENTS = new Set([
  "SUBSCRIPTION_INACTIVATED",
  "SUBSCRIPTION_DELETED",
]);

export function isAsaasConfigured() {
  return Boolean(asaasApiKey());
}

export function normalizeAsaasApiKey(value) {
  return String(value || "").trim().replace(/^['"]|['"]$/g, "");
}

export function isValidCreditCardNumber(value) {
  const number = digits(value);
  if (number.length < 13 || number.length > 19 || /^(\d)\1+$/.test(number)) {
    return false;
  }

  let sum = 0;
  let doubleDigit = false;
  for (let index = number.length - 1; index >= 0; index -= 1) {
    let digit = Number(number[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

export function publicAsaasCheckoutError(error) {
  if (error?.name !== "AsaasRequestError") {
    return error instanceof Error ? error.message : "Não foi possível criar o pagamento.";
  }

  const providerCode = String(error.providerCode || "").toLowerCase();
  const providerMessage = String(error.message || "").toLowerCase();
  if (
    providerCode.includes("invalid_creditcard")
    || providerMessage.includes("transação não autorizada")
    || providerMessage.includes("transacao nao autorizada")
    || providerMessage.includes("unauthorized transaction")
  ) {
    return "Não foi possível autorizar este cartão. Confira o número, a validade, o CVV e os dados do titular. Nenhuma cobrança foi realizada. Se estiver tudo correto, tente outro cartão.";
  }

  return "Não foi possível processar o pagamento agora. Nenhuma cobrança foi realizada. Aguarde alguns instantes e tente novamente.";
}

export function detectAsaasEnvironment(apiKey, fallback = "sandbox") {
  const normalized = normalizeAsaasApiKey(apiKey).toLowerCase();
  if (normalized.includes("hmlg") || normalized.includes("sandbox")) {
    return "sandbox";
  }
  if (normalized.includes("prod")) {
    return "production";
  }
  return fallback === "production" ? "production" : "sandbox";
}

export function configureAsaasApiKey(apiKey) {
  const normalized = normalizeAsaasApiKey(apiKey);
  if (!normalized) {
    throw new Error("Cole a API Key da Asaas antes de salvar.");
  }
  const environment = detectAsaasEnvironment(normalized, getSetting("asaas_environment") || "sandbox");
  setSetting("asaas_api_key", normalized);
  setSetting("asaas_environment", environment);
  setSetting("asaas_endpoint", environment === "production" ? PRODUCTION_URL : SANDBOX_URL);
  setSetting("asaas_enabled", "true");
  setSetting("asaas_webhook_ready", "false");
  setSetting("asaas_webhook_id", "");
  setSetting("asaas_last_error", "");
  return environment;
}

export function asaasWebhookUrl(publicUrl = process.env.PUBLIC_URL) {
  const base = String(publicUrl || "").replace(/\/+$/, "");
  return base ? `${base}/api/asaas/webhook` : "/api/asaas/webhook";
}

export async function testAsaasConnection() {
  const response = await asaasRequest("/customers?limit=1", { method: "GET" });
  return {
    ok: true,
    environment: asaasEnvironment(),
    totalCount: response.totalCount ?? response.total ?? 0,
  };
}

export async function setupAsaasIntegration({ email, publicUrl }) {
  const connection = await testAsaasConnection();
  const webhookUrl = asaasWebhookUrl(publicUrl);
  if (!/^https:\/\//i.test(webhookUrl)) {
    throw new Error("Defina PUBLIC_URL com o domínio HTTPS antes de preparar o webhook da Asaas.");
  }

  let authToken = getSetting("asaas_webhook_token") || process.env.ASAAS_WEBHOOK_TOKEN || "";
  if (authToken.length < 32) {
    authToken = `whsec_${randomToken(36)}`;
    setSetting("asaas_webhook_token", authToken);
  }

  const payload = {
    name: "Busca Vendas - Confweb",
    url: webhookUrl,
    email: String(email || "").trim(),
    enabled: true,
    interrupted: false,
    apiVersion: 3,
    authToken,
    sendType: "SEQUENTIALLY",
    events: [
      "PAYMENT_CREATED",
      "PAYMENT_UPDATED",
      "PAYMENT_AWAITING_RISK_ANALYSIS",
      "PAYMENT_APPROVED_BY_RISK_ANALYSIS",
      "PAYMENT_REPROVED_BY_RISK_ANALYSIS",
      "PAYMENT_CONFIRMED",
      "PAYMENT_RECEIVED",
      "PAYMENT_OVERDUE",
      "PAYMENT_DELETED",
      "PAYMENT_REFUNDED",
      "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED",
      "SUBSCRIPTION_CREATED",
      "SUBSCRIPTION_UPDATED",
      "SUBSCRIPTION_INACTIVATED",
      "SUBSCRIPTION_DELETED",
    ],
  };

  if (!payload.email) {
    throw new Error("O e-mail do administrador é necessário para preparar o webhook.");
  }

  const webhooks = await asaasRequest("/webhooks?limit=100", { method: "GET" });
  const existing = Array.isArray(webhooks?.data)
    ? webhooks.data.find((item) => String(item.url || "").replace(/\/+$/, "") === webhookUrl.replace(/\/+$/, ""))
    : null;
  const webhook = existing?.id
    ? await asaasRequest(`/webhooks/${encodeURIComponent(existing.id)}`, { method: "PUT", body: payload })
    : await asaasRequest("/webhooks", { method: "POST", body: payload });

  setSetting("asaas_enabled", "true");
  setSetting("asaas_webhook_id", webhook.id || existing?.id || "");
  setSetting("asaas_webhook_ready", "true");
  setSetting("asaas_last_error", "");
  setSetting("asaas_last_webhook_url", webhookUrl);

  return {
    ...connection,
    webhookId: webhook.id || existing?.id || null,
    webhookUrl,
    webhookReady: true,
  };
}

export async function createAsaasCheckout({ user, body, settings, remoteIp }) {
  if (!isAsaasConfigured()) {
    throw new Error("Configure a API Key da Asaas no painel admin antes de vender planos.");
  }

  const customerDocument = digits(body.cpfCnpj || "");
  const customerPhone = digits(body.phone || user.phone || "");
  if (![11, 14].includes(customerDocument.length)) {
    throw new Error("Informe um CPF com 11 números ou um CNPJ com 14 números.");
  }
  if (customerPhone.length < 10 || customerPhone.length > 11) {
    throw new Error("Informe um telefone válido com DDD.");
  }

  const offer = resolvePlanOffer(body, settings);
  const { billingType, chargeMode } = paymentRuleForOffer(offer, body);
  const checkoutBody = billingType === "CREDIT_CARD"
    ? await normalizeCreditCardCheckoutBody(body)
    : body;
  const customerId = await ensureAsaasCustomer(user, checkoutBody);
  const externalReference = [
    "bv",
    user.id,
    offer.plan,
    offer.cycle,
    chargeMode,
    Date.now(),
  ].join(":");

  const basePayload = {
    customer: customerId,
    billingType,
    description: offer.description,
    externalReference,
  };

  let providerResult;
  let firstPayment = null;
  let pixQrCode = null;

  if (chargeMode === "single") {
    providerResult = await asaasRequest("/payments", {
      method: "POST",
      body: {
        ...basePayload,
        dueDate: isoDate(),
        ...(billingType === "CREDIT_CARD" && offer.cycle === "yearly"
          ? { installmentCount: 12, totalValue: offer.value }
          : { value: offer.value }),
        ...(billingType === "CREDIT_CARD" ? creditCardPayload(checkoutBody, remoteIp) : {}),
      },
    });
    firstPayment = providerResult;
  } else {
    providerResult = await asaasRequest("/subscriptions", {
      method: "POST",
      body: {
        ...basePayload,
        value: offer.value,
        cycle: offer.cycle === "yearly" ? "YEARLY" : "MONTHLY",
        nextDueDate: isoDate(),
        ...(billingType === "CREDIT_CARD" ? creditCardPayload(checkoutBody, remoteIp) : {}),
      },
    });
    firstPayment = await findFirstSubscriptionPayment(providerResult.id);
  }

  if (billingType === "PIX" && firstPayment?.id) {
    pixQrCode = await getPaymentPixQrCode(firstPayment.id, 6);
  }

  const status = firstPayment?.status || providerResult.status || "PENDING";
  const invoiceUrl = firstPayment?.invoiceUrl || providerResult.invoiceUrl || providerResult.bankSlipUrl || "";
  const financeId = saveFinanceRecord({
    user,
    offer,
    billingType,
    chargeMode,
    status,
    providerResult,
    firstPayment,
    invoiceUrl,
    pixQrCode,
    externalReference,
  });

  if (PAID_STATUSES.has(status)) {
    activateUserPlan(user.id, offer, {
      subscriptionId: chargeMode === "subscription" ? providerResult.id : "",
      paymentUrl: invoiceUrl,
      resetUsage: true,
    });
  }
  setSetting("asaas_last_error", "");

  return {
    ok: true,
    financeId,
    plan: offer.plan,
    cycle: offer.cycle,
    chargeMode,
    billingType,
    value: offer.value,
    status,
    providerId: providerResult.id,
    paymentId: firstPayment?.id || null,
    invoiceUrl,
    pixQrCode,
    message: checkoutMessage({ billingType, status, invoiceUrl, pixQrCode }),
  };
}

export async function refreshAsaasCheckoutStatus({ user, financeId }) {
  const record = db.prepare(`
    SELECT *
    FROM finance_records
    WHERE id = ? AND user_id = ? AND provider = 'asaas'
    LIMIT 1
  `).get(Number(financeId), user.id);
  if (!record) {
    throw new Error("Compra não encontrada.");
  }

  let paymentId = record.provider_payment_id || "";
  if (!paymentId && record.provider_subscription_id) {
    const payment = await findFirstSubscriptionPayment(record.provider_subscription_id, 3);
    paymentId = payment?.id || "";
    if (paymentId) {
      db.prepare(`
        UPDATE finance_records
        SET external_id = ?, provider_payment_id = ?, payment_url = COALESCE(?, payment_url), updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(paymentId, paymentId, payment.invoiceUrl || null, record.id);
    }
  }

  let providerPayment = null;
  if (paymentId) {
    providerPayment = await asaasRequest(`/payments/${encodeURIComponent(paymentId)}`, { method: "GET" });
    const status = providerPayment.status || record.status;
    db.prepare(`
      UPDATE finance_records
      SET status = ?, amount = COALESCE(NULLIF(?, 0), amount),
          payment_url = COALESCE(NULLIF(?, ''), payment_url),
          paid_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      financeStatusFromAsaas(status),
      Number(providerPayment.value || 0),
      providerPayment.invoiceUrl || "",
      PAID_STATUSES.has(status) ? isoDateTime() : record.paid_at,
      record.id,
    );

    if (PAID_STATUSES.has(status)) {
      activateUserPlan(user.id, offerFromFinanceRecord(record), {
        subscriptionId: record.provider_subscription_id || providerPayment.subscription || "",
        paymentUrl: providerPayment.invoiceUrl || record.payment_url || "",
        resetUsage: record.status !== "paid",
      });
    } else if (FAILED_STATUSES.has(status) && record.provider_subscription_id) {
      suspendRecurringPlan(user.id, {
        subscriptionId: record.provider_subscription_id,
        paymentUrl: providerPayment.invoiceUrl || record.payment_url || "",
      });
    }
  }

  let pixQrCode = null;
  if (record.billing_type === "PIX" && paymentId) {
    pixQrCode = await getPaymentPixQrCode(paymentId, 2);
    const pixPayload = pixQrCode?.payload || pixQrCode?.encodedImage || "";
    if (pixPayload) {
      db.prepare(`
        UPDATE finance_records
        SET pix_payload = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(pixPayload, record.id);
    }
  }

  const updated = db.prepare("SELECT * FROM finance_records WHERE id = ?").get(record.id);
  const paid = updated.status === "paid";
  const providerStatus = providerPayment?.status || updated.status;
  setSetting("asaas_last_error", "");
  return {
    ok: true,
    financeId: updated.id,
    status: providerStatus,
    paid,
    invoiceUrl: providerPayment?.invoiceUrl || updated.payment_url || "",
    pixQrCode,
    message: paid
      ? "Pagamento aprovado. Seu plano já está liberado."
      : FAILED_STATUSES.has(providerStatus)
        ? "Pagamento não aprovado. Confira os dados informados e tente novamente."
        : pixQrCode
          ? "Pix gerado. Aguardando a confirmação do pagamento."
          : "Pagamento criado. Aguardando a confirmação no Asaas.",
  };
}

export async function handleAsaasWebhook(req, publicUrl) {
  const token = getSetting("asaas_webhook_token") || process.env.ASAAS_WEBHOOK_TOKEN || "";
  const receivedToken = req.headers["asaas-access-token"] || req.headers["access_token"] || req.headers["authorization"] || "";
  if (token && String(receivedToken).replace(/^Bearer\s+/i, "") !== token) {
    return { ok: false, status: 401, body: { error: "Token de webhook invalido." } };
  }

  const event = await readJsonFromRequest(req);
  const eventName = String(event.event || "").trim().toUpperCase();
  const isSubscriptionEvent = Boolean(event.subscription);
  const resource = event.payment || event.subscription || {};
  const providerId = resource.id || event.id || "";
  const subscriptionId = String(
    event.payment?.subscription
    || (isSubscriptionEvent ? resource.id : "")
    || "",
  );
  const externalReference = resource.externalReference || event.externalReference || "";
  const status = effectiveAsaasStatus(eventName, resource.status || event.status || "");
  const value = Number(resource.value || event.value || 0);
  const paymentUrl = resource.invoiceUrl || resource.bankSlipUrl || "";

  let row = findFinanceRecord({
    providerId,
    subscriptionId,
    externalReference,
  });
  const isNewPaidCycle = Boolean(
    !row
    || row.status !== "paid"
    || (providerId && row.provider_payment_id && row.provider_payment_id !== providerId),
  );
  const referenceInfo = parseExternalReference(externalReference || row?.external_reference);
  const userId = row?.user_id || referenceInfo.userId || null;
  const offer = referenceInfo.plan
    ? offerFromReference(referenceInfo)
    : row?.plan
      ? offerFromFinanceRecord(row)
      : null;

  if (!isSubscriptionEvent && userId) {
    row = saveWebhookPayment({
      row,
      userId,
      offer,
      providerId,
      subscriptionId,
      externalReference,
      status,
      value,
      paymentUrl,
      resource,
      eventName,
    });
  }

  if (userId && offer && PAID_STATUSES.has(status)) {
    activateUserPlan(userId, offer, {
      subscriptionId: subscriptionId || row?.provider_subscription_id || "",
      paymentUrl: paymentUrl || row?.payment_url || "",
      resetUsage: isNewPaidCycle,
    });
  } else if (
    userId
    && (PAYMENT_FAILURE_EVENTS.has(eventName) || FAILED_STATUSES.has(status))
    && (subscriptionId || referenceInfo.chargeMode === "subscription" || row?.provider_subscription_id)
  ) {
    suspendRecurringPlan(userId, {
      subscriptionId: subscriptionId || row?.provider_subscription_id || "",
      paymentUrl: paymentUrl || row?.payment_url || "",
    });
  }

  if (userId && SUBSCRIPTION_CANCELED_EVENTS.has(eventName)) {
    scheduleSubscriptionCancellation(userId, {
      subscriptionId: subscriptionId || providerId,
      nextDueDate: resource.nextDueDate || "",
    });
  }

  setSetting("asaas_last_event", `${eventName || "evento"} ${status || ""}`.trim());
  setSetting("asaas_last_webhook_url", asaasWebhookUrl(publicUrl));
  setSetting("asaas_last_error", "");
  return { ok: true, status: 200, body: { ok: true } };
}

export function billingBlocksSearch(user) {
  if (!user) {
    return false;
  }

  if (["past_due", "canceled"].includes(user.billing_status)) {
    return true;
  }

  if (user.billing_status === "canceling" && user.billing_access_until) {
    const accessUntil = Date.parse(user.billing_access_until);
    return Number.isFinite(accessUntil) && accessUntil <= Date.now();
  }

  return false;
}

export function syncAsaasSettingsFromEnv() {
  const envApiKey = normalizeAsaasApiKey(process.env.ASAAS_API_KEY || "");
  if (envApiKey && !getSetting("asaas_api_key")) {
    setSetting("asaas_api_key", envApiKey);
  }
  if (process.env.ASAAS_WEBHOOK_TOKEN && !getSetting("asaas_webhook_token")) {
    setSetting("asaas_webhook_token", String(process.env.ASAAS_WEBHOOK_TOKEN).trim());
  }

  const configuredKey = getSetting("asaas_api_key") || envApiKey;
  if (configuredKey) {
    const environment = detectAsaasEnvironment(
      configuredKey,
      process.env.ASAAS_ENVIRONMENT || getSetting("asaas_environment") || "sandbox",
    );
    setSetting("asaas_environment", environment);
    setSetting("asaas_endpoint", environment === "production" ? PRODUCTION_URL : SANDBOX_URL);
    setSetting("asaas_enabled", "true");
  } else if (process.env.ASAAS_ENABLED) {
    setSetting("asaas_enabled", String(process.env.ASAAS_ENABLED).trim().toLowerCase());
  }
}

function resolvePlanOffer(body, settings) {
  const plan = body.plan === "scale" ? "scale" : body.plan === "starter" ? "starter" : "";
  const cycle = body.cycle === "yearly" ? "yearly" : "monthly";
  if (!plan) {
    throw new Error("Escolha um plano pago.");
  }

  const key = `${plan}_${cycle === "yearly" ? "yearly" : "monthly"}`;
  const fallback = plan === "scale"
    ? cycle === "yearly" ? 359.1 : 39.9
    : cycle === "yearly" ? 179.1 : 19.9;
  const value = Number(settings[key] || fallback);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Valor do plano invalido.");
  }

  const searches = plan === "scale" ? null : Number(settings.starter_search_limit || 10);
  const planName = plan === "scale" ? "Ilimitado" : "10 pesquisas";
  const period = cycle === "yearly" ? "anual" : "mensal no cartao";

  return {
    plan,
    cycle,
    value: Number(value.toFixed(2)),
    searchLimit: searches,
    description: `Busca Vendas - Confweb ${planName} ${period}`,
  };
}

function paymentRuleForOffer(offer, body) {
  if (offer.cycle === "yearly") {
    return {
      billingType: normalizeBillingType(body.billingType),
      chargeMode: "single",
    };
  }

  return {
    billingType: "CREDIT_CARD",
    chargeMode: "subscription",
  };
}

async function normalizeCreditCardCheckoutBody(body) {
  const holder = body.creditCardHolderInfo || {};
  const addressNumber = String(holder.addressNumber || "").trim();
  if (!addressNumber) {
    throw new Error("Informe o número do endereço do titular do cartão.");
  }

  const address = await lookupBrazilianPostalCode(holder.postalCode);
  return {
    ...body,
    creditCardHolderInfo: {
      ...holder,
      postalCode: address.cep,
      addressNumber,
    },
  };
}

async function ensureAsaasCustomer(user, body) {
  if (user.asaas_customer_id) {
    await updateAsaasCustomer(user.asaas_customer_id, user, body).catch(() => {});
    return user.asaas_customer_id;
  }

  const payload = customerPayload(user, body);
  const created = await asaasRequest("/customers", { method: "POST", body: payload });
  if (!created.id) {
    throw new Error("Asaas não retornou o ID do cliente.");
  }
  db.prepare("UPDATE users SET asaas_customer_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(created.id, user.id);
  return created.id;
}

async function updateAsaasCustomer(customerId, user, body) {
  return asaasRequest(`/customers/${encodeURIComponent(customerId)}`, {
    method: "PUT",
    body: customerPayload(user, body),
  });
}

function customerPayload(user, body) {
  return stripEmpty({
    name: String(body.name || user.name || "").trim(),
    email: String(body.email || user.email || "").trim(),
    mobilePhone: digits(body.phone || user.phone || ""),
    cpfCnpj: digits(body.cpfCnpj || ""),
    externalReference: `busca-vendas-user-${user.id}`,
    notificationDisabled: false,
    groupName: "Busca Vendas - Confweb",
  });
}

function creditCardPayload(body, remoteIp) {
  const card = body.creditCard || {};
  const holder = body.creditCardHolderInfo || {};
  const payload = {
    creditCard: stripEmpty({
      holderName: card.holderName,
      number: digits(card.number || ""),
      expiryMonth: digits(card.expiryMonth || ""),
      expiryYear: digits(card.expiryYear || ""),
      ccv: digits(card.ccv || ""),
    }),
    creditCardHolderInfo: stripEmpty({
      name: holder.name || card.holderName || body.name,
      email: holder.email || body.email,
      cpfCnpj: digits(holder.cpfCnpj || body.cpfCnpj || ""),
      postalCode: digits(holder.postalCode || ""),
      addressNumber: holder.addressNumber,
      phone: digits(holder.phone || body.phone || ""),
    }),
    remoteIp,
  };

  const missingCard = ["holderName", "number", "expiryMonth", "expiryYear", "ccv"].filter((field) => !payload.creditCard[field]);
  const missingHolder = ["name", "email", "cpfCnpj", "postalCode", "addressNumber", "phone"].filter((field) => !payload.creditCardHolderInfo[field]);
  if (missingCard.length || missingHolder.length) {
    throw new Error("Preencha todos os dados do cartão, titular, CPF/CNPJ, CEP, número e telefone.");
  }
  if (!isValidCreditCardNumber(payload.creditCard.number)) {
    throw new Error("Confira o número do cartão. Ele parece ter sido digitado incorretamente.");
  }
  const expiryMonth = Number(payload.creditCard.expiryMonth);
  const expiryYear = Number(payload.creditCard.expiryYear);
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth() + 1;
  if (expiryMonth < 1 || expiryMonth > 12) {
    throw new Error("Informe um mês de validade entre 01 e 12.");
  }
  if (
    !Number.isInteger(expiryYear)
    || expiryYear < currentYear
    || (expiryYear === currentYear && expiryMonth < currentMonth)
  ) {
    throw new Error("Informe uma data de validade futura.");
  }
  if (![3, 4].includes(String(payload.creditCard.ccv).length)) {
    throw new Error("O CVV deve ter 3 ou 4 números.");
  }
  if (payload.creditCardHolderInfo.cpfCnpj.length !== 11 && payload.creditCardHolderInfo.cpfCnpj.length !== 14) {
    throw new Error("Informe um CPF ou CNPJ válido.");
  }
  if (payload.creditCardHolderInfo.postalCode.length !== 8) {
    throw new Error("Informe um CEP com 8 números.");
  }

  return payload;
}

async function findFirstSubscriptionPayment(subscriptionId, attempts = 4) {
  if (!subscriptionId) {
    return null;
  }
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await asaasRequest(`/subscriptions/${encodeURIComponent(subscriptionId)}/payments?limit=1`, { method: "GET" }).catch(() => null);
    if (result?.data?.[0]) {
      return result.data[0];
    }
    if (attempt < attempts - 1) {
      await wait(450 * (attempt + 1));
    }
  }
  return null;
}

async function getPaymentPixQrCode(paymentId, attempts = 4) {
  if (!paymentId) {
    return null;
  }
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const qrCode = await asaasRequest(`/payments/${encodeURIComponent(paymentId)}/pixQrCode`, { method: "GET" }).catch(() => null);
    if (qrCode?.encodedImage || qrCode?.payload) {
      return qrCode;
    }
    if (attempt < attempts - 1) {
      await wait(500 * (attempt + 1));
    }
  }
  return null;
}

async function asaasRequest(path, { method = "GET", body } = {}) {
  const key = asaasApiKey();
  if (!key) {
    throw new Error("API Key da Asaas não configurada.");
  }

  const response = await fetch(`${asaasBaseUrl()}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "BuscaVendasConfweb/1.0 (Node.js)",
      access_token: key,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const data = text ? safeJson(text) : {};
  if (!response.ok) {
    throw new AsaasRequestError(data, response.status);
  }
  return data;
}

function saveFinanceRecord({ user, offer, billingType, chargeMode, status, providerResult, firstPayment, invoiceUrl, pixQrCode, externalReference }) {
  const result = db.prepare(`
    INSERT INTO finance_records (
      user_id, type, description, amount, status, due_date, paid_at,
      provider, external_id, provider_payment_id, provider_subscription_id,
      external_reference, payment_url, pix_payload, plan, billing_cycle, billing_type
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    user.id,
    chargeMode === "single" ? "asaas_payment" : "asaas_subscription",
    offer.description,
    offer.value,
    financeStatusFromAsaas(status),
    firstPayment?.dueDate || providerResult.nextDueDate || isoDate(),
    PAID_STATUSES.has(status) ? isoDateTime() : null,
    "asaas",
    firstPayment?.id || providerResult.id || null,
    firstPayment?.id || null,
    chargeMode === "subscription" ? providerResult.id : null,
    externalReference,
    invoiceUrl || null,
    pixQrCode?.payload || pixQrCode?.encodedImage || null,
    offer.plan,
    offer.cycle,
    billingType,
  );
  return result.lastInsertRowid;
}

function findFinanceRecord({ providerId = "", subscriptionId = "", externalReference = "" } = {}) {
  if (providerId) {
    const direct = db.prepare(`
      SELECT *
      FROM finance_records
      WHERE provider = 'asaas'
        AND (external_id = ? OR provider_payment_id = ?)
      ORDER BY id DESC
      LIMIT 1
    `).get(providerId, providerId);
    if (direct) {
      return direct;
    }
  }

  if (subscriptionId) {
    const subscription = db.prepare(`
      SELECT *
      FROM finance_records
      WHERE provider = 'asaas' AND provider_subscription_id = ?
      ORDER BY id DESC
      LIMIT 1
    `).get(subscriptionId);
    if (subscription) {
      return subscription;
    }
  }

  if (externalReference) {
    return db.prepare(`
      SELECT *
      FROM finance_records
      WHERE provider = 'asaas' AND external_reference = ?
      ORDER BY id DESC
      LIMIT 1
    `).get(externalReference) || null;
  }

  return null;
}

function saveWebhookPayment({
  row,
  userId,
  offer,
  providerId,
  subscriptionId,
  externalReference,
  status,
  value,
  paymentUrl,
  resource,
  eventName,
}) {
  const isRenewal = Boolean(
    row
    && providerId
    && subscriptionId
    && row.provider_payment_id
    && row.provider_payment_id !== providerId,
  );
  const paidAt = PAID_STATUSES.has(status) ? isoDateTime() : null;
  const financeStatus = financeStatusFromAsaas(status);

  if (!row || isRenewal) {
    const result = db.prepare(`
      INSERT INTO finance_records (
        user_id, type, description, amount, status, due_date, paid_at,
        provider, external_id, provider_payment_id, provider_subscription_id,
        external_reference, payment_url, plan, billing_cycle, billing_type
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'asaas', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      isRenewal ? "asaas_renewal" : "asaas_webhook",
      row?.description || offer?.description || `Webhook Asaas ${eventName || status}`.trim(),
      value || row?.amount || offer?.value || 0,
      financeStatus,
      resource.dueDate || row?.due_date || null,
      paidAt,
      providerId || null,
      providerId || null,
      subscriptionId || row?.provider_subscription_id || null,
      externalReference || row?.external_reference || null,
      paymentUrl || row?.payment_url || null,
      offer?.plan || row?.plan || null,
      offer?.cycle || row?.billing_cycle || null,
      resource.billingType || row?.billing_type || null,
    );
    return db.prepare("SELECT * FROM finance_records WHERE id = ?").get(result.lastInsertRowid);
  }

  db.prepare(`
    UPDATE finance_records
    SET status = ?,
        amount = COALESCE(NULLIF(?, 0), amount),
        due_date = COALESCE(NULLIF(?, ''), due_date),
        paid_at = CASE WHEN ? IS NOT NULL THEN ? ELSE paid_at END,
        external_id = COALESCE(NULLIF(?, ''), external_id),
        provider_payment_id = COALESCE(NULLIF(?, ''), provider_payment_id),
        provider_subscription_id = COALESCE(NULLIF(?, ''), provider_subscription_id),
        external_reference = COALESCE(NULLIF(?, ''), external_reference),
        payment_url = COALESCE(NULLIF(?, ''), payment_url),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    financeStatus,
    value,
    resource.dueDate || "",
    paidAt,
    paidAt,
    providerId || "",
    providerId || "",
    subscriptionId || "",
    externalReference || "",
    paymentUrl || "",
    row.id,
  );
  return db.prepare("SELECT * FROM finance_records WHERE id = ?").get(row.id);
}

function activateUserPlan(userId, offer, billing = {}) {
  db.prepare(`
    UPDATE users
    SET plan = ?,
        search_limit = ?,
        searches_used = CASE WHEN ? = 1 THEN 0 ELSE searches_used END,
        billing_status = 'active',
        billing_cycle = ?,
        billing_provider_subscription_id = CASE
          WHEN NULLIF(?, '') IS NOT NULL THEN ?
          ELSE billing_provider_subscription_id
        END,
        billing_payment_url = CASE
          WHEN NULLIF(?, '') IS NOT NULL THEN ?
          ELSE billing_payment_url
        END,
        billing_access_until = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    offer.plan,
    offer.searchLimit,
    billing.resetUsage ? 1 : 0,
    offer.cycle,
    billing.subscriptionId || "",
    billing.subscriptionId || "",
    billing.paymentUrl || "",
    billing.paymentUrl || "",
    userId,
  );
}

function suspendRecurringPlan(userId, { subscriptionId = "", paymentUrl = "" } = {}) {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!user || !["starter", "scale"].includes(user.plan)) {
    return;
  }
  if (
    user.billing_provider_subscription_id
    && subscriptionId
    && user.billing_provider_subscription_id !== subscriptionId
  ) {
    return;
  }

  db.prepare(`
    UPDATE users
    SET billing_status = 'past_due',
        billing_provider_subscription_id = CASE
          WHEN NULLIF(?, '') IS NOT NULL THEN ?
          ELSE billing_provider_subscription_id
        END,
        billing_payment_url = CASE
          WHEN NULLIF(?, '') IS NOT NULL THEN ?
          ELSE billing_payment_url
        END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    subscriptionId,
    subscriptionId,
    paymentUrl,
    paymentUrl,
    userId,
  );
}

function scheduleSubscriptionCancellation(userId, { subscriptionId = "", nextDueDate = "" } = {}) {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!user || !["starter", "scale"].includes(user.plan)) {
    return;
  }
  if (
    user.billing_provider_subscription_id
    && subscriptionId
    && user.billing_provider_subscription_id !== subscriptionId
  ) {
    return;
  }

  const accessUntil = subscriptionAccessUntil(userId, user.billing_cycle, nextDueDate);
  const status = Date.parse(accessUntil) > Date.now() ? "canceling" : "canceled";
  db.prepare(`
    UPDATE users
    SET billing_status = ?,
        billing_access_until = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(status, accessUntil, userId);
}

function subscriptionAccessUntil(userId, cycle, nextDueDate) {
  const parsedNextDueDate = Date.parse(nextDueDate);
  if (Number.isFinite(parsedNextDueDate)) {
    return new Date(parsedNextDueDate).toISOString();
  }

  const lastPaid = db.prepare(`
    SELECT paid_at, due_date, billing_cycle
    FROM finance_records
    WHERE user_id = ? AND provider = 'asaas' AND status = 'paid'
    ORDER BY COALESCE(paid_at, created_at) DESC
    LIMIT 1
  `).get(userId);
  const baseDate = new Date(lastPaid?.paid_at || lastPaid?.due_date || Date.now());
  const billingCycle = lastPaid?.billing_cycle || cycle;
  if (billingCycle === "yearly") {
    baseDate.setUTCFullYear(baseDate.getUTCFullYear() + 1);
  } else {
    baseDate.setUTCMonth(baseDate.getUTCMonth() + 1);
  }
  return baseDate.toISOString();
}

function offerFromReference(referenceInfo) {
  const settings = Object.fromEntries(db.prepare("SELECT key, value FROM settings").all().map((row) => [row.key, row.value]));
  return resolvePlanOffer(referenceInfo, settings);
}

function offerFromFinanceRecord(record) {
  const settings = Object.fromEntries(db.prepare("SELECT key, value FROM settings").all().map((row) => [row.key, row.value]));
  return resolvePlanOffer({
    plan: record.plan,
    cycle: record.billing_cycle,
  }, settings);
}

function parseExternalReference(value = "") {
  const parts = String(value || "").split(":");
  if (parts[0] !== "bv") {
    return {};
  }
  return {
    userId: Number(parts[1]) || null,
    plan: parts[2],
    cycle: parts[3],
    chargeMode: parts[4],
  };
}

function checkoutMessage({ billingType, status, invoiceUrl, pixQrCode }) {
  if (PAID_STATUSES.has(status)) {
    return "Pagamento aprovado. Plano liberado.";
  }
  if (FAILED_STATUSES.has(status)) {
    return "Pagamento não aprovado. Confira os dados informados e tente novamente.";
  }
  if (billingType === "PIX" && pixQrCode) {
    return "Pix anual gerado. A liberação acontece automaticamente após a confirmação do pagamento.";
  }
  if (invoiceUrl) {
    return "Cobranca criada. Abra o link seguro da Asaas para concluir.";
  }
  return "Cobrança criada. Aguarde a confirmação do pagamento.";
}

function effectiveAsaasStatus(eventName, status) {
  const normalizedStatus = String(status || "").trim().toUpperCase();
  const eventStatus = String(eventName || "").replace(/^PAYMENT_/, "");
  if (
    PAID_STATUSES.has(eventStatus)
    || FAILED_STATUSES.has(eventStatus)
    || PAYMENT_FAILURE_EVENTS.has(eventName)
  ) {
    return eventStatus;
  }
  return normalizedStatus;
}

function financeStatusFromAsaas(status = "") {
  if (PAID_STATUSES.has(status)) return "paid";
  if (FAILED_STATUSES.has(status)) return "canceled";
  return "pending";
}

function normalizeBillingType(value) {
  if (value === "CREDIT_CARD") return "CREDIT_CARD";
  return "PIX";
}

function asaasApiKey() {
  return normalizeAsaasApiKey(getSetting("asaas_api_key") || process.env.ASAAS_API_KEY || "");
}

function asaasEnvironment() {
  return (getSetting("asaas_environment") || process.env.ASAAS_ENVIRONMENT || "sandbox").trim() === "production"
    ? "production"
    : "sandbox";
}

function asaasBaseUrl() {
  const endpoint = (getSetting("asaas_endpoint") || process.env.ASAAS_ENDPOINT || "").trim();
  if (endpoint) {
    return endpoint.replace(/\/+$/, "");
  }
  return asaasEnvironment() === "production" ? PRODUCTION_URL : SANDBOX_URL;
}

function asaasErrorMessage(data, status) {
  const details = Array.isArray(data?.errors)
    ? data.errors.map((error) => error.description || error.message || error.code).filter(Boolean).join(" ")
    : data?.message || data?.error || "";
  return `Asaas respondeu ${status}${details ? `: ${details}` : "."}`;
}

class AsaasRequestError extends Error {
  constructor(data, status) {
    super(asaasErrorMessage(data, status));
    this.name = "AsaasRequestError";
    this.statusCode = status;
    this.providerCode = Array.isArray(data?.errors)
      ? data.errors.map((error) => error.code).filter(Boolean).join(",")
      : "";
  }
}

async function readJsonFromRequest(req) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > 256 * 1024) {
      const error = new Error("Webhook maior do que o limite permitido.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? safeJson(raw) : {};
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function stripEmpty(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && String(item).trim() !== ""));
}

function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

function isoDate() {
  return new Date().toISOString().slice(0, 10);
}

function isoDateTime() {
  return new Date().toISOString();
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
