import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const tempDir = mkdtempSync(join(tmpdir(), "busca-vendas-scrapedo-status-"));
process.env.DB_PATH = join(tempDir, "scrapedo-status.sqlite");

const originalFetch = globalThis.fetch;
const { db, initDatabase, setSetting } = await import("../server/db.mjs");
const { testScrapeDoConnection } = await import("../server/scrapedo.mjs");

initDatabase();
setSetting("scrapedo_api_token", "token-de-teste");

after(() => {
  globalThis.fetch = originalFetch;
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

test("diferencia token ativo de conta sem créditos", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    IsActive: true,
    RemainingMonthlyRequest: 0,
    ConcurrentRequest: 5,
  }));

  const result = await testScrapeDoConnection();

  assert.equal(result.ok, true);
  assert.equal(result.active, true);
  assert.equal(result.available, false);
  assert.equal(result.remainingCredits, 0);
});

test("marca a fonte disponível quando ainda há créditos", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    IsActive: true,
    RemainingMonthlyRequest: 250_000,
    ConcurrentRequest: 10,
  }));

  const result = await testScrapeDoConnection();

  assert.equal(result.available, true);
  assert.equal(result.remainingCredits, 250_000);
});
