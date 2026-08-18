import { randomInt } from "node:crypto";
import { db, getSetting, setSetting } from "./db.mjs";
import {
  buildProductQuerySpec,
  matchesMarketplaceSearchResult,
  normalizeProductSearchQuery,
  normalizedProductKey,
} from "./product-match.mjs";
import { mercadoLivreHtmlParser as parser } from "./zyte.mjs";
import { minimumChampionSales } from "./champion-policy.mjs";

const DEFAULT_ENDPOINT = "https://api.scrape.do/";
const DEFAULT_DETAIL_LIMIT = 36;
const DEFAULT_SEARCH_PAGES = 4;
const EMERGING_MARKET_SAMPLE_SIZE = 12;
const DEFAULT_DETAIL_CONCURRENCY = 4;
const MARKET_ITEM_METADATA_VERSION = 4;
export const SCRAPEDO_PRICE_PARSER_VERSION = 2;
const SALES_RANKING_STRATEGY = "visible_sales_v3";
const activeSearches = new Map();
const providerQueue = [];
let activeProviderSearches = 0;

export function isScrapeDoConfigured() {
  return Boolean(scrapeDoToken());
}

export function normalizeScrapeDoToken(value) {
  const input = String(value || "").trim().replace(/^['"]|['"]$/g, "");
  if (!input) {
    return "";
  }

  if (/^https?:\/\//i.test(input)) {
    try {
      const token = new URL(input).searchParams.get("token");
      if (token) {
        return token.trim();
      }
    } catch {
      return input;
    }
  }

  return input.replace(/^token\s*=\s*/i, "").trim();
}

export function isScrapeDoEnabled() {
  const value = getSetting("scrapedo_enabled") || process.env.SCRAPEDO_ENABLED || "true";
  return isScrapeDoConfigured() && !["false", "0", "no", "nao"].includes(String(value).toLowerCase());
}

export async function testScrapeDoConnection() {
  const token = scrapeDoToken();
  if (!token) {
    throw new Error("Configure o token da Scrape.do no painel admin.");
  }
  const response = await fetch(`https://api.scrape.do/info?token=${encodeURIComponent(token)}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(describeError(response.status, text));
  }
  const data = parseJson(text);
  const confirmedAccount = [
    "IsActive",
    "active",
    "RemainingMonthlyRequest",
    "remainingCredits",
    "ConcurrentRequest",
    "concurrency",
  ].some((key) => key in data);
  if (!Object.keys(data).length || !confirmedAccount) {
    throw new Error("A Scrape.do respondeu, mas não confirmou o token. Copie o token do painel e salve novamente.");
  }
  if (data.IsActive === false || data.active === false) {
    throw new Error("A conta Scrape.do está inativa. Verifique o plano no painel da Scrape.do.");
  }
  const rawRemainingCredits = data.RemainingMonthlyRequest ?? data.remainingCredits;
  return {
    ok: true,
    active: true,
    available: rawRemainingCredits === undefined || Number(rawRemainingCredits) > 0,
    remainingCredits: rawRemainingCredits === undefined ? null : Number(rawRemainingCredits),
    concurrency: Number(data.ConcurrentRequest ?? data.concurrency ?? 0),
  };
}

export function searchMercadoLivreScrapeDo(query, options = {}) {
  const queryKey = normalizedProductKey(normalizeProductSearchQuery(query));
  const key = `${queryKey}:${options.forceRefresh === true ? "fresh" : "cached"}`;
  const active = activeSearches.get(key);
  if (active) {
    return active;
  }

  const usage = scrapeDoUsageSummary();
  if (usage.budget > 0 && usage.used >= usage.budget) {
    return Promise.resolve(
      emptyResult(
        "scrapedo_budget_exhausted",
        "O limite operacional mensal da fonte de dados foi atingido. A equipe Confweb já foi avisada.",
      ),
    );
  }

  const search = withProviderSlot(() => executeMercadoLivreScrapeDo(query, options))
    .then((result) => {
      recordProviderUsage(queryKey, Number(result?.providerCreditsUsed || 0), result?.ok ? "completed" : "incomplete");
      return result;
    })
    .catch((error) => {
      recordProviderUsage(queryKey, 0, "failed");
      throw error;
    })
    .finally(() => activeSearches.delete(key));
  activeSearches.set(key, search);
  return search;
}

export function scrapeDoUsageSummary() {
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(credits), 0) AS used,
      COUNT(*) AS searches,
      COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failures
    FROM provider_usage
    WHERE provider = 'scrapedo'
      AND created_at >= datetime('now', 'start of month')
  `).get();
  const budget = monthlyCreditBudget();
  const used = Number(row?.used || 0);
  return {
    used,
    budget,
    remaining: budget > 0 ? Math.max(0, budget - used) : null,
    searches: Number(row?.searches || 0),
    failures: Number(row?.failures || 0),
    active: activeProviderSearches,
    queued: providerQueue.length,
  };
}

export function ensureScrapeDoSearchDepth() {
  const configuredPages = Number(
    getSetting("scrapedo_search_pages") || process.env.SCRAPEDO_SEARCH_PAGES || DEFAULT_SEARCH_PAGES,
  );
  const configuredDetailLimit = Number(
    getSetting("scrapedo_detail_limit") || process.env.SCRAPEDO_DETAIL_LIMIT || DEFAULT_DETAIL_LIMIT,
  );
  const pages = Number.isFinite(configuredPages)
    ? Math.max(DEFAULT_SEARCH_PAGES, configuredPages)
    : DEFAULT_SEARCH_PAGES;
  const details = Number.isFinite(configuredDetailLimit)
    ? Math.max(DEFAULT_DETAIL_LIMIT, configuredDetailLimit)
    : DEFAULT_DETAIL_LIMIT;

  setSetting("scrapedo_search_pages", String(Math.min(4, pages)));
  setSetting("scrapedo_detail_limit", String(Math.min(48, details)));
}

export function scrapeDoSearchPolicy() {
  return {
    pages: searchPages(),
    detailLimit: detailLimit(),
    candidateTarget: candidateTarget(),
    detailConcurrency: detailConcurrency(),
  };
}

export function hasEnoughInspectedCandidates({ championCount, verifiedCount, inspectedCount, sampleTarget }) {
  return verifiedCount >= 3 && inspectedCount >= sampleTarget;
}

export function isUsableMercadoLivreHtml(status, html) {
  if (status >= 200 && status < 300) {
    return true;
  }
  if (status !== 404) {
    return false;
  }
  const text = String(html || "").toLowerCase();
  return text.includes("<html")
    && text.includes("mercadolivre")
    && (
      text.includes("lista.mercadolivre.com.br")
      || text.includes("ui-search")
      || text.includes("search-nordic")
    );
}

export function searchMercadoLivreCachedItems(query) {
  const querySpec = buildProductQuerySpec(query);
  const verifiedSalesItems = getCachedVerifiedItems(querySpec, { requireMetadata: false })
    .filter((item) => (
      item.title
      && Number(item.price) > 0
      && Number(item.soldQuantity) > 0
      && hasTrustedCachedPrice(item)
      && matchesMarketplaceSearchResult(item.title, querySpec).ok
    ))
    .sort((a, b) => (
      Number(b.soldQuantity) - Number(a.soldQuantity)
      || parser.championScore(a) - parser.championScore(b)
    ));

  if (!verifiedSalesItems.length) {
    return null;
  }

  const threshold = minimumChampionSales();
  const championItems = verifiedSalesItems
    .filter((item) => Number(item.soldQuantity) >= threshold)
    .slice(0, 3)
    .map(mapItem);
  let items = championItems;
  let opportunityMode = "";

  if (items.length < 3) {
    items = verifiedSalesItems.slice(0, 3).map(mapItem);
    opportunityMode = championItems.length === 0 && items.every((item) => item.soldQuantity < threshold)
      ? "emerging"
      : "developing";
  }

  return {
    ...buildSalesResult(items, {
      message: "Dados públicos reais do Mercado Livre recuperados da base interna.",
      exactMatches: items.length,
      totalAvailable: verifiedSalesItems.length,
      providerCreditsUsed: 0,
      itemCacheHits: items.length,
      opportunityMode,
      marketThreshold: threshold,
    }),
    source: "confweb_cache",
    cacheHit: true,
  };
}

async function executeMercadoLivreScrapeDo(query, options = {}) {
  if (!isScrapeDoEnabled()) {
    return emptyResult("scrapedo_not_configured", "Scrape.do ainda não foi configurada.");
  }

  const querySpec = buildProductQuerySpec(query);
  const searchQuery = normalizeProductSearchQuery(query);
  const sessionId = createSessionId();
  const candidates = [];
  let totalAvailable = 0;
  let cookies = "";
  let creditsUsed = 0;
  let itemCacheHits = 0;
  let lastPageError = null;

  for (let page = 1; page <= searchPages(); page += 1) {
    let pageResponse;
    let usedRenderedResponse = false;
    try {
      pageResponse = await requestPage(parser.searchUrlFor(searchQuery, page), {
        sessionId,
        cookies,
        render: false,
      });
    } catch (error) {
      lastPageError = error;
      pageResponse = await requestPage(parser.searchUrlFor(searchQuery, page), {
        sessionId,
        cookies,
        render: true,
      }).catch(() => null);
      usedRenderedResponse = Boolean(pageResponse);
      if (!pageResponse) {
        continue;
      }
    }
    cookies = pageResponse.cookies || cookies;
    creditsUsed += pageResponse.cost;
    let pageItems = parser.extractSearchItems(pageResponse.html);

    if (pageItems.length < 3 && !usedRenderedResponse) {
      try {
        const renderedResponse = await requestPage(parser.searchUrlFor(searchQuery, page), {
          sessionId,
          cookies,
          render: true,
        });
        cookies = renderedResponse.cookies || cookies;
        creditsUsed += renderedResponse.cost;
        const renderedItems = parser.extractSearchItems(renderedResponse.html);
        if (renderedItems.length > pageItems.length) {
          pageResponse = renderedResponse;
          pageItems = renderedItems;
        }
      } catch (error) {
        lastPageError = error;
      }
    }

    totalAvailable = totalAvailable || parser.parseTotalAvailable(pageResponse.html);
    candidates.push(
      ...pageItems
        .map((item, index) => ({
          ...item,
          position: item.position || candidates.length + index + 1,
        }))
        .filter((item) => (
          item.title
          && item.price > 0
          && matchesMarketplaceSearchResult(item.title, querySpec).ok
        )),
    );

    const uniquePageCandidates = dedupe(candidates);
    if (uniquePageCandidates.length >= candidateTarget()) {
      break;
    }
  }

  const uniqueCandidates = rankCandidatesByPublicSales(dedupe(candidates)).slice(0, detailLimit());
  if (!uniqueCandidates.length && lastPageError) {
    throw lastPageError;
  }
  const listingHasCompleteRanking = uniqueCandidates.filter((item) => Number(item.soldQuantity || 0) > 0).length >= 3;
  const enriched = [];
  const batchSize = detailConcurrency();
  for (let offset = 0; offset < uniqueCandidates.length; offset += batchSize) {
    const batch = await mapWithConcurrency(uniqueCandidates.slice(offset, offset + batchSize), batchSize, async (candidate) => (
      enrichCandidate(candidate, querySpec, sessionId, cookies, {
        ...options,
        requireMetadata: listingHasCompleteRanking,
      })
    ));
    for (const result of batch) {
      creditsUsed += result.creditsUsed;
      itemCacheHits += result.cacheHit ? 1 : 0;
      if (result.item) {
        enriched.push(result.item);
      }
    }
    const championCount = enriched.filter((item) => (
      item.price > 0 && item.soldQuantity >= minimumChampionSales()
    )).length;
    const inspectedCount = Math.min(offset + batchSize, uniqueCandidates.length);
    const verifiedCount = enriched.filter((item) => item.price > 0 && item.soldQuantity > 0).length;
    const minimumInspectionTarget = Math.min(
      Math.max(candidateTarget(), EMERGING_MARKET_SAMPLE_SIZE),
      uniqueCandidates.length,
    );
    if (hasEnoughInspectedCandidates({
      championCount,
      verifiedCount,
      inspectedCount,
      sampleTarget: minimumInspectionTarget,
    })) {
      break;
    }
  }

  const currentChampionCount = enriched.filter((item) => (
    item.price > 0 && item.soldQuantity >= minimumChampionSales()
  )).length;
  const cachedVerifiedItems = currentChampionCount >= 3 || !shouldUseScrapeDoItemCache(options)
    ? []
    : getCachedVerifiedItems(querySpec);
  itemCacheHits += cachedVerifiedItems.length;
  const enrichedPool = dedupe([...enriched, ...cachedVerifiedItems]);

  const verifiedSalesItems = enrichedPool
    .filter((item) => (
      item.title
      && item.price > 0
      && item.soldQuantity > 0
      && matchesMarketplaceSearchResult(item.title, querySpec).ok
    ))
    .sort((a, b) => (
      Number(b.soldQuantity) - Number(a.soldQuantity)
      || parser.championScore(a) - parser.championScore(b)
    ));

  const championItems = verifiedSalesItems
    .filter((item) => item.soldQuantity >= minimumChampionSales())
    .slice(0, 3)
    .map(mapItem);

  if (championItems.length >= 3) {
    return buildSalesResult(championItems, {
      message: "Dados públicos reais do Mercado Livre coletados pela Scrape.do.",
      exactMatches: championItems.length,
      totalAvailable: totalAvailable || uniqueCandidates.length,
      providerCreditsUsed: creditsUsed,
      itemCacheHits,
    });
  }

  const emergingItems = verifiedSalesItems
    .filter((item) => item.soldQuantity < minimumChampionSales())
    .slice(0, 3)
    .map(mapItem);

  if (championItems.length === 0 && emergingItems.length >= 1) {
    return buildSalesResult(emergingItems, {
      message: `Na amostra analisada, nenhum anúncio passou de ${minimumChampionSales().toLocaleString("pt-BR")} vendas públicas.`,
      exactMatches: emergingItems.length,
      totalAvailable: totalAvailable || uniqueCandidates.length,
      providerCreditsUsed: creditsUsed,
      itemCacheHits,
      opportunityMode: "emerging",
      marketThreshold: minimumChampionSales(),
    });
  }

  const leadingItems = verifiedSalesItems.slice(0, 3).map(mapItem);
  if (leadingItems.length >= 1) {
    return buildSalesResult(leadingItems, {
      message: `Encontramos ${leadingItems.length} anúncio(s) líder(es) com vendas públicas reais deste mercado.`,
      exactMatches: leadingItems.length,
      totalAvailable: totalAvailable || uniqueCandidates.length,
      providerCreditsUsed: creditsUsed,
      itemCacheHits,
      opportunityMode: "developing",
      marketThreshold: minimumChampionSales(),
    });
  }

  return {
    ...emptyResult(
      "scrapedo_incomplete_sales",
      `A Scrape.do encontrou ${championItems.length} anúncio(s) exato(s) com pelo menos ${minimumChampionSales().toLocaleString("pt-BR")} vendas públicas para "${query}".`,
    ),
    exactMatches: championItems.length,
    totalAvailable: totalAvailable || uniqueCandidates.length,
    providerCreditsUsed: creditsUsed,
    itemCacheHits,
  };
}

async function enrichCandidate(candidate, querySpec, sessionId, initialCookies, options = {}) {
  const cachedItem = shouldUseScrapeDoItemCache(options)
    ? getCachedMarketItem(candidate, querySpec, options)
    : null;
  if (cachedItem) {
    return {
      item: {
        ...cachedItem,
        title: candidate.title || cachedItem.title,
        image: candidate.image || cachedItem.image,
        price: Number(candidate.price || 0) || cachedItem.price,
        soldQuantity: Number(candidate.soldQuantity || 0) || cachedItem.soldQuantity,
        position: candidate.position || cachedItem.position,
        bestSeller: candidate.bestSeller ?? cachedItem.bestSeller,
        isAd: candidate.isAd ?? cachedItem.isAd,
      },
      creditsUsed: 0,
      cacheHit: true,
    };
  }

  const listingSales = Number(candidate.soldQuantity || 0);
  if (
    !options.requireMetadata
    && Number(candidate.price) > 0
    && listingSales > 0
    && matchesMarketplaceSearchResult(candidate.title, querySpec).ok
  ) {
    const listingItem = {
      ...candidate,
      href: parser.productDetailUrls(candidate)[0] || candidate.href,
      soldQuantity: listingSales,
    };
    saveMarketItemCache(candidate, listingItem);
    return { item: listingItem, creditsUsed: 0, cacheHit: false };
  }

  let combinedHtml = "";
  let finalUrl = candidate.href;
  let cookies = initialCookies;
  let creditsUsed = 0;

  for (const url of parser.productDetailUrls(candidate)) {
    let response = await requestPage(url, {
      sessionId,
      cookies,
      render: options.requireMetadata === true,
    }).catch(() => null);
    if (!response) {
      continue;
    }
    cookies = response.cookies || cookies;
    creditsUsed += response.cost;
    combinedHtml += ` ${response.html}`;
    finalUrl = response.resolvedUrl || parser.cleanMercadoLivreProductUrl(url) || url;

    if (!options.requireMetadata && !parser.parseSalesFromText(combinedHtml)) {
      response = await requestPage(url, {
        sessionId,
        cookies,
        render: true,
      }).catch(() => null);
      if (response) {
        cookies = response.cookies || cookies;
        creditsUsed += response.cost;
        combinedHtml += ` ${response.html}`;
        finalUrl = response.resolvedUrl || finalUrl;
      }
    }
    if (options.requireMetadata || parser.parseSalesFromText(combinedHtml)) {
      break;
    }
  }

  const title = parser.parseTitle(combinedHtml) || candidate.title;
  const item = {
    ...candidate,
    id: parser.extractItemId(finalUrl)
      || parser.extractProductId(finalUrl)
      || candidate.id
      || normalizedProductKey(title),
    title,
    href: finalUrl,
    image: parser.parseImage(combinedHtml) || candidate.image,
    price: parser.parsePrice(combinedHtml) || candidate.price,
    soldQuantity: parser.parseSalesFromText(combinedHtml) || candidate.soldQuantity || 0,
    categoryId: parser.parseCategoryId(combinedHtml) || candidate.categoryId || "",
    categoryName: parser.parseCategoryName(combinedHtml) || candidate.categoryName || "",
    weightKg: parser.parseWeightKg(`${title} ${combinedHtml}`) || candidate.weightKg || null,
    sellerId: parser.parseSellerId(combinedHtml) || candidate.sellerId || null,
    listingTypeId: parser.parseListingTypeId(combinedHtml) || candidate.listingTypeId || "",
    shippingMode: parser.parseShippingMode(combinedHtml) || candidate.shippingMode || "",
    logisticType: parser.parseLogisticType(combinedHtml) || candidate.logisticType || "",
    shippingDimensions: parser.parseShippingDimensions(combinedHtml) || candidate.shippingDimensions || "",
    freeShipping: parser.parseFreeShipping(combinedHtml) ?? candidate.freeShipping ?? null,
  };

  const validItem = matchesMarketplaceSearchResult(item.title, querySpec).ok ? item : null;
  if (validItem && validItem.price > 0 && validItem.soldQuantity > 0) {
    saveMarketItemCache(candidate, validItem);
  }

  return {
    item: validItem,
    creditsUsed,
    cacheHit: false,
  };
}

function getCachedMarketItem(candidate, querySpec, options = {}) {
  const row = db.prepare("SELECT payload, updated_at FROM market_item_cache WHERE key = ?").get(
    marketItemCacheKey(candidate),
  );
  if (!row) {
    return null;
  }

  const updatedAt = Date.parse(`${String(row.updated_at).replace(" ", "T")}Z`);
  if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > marketItemCacheTtlMs()) {
    return null;
  }

  try {
    const item = JSON.parse(row.payload || "{}");
    if (
      item.title
      && Number(item.price) > 0
      && Number(item.soldQuantity) > 0
      && hasTrustedCachedPrice(item)
      && (!options.requireMetadata || Number(item.metadataVersion || 0) >= MARKET_ITEM_METADATA_VERSION)
      && matchesMarketplaceSearchResult(item.title, querySpec).ok
    ) {
      return item;
    }
  } catch {
    return null;
  }
  return null;
}

function getCachedVerifiedItems(querySpec, options = {}) {
  const rows = db.prepare(`
    SELECT payload, updated_at
    FROM market_item_cache
    ORDER BY updated_at DESC
    LIMIT 500
  `).all();
  const ttlMs = marketItemCacheTtlMs();
  const now = Date.now();
  const items = [];

  for (const row of rows) {
    const updatedAt = Date.parse(`${String(row.updated_at).replace(" ", "T")}Z`);
    if (!Number.isFinite(updatedAt) || now - updatedAt > ttlMs) {
      continue;
    }
    try {
      const item = JSON.parse(row.payload || "{}");
      if (
        item.title
        && Number(item.price) > 0
        && Number(item.soldQuantity) > 0
        && hasTrustedCachedPrice(item)
        && (options.requireMetadata === false || Number(item.metadataVersion || 0) >= MARKET_ITEM_METADATA_VERSION)
        && matchesMarketplaceSearchResult(item.title, querySpec).ok
      ) {
        items.push(item);
      }
    } catch {
      // An invalid cache entry must not prevent a real search.
    }
  }

  return dedupe(items);
}

function buildSalesResult(items, metadata = {}) {
  const demand = items.reduce((sum, item) => sum + Number(item.soldQuantity || 0), 0);
  const revenue = items.reduce((sum, item) => sum + Number(item.revenue || 0), 0);
  return {
    ok: true,
    source: "scrapedo_mercado_livre",
    rankingStrategy: SALES_RANKING_STRATEGY,
    priceParserVersion: SCRAPEDO_PRICE_PARSER_VERSION,
    strictRealOnly: true,
    metricsMode: "sales",
    salesAvailable: true,
    message: metadata.message || "Dados públicos reais do Mercado Livre coletados pela Scrape.do.",
    items,
    exactMatches: metadata.exactMatches ?? items.length,
    totalAvailable: metadata.totalAvailable ?? items.length,
    providerCreditsUsed: Number(metadata.providerCreditsUsed || 0),
    itemCacheHits: Number(metadata.itemCacheHits || 0),
    ...(metadata.opportunityMode ? { opportunityMode: metadata.opportunityMode } : {}),
    ...(metadata.marketThreshold ? { marketThreshold: metadata.marketThreshold } : {}),
    totals: {
      demand,
      revenue,
      averageTicket: demand ? revenue / demand : 0,
      actualDemand: demand,
      isEstimated: false,
    },
  };
}

function saveMarketItemCache(candidate, item) {
  db.prepare(`
    INSERT INTO market_item_cache (key, title, permalink, payload, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET
      title = excluded.title,
      permalink = excluded.permalink,
      payload = excluded.payload,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    marketItemCacheKey(candidate),
    item.title,
    item.href || candidate.href || "",
    JSON.stringify({
      ...item,
      metadataVersion: MARKET_ITEM_METADATA_VERSION,
      priceParserVersion: SCRAPEDO_PRICE_PARSER_VERSION,
    }),
  );
}

function hasTrustedCachedPrice(item) {
  return Number(item?.priceParserVersion || 0) >= SCRAPEDO_PRICE_PARSER_VERSION;
}

function marketItemCacheKey(candidate) {
  return String(
    candidate.id
    || parser.extractItemId(candidate.href)
    || parser.extractProductId(candidate.href)
    || parser.cleanMercadoLivreProductUrl(candidate.href)
    || normalizedProductKey(candidate.title),
  ).trim();
}

function marketItemCacheTtlMs() {
  const days = Number(
    getSetting("market_cache_ttl_days")
    || process.env.MARKET_CACHE_TTL_DAYS
    || getSetting("market_item_cache_ttl_days")
    || process.env.MARKET_ITEM_CACHE_TTL_DAYS
    || 7,
  );
  return Math.max(1, Number.isFinite(days) ? days : 7) * 24 * 60 * 60 * 1000;
}

export function shouldUseScrapeDoItemCache(options = {}) {
  return options.forceRefresh !== true;
}

async function requestPage(targetUrl, options = {}) {
  const params = new URLSearchParams({
    token: scrapeDoToken(),
    url: targetUrl,
    super: "true",
    geoCode: "br",
    sessionId: String(options.sessionId || createSessionId()),
    device: "desktop",
  });
  if (options.render) {
    params.set("render", "true");
    params.set("customWait", "1500");
  }
  if (options.cookies) {
    params.set("setCookies", options.cookies);
  }

  const requestUrl = `${scrapeDoEndpoint()}?${params.toString()}`;
  const startedAt = Date.now();
  const response = await fetchScrapeDoPageWithRetry(requestUrl);
  const html = await response.text();
  if (!isUsableMercadoLivreHtml(response.status, html)) {
    throw new Error(describeError(response.status, html));
  }
  const result = {
    html,
    cookies: response.headers.get("scrape.do-cookies") || "",
    resolvedUrl: response.headers.get("scrape.do-resolved-url") || targetUrl,
    cost: Number(response.headers.get("scrape.do-request-cost") || 0),
  };
  const durationMs = Date.now() - startedAt;
  if (durationMs >= 15_000) {
    const target = new URL(targetUrl);
    console.warn(
      `[scrapedo] slow-request durationMs=${durationMs} render=${options.render === true} cost=${result.cost} target=${target.hostname}${target.pathname}`,
    );
  }
  return result;
}

async function fetchScrapeDoPageWithRetry(url) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchScrapeDoPage(url);
      if (![502, 503, 504].includes(response.status) || attempt === 1) {
        return response;
      }
      await response.body?.cancel();
    } catch (error) {
      lastError = error;
      if (!isTransientFetchError(error) || attempt === 1) {
        throw error;
      }
    }
    await delay(700 + randomInt(100, 500));
  }
  throw lastError || new Error("A fonte de dados não respondeu.");
}

function isTransientFetchError(error) {
  const name = String(error?.name || "").toLowerCase();
  const message = String(error?.message || error || "").toLowerCase();
  return (
    name === "aborterror"
    || name === "timeouterror"
    || message.includes("timeout")
    || message.includes("fetch failed")
    || message.includes("socket")
  );
}

function fetchScrapeDoPage(url) {
  return fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "BuscaVendasConfweb/1.0",
    },
    signal: AbortSignal.timeout(timeoutMs()),
  });
}

function mapItem(item) {
  return {
    id: item.id,
    title: item.title,
    subtitle: [
      item.bestSeller ? "Selo público: Mais vendido" : "Ranking público do Mercado Livre",
      item.isAd ? "Patrocinado" : "Orgânico",
    ].join(" - "),
    image: String(item.image || "").replace("http://", "https://"),
    price: item.price,
    soldQuantity: item.soldQuantity,
    estimatedSoldQuantity: null,
    revenue: Number((item.price * item.soldQuantity).toFixed(2)),
    estimatedRevenue: null,
    permalink: item.href || parser.searchUrlFor(item.title),
    categoryId: item.categoryId || "",
    categoryName: item.categoryName || "",
    weightKg: item.weightKg || null,
    sellerId: item.sellerId || null,
    listingTypeId: item.listingTypeId || "",
    shippingMode: item.shippingMode || "",
    logisticType: item.logisticType || "",
    shippingDimensions: item.shippingDimensions || "",
    freeShipping: item.freeShipping ?? null,
  };
}

function dedupe(items) {
  const result = new Map();
  for (const item of items) {
    const key = item.id || normalizedProductKey(item.title);
    const current = result.get(key);
    if (!current || Number(item.position || 999) < Number(current.position || 999)) {
      result.set(key, item);
    }
  }
  return [...result.values()].sort((a, b) => Number(a.position || 999) - Number(b.position || 999));
}

export function rankCandidatesByPublicSales(items) {
  return [...items].sort((a, b) => {
    const salesDifference = Number(b.soldQuantity || 0) - Number(a.soldQuantity || 0);
    if (salesDifference) {
      return salesDifference;
    }
    return Number(a.position || 999) - Number(b.position || 999);
  });
}

async function mapWithConcurrency(values, concurrency, worker) {
  const results = new Array(values.length);
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(values[index]);
      }
    },
  );
  await Promise.all(runners);
  return results;
}

function describeError(status, body) {
  const data = parseJson(body);
  const detail = data?.Error || data?.error || data?.message || String(body || "").slice(0, 180);
  if (status === 401) {
    return "Scrape.do recusou o token. Copie o token do painel e salve novamente.";
  }
  if (status === 402 || status === 403) {
    return "A conta Scrape.do está sem créditos disponíveis. As pesquisas salvas continuam funcionando, mas produtos novos exigem créditos na API.";
  }
  if (status === 429) {
    return "Scrape.do atingiu o limite de créditos ou concorrência do plano.";
  }
  return `Scrape.do respondeu ${status}: ${detail || "sem detalhe"}`;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function createSessionId() {
  return randomInt(1_000_000, 9_999_999);
}

function scrapeDoToken() {
  return normalizeScrapeDoToken(getSetting("scrapedo_api_token") || process.env.SCRAPEDO_API_TOKEN || "");
}

function scrapeDoEndpoint() {
  return (getSetting("scrapedo_endpoint") || process.env.SCRAPEDO_ENDPOINT || DEFAULT_ENDPOINT)
    .trim()
    .replace(/\?+$/, "");
}

function detailLimit() {
  return Math.min(48, Math.max(12, Number(
    getSetting("scrapedo_detail_limit") || process.env.SCRAPEDO_DETAIL_LIMIT || DEFAULT_DETAIL_LIMIT,
  )));
}

function candidateTarget() {
  const configured = Number(
    getSetting("scrapedo_candidate_target") || process.env.SCRAPEDO_CANDIDATE_TARGET || EMERGING_MARKET_SAMPLE_SIZE,
  );
  return Math.min(detailLimit(), Math.max(EMERGING_MARKET_SAMPLE_SIZE, Number.isFinite(configured) ? configured : EMERGING_MARKET_SAMPLE_SIZE));
}

function detailConcurrency() {
  const configured = Number(
    getSetting("scrapedo_detail_concurrency") || process.env.SCRAPEDO_DETAIL_CONCURRENCY || DEFAULT_DETAIL_CONCURRENCY,
  );
  return Math.min(8, Math.max(1, Number.isFinite(configured) ? configured : DEFAULT_DETAIL_CONCURRENCY));
}

function searchPages() {
  return Math.min(4, Math.max(1, Number(
    getSetting("scrapedo_search_pages") || process.env.SCRAPEDO_SEARCH_PAGES || DEFAULT_SEARCH_PAGES,
  )));
}

function timeoutMs() {
  return Math.max(10_000, Number(getSetting("scrapedo_timeout_ms") || process.env.SCRAPEDO_TIMEOUT_MS || 45_000));
}

function monthlyCreditBudget() {
  const configured = Number(
    getSetting("scrapedo_monthly_credit_budget")
    || process.env.SCRAPEDO_MONTHLY_CREDIT_BUDGET
    || 225_000,
  );
  return Math.max(0, Number.isFinite(configured) ? configured : 225_000);
}

function recordProviderUsage(queryKey, credits, status) {
  db.prepare(`
    INSERT INTO provider_usage (provider, query_key, credits, status)
    VALUES ('scrapedo', ?, ?, ?)
  `).run(queryKey || null, Math.max(0, Number(credits || 0)), status);
}

function withProviderSlot(task) {
  return new Promise((resolve, reject) => {
    providerQueue.push({ task, resolve, reject });
    drainProviderQueue();
  });
}

function drainProviderQueue() {
  const limit = Math.min(10, Math.max(1, Number(process.env.SCRAPEDO_MAX_CONCURRENCY || 4)));
  while (activeProviderSearches < limit && providerQueue.length) {
    const entry = providerQueue.shift();
    activeProviderSearches += 1;
    Promise.resolve()
      .then(entry.task)
      .then(entry.resolve, entry.reject)
      .finally(() => {
        activeProviderSearches -= 1;
        drainProviderQueue();
      });
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function emptyResult(source, message) {
  return {
    ok: false,
    source,
    strictRealOnly: true,
    metricsMode: "sales",
    salesAvailable: false,
    message,
    items: [],
    exactMatches: 0,
    totalAvailable: 0,
    totals: { demand: 0, revenue: 0, averageTicket: 0, actualDemand: 0 },
  };
}

export function syncScrapeDoSettingsFromEnv() {
  if (process.env.SCRAPEDO_API_TOKEN && !getSetting("scrapedo_api_token")) {
    setSetting("scrapedo_api_token", normalizeScrapeDoToken(process.env.SCRAPEDO_API_TOKEN));
  }
  if (process.env.SCRAPEDO_ENABLED && !getSetting("scrapedo_enabled")) {
    setSetting("scrapedo_enabled", process.env.SCRAPEDO_ENABLED.trim().toLowerCase());
  }
}
