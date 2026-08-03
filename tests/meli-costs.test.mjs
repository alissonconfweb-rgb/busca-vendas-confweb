import assert from "node:assert/strict";
import test from "node:test";

import { enrichMercadoLivreCosts } from "../server/meli-costs.mjs";

const originalFetch = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("anexa comissao e frete retornados pelos endpoints oficiais", async () => {
  const requested = [];
  globalThis.fetch = async (url) => {
    requested.push(String(url));
    if (String(url).includes("/listing_prices?")) {
      return Response.json([
        {
          listing_type_id: "gold_special",
          listing_type_name: "Classica",
          sale_fee_amount: 15.96,
          sale_fee_details: { fixed_fee: 0, percentage_fee: 11.5, financing_add_on_fee: 0 },
        },
        {
          listing_type_id: "gold_pro",
          listing_type_name: "Premium",
          sale_fee_amount: 22.9,
          sale_fee_details: { fixed_fee: 0, percentage_fee: 16.5, financing_add_on_fee: 0 },
        },
      ]);
    }
    return Response.json({
      coverage: {
        all_country: { list_cost: 36.05, currency_id: "BRL", billable_weight: 6100 },
      },
    });
  };

  const result = await enrichMercadoLivreCosts({
    ok: true,
    items: [{
      id: "MLB7156647924",
      categoryId: "MLB193946",
      price: 138.81,
      sellerId: 12345,
      shippingMode: "me2",
      logisticType: "drop_off",
      freeShipping: true,
      weightKg: 5.9,
    }],
  }, { accessToken: "token", siteId: "MLB" });

  assert.equal(result.items[0].marketplaceFees.classic.saleFeeAmount, 15.96);
  assert.equal(result.items[0].marketplaceFees.classic.percentageFee, 11.5);
  assert.equal(result.items[0].marketplaceFees.premium.saleFeeAmount, 22.9);
  assert.equal(result.items[0].shippingQuote.amount, 36.05);
  assert.equal(result.items[0].shippingQuote.billableWeightKg, 6.1);
  assert.equal(result.items[0].shippingQuote.inputWeightKg, 5.9);
  assert.equal(result.items[0].shippingQuote.calculationMode, "sale_simulation");
  assert.equal(requested.length, 2);
  assert.match(requested[1], /item_price=138.81/);
  assert.match(requested[1], /dimensions=1x1x1%2C5900/);
});

test("preserva o resultado quando nao ha token oficial", async () => {
  const result = { ok: true, items: [{ id: "MLB1", price: 10 }] };
  assert.equal(await enrichMercadoLivreCosts(result, {}), result);
});
