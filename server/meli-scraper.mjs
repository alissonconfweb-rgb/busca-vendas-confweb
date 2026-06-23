import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildProductQuerySpec, matchesProductQuery, normalizedProductKey } from "./product-match.mjs";

const CACHE_TTL_MS = Number(process.env.MELI_SCRAPER_CACHE_MS || 60 * 60 * 1000);
const STALE_CACHE_TTL_MS = Number(process.env.MELI_SCRAPER_STALE_CACHE_MS || 6 * 60 * 60 * 1000);
const SCRAPER_TIMEOUT_MS = Number(process.env.MELI_SCRAPER_TIMEOUT_MS || 24_000);
const PRODUCT_PAGE_TIMEOUT_MS = Number(process.env.MELI_PRODUCT_PAGE_TIMEOUT_MS || 18_000);
const SEARCH_RESULTS_WAIT_MS = Number(process.env.MELI_SEARCH_RESULTS_WAIT_MS || 12_000);
const SEARCH_CARD_LIMIT = Number(process.env.MELI_SEARCH_CARD_LIMIT || 12);
const CACHE_VERSION = "sales-real-v7";
const CACHE_FILE = resolve(process.cwd(), "data", "meli-scraper-cache.json");
const cache = new Map();
const inFlight = new Map();
let diskCacheLoaded = false;

export async function searchMercadoLivreScraper(query, options = {}) {
  const cacheKey = scraperCacheKey(query, options);
  ensureDiskCacheLoaded();
  const cached = cache.get(cacheKey);

  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    return {
      ...cached.result,
      message: `${cached.result.message} Resultado reaproveitado do cache temporario.`,
    };
  }

  if (inFlight.has(cacheKey)) {
    return inFlight.get(cacheKey);
  }

  const promise = runScraper(query, options)
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

async function runScraper(query, options = {}) {
  let scraped;
  const cacheKey = scraperCacheKey(query, options);

  try {
    scraped = await scrapeSearchPage(query, options);
  } catch (error) {
    const stale = cache.get(cacheKey);
    if (stale && Date.now() - stale.createdAt < STALE_CACHE_TTL_MS) {
      return {
        ...stale.result,
        message: `${stale.result.message} Mercado Livre pediu verificacao agora; usando cache temporario real.`,
      };
    }

    return {
      ok: false,
      source: "mercado_livre_scraper_blocked",
      metricsMode: "market_signal",
      salesAvailable: false,
      message: error instanceof Error
        ? `Nao foi possivel ler a listagem publica do Mercado Livre agora: ${error.message}`
        : "Nao foi possivel ler a listagem publica do Mercado Livre agora.",
      items: [],
      exactMatches: 0,
      totalAvailable: 0,
      totals: { demand: 0, revenue: 0, averageTicket: 0 },
    };
  }

  const spec = buildProductQuerySpec(query);
  const candidates = scraped.items
    .map((item, index) => ({ ...item, position: index + 1, match: matchesProductQuery(item.title, spec) }))
    .filter((item) => item.match.ok && item.price > 0);
  const uniqueItems = dedupeAndRankChampions(candidates).slice(0, 3);
  const mappedItems = uniqueItems.map(mapScrapedItem);
  const demand = mappedItems.reduce((sum, item) => sum + (typeof item.soldQuantity === "number" ? item.soldQuantity : 0), 0);
  const revenue = mappedItems.reduce((sum, item) => sum + (typeof item.revenue === "number" ? item.revenue : 0), 0);
  const actualDemand = mappedItems.reduce((sum, item) => sum + (typeof item.soldQuantity === "number" ? item.soldQuantity : 0), 0);
  const hasEstimated = false;
  const hasSales = demand > 0;
  const averageTicket = hasSales
    ? revenue / demand
    : uniqueItems.length
    ? uniqueItems.reduce((sum, item) => sum + item.price, 0) / uniqueItems.length
    : 0;

  if (!uniqueItems.length) {
    return {
      ok: false,
      source: "mercado_livre_scraper_no_exact_match",
      metricsMode: "market_signal",
      salesAvailable: false,
      message: `Encontrei a pagina do Mercado Livre, mas nenhum card bateu exatamente com "${query}".`,
      items: [],
      exactMatches: 0,
      totalAvailable: scraped.totalAvailable,
      totals: { demand: 0, revenue: 0, averageTicket: 0 },
    };
  }

  return {
    ok: true,
    source: "mercado_livre_scraper",
    metricsMode: hasSales ? "sales" : "market_signal",
    salesAvailable: hasSales,
    message: hasSales
      ? "Anuncios reais encontrados na pagina publica do Mercado Livre com vendas extraidas de sinais publicos do proprio anuncio."
      : uniqueItems.length >= 3
      ? "Anuncios reais encontrados na pagina publica do Mercado Livre com filtro exato. Vendas por anuncio nao apareceram publicamente, entao nao foram simuladas."
      : `Encontrei ${uniqueItems.length} anuncio(s) com correspondencia exata. Nao completei 3 para evitar entregar produto diferente do pesquisado.`,
    items: mappedItems,
    exactMatches: uniqueItems.length,
    totalAvailable: scraped.totalAvailable,
    totals: {
      demand,
      revenue,
      averageTicket,
      isEstimated: hasEstimated,
      actualDemand,
    },
  };
}

