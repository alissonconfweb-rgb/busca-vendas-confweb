import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const databasePath = join(tmpdir(), `busca-vendas-asaas-env-${process.pid}.sqlite`);
process.env.DB_PATH = databasePath;

const { db } = await import("../server/db.mjs");
const { detectAsaasEnvironment, normalizeAsaasApiKey } = await import("../server/asaas.mjs");

test("detecta chaves do sandbox e de produção", () => {
  assert.equal(detectAsaasEnvironment("$aact_hmlg_abc123"), "sandbox");
  assert.equal(detectAsaasEnvironment("$aact_prod_abc123"), "production");
});

test("normaliza uma chave copiada com espaços e aspas", () => {
  assert.equal(normalizeAsaasApiKey('  "$aact_prod_abc123"  '), "$aact_prod_abc123");
});

test.after(() => {
  db.close();
  rmSync(databasePath, { force: true });
  rmSync(`${databasePath}-wal`, { force: true });
  rmSync(`${databasePath}-shm`, { force: true });
});
