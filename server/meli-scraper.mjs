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
  const averageTicket = uniqueItems.length
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
    metricsMode: "market_signal",
    salesAvailable: false,
    message: uniqueItems.length >= 3
      ? "Anuncios reais encontrados na pagina publica do Mercado Livre com filtro exato. Vendas por anuncio ainda nao estao liberadas pela API, entao nao foram simuladas."
      : `Encontrei ${uniqueItems.length} anuncio(s) com correspondencia exata. Nao completei 3 para evitar entregar produto diferente do pesquisado.`,
    items: uniqueItems.map(mapScrapedItem),
    exactMatches: uniqueItems.length,
    totalAvailable: scraped.totalAvailable,
    totals: {
      demand: 0,
      revenue: 0,
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
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    const context = await browser.newContext({
      locale: "pt-BR",
      viewport: { width: 1366, height: 900 },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      extraHTTPHeaders: {
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.6",
      },
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

    await page.waitForSelector("a.poly-component__title", { timeout: 10_000 });
    bodyText = await safeBodyText(page);
    await assertNotBlocked(page, bodyText);

    const items = await page.$$eval("a.poly-component__title", (anchors) =>
      anchors.map((anchor) => {
        const card =
          anchor.closest("li.ui-search-layout__item") ||
          anchor.closest("li") ||
          anchor.closest(".poly-card") ||
          anchor.parentElement;
        const image = card
          ? Array.from(card.querySelectorAll("img"))
              .map((img) => img.currentSrc || img.src || img.getAttribute("data-src") || "")
              .find(Boolean) || ""
          : "";
        const text = (card?.textContent || "").replace(/\s+/g, " ").trim();

        return {
          title: (anchor.textContent || "").replace(/\s+/g, " ").trim(),
          href: anchor.href,
          text,
          image,
          isAd: /[?&#]is_advertising=true/i.test(anchor.href) || /\bAd\b/.test(text),
          bestSeller: /mais vendido/i.test(text),
        };
      }),
    );

    return {
      totalAvailable: parseTotalAvailable(bodyText) || items.length,
      items: items.map((item) => ({
        ...item,
        id: extractItemId(item.href) || normalizedProductKey(item.title),
        price: parseCardPrice(item.text),
      })),
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
  return item.position + (item.isAd ? 20 : 0) - (item.bestSeller ? 8 : 0);
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
    soldQuantity: null,
    salesMetricLabel: "Nao divulgado",
    revenue: null,
    revenueMetricLabel: "Aguardando API",
    permalink: item.href || searchUrlFor(item.title),
  };
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