function scraperCacheKey(query, options = {}) {
  const mode = options.accessToken ? "oauth" : "public";
  return `${CACHE_VERSION}:${mode}:${normalizedProductKey(query)}`;
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
    // Ignore malformed cache; the scraper can rebuild it.
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
    // Cache is a convenience layer; search should not fail if disk write fails.
  }
}

async function scrapeSearchPage(query, options = {}) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1920,1080",
      "--lang=pt-BR",
    ],
  });

  try {
    const context = await browser.newContext({
      locale: "pt-BR",
      viewport: { width: 1920, height: 1080 },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      extraHTTPHeaders: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.6",
      },
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      Object.defineProperty(navigator, "languages", { get: () => ["pt-BR", "pt", "en-US", "en"] });
      Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
    });
    const page = await context.newPage();
    const url = searchUrlFor(query);

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: SCRAPER_TIMEOUT_MS });
    await page.waitForTimeout(1_500);

    let bodyText = await safeBodyText(page);
    await assertNotBlocked(page, bodyText);

    for (let index = 0; index < 1; index += 1) {
      await page.mouse.wheel(0, 900);
      await page.waitForTimeout(500);
    }

    await page.waitForSelector("li.ui-search-layout__item, .ui-search-result__wrapper, .poly-card", {
      timeout: SEARCH_RESULTS_WAIT_MS,
    });
    bodyText = await safeBodyText(page);
    await assertNotBlocked(page, bodyText);

    const items = await page.$$eval("li.ui-search-layout__item, .ui-search-result__wrapper, .poly-card", (containers, limit) => {
      const containerSelector = "li.ui-search-layout__item, .ui-search-result__wrapper, .poly-card";
      const titleSelector = "a.poly-component__title, a.ui-search-link, a[href*='/p/MLB'], a[href*='/MLB']";
      const priceSelectors = [
        ".poly-price__current .andes-money-amount",
        ".poly-price__current",
        ".poly-component__price .andes-money-amount",
        ".andes-money-amount",
      ];
      const parsePrice = (value) => {
        const match = String(value || "").match(/R\$\s*([\d.]+(?:,\d{1,2})?|\d+)/);
        if (!match) {
          return 0;
        }
        const raw = match[1];
        return raw.includes(",")
          ? Number(raw.replace(/\./g, "").replace(",", "."))
          : Number(raw.replace(/\./g, ""));
      };
      const readPrice = (card) => {
        for (const selector of priceSelectors) {
          const values = Array.from(card.querySelectorAll(selector))
            .map((element) => parsePrice(element.textContent))
            .filter((price) => Number.isFinite(price) && price > 0);
          if (values.length) {
            return values[0];
          }
        }
        return parsePrice(card.textContent);
      };

      return containers
        .filter((container) => !container.parentElement?.closest(containerSelector))
        .slice(0, Number(limit) || 12)
        .map((card) => {
          const anchor = card.querySelector(titleSelector);
          const image =
            Array.from(card.querySelectorAll("img"))
              .map((img) => img.currentSrc || img.src || img.getAttribute("data-src") || "")
              .find(Boolean) || "";
          const text = (card.textContent || "").replace(/\s+/g, " ").trim();

          return {
            title: (anchor?.textContent || "").replace(/\s+/g, " ").trim(),
            href: anchor?.href || "",
            text,
            image,
            price: readPrice(card),
            isAd: /[?&#]is_advertising=true/i.test(anchor?.href || "") || /\bAd\b/.test(text),
            bestSeller: /mais vendido/i.test(text),
          };
        });
    }, SEARCH_CARD_LIMIT);

    const mappedItems = items.map((item, index) => ({
      ...item,
      position: index + 1,
      id: extractItemId(item.href) || normalizedProductKey(item.title),
      price: Number(item.price) > 0 ? Number(item.price) : parseCardPrice(item.text),
      soldQuantity: parseSalesFromText(item.text),
    }));
    const spec = buildProductQuerySpec(query);
    const exactItems = mappedItems
      .map((item) => ({ ...item, match: matchesProductQuery(item.title, spec) }))
      .filter((item) => item.match.ok && item.price > 0);
    const enrichedItems = await enrichTopMercadoLivreItems(context, dedupeAndRank(exactItems).slice(0, 3), options);

    return {
      totalAvailable: parseTotalAvailable(bodyText) || items.length,
      items: enrichedItems,
    };
  } finally {
    await browser.close();
  }
}

