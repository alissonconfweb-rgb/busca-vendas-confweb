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
  isUsableMercadoLivreHtml,
  rankCandidatesByPublicSales,
  scrapeDoSearchPolicy,
  shouldUseScrapeDoItemCache,
} = await import("../server/scrapedo.mjs");

initDatabase();

after(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

test("migra a varredura antiga para a politica de baixa latencia", () => {
  setSetting("scrapedo_search_pages", "2");
  setSetting("scrapedo_detail_limit", "9");

  ensureScrapeDoSearchDepth();

  assert.deepEqual(scrapeDoSearchPolicy(), {
    pages: 1,
    detailLimit: 12,
    candidateTarget: 6,
    detailConcurrency: 3,
  });
});

test("preserva a politica otimizada depois da migracao", () => {
  setSetting("scrapedo_latency_policy_version", "2");
  setSetting("scrapedo_search_pages", "4");
  setSetting("scrapedo_detail_limit", "48");

  ensureScrapeDoSearchDepth();

  assert.deepEqual(scrapeDoSearchPolicy(), {
    pages: 2,
    detailLimit: 18,
    candidateTarget: 6,
    detailConcurrency: 3,
  });
});

test("inspeciona a amostra planejada antes de fechar o ranking", () => {
  assert.equal(hasEnoughInspectedCandidates({
    championCount: 3,
    verifiedCount: 3,
    inspectedCount: 4,
    sampleTarget: 12,
  }), false);
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

test("aceita a pagina valida do Mercado Livre mesmo quando a Scrape.do repassa status 404", () => {
  const mercadoLivreHtml = `<!doctype html><html lang="pt-BR"><head><base href="https://lista.mercadolivre.com.br/produto"><script src="search-nordic.js"></script></head></html>`;

  assert.equal(isUsableMercadoLivreHtml(404, mercadoLivreHtml), true);
  assert.equal(isUsableMercadoLivreHtml(404, "<html><body>Not found</body></html>"), false);
  assert.equal(isUsableMercadoLivreHtml(500, mercadoLivreHtml), false);
  assert.equal(isUsableMercadoLivreHtml(200, "qualquer resposta"), true);
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
