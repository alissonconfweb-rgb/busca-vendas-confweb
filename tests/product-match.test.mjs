import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMarketplaceSearchQueries,
  buildProductQuerySpec,
  matchesMarketplaceSearchResult,
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

test("entende erro de digitacao e trata MDF como caracteristica opcional", () => {
  const spec = buildProductQuerySpec("escrinaninha de mdf");

  assert.equal(normalizeProductSearchQuery("escrinaninha de mdf"), "escrivaninha de mdf");
  assert.equal(
    matchesProductQuery("Mesa Home Office Escrivaninha Industrial Quarto Notebook", spec).ok,
    true,
  );
  assert.equal(
    matchesProductQuery("Escrivaninha industrial aco, mdf, mdp de 90cm", spec).ok,
    true,
  );
});

test("rejeita tampo quando a busca pede a escrivaninha completa", () => {
  const spec = buildProductQuerySpec("escrivaninha de mdf");

  assert.equal(matchesProductQuery("Tampo Escrivaninha 120x80 em MDF", spec).ok, false);
  assert.equal(
    matchesProductQuery("Tampo para escrivaninha de MDF 120x80", buildProductQuerySpec("tampo escrivaninha mdf")).ok,
    true,
  );
});

test("aceita resultado relevante do marketplace mesmo quando a marca nao aparece no titulo", () => {
  const spec = buildProductQuerySpec("conjunto feminino Blue Bay Plush");

  assert.equal(
    matchesMarketplaceSearchResult("Abrigo Feminino Plush Plus Size Veludo Agasalho De Frio", spec).ok,
    true,
  );
  assert.equal(
    matchesMarketplaceSearchResult("Conjunto Moletom Veludo Plush Blusa De Ziper E Calca", spec).ok,
    true,
  );
  assert.equal(
    matchesMarketplaceSearchResult("Conjunto infantil masculino de algodao", spec).ok,
    false,
  );
});

test("amplia uma busca com marca sem perder o produto principal", () => {
  assert.deepEqual(
    buildMarketplaceSearchQueries("conjunto feminino Blue Bay Plush"),
    [
      "conjunto feminino blue bay plush",
      "conjunto feminino plush",
      "conjunto feminino blue",
      "conjunto feminino",
    ],
  );
});

test("nao relaxa numeros de modelo informados pelo usuario", () => {
  const spec = buildProductQuerySpec("iphone 15 pro max azul");

  assert.equal(matchesMarketplaceSearchResult("Apple iPhone 15 Pro Max Azul", spec).ok, true);
  assert.equal(matchesMarketplaceSearchResult("Apple iPhone 14 Pro Max Azul", spec).ok, false);
});
