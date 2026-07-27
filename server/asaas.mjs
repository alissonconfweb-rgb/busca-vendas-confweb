import { db, getSetting, setSetting } from "./db.mjs";
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
]);

export function isAsaasConfigured() {
  return Boolean(asaasApiKey());
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

  const offer = resolvePlanOffer(body, settings);
  const { billingType, chargeMode } = paymentRuleForOffer(offer, body);
  const customerId = await ensureAsaasCustomer(user, body);
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
        ...(billingType === "CREDIT_CARD" ? creditCardPayload(body, remoteIp) : {}),
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
        ...(billingType === "CREDIT_CARD" ? creditCardPayload(body, remoteIp) : {}),
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
    activateUserPlan(user.id, offer);
  }

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
      activateUserPlan(user.id, offerFromFinanceRecord(record));
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
  const payment = event.payment || event.subscription || {};
  const providerId = payment.id || event.id;
  const externalReference = payment.externalReference || event.externalReference || "";
  const status = payment.status || event.status || "";
  const value = Number(payment.value || event.value || 0);

  const row = providerId
    ? db.prepare("SELECT * FROM finance_records WHERE external_id = ? OR provider_payment_id = ? ORDER BY id DESC LIMIT 1").get(providerId, providerId)
    : null;
  const referenceInfo = parseExternalReference(externalReference || row?.external_reference);
  const userId = row?.user_id || referenceInfo.userId || null;
  const offer = referenceInfo.plan
    ? offerFromReference(referenceInfo)
    : null;

  if (row) {
    db.prepare(`
      UPDATE finance_records
      SET status = ?, amount = COALESCE(NULLIF(?, 0), amount), paid_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(financeStatusFromAsaas(status), value, PAID_STATUSES.has(status) ? isoDateTime() : row.paid_at, row.id);
  } else if (userId) {
    db.prepare(`
      INSERT INTO finance_records (user_id, type, description, amount, status, paid_at, provider, external_id, provider_payment_id, external_reference)
      VALUES (?, ?, ?, ?, ?, ?, 'asaas', ?, ?, ?)
    `).run(
      userId,
      "asaas_webhook",
      `Webhook Asaas ${status || event.event || ""}`.trim(),
      value,
      financeStatusFromAsaas(status),
      PAID_STATUSES.has(status) ? isoDateTime() : null,
      providerId || null,
      providerId || null,
      externalReference || null,
    );
  }

  if (userId && offer && PAID_STATUSES.has(status)) {
    activateUserPlan(userId, offer);
  }

  setSetting("asaas_last_event", `${event.event || "evento"} ${status || ""}`.trim());
  setSetting("asaas_last_webhook_url", asaasWebhookUrl(publicUrl));
  return { ok: true, status: 200, body: { ok: true } };
}

export function syncAsaasSettingsFromEnv() {
  const entries = {
    asaas_enabled: process.env.ASAAS_ENABLED,
    asaas_environment: process.env.ASAAS_ENVIRONMENT,
    asaas_api_key: process.env.ASAAS_API_KEY,
    asaas_webhook_token: process.env.ASAAS_WEBHOOK_TOKEN,
  };

  for (const [key, value] of Object.entries(entries)) {
    if (value && !getSetting(key)) {
      setSetting(key, String(value).trim());
    }
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
      expiryMonth: card.expiryMonth,
      expiryYear: card.expiryYear,
      ccv: card.ccv,
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
    throw new Error(asaasErrorMessage(data, response.status));
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

function activateUserPlan(userId, offer) {
  db.prepare(`
    UPDATE users
    SET plan = ?, search_limit = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(offer.plan, offer.searchLimit, userId);
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

function financeStatusFromAsaas(status = "") {
  if (PAID_STATUSES.has(status)) return "paid";
  if (["DELETED", "REFUNDED", "CANCELED", "OVERDUE"].includes(status)) return "canceled";
  return "pending";
}

function normalizeBillingType(value) {
  if (value === "CREDIT_CARD") return "CREDIT_CARD";
  return "PIX";
}

function asaasApiKey() {
  return (getSetting("asaas_api_key") || process.env.ASAAS_API_KEY || "").trim();
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

async function readJsonFromRequest(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
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