function dedupeAndRank(items) {
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

function dedupeAndRankChampions(items) {
  const byKey = new Map();

  for (const item of items) {
    const key = item.id || normalizedProductKey(item.title);
    const current = byKey.get(key);
    if (!current || championScore(item) < championScore(current)) {
      byKey.set(key, item);
    }
  }

  return [...byKey.values()].sort((a, b) => championScore(a) - championScore(b));
}

function championScore(item) {
  const soldQuantity = typeof item.soldQuantity === "number" && item.soldQuantity > 0 ? item.soldQuantity : 0;
  if (soldQuantity > 0) {
    return -soldQuantity + rankingScore(item) / 1000;
  }
  return rankingScore(item);
}

function rankingScore(item) {
  const salesBonus = typeof item.soldQuantity === "number" && item.soldQuantity > 0 ? Math.min(item.soldQuantity / 100, 100) : 0;
  return item.position + (item.isAd ? 20 : 0) - (item.bestSeller ? 8 : 0) - salesBonus;
}

function mapScrapedItem(item) {
  const hasSales = typeof item.soldQuantity === "number" && item.soldQuantity > 0;

  return {
    id: item.id,
    title: item.title,
    subtitle: [
      item.bestSeller ? "Selo publico: Mais vendido" : "Ranking publico do Mercado Livre",
      item.isAd ? "Patrocinado" : "Organico",
    ].join(" - "),
    image: String(item.image || "").replace("http://", "https://"),
    price: item.price,
    soldQuantity: hasSales ? item.soldQuantity : null,
    estimatedSoldQuantity: null,
    salesMetricLabel: hasSales ? undefined : "Nao exibido pelo Mercado Livre",
    revenue: hasSales ? Number((item.price * item.soldQuantity).toFixed(2)) : null,
    estimatedRevenue: null,
    revenueMetricLabel: hasSales ? undefined : "Aguardando API",
    permalink: item.href || searchUrlFor(item.title),
  };
}

async function enrichTopMercadoLivreItems(context, items, options = {}) {
  const topItems = items.slice(0, 3);
  const enriched = [];

  for (const item of topItems) {
    enriched.push(
      typeof item.soldQuantity === "number" && item.soldQuantity > 0
        ? item
        : await enrichMercadoLivreItem(context, item, options),
    );
  }

  return [...enriched, ...items.slice(topItems.length)];
}

async function enrichMercadoLivreItem(context, item, options = {}) {
  const href = item.href || "";
  if (!href || !/mercadolivre\.com\.br/i.test(href)) {
    return item;
  }

  const apiItem = await enrichMercadoLivreItemWithApi(item, options);
  if (typeof apiItem.soldQuantity === "number" && apiItem.soldQuantity > 0) {
    return apiItem;
  }

  const page = await context.newPage();
  try {
    let detail = await readMercadoLivreProductPage(page, href);
    let soldQuantity = parseSalesFromText(detail.text);
    let price = parseProductPrice(detail.text) || item.price;

    const cleanHref = cleanMercadoLivreProductUrl(detail.finalUrl || href);
    if (!soldQuantity && cleanHref) {
      detail = await readMercadoLivreProductPage(page, cleanHref);
      soldQuantity = parseSalesFromText(detail.text);
      price = parseProductPrice(detail.text) || price;
    }

    if (!soldQuantity) {
      await assertNotBlocked(page, detail.bodyText);
    }
    return {
      ...item,
      href: /mercadolivre\.com\.br/i.test(detail.finalUrl) ? cleanMercadoLivreProductUrl(detail.finalUrl) || detail.finalUrl : item.href,
      price,
      soldQuantity: soldQuantity || item.soldQuantity,
    };
  } catch {
    return enrichMercadoLivreItemWithFetch(item, href);
  } finally {
    await page.close().catch(() => {});
  }
}

async function readMercadoLivreProductPage(page, href) {
  await page.goto(href, { waitUntil: "domcontentloaded", timeout: PRODUCT_PAGE_TIMEOUT_MS });
  await page.waitForLoadState("networkidle", { timeout: 6_000 }).catch(() => {});
  await page.waitForTimeout(1_200);
  const bodyText = await safeBodyText(page);
  const htmlText = await page.content().catch(() => "");
  const finalUrl = page.url();
  const directText = await fetchMercadoLivrePageText(finalUrl || href);
  return {
    bodyText,
    finalUrl,
    text: `${bodyText} ${htmlText} ${directText}`,
  };
}

function cleanMercadoLivreProductUrl(href) {
  try {
    const url = new URL(href);
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

async function enrichMercadoLivreItemWithApi(item, options = {}) {
  const accessToken = options.accessToken;
  const itemId = extractItemId(item.href) || item.id;
  if (!accessToken || !/^MLB\d+$/i.test(itemId || "")) {
    return item;
  }

  const apiItem = await fetchMeliJson(`https://api.mercadolibre.com/items/${itemId}`, accessToken);
  if (apiItem) {
    const soldQuantity = Number(apiItem.sold_quantity ?? apiItem.soldQuantity ?? apiItem.initial_quantity_sold ?? 0);
    const price = Number(apiItem.price ?? item.price);
    return {
      ...item,
      href: apiItem.permalink || item.href,
      price: Number.isFinite(price) && price > 0 ? price : item.price,
      soldQuantity: Number.isFinite(soldQuantity) && soldQuantity > 0 ? soldQuantity : item.soldQuantity,
    };
  }

  const productId = extractProductId(item.href);
  if (!productId) {
    return item;
  }

  const product = await fetchMeliJson(`https://api.mercadolibre.com/products/${productId}`, accessToken);
  const productSoldQuantity = Number(product?.sold_quantity ?? product?.soldQuantity ?? product?.quantity_sold ?? 0);
  const productPrice = Number(product?.buy_box_winner?.price ?? product?.price ?? item.price);

  return {
    ...item,
    price: Number.isFinite(productPrice) && productPrice > 0 ? productPrice : item.price,
    soldQuantity: Number.isFinite(productSoldQuantity) && productSoldQuantity > 0 ? productSoldQuantity : item.soldQuantity,
  };
}

async function fetchMeliJson(url, accessToken) {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "BuscaVendasConfweb/1.0",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  }
}

async function enrichMercadoLivreItemWithFetch(item, href) {
  const directText = await fetchMercadoLivrePageText(href);
  const soldQuantity = parseSalesFromText(directText);
  const price = parseProductPrice(directText) || item.price;
  return {
    ...item,
    price,
    soldQuantity: soldQuantity || item.soldQuantity,
  };
}

async function fetchMercadoLivrePageText(url) {
  if (!url || !/mercadolivre\.com\.br/i.test(url)) {
    return "";
  }

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.6",
        "Cache-Control": "no-cache",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      return "";
    }
    return await response.text();
  } catch {
    return "";
  }
}

