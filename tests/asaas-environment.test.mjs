import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const databasePath = join(tmpdir(), `busca-vendas-asaas-env-${process.pid}.sqlite`);
process.env.DB_PATH = databasePath;

const { db } = await import("../server/db.mjs");
const {
  detectAsaasEnvironment,
  isValidCreditCardNumber,
  normalizeAsaasApiKey,
  publicAsaasCheckoutError,
} = await import("../server/asaas.mjs");

test("detecta chaves do sandbox e de produção", () => {
  assert.equal(detectAsaasEnvironment("$aact_hmlg_abc123"), "sandbox");
  assert.equal(detectAsaasEnvironment("$aact_prod_abc123"), "production");
});

test("normaliza uma chave copiada com espaços e aspas", () => {
  assert.equal(normalizeAsaasApiKey('  "$aact_prod_abc123"  '), "$aact_prod_abc123");
});

test("valida o número do cartão antes de chamar o Asaas", () => {
  assert.equal(isValidCreditCardNumber("4111 1111 1111 1111"), true);
  assert.equal(isValidCreditCardNumber("4111 1111 1111 1112"), false);
  assert.equal(isValidCreditCardNumber("1111 1111 1111 1111"), false);
});

test("traduz recusa do Asaas sem expor o erro bruto ao comprador", () => {
  const error = new Error("Asaas respondeu 400: Transação não autorizada.");
  error.name = "AsaasRequestError";
  error.statusCode = 400;
  error.providerCode = "invalid_creditCard";

  assert.equal(
    publicAsaasCheckoutError(error),
    "Não foi possível autorizar este cartão. Confira o número, a validade, o CVV e os dados do titular. Nenhuma cobrança foi realizada. Se estiver tudo correto, tente outro cartão.",
  );
});

test.after(() => {
  db.close();
  rmSync(databasePath, { force: true });
  rmSync(`${databasePath}-wal`, { force: true });
  rmSync(`${databasePath}-shm`, { force: true });
});
