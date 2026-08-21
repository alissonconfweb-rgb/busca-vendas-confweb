import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { getSetting, setSetting } from "./db.mjs";
import {
  buildProductQuerySpec,
  extractMeasures,
  matchesProductQuery,
  normalizedProductKey,
  normalizeProductSearchQuery,
} from "./product-match.mjs";

const ZYTE_ENDPOINT = "https://api.zyte.com/v1/extract";
const CACHE_VERSION = "zyte-sales-v4";
const CACHE_FILE = resolve(process.cwd(), "data", "zyte-cache.json");
const CACHE_TTL_MS = Number(process.env.ZYTE_CACHE_MS || 12 * 60 * 60 * 1000);
const STALE_CACHE_TTL_MS = Number(process.env.ZYTE_STALE_CACHE_MS || 36 * 60 * 60 * 1000);

const cache = new Map();
const inFlight = new Map();
let diskCacheLoaded = false;

export const MERCADO_LIVRE_SALES_PARSER_VERSION = 1;

export function isZyteConfigured() {
  return Boolean(zyteApiKey());
}

export function isZyteSearchEnabled() {
  const enabled = (getSetting("zyte_search_enabled") ?? process.env.ZYTE_SEARCH_ENABLED ?? "false").trim().toLowerCase();
  return ["true", "1", "yes", "sim"].includes(enabled);
}

export async function testZyteConnection() {
  const html = await requestZyteHtml("https://books.toscrape.com/", { render: false });
  return {
    ok: true,
    status: 200,
    sample: html.slice(0, 120),
  };
}

export async function searchMercadoLivreZyte(query) {
  if (!isZyteConfigured()) {
    return emptyResult("zyte_not_configured", "Zyte ainda não foi configurada no painel admin.");
  }

  const cacheKey = `${CACHE_VERSION}:${normalizedProductKey(query)}`;
  ensureDiskCacheLoaded();
  const cached = cache.get(cacheKey);

  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    return {
      ...cached.result,
      message: `${cached.result.message} Resultado reaproveitado do cache Zyte.`,
    };
  }

  if (inFlight.has(cacheKey)) {
    return inFlight.get(cacheKey);
  }

  const promise = runZyteSearch(query, cacheKey)
    .then((result) => {
      if (result.ok) {
        cache.set(cacheKey, { createdAt: Date.now(), result });
        persistDiskCache();
      }
      return result;
    })
    .finally(() => inFlight.delete(cacheKey));

  inFlight.set(cacheKey, promise);
  return promise;
}

async function runZyteSearch(query, cacheKey) {
  const stale = cache.get(cacheKey);

  try {
    const querySpec = buildProductQuerySpec(query);
    const requestContext = randomUUID();
    const candidates = [];
    let totalAvailable = 0;

    for (let page = 1; page <= Math.max(1, zyteSearchPages()); page += 1) {
      const pageResult = await requestZyteSearchPage(searchUrlFor(query, page), {
        render: shouldRender(),
        requestContext,
      });
      totalAvailable = totalAvailable
        || parseTotalAvailable(pageResult.html)
        || pageResult.productList?.products?.length
        || 0;
      const pageItems = [
        ...extractSearchItems(pageResult.html),
        ...extractStructuredProducts(pageResult.productList),
      ]
        .map((item, index) => ({
          ...item,
          position: item.position || candidates.length + index + 1,
          match: matchesProductQuery(item.title, querySpec),
        }))
        .filter((item) => item.match.ok && item.price > 0);

      candidates.push(...pageItems);
      if (dedupe(candidates).length >= zyteDetailLimit()) {
        break;
      }
    }

    const uniqueCandidates = dedupe(candidates).slice(0, zyteDetailLimit());
    const completeItems = [];

    for (const candidate of uniqueCandidates) {
      const enriched = await enrichItem(candidate, querySpec, requestContext);
      if (
        enriched.title &&
        enriched.price > 0 &&
        typeof enriched.soldQuantity === "number" &&
        enriched.soldQuantity > 0 &&
        matchesProductQuery(enriched.title, querySpec).ok
      ) {
        completeItems.push(enriched);
      }
      if (completeItems.length >= 3) {
        break;
      }
    }

    const items = completeItems
      .sort((a, b) => championScore(a) - championScore(b))
      .slice(0, 3)
      .map(mapZyteItem);
    const demand = items.reduce((sum, item) => sum + (item.soldQuantity || 0), 0);
    const revenue = items.reduce((sum, item) => sum + (item.revenue || 0), 0);

    if (items.length < 3) {
      return {
        ok: false,
        source: "zyte_incomplete_sales",
        strictRealOnly: true,
        metricsMode: "sales",
        salesAvailable: false,
        message: `A Zyte leu ${uniqueCandidates.length} anúncio(s), mas encontrou apenas ${items.length} com vendas públicas completas para "${query}". Anúncios sem quantidade de vendas foram descartados.`,
        items: [],
        exactMatches: items.length,
        totalAvailable: totalAvailable || candidates.length,
        totals: { demand: 0, revenue: 0, averageTicket: 0, actualDemand: 0 },
      };
    }

    return {
      ok: true,
      source: "zyte_mercado_livre",
      salesParserVersion: MERCADO_LIVRE_SALES_PARSER_VERSION,
      metricsMode: "sales",
      salesAvailable: true,
      message: "Dados reais extraídos via Zyte das páginas públicas do Mercado Livre. Anúncios sem vendas públicas foram ignorados.",
      items,
      exactMatches: items.length,
      totalAvailable: totalAvailable || candidates.length,
      totals: {
        demand,
        revenue,
        averageTicket: demand ? revenue / demand : 0,
        isEstimated: false,
        actualDemand: demand,
      },
    };
  } catch (error) {
    if (stale && Date.now() - stale.createdAt < STALE_CACHE_TTL_MS) {
      return {
        ...stale.result,
        message: `${stale.result.message} Zyte falhou agora; usando cache real temporário.`,
      };
    }
    throw error;
  }
}

