import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const tempDir = mkdtempSync(join(tmpdir(), "busca-vendas-parser-"));
process.env.DB_PATH = join(tempDir, "parser.sqlite");

const { db } = await import("../server/db.mjs");
const { mercadoLivreHtmlParser: parser } = await import("../server/zyte.mjs");

after(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

test("usa somente a URL canonica para links de catalogo que geravam 404 cobrado", () => {
  assert.deepEqual(
    parser.productDetailUrls({
      id: "MLB123456789",
      href: "https://www.mercadolivre.com.br/produto-exemplo/p/MLB123456789",
    }),
    ["https://produto.mercadolivre.com.br/MLB-123456789-_JM"],
  );
});

test("prioriza a URL canonica quando o link de busca informa o wid do anuncio", () => {
  assert.deepEqual(
    parser.productDetailUrls({
      href: "https://www.mercadolivre.com.br/produto/p/MLB111?wid=MLB987654321&source=search",
    }),
    ["https://produto.mercadolivre.com.br/MLB-987654321-_JM"],
  );
});

test("preserva uma URL direta de anuncio sem criar chamadas duplicadas", () => {
  assert.deepEqual(
    parser.productDetailUrls({
      href: "https://produto.mercadolivre.com.br/MLB-987654321-_JM?tracking_id=abc",
    }),
    ["https://produto.mercadolivre.com.br/MLB-987654321-_JM"],
  );
});

test("prioriza o preco promocional atual em vez do valor anterior", () => {
  const html = `
    <s aria-label="Antes: 65 reais com 90 centavos">R$ 65,90</s>
    <div class="poly-price__current">
      <span class="andes-money-amount" aria-label="Agora: 44 reais com 90 centavos">
        <span class="andes-money-amount__fraction">44</span>
        <span class="andes-money-amount__cents">90</span>
      </span>
    </div>
  `;

  assert.equal(parser.parsePrice(html), 44.9);
});

test("prioriza o preco promocional da pagina do anuncio", () => {
  const html = `
    <s><span class="andes-money-amount" aria-label="200 reais com 98 centavos">R$ 200,98</span></s>
    <div class="ui-pdp-price__second-line">
      <span class="andes-money-amount" aria-label="138 reais com 37 centavos">
        <span class="andes-money-amount__fraction">138</span>
        <span class="andes-money-amount__cents">37</span>
      </span>
    </div>
  `;

  assert.equal(parser.parsePrice(html), 138.37);
});

test("ignora precos de produtos relacionados na pagina do anuncio", () => {
  const html = `
    <div class="ui-pdp-price__main-container">
      <s><span class="andes-money-amount">R$ 76,53</span></s>
      <div class="ui-pdp-price__second-line">
        <span class="andes-money-amount">
          <span class="andes-money-amount__fraction">68</span>
          <span class="andes-money-amount__cents">59</span>
          <meta itemprop="price" content="68.59">
        </span>
      </div>
    </div>
    <section class="recommendations">
      <div class="poly-price__current">
        <span class="andes-money-amount__fraction">98</span>
        <span class="andes-money-amount__cents">61</span>
      </div>
    </section>
  `;

  assert.equal(parser.parsePrice(html), 68.59);
});

test("le os dados logisticos do proprio anuncio", () => {
  const html = `{
    "seller_id": 123456,
    "listing_type_id": "gold_special",
    "shipping": {
      "mode": "me2",
      "dimensions": "12x80x95,8000",
      "free_shipping": true,
      "logistic_type": "drop_off"
    }
  }`;

  assert.equal(parser.parseSellerId(html), 123456);
  assert.equal(parser.parseListingTypeId(html), "gold_special");
  assert.equal(parser.parseShippingMode(html), "me2");
  assert.equal(parser.parseLogisticType(html), "drop_off");
  assert.equal(parser.parseShippingDimensions(html), "12x80x95,8000");
  assert.equal(parser.parseFreeShipping(html), true);
});

test("nao confunde pesos de recomendacoes distantes com o produto", () => {
  const html = `${"Escrivaninha industrial MDF ".padEnd(300, "x")} Peso recomendado 20 kg`;
  assert.equal(parser.parseWeightKg(html), null);
});

test("le o peso fisico sem confundir com a capacidade suportada", () => {
  const html = `
    <h2>Peso e dimensões</h2>
    <table>
      <tr><th>Profundidade</th><td>45 cm</td></tr>
      <tr><th>Peso</th><td>5,9 kg</td></tr>
    </table>
    <h2>Outros</h2>
    <table><tr><th>Capacidade em peso</th><td>20 kg</td></tr></table>
  `;

  assert.equal(parser.parseWeightKg(html), 5.9);
});

test("converte o selo publico de mais de 50 mil vendidos", () => {
  assert.equal(parser.parseSalesFromText("4.8 | +50 mil vendidos"), 50_000);
});

test("nao confunde as vendas totais do vendedor com vendas do anuncio", () => {
  const html = `
    <main class="ui-pdp-container">
      <h1>2pcs Porta Crachá Vertical Retrátil Com Cordão Extensível</h1>
      <aside>Vendido por VE20260323142145 MercadoLíder | +5 mil vendas</aside>
    </main>
  `;

  assert.equal(parser.parseSalesFromText(html), null);
});

test("le o selo de vendas do proprio produto perto do titulo", () => {
  const html = `
    <main class="ui-pdp-container">
      <span class="ui-pdp-subtitle">Novo | +5 mil vendidos</span>
      <h1>Produto com vendas públicas</h1>
      <aside>Vendido por Loja Exemplo MercadoLíder | +100 mil vendas</aside>
    </main>
  `;

  assert.equal(parser.parseSalesFromText(html), 5_000);
});

test("nao herda vendas de produtos relacionados em uma pagina sem vendas", () => {
  const html = `
    <main class="ui-pdp-container">
      <h1>Produto novo sem vendas públicas</h1>
      ${"Detalhes do produto ".repeat(700)}
      <section class="recommendations">Produto relacionado | +50 mil vendidos</section>
    </main>
  `;

  assert.equal(parser.parseSalesFromText(html), null);
});

test("associa vendas estruturadas da busca ao item_id correto antes de ranquear", () => {
  const html = `
    <ol>
      <li class="ui-search-layout__item">
        <a href="https://www.mercadolivre.com.br/produto-a/p/MLB111?pdp_filters=item_id:MLB111">Produto A</a>
        <div class="poly-price__current"><span class="andes-money-amount__fraction">140</span></div>
      </li>
      <li class="ui-search-layout__item">
        <a href="https://www.mercadolivre.com.br/produto-b/p/MLB222?pdp_filters=item_id:MLB222">Produto B</a>
        <div class="poly-price__current"><span class="andes-money-amount__fraction">200</span></div>
      </li>
    </ol>
    <script>
      window.__DATA__ = "{\\"printed_result\\":[{\\"item_id\\":\\"MLB111\\",\\"sold_quantity\\":100,\\"position\\":4},{\\"item_id\\":\\"MLB222\\",\\"sold_quantity\\":10000,\\"position\\":0}]}";
    </script>
  `;

  const metrics = parser.parseSearchResultMetrics(html);
  const items = parser.extractSearchItems(html);

  assert.deepEqual(metrics.get("MLB111"), { soldQuantity: 100, position: 5 });
  assert.deepEqual(metrics.get("MLB222"), { soldQuantity: 10_000, position: 1 });
  assert.deepEqual(
    items.map((item) => ({ id: item.id, sales: item.soldQuantity, source: item.salesSource })),
    [
      { id: "MLB111", sales: 100, source: "marketplace_search_backend" },
      { id: "MLB222", sales: 10_000, source: "marketplace_search_backend" },
    ],
  );
});

test("nao atribui a um card vendas estruturadas de outro item", () => {
  const html = `
    <li class="ui-search-layout__item">
      <a href="https://produto.mercadolivre.com.br/MLB-333-_JM">Produto sem métrica própria</a>
      <div class="poly-price__current"><span class="andes-money-amount__fraction">39</span></div>
      <span>Vendedor MercadoLíder +5 mil vendas</span>
    </li>
    <script>{"printed_result":[{"item_id":"MLB999","sold_quantity":5000,"position":0}]}</script>
  `;

  const [item] = parser.extractSearchItems(html);
  assert.equal(item.id, "MLB333");
  assert.equal(item.soldQuantity, null);
  assert.equal(item.salesSource, "");
});
