import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";

const databasePath = join(tmpdir(), `busca-vendas-webhook-${process.pid}.sqlite`);
process.env.DB_PATH = databasePath;

const { db, initDatabase, setSetting } = await import("../server/db.mjs");
const { billingBlocksSearch, handleAsaasWebhook } = await import("../server/asaas.mjs");

initDatabase();
setSetting("asaas_webhook_token", "token-seguro-de-teste-asaas-confweb");

let webhookSequence = 0;

function webhookRequest(payload) {
  const normalizedPayload = payload.id
    ? payload
    : { id: `evt_test_${++webhookSequence}`, ...payload };
  const request = Readable.from([Buffer.from(JSON.stringify(normalizedPayload))]);
  request.headers = { "asaas-access-token": "token-seguro-de-teste-asaas-confweb" };
  return request;
}

test("rejeita webhook sem o token correto", async () => {
  const request = webhookRequest({ event: "PAYMENT_CONFIRMED" });
  request.headers = { "asaas-access-token": "token-incorreto" };
  const result = await handleAsaasWebhook(request, "https://buscavendas.confweb.com.br");
  assert.equal(result.status, 401);
});

test("bloqueia renovação recusada e reativa após confirmação", async () => {
  const userResult = db.prepare(`
    INSERT INTO users (
      name, email, phone, password_hash, role, status, plan, search_limit,
      searches_used, billing_status, billing_cycle, billing_provider_subscription_id
    )
    VALUES (?, ?, ?, ?, 'user', 'active', 'scale', NULL, 7, 'active', 'monthly', ?)
  `).run("Cliente Teste", "cliente-webhook@teste.local", "11999999999", "hash", "sub_test_1");
  const userId = userResult.lastInsertRowid;
  const externalReference = `bv:${userId}:scale:monthly:subscription:teste`;

  db.prepare(`
    INSERT INTO finance_records (
      user_id, type, description, amount, status, provider,
      external_id, provider_payment_id, provider_subscription_id,
      external_reference, payment_url, plan, billing_cycle, billing_type
    )
    VALUES (?, 'asaas_subscription', 'Plano mensal', 39.9, 'paid', 'asaas',
      'pay_initial', 'pay_initial', 'sub_test_1', ?, ?, 'scale', 'monthly', 'CREDIT_CARD')
  `).run(userId, externalReference, "https://sandbox.asaas.com/i/pay_initial");

  await handleAsaasWebhook(webhookRequest({
    event: "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED",
    payment: {
      id: "pay_renewal",
      subscription: "sub_test_1",
      status: "PENDING",
      value: 39.9,
      externalReference,
      invoiceUrl: "https://sandbox.asaas.com/i/pay_renewal",
    },
  }), "https://buscavendas.confweb.com.br");

  const pendingUser = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  assert.equal(pendingUser.billing_status, "past_due");
  assert.equal(pendingUser.billing_payment_url, "https://sandbox.asaas.com/i/pay_renewal");
  assert.equal(billingBlocksSearch(pendingUser), true);

  await handleAsaasWebhook(webhookRequest({
    event: "PAYMENT_CONFIRMED",
    payment: {
      id: "pay_renewal",
      subscription: "sub_test_1",
      status: "CONFIRMED",
      value: 39.9,
      externalReference,
      invoiceUrl: "https://sandbox.asaas.com/i/pay_renewal",
    },
  }), "https://buscavendas.confweb.com.br");

  const activeUser = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  assert.equal(activeUser.billing_status, "active");
  assert.equal(activeUser.plan, "scale");
  assert.equal(activeUser.searches_used, 0);
  assert.equal(billingBlocksSearch(activeUser), false);

  const nextDueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await handleAsaasWebhook(webhookRequest({
    event: "SUBSCRIPTION_DELETED",
    subscription: {
      id: "sub_test_1",
      status: "INACTIVE",
      externalReference,
      nextDueDate,
    },
  }), "https://buscavendas.confweb.com.br");

  const cancelingUser = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  assert.equal(cancelingUser.billing_status, "canceling");
  assert.equal(billingBlocksSearch(cancelingUser), false);
});