async function enrichItem(item, querySpec, requestContext) {
  let combinedText = "";
  let finalUrl = item.href;

  for (const url of productDetailUrls(item)) {
    const detailHtml = await requestZyteHtml(url, {
      render: shouldRender(),
      requestContext,
      referer: searchUrlFor(querySpec.original),
    }).catch(() => "");
    if (!detailHtml) {
      continue;
    }
    combinedText += ` ${detailHtml}`;
    finalUrl = cleanMercadoLivreProductUrl(url) || url;
    const soldQuantity = parseSalesFromText(combinedText);
    if (soldQuantity) {
      break;
    }
  }

  const title = parseTitle(combinedText) || item.title;
  const discoveredCategory = await discoverCategory(title || querySpec.original).catch(() => null);
  const categoryId = parseCategoryId(combinedText) || discoveredCategory?.category_id || "";
  const categoryName = parseCategoryName(combinedText) || discoveredCategory?.category_name || "";
  const weightKg = parseWeightKg(`${title} ${combinedText}`);
  const price = parsePrice(combinedText) || item.price;
  const soldQuantity = parseSalesFromText(combinedText) || item.soldQuantity || null;
  const image = parseImage(combinedText) || item.image;

  return {
    ...item,
    title,
    href: finalUrl,
    image,
    price,
    soldQuantity,
    categoryId,
    categoryName,
    weightKg,
    sellerId: parseSellerId(combinedText) || item.sellerId || null,
    listingTypeId: parseListingTypeId(combinedText) || item.listingTypeId || "",
    shippingMode: parseShippingMode(combinedText) || item.shippingMode || "",
    logisticType: parseLogisticType(combinedText) || item.logisticType || "",
    shippingDimensions: parseShippingDimensions(combinedText) || item.shippingDimensions || "",
    freeShipping: parseFreeShipping(combinedText) ?? item.freeShipping ?? null,
  };
}

async function requestZyteHtml(url, options = {}) {
  const render = Boolean(options.render);
  const data = await requestZyte(url, render ? { browserHtml: true } : { httpResponseBody: true }, options);
  return htmlFromZyteResponse(data);
}

async function requestZyteSearchPage(url, options = {}) {
  const render = Boolean(options.render);
  const data = await requestZyte(url, render
    ? {
        browserHtml: true,
        productList: true,
        productListOptions: { extractFrom: "browserHtml" },
      }
    : {
        httpResponseBody: true,
        productList: true,
        productListOptions: { extractFrom: "httpResponseBody" },
      }, options);
  return {
    html: htmlFromZyteResponse(data),
    productList: data.productList || null,
  };
}

async function requestZyte(url, output, options = {}) {
  const apiKey = zyteApiKey();
  if (!apiKey) {
    throw new Error("Configure a API Key da Zyte no painel admin.");
  }

  const requestBody = {
    url,
    ...output,
    ...zyteNetworkOptions(options),
  };
  const response = await fetch(zyteEndpoint(), {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
      "Content-Type": "application/json",
      "User-Agent": "BuscaVendasConfweb/1.0",
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(zyteTimeoutMs()),
  });
  const text = await response.text();
  const data = parseJson(text);

  if (!response.ok) {
    throw new Error(describeZyteError(response.status, data, text));
  }

  return data;
}

