import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const tempDir = mkdtempSync(join(tmpdir(), "busca-vendas-scrapedo-depth-"));
process.env.DB_PATH = join(tempDir, "scrapedo-depth.sqlite");

const { db, initDatabase, setSetting } = await import("../server/db.mjs");
const {
  ensureScrapeDoSearchDepth,
  scrapeDoSearchPolicy,
  shouldUseScrapeDoItemCache,
} = await import("../server/scrapedo.mjs");

initDatabase();

after(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

test("migra a varredura curta que deixava buscas novas sem Top 3", () => {
  setSetting("scrapedo_search_pages", "2");
  setSetting("scrapedo_detail_limit", "9");

  ensureScrapeDoSearchDepth();

  assert.deepEqual(scrapeDoSearchPolicy(), {
    pages: 4,
    detailLimit: 36,
  });
});

test("preserva uma profundidade maior configurada para a fonte", () => {
  setSetting("scrapedo_search_pages", "4");
  setSetting("scrapedo_detail_limit", "48");

  ensureScrapeDoSearchDepth();

  assert.deepEqual(scrapeDoSearchPolicy(), {
    pages: 4,
    detailLimit: 48,
  });
});

test("ignora o cache individual de anuncios em uma atualizacao forcada", () => {
  assert.equal(shouldUseScrapeDoItemCache(), true);
  assert.equal(shouldUseScrapeDoItemCache({ forceRefresh: false }), true);
  assert.equal(shouldUseScrapeDoItemCache({ forceRefresh: true }), false);
});
