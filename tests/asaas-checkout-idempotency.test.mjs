import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const databasePath = join(tmpdir(), `busca-vendas-checkout-${process.pid}.sqlite`);
process.env.DB_PATH = databasePath;

const { db, initDatabase, setSetting } = await import("../server/db.mjs");
const { createAsaasCheckout } = await import("../server/asaas.mjs");

initDatabase();
setSetting("asaas_api_key", "$aact_hmlg_teste");
setSetting("asaas_environment", "sandbox");

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("repetir a mesma tentativa devolve o checkout salvo sem criar outra cobranca", async () => {
  let paymentCreates = 0;
  globalThis.fetch = async (url, options = {}) => {
    const pathname = new URL(String(url)).pathname;
    if (pathname.endsWith("/customers") && options.method === "POST") {
      return Response.json({ id: "cus_idempotente" });
    }
    if (pathname.endsWith("/payments") && options.method === "POST") {
      paymentCreates += 1;
      const payload = JSON.parse(options.body);
      return Response.json({
        id: "pay_idempotente",
        status: "PENDING",
        value: payload.value,
        externalReference: payload.externalReference,
        invoiceUrl: "https://sandbox.asaas.com/i/pay_idempotente",
      });
    }
    if (pathname.endsWith("/pixQrCode")) {
      return Response.json({ payload: "pix-copia-cola", encodedImage: "imagem" });
    }
    throw new Error(`Endpoint inesperado no teste: ${pathname}`);
  };

  const userId = db.prepare(`
    INSERT INTO users (name, email, phone, password_hash, plan, search_limit)
    VALUES ('Cliente', 'checkout-idempotente@teste.local', '11999999999', 'hash', 'free', 1)
  `).run().lastInsertRowid;
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  const body = {
    idempotencyKey: "checkout_teste_idempotente_001",
    plan: "starter",
    cycle: "yearly",
    billingType: "PIX",
    chargeMode: "single",
    cpfCnpj: "12345678901",
    phone: "11999999999",
    name: "Cliente",
    email: user.email,
  };
  const settings = { starter_yearly: "179.10", starter_search_limit: "10" };

  const first = await createAsaasCheckout({ user, body, settings, remoteIp: "127.0.0.1" });
  const replay = await createAsaasCheckout({ user, body, settings, remoteIp: "127.0.0.1" });
  const otherDeviceReplay = await createAsaasCheckout({
    user,
    body: { ...body, idempotencyKey: "checkout_outro_dispositivo_002" },
    settings,
    remoteIp: "127.0.0.2",
  });

  assert.equal(first.financeId, replay.financeId);
  assert.equal(first.financeId, otherDeviceReplay.financeId);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(otherDeviceReplay.idempotentReplay, true);
  assert.equal(paymentCreates, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM finance_records").get().total, 1);
  assert.equal(db.prepare("SELECT status FROM checkout_attempts").get().status, "completed");
});

test.after(() => {
  db.close();
  rmSync(databasePath, { force: true });
  rmSync(`${databasePath}-wal`, { force: true });
  rmSync(`${databasePath}-shm`, { force: true });
});