function htmlFromZyteResponse(data) {
  if (typeof data.browserHtml === "string") {
    return data.browserHtml;
  }
  if (typeof data.httpResponseBody === "string") {
    return Buffer.from(data.httpResponseBody, "base64").toString("utf8");
  }
  if (typeof data.text === "string") {
    return data.text;
  }
  return JSON.stringify(data || {});
}

function zyteNetworkOptions(options = {}) {
  const network = {};
  const geolocation = zyteGeolocation();
  const ipType = zyteIpType();

  if (geolocation) {
    network.geolocation = geolocation;
  }
  if (["datacenter", "residential"].includes(ipType)) {
    network.ipType = ipType;
  }
  if (options.requestContext) {
    network.sessionContext = [{ name: "busca_vendas", value: options.requestContext }];
  }
  if (options.referer) {
    network.requestHeaders = { referer: options.referer };
  }
  return network;
}

function extractSearchItems(html) {
  return splitSearchBlocks(html)
    .map((block, index) => {
      const href = normalizeMercadoLivreUrl(parseHref(block));
      const title = cleanText(parseTitle(block) || parseAnchorText(block));
      return {
        id: extractItemId(href) || extractProductId(href) || normalizedProductKey(title),
        title,
        image: parseImage(block),
        href,
        price: parsePrice(block),
        soldQuantity: parseSalesFromText(block),
        salesParserVersion: MERCADO_LIVRE_SALES_PARSER_VERSION,
        categoryId: parseCategoryId(block),
        categoryName: parseCategoryName(block),
        weightKg: parseWeightKg(`${title} ${block}`),
        sellerId: parseSellerId(block),
        listingTypeId: parseListingTypeId(block),
        shippingMode: parseShippingMode(block),
        logisticType: parseLogisticType(block),
        shippingDimensions: parseShippingDimensions(block),
        freeShipping: parseFreeShipping(block),
        bestSeller: /mais vendido/i.test(block),
        isAd: /is_advertising=true|promoted|patrocinado/i.test(block),
        position: index + 1,
      };
    })
    .filter((item) => item.title && item.href && item.price > 0);
}

function extractStructuredProducts(productList) {
  const products = Array.isArray(productList?.products) ? productList.products : [];
  return products
    .map((product, index) => {
      const href = normalizeMercadoLivreUrl(product.url || product.canonicalUrl || "");
      const title = cleanText(product.name || product.title || "");
      const price = parseNumberValue(
        product.price
        ?? product.offerPrice
        ?? product.aggregateOffer?.lowPrice
        ?? product.aggregateOffer?.highPrice,
      );
      const image = product.mainImage?.url
        || product.images?.[0]?.url
        || product.image?.url
        || "";
      return {
        id: extractItemId(href) || extractProductId(href) || normalizedProductKey(title),
        title,
        image: normalizeMercadoLivreUrl(image),
        href,
        price,
        soldQuantity: null,
        salesParserVersion: MERCADO_LIVRE_SALES_PARSER_VERSION,
        categoryId: "",
        categoryName: productList?.categoryName || "",
        weightKg: parseWeightKg(`${title} ${JSON.stringify(product.additionalProperties || [])}`),
        sellerId: null,
        listingTypeId: "",
        shippingMode: "",
        logisticType: "",
        shippingDimensions: "",
        freeShipping: null,
        bestSeller: false,
        isAd: /click1\.mercadolivre\.com\.br/i.test(href),
        position: index + 1,
      };
    })
    .filter((item) => item.title && item.href && item.price > 0);
}

function splitSearchBlocks(html) {
  const source = String(html || "");
  const blocks = [];
  const patterns = [
    /<li\b[^>]*(?:ui-search-layout__item|poly-card)[\s\S]*?<\/li>/gi,
    /<div\b[^>]*(?:ui-search-result__wrapper|poly-card)[\s\S]*?(?=<div\b[^>]*(?:ui-search-result__wrapper|poly-card)|<\/body>|$)/gi,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      blocks.push(match[0]);
    }
    if (blocks.length) {
      break;
    }
  }

  if (blocks.length) {
    return blocks;
  }

  return source
    .split(/(?=<a\b[^>]+href=["'][^"']*mercadolivre\.com\.br[^"']*)/i)
    .filter((block) => /\/(?:p\/MLB|MLB-|\bMLB\d+)/i.test(block))
    .slice(0, zyteSearchCardLimit());
}