function searchUrlFor(query) {
  const slug = String(query || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
  return `https://lista.mercadolivre.com.br/${encodeURIComponent(slug).replace(/%2D/g, "-")}`;
}

async function safeBodyText(page) {
  try {
    return await page.locator("body").innerText({ timeout: 5_000 });
  } catch {
    return "";
  }
}

async function assertNotBlocked(page, bodyText) {
  const title = await page.title().catch(() => "");
  const normalized = normalizedProductKey(`${page.url()} ${title} ${bodyText}`);
  const blocked = [
    "captcha",
    "complete-esta-etapa",
    "por-seguranca",
    "seguridad",
    "account-verification",
  ].some((marker) => normalized.includes(marker));

  if (blocked) {
    throw new Error("o Mercado Livre pediu verificacao de seguranca para o navegador automatico");
  }
}

function parseTotalAvailable(text) {
  const normalized = String(text || "").replace(/\s+/g, " ");
  const match = normalized.match(/(?:mais de\s*)?([\d.]+)\s+resultados/i);
  if (!match) {
    return 0;
  }
  return Number(match[1].replace(/\./g, ""));
}

function parseSalesFromText(text) {
  const rawText = normalizeHtmlText(text);
  const normalized = normalizedProductKey(rawText);
  const patterns = [
    /"(?:(?:sold_quantity)|(?:soldQuantity)|(?:quantity_sold)|(?:units_sold))"\s*:\s*(\d+)/i,
    /\+?\s*(\d+(?:[.,]\d+)?)\s*(mil|mi|milhao|milhoes)?\s*(?:vendido|vendidos|venda|vendas|comprado|comprados)/i,
    /mais\s+de\s+\+?\s*(\d+(?:[.,]\d+)?)\s*(mil|mi|milhao|milhoes)?\s*(?:comprado|comprados|vendido|vendidos)/i,
  ];

  for (let index = 0; index < patterns.length; index += 1) {
    const match = normalized.match(patterns[index]) || rawText.match(patterns[index]);
    if (!match) {
      continue;
    }
    const parsed = Number(String(match[1]).replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      continue;
    }
    const multiplier = salesUnitMultiplier(match[2]);
    return Math.round(parsed * multiplier);
  }

  return null;
}

function normalizeHtmlText(text) {
  return String(text || "")
    .replace(/\\u00a0/gi, " ")
    .replace(/\\u002b/gi, "+")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&#43;|&plus;/gi, "+")
    .replace(/\u00a0/g, " ");
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

function parseCardPrice(text) {
  const prices = [...String(text || "").matchAll(/R\$\s*([\d.]+,\d{2})/g)]
    .map((match) => Number(match[1].replace(/\./g, "").replace(",", ".")))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (!prices.length) {
    return 0;
  }

  if (prices.length >= 2 && prices[0] > prices[1]) {
    return prices[1];
  }

  return prices[0];
}

function parseProductPrice(text) {
  const value = parseJsonNumber(text, /itemprop=["']price["'][^>]*content=["']([\d.,]+)/i)
    || parseJsonNumber(text, /"price"\s*:\s*"?([\d.,]+)"?/i)
    || parseJsonNumber(text, /"base_price"\s*:\s*"?([\d.,]+)"?/i)
    || parseJsonNumber(text, /"price_amount"\s*:\s*"?([\d.,]+)"?/i);
  return value && value > 0 ? value : 0;
}

function parseJsonNumber(text, pattern) {
  const match = String(text || "").match(pattern);
  if (!match) {
    return 0;
  }
  const value = parseNumberValue(match[1]);
  return Number.isFinite(value) ? value : 0;
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

function extractItemId(href) {
  const text = decodeURIComponent(String(href || ""));
  const wid = text.match(/[?&#]wid=(MLB\d+)/i);
  if (wid) {
    return wid[1].toUpperCase();
  }
  const item = text.match(/item_id[:=](MLB\d+)/i);
  if (item) {
    return item[1].toUpperCase();
  }
  const product = text.match(/\/p\/(MLB\d+)/i);
  if (product) {
    return product[1].toUpperCase();
  }
  return "";
}

function extractProductId(href) {
  const text = decodeURIComponent(String(href || ""));
  const product = text.match(/\/p\/(MLB\d+)/i);
  if (product) {
    return product[1].toUpperCase();
  }
  return "";
}