test("uma primeira tentativa recusada mantém o plano grátis disponível", async () => {
  const userResult = db.prepare(`
    INSERT INTO users (
      name, email, phone, password_hash, role, status, plan, search_limit,
      billing_status, billing_cycle
    )
    VALUES (?, ?, ?, ?, 'user', 'active', 'free', 1, 'none', NULL)
  `).run("Cliente Grátis", "cliente-gratis@teste.local", "11999999998", "hash");
  const userId = userResult.lastInsertRowid;
  const externalReference = `bv:${userId}:starter:monthly:subscription:teste`;

  db.prepare(`
    INSERT INTO finance_records (
      user_id, type, description, amount, status, provider,
      provider_subscription_id, external_reference, plan, billing_cycle, billing_type
    )
    VALUES (?, 'asaas_subscription', 'Plano mensal', 19.9, 'pending', 'asaas',
      'sub_test_free', ?, 'starter', 'monthly', 'CREDIT_CARD')
  `).run(userId, externalReference);

  await handleAsaasWebhook(webhookRequest({
    event: "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED",
    payment: {
      id: "pay_free_refused",
      subscription: "sub_test_free",
      status: "PENDING",
      value: 19.9,
      externalReference,
    },
  }), "https://buscavendas.confweb.com.br");

  const freeUser = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  assert.equal(freeUser.plan, "free");
  assert.equal(freeUser.billing_status, "none");
  assert.equal(billingBlocksSearch(freeUser), false);
});

test("reembolso anual bloqueia o acesso mesmo sem assinatura recorrente e é idempotente", async () => {
  const userResult = db.prepare(`
    INSERT INTO users (
      name, email, phone, password_hash, role, status, plan, search_limit,
      searches_used, billing_status, billing_cycle
    )
    VALUES (?, ?, ?, ?, 'user', 'active', 'scale', NULL, 3, 'active', 'yearly')
  `).run("Cliente Anual", "cliente-anual@teste.local", "11999999997", "hash");
  const userId = userResult.lastInsertRowid;
  const externalReference = `bv:${userId}:scale:yearly:single:teste`;
  db.prepare(`
    INSERT INTO finance_records (
      user_id, type, description, amount, status, provider,
      external_id, provider_payment_id, external_reference,
      plan, billing_cycle, billing_type
    ) VALUES (?, 'asaas_payment', 'Plano anual', 359.1, 'paid', 'asaas',
      'pay_yearly', 'pay_yearly', ?, 'scale', 'yearly', 'PIX')
  `).run(userId, externalReference);

  const payload = {
    id: "evt_refund_yearly",
    event: "PAYMENT_REFUNDED",
    payment: {
      id: "pay_yearly",
      status: "REFUNDED",
      value: 359.1,
      externalReference,
    },
  };
  const first = await handleAsaasWebhook(
    webhookRequest(payload),
    "https://buscavendas.confweb.com.br",
  );
  const duplicate = await handleAsaasWebhook(
    webhookRequest(payload),
    "https://buscavendas.confweb.com.br",
  );
  const reorderedDuplicate = await handleAsaasWebhook(
    webhookRequest({
      payment: {
        externalReference,
        value: 359.1,
        status: "REFUNDED",
        id: "pay_yearly",
      },
      event: "PAYMENT_REFUNDED",
      id: "evt_refund_yearly",
    }),
    "https://buscavendas.confweb.com.br",
  );
  const conflictingDuplicate = await handleAsaasWebhook(
    webhookRequest({ ...payload, payment: { ...payload.payment, value: 1 } }),
    "https://buscavendas.confweb.com.br",
  );

  const refundedUser = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  assert.equal(first.status, 200);
  assert.equal(duplicate.body.duplicate, true);
  assert.equal(reorderedDuplicate.body.duplicate, true);
  assert.equal(conflictingDuplicate.status, 409);
  assert.equal(refundedUser.billing_status, "canceled");
  assert.equal(billingBlocksSearch(refundedUser), true);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS total FROM asaas_webhook_events WHERE event_id = ?").get(payload.id).total,
    1,
  );
});

test.after(() => {
  db.close();
  rmSync(databasePath, { force: true });
  rmSync(`${databasePath}-wal`, { force: true });
  rmSync(`${databasePath}-shm`, { force: true });
});