function mapZyteItem(item) {
  return {
    id: item.id,
    title: item.title,
    subtitle: [
      item.bestSeller ? "Selo publico: Mais vendido" : "Zyte + Mercado Livre",
      item.isAd ? "Patrocinado" : "Organico",
    ].join(" - "),
    image: String(item.image || "").replace("http://", "https://"),
    price: item.price,
    soldQuantity: item.soldQuantity,
    salesParserVersion: MERCADO_LIVRE_SALES_PARSER_VERSION,
    estimatedSoldQuantity: null,
    revenue: Number((item.price * item.soldQuantity).toFixed(2)),
    estimatedRevenue: null,
    permalink: item.href || searchUrlFor(item.title),
    categoryId: item.categoryId || "",
    categoryName: item.categoryName || "",
    weightKg: item.weightKg || null,
  };
}

function dedupe(items) {
  const byKey = new Map();

  for (const item of items) {
    const key = item.id || normalizedProductKey(item.title);
    const current = byKey.get(key);
    if (!current || rankingScore(item) < rankingScore(current)) {
      byKey.set(key, item);
    }
  }

  return [...byKey.values()].sort((a, b) => rankingScore(a) - rankingScore(b));
}

function rankingScore(item) {
  const salesBonus = typeof item.soldQuantity === "number" && item.soldQuantity > 0 ? Math.min(item.soldQuantity / 100, 100) : 0;
  return item.position + (item.isAd ? 20 : 0) - (item.bestSeller ? 8 : 0) - salesBonus;
}

function championScore(item) {
  const soldQuantity = typeof item.soldQuantity === "number" && item.soldQuantity > 0 ? item.soldQuantity : 0;
  return -soldQuantity + rankingScore(item) / 1000;
}

function parseTitle(text) {
  const source = decodeText(text);
  return cleanText(firstMatch(source, [
    /<h1[^>]*>([\s\S]*?)<\/h1>/i,
    /"title"\s*:\s*"([^"]+)"/i,
    /"name"\s*:\s*"([^"]+)"/i,
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
  ]));
}

function parseAnchorText(text) {
  return cleanText(firstMatch(text, [/<a\b[^>]*>([\s\S]{5,320}?)<\/a>/i]));
}

function parseHref(text) {
  return firstMatch(text, [
    /href=["']([^"']*mercadolivre\.com\.br[^"']+)["']/i,
    /"permalink"\s*:\s*"([^"]+)"/i,
    /"url"\s*:\s*"([^"]*mercadolivre\.com\.br[^"]+)"/i,
  ]);
}

function parseImage(text) {
  return normalizeMercadoLivreUrl(firstMatch(text, [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i,
    /<img[^>]+(?:src|data-src)=["']([^"']+)["']/i,
    /"thumbnail"\s*:\s*"([^"]+)"/i,
    /"image"\s*:\s*"([^"]+)"/i,
  ]));
}

