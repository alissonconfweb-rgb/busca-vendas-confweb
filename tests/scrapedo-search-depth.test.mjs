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
  hasEnoughInspectedCandidates,
  rankCandidatesByPublicSales,
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
    candidateTarget: 12,
    detailConcurrency: 4,
  });
});

test("preserva uma profundidade maior configurada para a fonte", () => {
  setSetting("scrapedo_search_pages", "4");
  setSetting("scrapedo_detail_limit", "48");

  ensureScrapeDoSearchDepth();

  assert.deepEqual(scrapeDoSearchPolicy(), {
    pages: 4,
    detailLimit: 48,
    candidateTarget: 12,
    detailConcurrency: 4,
  });
});

test("encerra a validacao assim que encontra tres campeoes reais", () => {
  assert.equal(hasEnoughInspectedCandidates({
    championCount: 3,
    verifiedCount: 3,
    inspectedCount: 4,
    sampleTarget: 12,
  }), true);
  assert.equal(hasEnoughInspectedCandidates({
    championCount: 2,
    verifiedCount: 4,
    inspectedCount: 4,
    sampleTarget: 12,
  }), false);
  assert.equal(hasEnoughInspectedCandidates({
    championCount: 0,
    verifiedCount: 8,
    inspectedCount: 12,
    sampleTarget: 12,
  }), true);
});

test("ignora o cache individual de anuncios em uma atualizacao forcada", () => {
  assert.equal(shouldUseScrapeDoItemCache(), true);
  assert.equal(shouldUseScrapeDoItemCache({ forceRefresh: false }), true);
  assert.equal(shouldUseScrapeDoItemCache({ forceRefresh: true }), false);
});

test("ordena toda a listagem pelas vendas antes de escolher os tres campeoes", () => {
  const ranked = rankCandidatesByPublicSales([
    { id: "a", position: 1, soldQuantity: 10_000 },
    { id: "b", position: 2, soldQuantity: 5_000 },
    { id: "c", position: 3, soldQuantity: 1_000 },
    { id: "d", position: 8, soldQuantity: 50_000 },
  ]);

  assert.deepEqual(ranked.slice(0, 3).map((item) => item.id), ["d", "a", "b"]);
});
