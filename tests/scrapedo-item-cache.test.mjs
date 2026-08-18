import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const tempDir = mkdtempSync(join(tmpdir(), "busca-vendas-item-cache-"));
process.env.DB_PATH = join(tempDir, "item-cache.sqlite");

const { db, initDatabase, setSetting } = await import("../server/db.mjs");
const { searchMercadoLivreCachedItems } = await import("../server/scrapedo.mjs");

initDatabase();
setSetting("min_champion_sales", "1000");

after(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

function saveItem(id, title, soldQuantity, price) {
  const item = {
    id,
    title,
    href: `https://produto.mercadolivre.com.br/${id}`,
    image: "https://http2.mlstatic.com/item.jpg",
    soldQuantity,
    price,
    revenue: soldQuantity * price,
    metadataVersion: 4,
    priceParserVersion: 2,
  };
  db.prepare(`
    INSERT INTO market_item_cache (key, title, permalink, payload, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(id, title, item.href, JSON.stringify(item));
}

function saveLegacyItem(id, title, soldQuantity, price) {
  const item = {
    id,
    title,
    href: `https://produto.mercadolivre.com.br/${id}`,
    soldQuantity,
    price,
    revenue: soldQuantity * price,
    metadataVersion: 2,
  };
  db.prepare(`
    INSERT INTO market_item_cache (key, title, permalink, payload, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(id, title, item.href, JSON.stringify(item));
}

test("reaproveita tres anuncios reais para uma consulta equivalente ainda sem cache de pesquisa", () => {
  saveItem("MLB1", "Adubo NPK 10-10-10 para plantas 1kg", 12_000, 49.9);
  saveItem("MLB2", "Fertilizante Adubo NPK granulado 1kg", 5_000, 39.9);
  saveItem("MLB3", "Adubo mineral NPK para jardim 1kg", 1_000, 29.9);

  const result = searchMercadoLivreCachedItems("adubo rpk 1kg");

  assert.equal(result?.ok, true);
  assert.equal(result?.source, "confweb_cache");
  assert.equal(result?.items.length, 3);
  assert.equal(result?.providerCreditsUsed, 0);
  assert.equal(result?.totals.demand, 18_000);
});

test("não mistura anúncios de outro produto ao reaproveitar a base", () => {
  const result = searchMercadoLivreCachedItems("cafeteira elétrica");

  assert.equal(result, null);
});

test("nao publica precos antigos antes de recalcular os metadados do anuncio", () => {
  saveLegacyItem("MLB4", "Creatina monohidratada pura 500g marca A", 50_000, 49.9);
  saveLegacyItem("MLB5", "Creatina monohidratada pura 500g marca B", 10_000, 59.9);
  saveLegacyItem("MLB6", "Creatina monohidratada pura 500g marca C", 5_000, 69.9);

  const result = searchMercadoLivreCachedItems("creatina 500g");

  assert.equal(result, null);
});

test("entrega os anuncios reais disponiveis como oportunidade quando nenhum passa de mil vendas", () => {
  saveItem("MLB7", "Abrigo Feminino Plush Plus Size Veludo", 500, 109.9);
  saveItem("MLB8", "Conjunto Moletom Veludo Plush Blusa E Calca", 25, 169.9);

  const result = searchMercadoLivreCachedItems("conjunto feminino Blue Bay Plush");

  assert.equal(result?.ok, true);
  assert.equal(result?.opportunityMode, "emerging");
  assert.equal(result?.items.length, 2);
  assert.deepEqual(result?.items.map((item) => item.soldQuantity), [500, 25]);
});