function parsePrice(text) {
  const source = decodeText(text);
  // Product pages also contain carousels with unrelated `poly-price` values.
  // When a PDP price exists, it is the only valid source for the advertised item.
  const hasProductPagePrice = /ui-pdp-price__(?:second-line|main-container)/i.test(source);
  const currentPriceMarkers = hasProductPagePrice
    ? [/ui-pdp-price__second-line/i, /ui-pdp-price__main-container/i]
    : [/poly-price__current/i];
  for (const marker of currentPriceMarkers) {
    const markerIndex = source.search(marker);
    if (markerIndex < 0) {
      continue;
    }
    const priceBlock = source
      .slice(markerIndex, markerIndex + 2_000)
      .replace(/<s\b[^>]*>[\s\S]*?<\/s>/gi, " ");
    const itemPropPrice = parseNumberValue(firstMatch(priceBlock, [
      /itemprop=["']price["'][^>]*content=["']([\d.,]+)/i,
      /content=["']([\d.,]+)["'][^>]*itemprop=["']price["']/i,
    ]));
    if (Number.isFinite(itemPropPrice) && itemPropPrice > 0) {
      return itemPropPrice;
    }
    const currentPrice = parseMercadoLivreMoney(priceBlock);
    if (currentPrice > 0) {
      return currentPrice;
    }
  }

  const ariaPrice = parseMercadoLivreMoney(source, { requireNow: true });
  if (ariaPrice > 0) {
    return ariaPrice;
  }

  const structuredCurrentPrice = parseNumberValue(firstMatch(source, [
    /"price"\s*:\s*\{\s*"type"\s*:\s*"standard"[\s\S]{0,240}?"amount"\s*:\s*([\d.]+)/i,
    /"offers"\s*:\s*\{[\s\S]{0,400}?"price"\s*:\s*"?([\d.]+)"?/i,
  ]));
  if (Number.isFinite(structuredCurrentPrice) && structuredCurrentPrice > 0) {
    return structuredCurrentPrice;
  }

  const value = parseNumberValue(firstMatch(source, [
    /itemprop=["']price["'][^>]*content=["']([\d.,]+)/i,
    /"price"\s*:\s*"?([\d.,]+)"?/i,
    /"base_price"\s*:\s*"?([\d.,]+)"?/i,
    /R\$\s*([\d.]+,\d{2})/i,
  ]));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function parseMercadoLivreMoney(source, options = {}) {
  const text = String(source || "");
  const ariaNow = text.match(options.requireNow
    ? /aria-label=["']Agora:\s*([\d.]+)\s*reais(?:\s*com\s*(\d{1,2})\s*centavos?)?/i
    : /aria-label=["'](?:Agora:\s*)?([\d.]+)\s*reais(?:\s*com\s*(\d{1,2})\s*centavos?)?/i);
  if (ariaNow) {
    return moneyPartsToNumber(ariaNow[1], ariaNow[2]);
  }

  const fraction = firstMatch(text, [
    /data-andes-money-amount-fraction=["']true["'][^>]*>\s*([\d.]+)/i,
    /andes-money-amount__fraction[^>]*>\s*([\d.]+)/i,
  ]);
  if (!fraction) {
    return 0;
  }
  const cents = firstMatch(text, [
    /data-andes-money-amount-cents=["']true["'][^>]*>\s*(\d{1,2})/i,
    /andes-money-amount__cents[^>]*>\s*(\d{1,2})/i,
  ]);
  return moneyPartsToNumber(fraction, cents);
}

function moneyPartsToNumber(reais, cents) {
  const whole = Number(String(reais || "").replace(/\./g, ""));
  const decimal = cents ? Number(String(cents).padEnd(2, "0").slice(0, 2)) / 100 : 0;
  const value = whole + decimal;
  return Number.isFinite(value) ? value : 0;
}

function parseSalesFromText(text) {
  const source = decodeText(text);
  const looksLikeHtml = /<\/?(?:html|body|main|h1|li|div|span)\b/i.test(source);

  // Structured API responses expose the item's own sold_quantity. Do not scan
  // arbitrary page scripts because they may contain seller or related-item data.
  if (!looksLikeHtml) {
    const structured = source.match(
      /"(?:(?:sold_quantity)|(?:soldQuantity)|(?:quantity_sold)|(?:units_sold))"\s*:\s*(\d+)/i,
    );
    const structuredQuantity = Number(structured?.[1] || 0);
    if (Number.isFinite(structuredQuantity) && structuredQuantity > 0) {
      return Math.round(structuredQuantity);
    }
  }

  const visibleText = productSalesVisibleText(source);
  const normalized = normalizedProductKey(visibleText);
  const patterns = [
    /mais\s+de\s+\+?\s*(\d+(?:[.,]\d+)?)\s*(mil|mi|milhao|milhoes)?\s*(?:comprado|comprados|vendido|vendidos)/i,
    /\+?\s*(\d+(?:[.,]\d+)?)\s*(mil|mi|milhao|milhoes)?\s*(?:vendido|vendidos|comprado|comprados)/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern) || visibleText.match(pattern);
    if (!match) {
      continue;
    }
    const parsed = Number(String(match[1]).replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      continue;
    }
    return Math.round(parsed * salesUnitMultiplier(match[2]));
  }

  return null;
}

function productSalesVisibleText(source) {
  const visibleHtml = String(source || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ");
  const isProductPage = /<h1\b|ui-pdp-(?:header|title|subtitle)/i.test(visibleHtml);

  if (!isProductPage) {
    return cleanText(visibleHtml);
  }

  const headingIndex = visibleHtml.search(/<h1\b|ui-pdp-title/i);
  const headerIndex = visibleHtml.search(/ui-pdp-(?:header|subtitle)/i);
  const anchorIndex = headingIndex >= 0 ? headingIndex : headerIndex;
  if (anchorIndex < 0) {
    return cleanText(visibleHtml.slice(0, 12_000));
  }

  // The public sales badge belongs to the PDP header, close to the H1. Limiting
  // this scope prevents carousels and recommendations from lending their sales
  // count to the advertised product.
  return cleanText(visibleHtml.slice(Math.max(0, anchorIndex - 5_000), anchorIndex + 8_000));
}

function salesUnitMultiplier(unit) {
  const normalized = normalizedProductKey(unit || "");
  if (["milhao", "milhoes", "mi"].includes(normalized)) {
    return 1_000_000;
  }
  if (normalized === "mil") {
    return 1_000;
  }
  return 1;
}

function parseCategoryId(text) {
  return firstMatch(text, [
    /"category_id"\s*:\s*"([^"]+)"/i,
    /"categoryId"\s*:\s*"([^"]+)"/i,
    /"category"\s*:\s*{\s*"id"\s*:\s*"([^"]+)"/i,
  ]);
}

function parseCategoryName(text) {
  return cleanText(firstMatch(text, [
    /"category_name"\s*:\s*"([^"]+)"/i,
    /"categoryName"\s*:\s*"([^"]+)"/i,
    /"category"\s*:\s*{\s*"id"\s*:\s*"[^"]+"\s*,\s*"name"\s*:\s*"([^"]+)"/i,
    /<a[^>]+class=["'][^"']*andes-breadcrumb[^"']*["'][^>]*>([\s\S]*?)<\/a>/i,
  ]));
}

function parseWeightKg(text) {
  const source = decodeText(text);
  const explicit = firstMatch(source, [
    /"id"\s*:\s*"WEIGHT"[\s\S]{0,500}?"value_name"\s*:\s*"([^"]+)"/i,
    /"id"\s*:\s*"PACKAGE_WEIGHT"[\s\S]{0,500}?"value_name"\s*:\s*"([^"]+)"/i,
    /"name"\s*:\s*"Peso"[\s\S]{0,300}?"value_name"\s*:\s*"([^"]+)"/i,
    /"package_weight"\s*:\s*"?([^",}]+(?:kg|kgs|g|gr|gramas?))"?/i,
  ]);
  const visibleText = normalizeHtmlText(source);
  const weightSection = firstMatch(visibleText, [
    /peso\s+e\s+dimens(?:ao|oes)[\s\S]{0,1200}?\bpeso\s+(\d+(?:[,.]\d+)?\s*(?:kg|kgs|g|gr|gramas?))/i,
  ]);
  const tableWeight = firstMatch(source, [
    /<(?:th|td)[^>]*>\s*peso\s*<\/(?:th|td)>[\s\S]{0,500}?<(?:th|td)[^>]*>\s*(\d+(?:[,.]\d+)?\s*(?:kg|kgs|g|gr|gramas?))/i,
  ]);
  const nearbyLabel = firstMatch(source.slice(0, 240), [
    /(?:peso|weight)[^<>"']{0,80}?(\d+(?:[,.]\d+)?\s*(?:kg|kgs|g|gr|gramas?))/i,
  ]);
  // The page contains unrelated weights in recommendations and scripts. When
  // there is no explicit package attribute, only inspect the leading title.
  const measures = extractMeasures(explicit || weightSection || tableWeight || nearbyLabel || source.slice(0, 240));
  const weight = measures.find((measure) => measure.kind === "weight");
  return weight ? Number((weight.value / 1000).toFixed(3)) : null;
}

