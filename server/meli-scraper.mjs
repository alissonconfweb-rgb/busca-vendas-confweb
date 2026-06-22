import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildProductQuerySpec, matchesProductQuery, normalizedProductKey } from "./product-match.mjs";

const CACHE_TTL_MS = Number(process.env.MELI_SCRAPER_CACHE_MS || 60 * 60 * 1000);
const STALE_CACHE_TTL_MS = Number(process.env.MELI_SCRAPER_STALE_CACHE_MS || 6 * 60 * 60 * 1000);
const SCRAPER_TIMEOUT_MS = Number(process.env.MELI_SCRAPER_TIMEOUT_MS || 45_000);
const CACHE_FILE = resolve(process.cwd(), "data", "meli-scraper-cache.json");
const cache = new Map();
const inFlight = new Map();
let diskCacheLoaded = false;

export async function searchMercadoLivreScraper(query) {
  const cacheKey = normalizedProductKey(query);
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

  const promise = runScraper(query)
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

async function runScraper(query) {
  let scraped;
  const cacheKey = normalizedProductKey(query);

  try {
    scraped = await scrapeSearchPage(query);
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
  const uniqueItems = dedupeAndRank(candidates).slice(0, 3);
  const mappedItems = uniqueItems.map(mapScrapedItem);
  const demand = mappedItems.reduce((sum, item) => sum + (typeof item.soldQuantity === "number" ? item.soldQuantity : 0), 0);
  const revenue = mappedItems.reduce((sum, item) => sum + (typeof item.revenue === "number" ? item.revenue : 0), 0);
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
    },
  };
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

async function scrapeSearchPage(query) {
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
    await page.waitForTimeout(2_500);

    let bodyText = await safeBodyText(page);
    await assertNotBlocked(page, bodyText);

    for (let index = 0; index < 4; index += 1) {
      await page.mouse.wheel(0, 900);
      await page.waitForTimeout(700);
    }

    await page.waitForSelector("li.ui-search-layout__item, .ui-search-result__wrapper, .poly-card", { timeout: 10_000 });
    bodyText = await safeBodyText(page);
    await assertNotBlocked(page, bodyText);

    const items = await page.$$eval("li.ui-search-layout__item, .ui-search-result__wrapper, .poly-card", (containers) => {
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
    });

    const mappedItems = items.map((item) => ({
      ...item,
      id: extractItemId(item.href) || normalizedProductKey(item.title),
      price: Number(item.price) > 0 ? Number(item.price) : parseCardPrice(item.text),
      soldQuantity: parseSalesFromText(item.text),
    }));
    const enrichedItems = await enrichTopMercadoLivreItems(context, mappedItems);

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

function rankingScore(item) {
  const salesBonus = typeof item.soldQuantity === "number" && item.soldQuantity > 0 ? Math.min(item.soldQuantity / 100, 100) : 0;
  return item.position + (item.isAd ? 20 : 0) - (item.bestSeller ? 8 : 0) - salesBonus;
}

function mapScrapedItem(item) {
  return {
    id: item.id,
    title: item.title,
    subtitle: [
      item.bestSeller ? "Selo publico: Mais vendido" : "Ranking publico do Mercado Livre",
      item.isAd ? "Patrocinado" : "Organico",
    ].join(" - "),
    image: String(item.image || "").replace("http://", "https://"),
    price: item.price,
    soldQuantity: typeof item.soldQuantity === "number" && item.soldQuantity > 0 ? item.soldQuantity : null,
    salesMetricLabel: typeof item.soldQuantity === "number" && item.soldQuantity > 0 ? undefined : "Nao divulgado",
    revenue: typeof item.soldQuantity === "number" && item.soldQuantity > 0 ? Number((item.price * item.soldQuantity).toFixed(2)) : null,
    revenueMetricLabel: typeof item.soldQuantity === "number" && item.soldQuantity > 0 ? undefined : "Aguardando API",
    permalink: item.href || searchUrlFor(item.title),
  };
}

async function enrichTopMercadoLivreItems(context, items) {
  const enriched = [];
  for (const item of items.slice(0, 8)) {
    if (typeof item.soldQuantity === "number" && item.soldQuantity > 0) {
      enriched.push(item);
      continue;
    }
    enriched.push(await enrichMercadoLivreItem(context, item));
  }
  return [...enriched, ...items.slice(enriched.length)];
}

async function enrichMercadoLivreItem(context, item) {
  const href = item.href || "";
  if (!href || !/mercadolivre\.com\.br/i.test(href)) {
    return item;
  }

  const page = await context.newPage();
  try {
    await page.goto(href, { waitUntil: "domcontentloaded", timeout: 18_000 });
    await page.waitForTimeout(900);
    const bodyText = await safeBodyText(page);
    await assertNotBlocked(page, bodyText);
    const htmlText = await page.content().catch(() => "");
    const soldQuantity = parseSalesFromText(`${bodyText} ${htmlText}`);
    const price = parseProductPrice(`${bodyText} ${htmlText}`) || item.price;
    const finalUrl = page.url();
    return {
      ...item,
      href: /mercadolivre\.com\.br/i.test(finalUrl) ? finalUrl : item.href,
      price,
      soldQuantity: soldQuantity || item.soldQuantity,
    };
  } catch {
    return item;
  } finally {
    await page.close().catch(() => {});
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
    return await page.locator("body").innerText({ timeout: 8_000 });
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
  const normalized = normalizedProductKey(String(text || ""));
  const patterns = [
    /"(?:(?:sold_quantity)|(?:soldQuantity)|(?:quantity_sold)|(?:units_sold))"\s*:\s*(\d+)/i,
    /(\d+(?:[.,]\d+)?)\s*\+?\s*(?:vendido|vendidos|venda|vendas|comprado|comprados)/i,
    /mais\s+de\s+(\d+(?:[.,]\d+)?)\s*(?:comprado|comprados|vendido|vendidos)/i,
    /(\d+(?:[.,]\d+)?)\s*mil\s*(?:vendido|vendidos|comprado|comprados)?/i,
  ];

  for (let index = 0; index < patterns.length; index += 1) {
    const match = normalized.match(patterns[index]) || String(text || "").match(patterns[index]);
    if (!match) {
      continue;
    }
    const parsed = Number(String(match[1]).replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      continue;
    }
    return index === 3 ? Math.round(parsed * 1000) : Math.round(parsed);
  }

  return null;
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
