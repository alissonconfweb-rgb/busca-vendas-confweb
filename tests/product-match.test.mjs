import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProductQuerySpec,
  matchesProductQuery,
  normalizeProductSearchQuery,
  normalizedProductKey,
} from "../server/product-match.mjs";

test("corrige RPK para NPK na consulta e na chave do cache", () => {
  assert.equal(normalizeProductSearchQuery("Adubo RPK"), "adubo npk");
  assert.equal(
    normalizedProductKey(normalizeProductSearchQuery("Adubo RPK")),
    normalizedProductKey(normalizeProductSearchQuery("Adubo NPK")),
  );
});

test("aceita anuncios NPK quando o usuario digita RPK", () => {
  const spec = buildProductQuerySpec("Adubo RPK");
  const match = matchesProductQuery("Adubo Granulado NPK 10-10-10 para Plantas", spec);

  assert.equal(match.ok, true);
});

test("corrige langerie para lingerie antes de consultar o marketplace", () => {
  assert.equal(normalizeProductSearchQuery("Langerie feminina"), "lingerie feminina");
  assert.equal(
    matchesProductQuery("Kit Lingerie Feminina Conjunto", buildProductQuerySpec("kit langerie feminina")).ok,
    true,
  );
});