function parseSellerId(text) {
  const value = firstMatch(decodeText(text), [
    /"seller_id"\s*:\s*"?(\d+)"?/i,
    /"sellerId"\s*:\s*"?(\d+)"?/i,
    /"seller"\s*:\s*\{[\s\S]{0,160}?"id"\s*:\s*"?(\d+)"?/i,
  ]);
  return value ? Number(value) : null;
}

function parseListingTypeId(text) {
  return firstMatch(decodeText(text), [
    /"listing_type_id"\s*:\s*"([^"]+)"/i,
    /"listingTypeId"\s*:\s*"([^"]+)"/i,
  ]);
}

function parseShippingMode(text) {
  return firstMatch(decodeText(text), [
    /"shipping"\s*:\s*\{[\s\S]{0,500}?"mode"\s*:\s*"([^"]+)"/i,
    /"shipping_mode"\s*:\s*"([^"]+)"/i,
  ]);
}

function parseLogisticType(text) {
  return firstMatch(decodeText(text), [
    /"shipping"\s*:\s*\{[\s\S]{0,700}?"logistic_type"\s*:\s*"([^"]+)"/i,
    /"logistic_type"\s*:\s*"([^"]+)"/i,
  ]);
}

function parseShippingDimensions(text) {
  return firstMatch(decodeText(text), [
    /"shipping"\s*:\s*\{[\s\S]{0,700}?"dimensions"\s*:\s*"([^"]+)"/i,
    /"dimensions"\s*:\s*"(\d+x\d+x\d+,\d+)"/i,
  ]);
}

function parseFreeShipping(text) {
  const value = firstMatch(decodeText(text), [
    /"shipping"\s*:\s*\{[\s\S]{0,700}?"free_shipping"\s*:\s*(true|false)/i,
    /"free_shipping"\s*:\s*(true|false)/i,
  ]);
  return value ? value.toLowerCase() === "true" : null;
}

async function discoverCategory(title) {
  const query = normalizeProductSearchQuery(title).slice(0, 120);
  if (!query) {
    return null;
  }
  const response = await fetch(`https://api.mercadolibre.com/sites/MLB/domain_discovery/search?q=${encodeURIComponent(query)}&limit=1`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "BuscaVendasConfweb/1.0",
    },
    signal: AbortSignal.timeout(6_000),
  });
  if (!response.ok) {
    return null;
  }
  const data = await response.json();
  return Array.isArray(data) ? data[0] : null;
}

