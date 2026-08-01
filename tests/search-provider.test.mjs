import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeSearchProviderMode,
  searchProviderPlan,
} from "../server/search-provider.mjs";

test("defaults to automatic provider selection", () => {
  assert.equal(normalizeSearchProviderMode(), "auto");
  assert.equal(normalizeSearchProviderMode("invalid"), "auto");
  assert.deepEqual(searchProviderPlan("auto"), {
    mode: "auto",
    useMercadoLivre: true,
    useScrapeDo: true,
  });
});

test("Mercado Livre only never enables Scrape.do", () => {
  assert.deepEqual(searchProviderPlan("meli_only"), {
    mode: "meli_only",
    useMercadoLivre: true,
    useScrapeDo: false,
  });
});

test("Scrape.do only skips Mercado Livre", () => {
  assert.deepEqual(searchProviderPlan("scrapedo_only"), {
    mode: "scrapedo_only",
    useMercadoLivre: false,
    useScrapeDo: true,
  });
});
