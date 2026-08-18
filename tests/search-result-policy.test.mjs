import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const tempDir = mkdtempSync(join(tmpdir(), "busca-vendas-result-policy-"));
process.env.DB_PATH = join(tempDir, "result-policy.sqlite");

const { db, initDatabase, setSetting } = await import("../server/db.mjs");
const {
  isCompleteChampionResult,
  isCompleteDevelopingOpportunityResult,
  isCompleteEmergingOpportunityResult,
  isCompleteRealSalesResult,
} = await import("../server/search-result-policy.mjs");

initDatabase();
setSetting("min_champion_sales", "1000");

after(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

function resultWithSales(sales, opportunityMode) {
  const items = sales.map((soldQuantity, index) => ({
    id: String(index + 1),
    title: `Produto real ${index + 1}`,
    price: 50,
    soldQuantity,
    revenue: soldQuantity * 50,
  }));
  const demand = sales.reduce((total, value) => total + value, 0);
  return {
    ok: true,
    salesAvailable: true,
    opportunityMode,
    items,
    totals: {
      demand,
      revenue: demand * 50,
      averageTicket: 50,
    },
  };
}

test("aceita Top 3 consolidado quando todos passam de mil vendas", () => {
  const result = resultWithSales([10_000, 5_000, 1_000]);

  assert.equal(isCompleteChampionResult(result), true);
  assert.equal(isCompleteRealSalesResult(result), true);
});

test("aceita mercado pouco explorado somente com tres vendas reais abaixo de mil", () => {
  const result = resultWithSales([900, 450, 120], "emerging");

  assert.equal(isCompleteEmergingOpportunityResult(result), true);
  assert.equal(isCompleteRealSalesResult(result), true);
});

test("rejeita oportunidade se algum anuncio atingir mil vendas", () => {
  const result = resultWithSales([1_000, 450, 120], "emerging");

  assert.equal(isCompleteEmergingOpportunityResult(result), false);
  assert.equal(isCompleteRealSalesResult(result), false);
});

test("rejeita oportunidade sem tres anuncios com metricas completas", () => {
  const result = resultWithSales([900, 450, 120], "emerging");
  result.items[2].revenue = 0;

  assert.equal(isCompleteEmergingOpportunityResult(result), false);
  assert.equal(isCompleteRealSalesResult(result), false);
});

test("aceita tres lideres reais quando o mercado mistura anuncios acima e abaixo de mil", () => {
  const result = resultWithSales([5_000, 1_000, 450], "developing");

  assert.equal(isCompleteDevelopingOpportunityResult(result), true);
  assert.equal(isCompleteRealSalesResult(result), true);
});

test("rejeita oportunidade real com menos de tres anuncios", () => {
  const result = resultWithSales([500, 25], "emerging");

  assert.equal(isCompleteEmergingOpportunityResult(result), false);
  assert.equal(isCompleteRealSalesResult(result), false);
});

test("rejeita mercado em desenvolvimento com apenas um lider", () => {
  const result = resultWithSales([1_000], "developing");

  assert.equal(isCompleteDevelopingOpportunityResult(result), false);
  assert.equal(isCompleteRealSalesResult(result), false);
});

test("continua rejeitando resultado vazio", () => {
  const result = resultWithSales([], "emerging");

  assert.equal(isCompleteRealSalesResult(result), false);
});