function parseTotalAvailable(text) {
  const match = decodeText(text).match(/(?:mais de\s*)?([\d.]+)\s+resultados/i);
  return match ? Number(match[1].replace(/\./g, "")) : 0;
}

function productDetailUrls(item) {
  const href = String(item?.href || "");
  const itemId = extractItemId(href);
  const productId = extractProductId(href);
  const fallbackId = /^MLB\d+$/i.test(String(item?.id || "")) ? String(item.id) : "";
  const itemPageUrl = mercadoLivreItemPageUrl(itemId || productId || fallbackId);
  const cleanHref = cleanMercadoLivreProductUrl(item.href);
  const urls = [];

  if (itemPageUrl) {
    urls.push(itemPageUrl);
  }

  // Catalog and tracking links have repeatedly returned charged 404 responses
  // through providers. Use them only when no canonical item URL can be built.
  if (cleanHref && (!itemPageUrl || /(^|\.)produto\.mercadolivre\.com\.br$/i.test(new URL(cleanHref).hostname))) {
    urls.push(cleanHref);
  }

  return [...new Set(urls.filter(Boolean))];
}

function mercadoLivreItemPageUrl(itemId) {
  const match = String(itemId || "").match(/^MLB(\d+)$/i);
  return match ? `https://produto.mercadolivre.com.br/MLB-${match[1]}-_JM` : "";
}

function searchUrlFor(query, page = 1) {
  const slug = normalizeProductSearchQuery(query).replace(/\s+/g, "-").replace(/-+/g, "-");
  const base = `https://lista.mercadolivre.com.br/${encodeURIComponent(slug).replace(/%2D/g, "-")}`;
  if (page <= 1) {
    return base;
  }
  const offset = (page - 1) * 48 + 1;
  return `${base}_Desde_${offset}_NoIndex_True`;
}

