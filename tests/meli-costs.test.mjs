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
      shippingDimensions: "45x90x76,5900",
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
  assert.match(requested[1], /dimensions=45x90x76%2C5900/);
});

test("preserva o resultado quando nao ha token oficial", async () => {
  const result = { ok: true, items: [{ id: "MLB1", price: 10 }] };
  assert.equal(await enrichMercadoLivreCosts(result, {}), result);
});

test("calcula cada anuncio com os proprios dados sem valores especificos por produto", async () => {
  const requested = [];
  globalThis.fetch = async (url) => {
    const requestUrl = new URL(String(url));
    requested.push(requestUrl);
    if (requestUrl.pathname.endsWith("/listing_prices")) {
      const price = Number(requestUrl.searchParams.get("price"));
      return Response.json([{
        listing_type_id: "gold_special",
        listing_type_name: "Classica",
        sale_fee_amount: Number((price * 0.12).toFixed(2)),
        sale_fee_details: { fixed_fee: 0, percentage_fee: 12, financing_add_on_fee: 0 },
      }]);
    }
    const dimensions = requestUrl.searchParams.get("dimensions");
    const weightGrams = Number(dimensions?.split(",").at(-1));
    return Response.json({
      coverage: {
        all_country: {
          list_cost: Number((weightGrams / 1000 * 5).toFixed(2)),
          currency_id: "BRL",
          billable_weight: weightGrams,
        },
      },
    });
  };

  const products = [
    { id: "MLB100", categoryId: "MLB-A", price: 49.9, sellerId: 10, weightKg: 0.3, shippingDimensions: "10x20x30,300" },
    { id: "MLB200", categoryId: "MLB-B", price: 138.81, sellerId: 20, weightKg: 5.9, shippingDimensions: "45x90x76,5900" },
    { id: "MLB300", categoryId: "MLB-C", price: 899, sellerId: 30, weightKg: 15, shippingDimensions: "60x70x80,15000" },
  ].map((item) => ({
    ...item,
    shippingMode: "me2",
    logisticType: "drop_off",
    freeShipping: item.price >= 79,
  }));

  const result = await enrichMercadoLivreCosts({ ok: true, items: products }, {
    accessToken: "token",
    siteId: "MLB",
  });

  assert.deepEqual(
    result.items.map((item) => item.marketplaceFees.classic.saleFeeAmount),
    [5.99, 16.66, 107.88],
  );
  assert.deepEqual(
    result.items.map((item) => item.shippingQuote.amount),
    [1.5, 29.5, 75],
  );
  assert.deepEqual(
    requested.filter((url) => url.pathname.endsWith("/listing_prices"))
      .map((url) => [url.searchParams.get("category_id"), url.searchParams.get("price")]),
    [["MLB-A", "49.9"], ["MLB-B", "138.81"], ["MLB-C", "899"]],
  );
  assert.deepEqual(
    requested.filter((url) => url.pathname.endsWith("/shipping_options/free"))
      .map((url) => url.searchParams.get("dimensions")),
    ["10x20x30,300", "45x90x76,5900", "60x70x80,15000"],
  );
});

test("sem dimensoes usa a cotacao do item e nao inventa pacote ou frete gratis", async () => {
  let shippingUrl = null;
  globalThis.fetch = async (url) => {
    const requestUrl = new URL(String(url));
    if (requestUrl.pathname.endsWith("/listing_prices")) {
      return Response.json([]);
    }
    shippingUrl = requestUrl;
    return Response.json({
      coverage: { all_country: { list_cost: 22.5, currency_id: "BRL", billable_weight: 1200 } },
    });
  };

  const result = await enrichMercadoLivreCosts({
    ok: true,
    items: [{
      id: "MLB999",
      price: 200,
      sellerId: 99,
      weightKg: 5.9,
      freeShipping: null,
    }],
  }, { accessToken: "token" });

  assert.equal(shippingUrl.searchParams.get("item_id"), "MLB999");
  assert.equal(shippingUrl.searchParams.has("dimensions"), false);
  assert.equal(shippingUrl.searchParams.get("free_shipping"), "false");
  assert.equal(result.items[0].shippingQuote.calculationMode, "item_quote");
});
