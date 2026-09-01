import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const tempDir = mkdtempSync(join(tmpdir(), "busca-vendas-scrapedo-integration-"));
process.env.DB_PATH = join(tempDir, "scrapedo-integration.sqlite");
process.env.SCRAPEDO_MAX_CONCURRENCY = "1";

const { db, initDatabase, setSetting } = await import("../server/db.mjs");
const {
  scrapeDoUsageSummary,
  searchMercadoLivreScrapeDo,
  withScrapeDoProviderSlot,
} = await import("../server/scrapedo.mjs");

initDatabase();
setSetting("scrapedo_api_token", "token-de-integracao");
setSetting("scrapedo_enabled", "true");
setSetting("scrapedo_detail_limit", "12");
setSetting("scrapedo_candidate_target", "6");
setSetting("scrapedo_detail_concurrency", "3");
setSetting("min_champion_sales", "1000");

const originalFetch = globalThis.fetch;
let fixtureMode = "products";
let requestCount = 0;

globalThis.fetch = async (requestUrl) => {
  requestCount += 1;
  if (fixtureMode === "slow-empty") {
    await new Promise((resolve) => setTimeout(resolve, 80));
    return scrapeDoResponse("<html><body>lista.mercadolivre.com.br search-nordic</body></html>");
  }

  const target = new URL(String(requestUrl)).searchParams.get("url") || "";
  if (target.includes("lista.mercadolivre.com.br")) {
    return scrapeDoResponse(searchListingFixture());
  }

  const itemId = target.match(/MLB-?(\d+)/i)?.[1] || "";
  return scrapeDoResponse(productFixture(itemId));
};

after(() => {
  globalThis.fetch = originalFetch;
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

test("retorna tres oportunidades reais e rejeita vendas que pertencem ao vendedor", async () => {
  fixtureMode = "products";
  requestCount = 0;
  const options = { forceRefresh: true, deadlineAt: Date.now() + 5_000 };
  const first = searchMercadoLivreScrapeDo("cordao para cracha", options);
  const second = searchMercadoLivreScrapeDo("cordao para cracha", options);

  assert.equal(first, second, "consultas simultâneas equivalentes devem compartilhar a mesma coleta");
  const result = await first;

  assert.equal(result.ok, true);
  assert.equal(result.items.length, 3);
  assert.equal(result.opportunityMode, "emerging");
  assert.deepEqual(result.items.map((item) => item.soldQuantity), [500, 100, 25]);
  assert.deepEqual(result.items.map((item) => item.price), [93.49, 109.9, 79.9]);
  assert.equal(result.items.some((item) => item.id === "MLB100"), false);
  assert.ok(requestCount >= 5 && requestCount <= 7, `quantidade inesperada de chamadas: ${requestCount}`);

  const cachedPayloads = db.prepare("SELECT payload FROM market_item_cache").all()
    .map((row) => JSON.parse(row.payload));
  assert.equal(cachedPayloads.length, 3);
  assert.ok(cachedPayloads.every((item) => (
    item.salesSource === "product_page" && item.priceSource === "product_page"
  )));
});

test("o prazo da pesquisa também vale enquanto ela aguarda na fila", async () => {
  await new Promise((resolve) => setImmediate(resolve));
  let releaseRunning;
  const running = withScrapeDoProviderSlot(
    () => new Promise((resolve) => {
      releaseRunning = resolve;
    }),
    { deadlineAt: Date.now() + 1_000 },
  );
  assert.equal(scrapeDoUsageSummary().active, 1);
  const queued = withScrapeDoProviderSlot(
    () => Promise.resolve("não deveria iniciar"),
    { deadlineAt: Date.now() + 30 },
  );
  assert.equal(scrapeDoUsageSummary().queued, 1);

  const queuedOutcome = await queued.then(
    (value) => ({ value, error: null }),
    (error) => ({ value: null, error }),
  );
  assert.ok(queuedOutcome.error, JSON.stringify(queuedOutcome.value));
  assert.match(String(queuedOutcome.error.message || queuedOutcome.error), /expirou enquanto aguardava/i);
  releaseRunning("concluída");
  await running;
});

function scrapeDoResponse(html) {
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "scrape.do-request-cost": "1",
    },
  });
}

function searchListingFixture() {
  return `
    <html><body><ol>
      ${searchCard("100", "2pcs Porta Cracha Vertical Retratil Com Cordao Extensivel", 39.1, "+5 mil vendidos")}
      ${searchCard("101", "Cordao Para Cracha Azul Com Trava", 999, "+500 vendidos")}
      ${searchCard("102", "Cordao Para Cracha Retratil Preto", 999, "+100 vendidos")}
      ${searchCard("103", "Cordao Para Cracha Personalizado", 999, "+25 vendidos")}
    </ol></body></html>
  `;
}

function searchCard(id, title, price, sales) {
  const [whole, cents = "00"] = Number(price).toFixed(2).split(".");
  return `
    <li class="ui-search-layout__item">
      <a href="https://produto.mercadolivre.com.br/MLB-${id}-_JM">
        <script type="application/json">{"title":"${title}"}</script>
        <div class="poly-price__current">
          <span class="andes-money-amount__fraction">${whole}</span>
          <span class="andes-money-amount__cents">${cents}</span>
        </div>
        <span>${sales}</span>
      </a>
    </li>
  `;
}

function productFixture(id) {
  if (id === "100") {
    return productPage({
      title: "2pcs Porta Cracha Vertical Retratil Com Cordao Extensivel",
      price: 39.1,
      productSales: "",
      sellerSales: "+5 mil vendas",
    });
  }
  const products = {
    101: { title: "Cordao Para Cracha Azul Com Trava", price: 93.49, productSales: "+500 vendidos" },
    102: { title: "Cordao Para Cracha Retratil Preto", price: 109.9, productSales: "+100 vendidos" },
    103: { title: "Cordao Para Cracha Personalizado", price: 79.9, productSales: "+25 vendidos" },
  };
  return productPage(products[id] || { title: "Produto desconhecido", price: 1, productSales: "" });
}

function productPage({ title, price, productSales, sellerSales = "+50 mil vendas" }) {
  const [whole, cents = "00"] = Number(price).toFixed(2).split(".");
  return `
    <html><body><main class="ui-pdp-container">
      ${productSales ? `<span class="ui-pdp-subtitle">Novo | ${productSales}</span>` : ""}
      <h1>${title}</h1>
      <div class="ui-pdp-price__main-container"><div class="ui-pdp-price__second-line">
        <span class="andes-money-amount__fraction">${whole}</span>
        <span class="andes-money-amount__cents">${cents}</span>
      </div></div>
      <aside class="ui-pdp-seller">Vendido por Loja Exemplo MercadoLider | ${sellerSales}</aside>
    </main></body></html>
  `;
}