function normalizeMercadoLivreUrl(url) {
  const text = decodeText(url).replace(/\\\//g, "/").replace(/^\/\//, "https://");
  if (!text) {
    return "";
  }
  try {
    return new URL(text, "https://www.mercadolivre.com.br").toString();
  } catch {
    return text;
  }
}

function cleanMercadoLivreProductUrl(href) {
  try {
    const url = new URL(normalizeMercadoLivreUrl(href));
    if (!/mercadolivre\.com\.br/i.test(url.hostname)) {
      return "";
    }
    url.hash = "";
    url.search = "";
    return url.toString();
  } catch {
    return "";
  }
}

function extractItemId(href) {
  const text = decodeURIComponent(String(href || ""));
  const wid = text.match(/[?&#]wid=(MLB\d+)/i);
  if (wid) {
    return wid[1].toUpperCase();
  }
  const classic = text.match(/\/MLB-?(\d+)/i);
  if (classic) {
    return `MLB${classic[1]}`.toUpperCase();
  }
  const item = text.match(/item_id[:=](MLB\d+)/i);
  if (item) {
    return item[1].toUpperCase();
  }
  return "";
}

function extractProductId(href) {
  const text = decodeURIComponent(String(href || ""));
  const product = text.match(/\/p\/(MLB\d+)/i);
  return product ? product[1].toUpperCase() : "";
}

function normalizeHtmlText(text) {
  return String(text || "")
    .replace(/\\u00a0/gi, " ")
    .replace(/\\u002b/gi, "+")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&#43;|&plus;/gi, "+")
    .replace(/\u00a0/g, " ");
}

function decodeText(text) {
  return normalizeHtmlText(text)
    .replace(/\\"/g, '"')
    .replace(/\\\//g, "/")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x2F;/gi, "/");
}

function cleanText(text) {
  return decodeText(text)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstMatch(text, patterns) {
  const source = String(text || "");
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }
  return "";
}

function parseNumberValue(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return 0;
  }
  if (raw.includes(",")) {
    return Number(raw.replace(/\./g, "").replace(",", "."));
  }
  return Number(raw);
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function describeZyteError(status, data, text) {
  const detail = data?.detail || data?.message || data?.error || text.slice(0, 180);
  if (status === 401 || status === 403) {
    return "Zyte recusou a API Key. Copie a API Key correta da página Zyte API Access e salve novamente.";
  }
  if (/kyc/i.test(String(detail || ""))) {
    return "A Zyte exige aprovação KYC para usar IP residencial. Solicite o acesso no Zyte IDE e mantenha o modo automático até a aprovação.";
  }
  if (status === 520 || /ban-free response/i.test(String(detail || ""))) {
    return "A Zyte não conseguiu uma resposta sem bloqueio do Mercado Livre. Após a aprovação KYC, ative IP residencial brasileiro no painel admin.";
  }
  return `Zyte respondeu ${status}: ${detail || "sem detalhe"}`;
}

function emptyResult(source, message) {
  return {
    ok: false,
    source,
    metricsMode: "market_signal",
    salesAvailable: false,
    message,
    items: [],
    exactMatches: 0,
    totalAvailable: 0,
    totals: { demand: 0, revenue: 0, averageTicket: 0 },
  };
}

function zyteApiKey() {
  return (getSetting("zyte_api_key") || process.env.ZYTE_API_KEY || "").trim();
}

function zyteEndpoint() {
  return (getSetting("zyte_endpoint") || process.env.ZYTE_ENDPOINT || ZYTE_ENDPOINT).trim();
}

function shouldRender() {
  return (getSetting("zyte_mode") || process.env.ZYTE_MODE || "browser_html") !== "http_response";
}

function zyteSearchPages() {
  return Number(process.env.ZYTE_SEARCH_PAGES || getSetting("zyte_search_pages") || 4);
}

function zyteDetailLimit() {
  return Number(process.env.ZYTE_DETAIL_LIMIT || getSetting("zyte_detail_limit") || 60);
}

function zyteSearchCardLimit() {
  return Number(process.env.ZYTE_SEARCH_CARD_LIMIT || getSetting("zyte_search_card_limit") || 60);
}

function zyteTimeoutMs() {
  return Number(process.env.ZYTE_TIMEOUT_MS || getSetting("zyte_timeout_ms") || 90_000);
}

function zyteIpType() {
  return (getSetting("zyte_ip_type") || process.env.ZYTE_IP_TYPE || "auto").trim().toLowerCase();
}

function zyteGeolocation() {
  return (getSetting("zyte_geolocation") || process.env.ZYTE_GEOLOCATION || "BR").trim().toUpperCase();
}

function ensureDiskCacheLoaded() {
  if (diskCacheLoaded) {
    return;
  }
  diskCacheLoaded = true;
  if (!existsSync(CACHE_FILE)) {
    return;
  }
  try {
    const raw = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
    for (const [key, value] of Object.entries(raw)) {
      if (value?.createdAt && value?.result) {
        cache.set(key, value);
      }
    }
  } catch {
    // Cache can be rebuilt.
  }
}

function persistDiskCache() {
  try {
    mkdirSync(dirname(CACHE_FILE), { recursive: true });
    const serializable = {};
    for (const [key, value] of cache.entries()) {
      if (Date.now() - value.createdAt < STALE_CACHE_TTL_MS) {
        serializable[key] = value;
      }
    }
    writeFileSync(CACHE_FILE, JSON.stringify(serializable, null, 2));
  } catch {
    // Search should not fail because cache write failed.
  }
}

export const mercadoLivreHtmlParser = Object.freeze({
  championScore,
  cleanMercadoLivreProductUrl,
  extractItemId,
  extractProductId,
  extractSearchItems,
  normalizeMercadoLivreUrl,
  parseCategoryId,
  parseCategoryName,
  parseFreeShipping,
  parseImage,
  parseListingTypeId,
  parseLogisticType,
  parsePrice,
  parseSalesFromText,
  parseSellerId,
  parseShippingDimensions,
  parseShippingMode,
  parseTitle,
  parseTotalAvailable,
  parseWeightKg,
  productDetailUrls,
  searchUrlFor,
});

export function syncZyteSettingsFromEnv() {
  if (process.env.ZYTE_API_KEY && !getSetting("zyte_api_key")) {
    setSetting("zyte_api_key", process.env.ZYTE_API_KEY.trim());
  }
  setSetting(
    "zyte_search_enabled",
    process.env.ZYTE_SEARCH_ENABLED
      ? process.env.ZYTE_SEARCH_ENABLED.trim().toLowerCase()
      : "false",
  );
  if (process.env.ZYTE_ENDPOINT && !getSetting("zyte_endpoint")) {
    setSetting("zyte_endpoint", process.env.ZYTE_ENDPOINT.trim());
  }
  if (process.env.ZYTE_MODE && !getSetting("zyte_mode")) {
    setSetting("zyte_mode", process.env.ZYTE_MODE.trim());
  }
  if (process.env.ZYTE_IP_TYPE && !getSetting("zyte_ip_type")) {
    setSetting("zyte_ip_type", process.env.ZYTE_IP_TYPE.trim().toLowerCase());
  }
  if (process.env.ZYTE_GEOLOCATION && !getSetting("zyte_geolocation")) {
    setSetting("zyte_geolocation", process.env.ZYTE_GEOLOCATION.trim().toUpperCase());
  }
}
