import https from "node:https";
import { HttpsProxyAgent } from "https-proxy-agent";
import { getSetting, setSetting } from "./db.mjs";
import {
  buildProductQuerySpec,
  matchesProductQuery,
  normalizedProductKey,
  normalizeProductSearchQuery,
} from "./product-match.mjs";

const WEB_SCRAPER_API_ENDPOINT = "https://realtime.oxylabs.io/v1/queries";
const WEB_UNBLOCKER_ENDPOINT = "https://unblock.oxylabs.io:60000";
const DEFAULT_GEO = "Brazil";
const WEB_UNBLOCKER_MODE = "web_unblocker";
const WEB_SCRAPER_API_MODE = "web_scraper_api";
const PRODUCT_LIMIT = Number(process.env.OXYLABS_PRODUCT_LIMIT || 3);

export function isOxylabsConfigured() {
  const { username, password } = oxylabsCredentials();
  return Boolean(username && password);
}

export async function testOxylabsConnection() {
  if (oxylabsMode() === WEB_UNBLOCKER_MODE) {
    const text = await fetchViaOxylabsProxy("https://ip.oxylabs.io/location");
    return {
      ok: true,
      status: 200,
      sample: text.slice(0, 120),
    };
  }

  const data = await requestOxylabs({
    source: "universal",
    url: "https://sandbox.oxylabs.io/products/1",
  });
  return {
    ok: true,
    status: data?.results?.[0]?.status_code || data?.results?.[0]?.status || 200,
  };
}

export async function searchMercadoLivreOxylabs(query) {
  if (!isOxylabsConfigured()) {
    return {
      ok: false,
      source: "oxylabs_not_configured",
      metricsMode: "market_signal",
      salesAvailable: false,
      message: "Oxylabs ainda nao foi configurado no painel admin.",
      items: [],
      totalAvailable: 0,
      totals: { demand: 0, revenue: 0, averageTicket: 0 },
    };
  }

  const searchHtml = await fetchOxylabsMercadoLivreSearch(query);
  const querySpec = buildProductQuerySpec(query);
  const candidates = extractSearchItems(searchHtml)
    .map((item, index) => ({ ...item, position: index + 1, match: matchesProductQuery(item.title, querySpec) }))
    .filter((item) => item.match.ok && item.price > 0);
  const uniqueCandidates = dedupe(candidates).slice(0, PRODUCT_LIMIT);
  const enriched = await Promise.all(uniqueCandidates.map((item) => enrichItem(item)));

  const items = enriched
    .filter((item) => item.title && item.price > 0)
    .sort((a, b) => championScore(a) - championScore(b))
    .slice(0, 3)
    .map(mapOxylabsItem);
  const demand = items.reduce((sum, item) => sum + (item.soldQuantity || 0), 0);
  const revenue = items.reduce((sum, item) => sum + (item.revenue || 0), 0);
  const averageTicket = demand
    ? revenue / demand
    : items.length
      ? items.reduce((sum, item) => sum + item.price, 0) / items.length
      : 0;

  if (!items.length) {
    return {
      ok: false,
      source: "oxylabs_no_exact_match",
      metricsMode: "market_signal",
      salesAvailable: false,
      message: `A Oxylabs respondeu, mas nenhum resultado bateu exatamente com "${query}".`,
      items: [],
      exactMatches: 0,
      totalAvailable: parseTotalAvailable(searchHtml) || candidates.length,
      totals: { demand: 0, revenue: 0, averageTicket: 0 },
    };
  }

  return {
    ok: true,
    source: "oxylabs_mercado_livre",
    metricsMode: demand > 0 ? "sales" : "market_signal",
    salesAvailable: demand > 0,
    message: demand > 0
      ? "Dados reais extraidos via Oxylabs a partir das paginas publicas do Mercado Livre."
      : "Anuncios reais encontrados via Oxylabs, mas o Mercado Livre nao exibiu vendas publicas nesses anuncios.",
    items,
    exactMatches: items.length,
    totalAvailable: parseTotalAvailable(searchHtml) || candidates.length,
    totals: {
      demand,
      revenue,
      averageTicket,
      isEstimated: false,
      actualDemand: demand,
    },
  };
}

async function enrichItem(item) {
  const detailUrls = productDetailUrls(item);
  let detailText = "";

  for (const url of detailUrls) {
    detailText = await fetchOxylabsMercadoLivrePage(url).catch(() => "");
    if (parseSalesFromText(detailText)) {
      break;
    }
  }

  const soldQuantity = parseSalesFromText(detailText) || item.soldQuantity || null;
  const price = parsePrice(detailText) || item.price;
  const title = parseTitle(detailText) || item.title;
  const image = parseImage(detailText) || item.image;

  return {
    ...item,
    title,
    image,
    price,
    soldQuantity,
  };
}

async function fetchOxylabsMercadoLivreSearch(query) {
  if (oxylabsMode() === WEB_UNBLOCKER_MODE) {
    return fetchViaOxylabsProxy(searchUrlFor(query), { render: true });
  }

  const searchData = await requestOxylabs({
    source: "mercadolivre_search",
    query,
    geo_location: oxylabsGeoLocation(),
    parse: false,
  });
  return extractOxylabsContent(searchData);
}

async function fetchOxylabsMercadoLivrePage(url) {
  if (oxylabsMode() === WEB_UNBLOCKER_MODE) {
    return fetchViaOxylabsProxy(url, { render: true });
  }

  const data = await requestOxylabs({
    source: "mercadolivre",
    url,
    geo_location: oxylabsGeoLocation(),
    parse: false,
  });
  return extractOxylabsContent(data);
}

async function requestOxylabs(payload) {
  const { username, password } = oxylabsCredentials();
  if (!username || !password) {
    throw new Error("Configure usuario e senha da Oxylabs no painel admin.");
  }

  const response = await fetch(oxylabsEndpoint(), {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
      "Content-Type": "application/json",
      "User-Agent": "BuscaVendasConfweb/1.0",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(oxylabsTimeoutMs()),
  });
  const text = await response.text();
  const data = parseJson(text);

  if (!response.ok) {
    throw new Error(describeOxylabsError(response.status, data, text));
  }

  return data;
}

async function fetchViaOxylabsProxy(url, options = {}) {
  const { username, password } = oxylabsCredentials();
  if (!username || !password) {
    throw new Error("Configure usuario e senha da Oxylabs no painel admin.");
  }

  const proxyUrl = withProxyCredentials(oxylabsEndpoint(), username, password);
  const agent = new HttpsProxyAgent(proxyUrl, { rejectUnauthorized: false });
  const timeoutMs = oxylabsTimeoutMs();

  return new Promise((resolvePromise, rejectPromise) => {
    const headers = {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
      "X-Oxylabs-Geo-Location": oxylabsGeoLocation(),
    };
    if (options.render) {
      headers["x-oxylabs-render"] = "html";
      headers["x-oxylabs-browser-instructions"] = JSON.stringify([{ type: "wait", wait_time_s: oxylabsRenderWaitSeconds() }]);
    }

    const request = https.get(url, {
      agent,
      rejectUnauthorized: false,
      timeout: timeoutMs,
      headers,
    }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        text += chunk;
      });
      response.on("end", () => {
        const status = response.statusCode || 0;
        if (status < 200 || status >= 300) {
          rejectPromise(new Error(describeOxylabsError(status, parseJsonSafe(text), text)));
          return;
        }
        resolvePromise(text);
      });
    });

    request.on("timeout", () => {
      request.destroy(new Error(`Oxylabs demorou mais de ${Math.round(timeoutMs / 1000)}s para responder. Tente novamente; se repetir, verifique se a conta Web Unblocker esta ativa.`));
    });
    request.on("error", (error) => {
      rejectPromise(error);
    });
  });
}

function extractSearchItems(html) {
  const blocks = splitSearchBlocks(html);
  return blocks
    .map((block, index) => {
      const href = normalizeMercadoLivreUrl(parseHref(block));
      const title = cleanText(parseTitle(block) || parseAnchorText(block));
      const image = parseImage(block);
      const price = parsePrice(block);
      return {
        id: extractItemId(href) || extractProductId(href) || normalizedProductKey(title),
        title,
        image,
        href,
        price,
        soldQuantity: parseSalesFromText(block),
        bestSeller: /mais vendido/i.test(block),
        isAd: /is_advertising=true|promoted|patrocinado/i.test(block),
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
    .slice(0, 20);
}

function mapOxylabsItem(item) {
  const hasSales = typeof item.soldQuantity === "number" && item.soldQuantity > 0;
  return {
    id: item.id,
    title: item.title,
    subtitle: [
      item.bestSeller ? "Selo publico: Mais vendido" : "Oxylabs + Mercado Livre",
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
  if (soldQuantity > 0) {
    return -soldQuantity + rankingScore(item) / 1000;
  }
  return rankingScore(item);
}

function extractOxylabsContent(data) {
  const candidates = [
    data?.results?.[0]?.content,
    data?.results?.[0]?.content?.html,
    data?.results?.[0]?.content?.body,
    data?.content,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      return candidate;
    }
    if (candidate && typeof candidate === "object") {
      return JSON.stringify(candidate);
    }
  }
  return JSON.stringify(data || {});
}

function parseTitle(text) {
  const source = decodeText(text);
  return cleanText(
    firstMatch(source, [
      /<h1[^>]*>([\s\S]*?)<\/h1>/i,
      /"title"\s*:\s*"([^"]+)"/i,
      /"name"\s*:\s*"([^"]+)"/i,
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
    ]),
  );
}

function parseAnchorText(text) {
  return cleanText(firstMatch(text, [/<a\b[^>]*>([\s\S]{5,260}?)<\/a>/i]));
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
  const currentPriceBlock = firstMatch(source, [
    /<div[^>]+class=["'][^"']*poly-price__current[^"']*["'][\s\S]*?(?=<span[^>]+class=["'][^"']*poly-price__disc_label|<\/div>)/i,
  ]);
  const currentPrice = parseMercadoLivreMoney(currentPriceBlock);
  if (currentPrice > 0) {
    return currentPrice;
  }

  const ariaPrice = parseMercadoLivreMoney(source, { requireNow: true });
  if (ariaPrice > 0) {
    return ariaPrice;
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
  const rawText = normalizeHtmlText(text);
  const normalized = normalizedProductKey(rawText);
  const patterns = [
    /"(?:(?:sold_quantity)|(?:soldQuantity)|(?:quantity_sold)|(?:units_sold))"\s*:\s*(\d+)/i,
    /\+?\s*(\d+(?:[.,]\d+)?)\s*(mil|mi|milhao|milhoes)?\s*(?:vendido|vendidos|venda|vendas|comprado|comprados)/i,
    /mais\s+de\s+\+?\s*(\d+(?:[.,]\d+)?)\s*(mil|mi|milhao|milhoes)?\s*(?:comprado|comprados|vendido|vendidos)/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern) || rawText.match(pattern);
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

function parseTotalAvailable(text) {
  const match = decodeText(text).match(/(?:mais de\s*)?([\d.]+)\s+resultados/i);
  return match ? Number(match[1].replace(/\./g, "")) : 0;
}

function productDetailUrls(item) {
  const urls = [item.href];
  const itemPageUrl = mercadoLivreItemPageUrl(extractItemId(item.href) || item.id);
  if (itemPageUrl) {
    urls.push(itemPageUrl);
  }
  return [...new Set(urls.filter(Boolean))];
}

function mercadoLivreItemPageUrl(itemId) {
  const match = String(itemId || "").match(/^MLB(\d+)$/i);
  return match ? `https://produto.mercadolivre.com.br/MLB-${match[1]}-_JM` : "";
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

function searchUrlFor(query) {
  const slug = normalizeProductSearchQuery(query).replace(/\s+/g, "-").replace(/-+/g, "-");
  return `https://lista.mercadolivre.com.br/${encodeURIComponent(slug).replace(/%2D/g, "-")}`;
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);
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
  return raw.includes(",") ? Number(raw.replace(/\./g, "").replace(",", ".")) : Number(raw);
}

function normalizeHtmlText(text) {
  return decodeText(text)
    .replace(/\\u00a0/gi, " ")
    .replace(/\\u002b/gi, "+")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&#43;|&plus;/gi, "+")
    .replace(/\u00a0/g, " ");
}

function cleanText(text) {
  return decodeText(text)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeText(text) {
  return String(text || "")
    .replace(/\\u002F/gi, "/")
    .replace(/\\u002f/gi, "/")
    .replace(/\\u002B/gi, "+")
    .replace(/\\u002b/gi, "+")
    .replace(/\\"/g, '"')
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/g, "'");
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Oxylabs retornou resposta invalida: ${String(text || "").slice(0, 180)}`);
  }
}

function parseJsonSafe(text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

function describeOxylabsError(status, data, text) {
  const detail = data?.message || data?.error || data?.detail || String(text || "").slice(0, 180);
  if (status === 401) {
    return "Oxylabs recusou as credenciais. Use o Nome de usuario e a Senha do Web Unblocker, nao o e-mail/senha de login do painel Oxylabs. Salve novamente no painel admin e teste.";
  }
  if (status === 407) {
    return "Oxylabs recusou a autenticacao do proxy. Confira usuario e senha do Web Unblocker e salve novamente no painel admin.";
  }
  if (status === 403) {
    return "Oxylabs autenticou, mas bloqueou o acesso. Verifique se o Web Unblocker esta ativo no plano e se o usuario tem permissao para usar o endpoint.";
  }
  return `Oxylabs respondeu ${status}: ${detail || "sem detalhe"}`;
}

function oxylabsCredentials() {
  return {
    username: (getSetting("oxylabs_username") || process.env.OXYLABS_USERNAME || "").trim(),
    password: (getSetting("oxylabs_password") || process.env.OXYLABS_PASSWORD || "").trim(),
  };
}

function oxylabsMode() {
  const configured = (getSetting("oxylabs_mode") || process.env.OXYLABS_MODE || "").trim();
  if (configured === WEB_SCRAPER_API_MODE || configured === "realtime") {
    return WEB_SCRAPER_API_MODE;
  }
  return WEB_UNBLOCKER_MODE;
}

function rawOxylabsEndpoint() {
  return (getSetting("oxylabs_endpoint") || process.env.OXYLABS_ENDPOINT || "").trim();
}

function withProxyCredentials(endpoint, username, password) {
  const url = new URL(endpoint);
  url.username = username;
  url.password = password;
  return url.toString();
}

function oxylabsTimeoutMs() {
  return Number(process.env.OXYLABS_TIMEOUT_MS || getSetting("oxylabs_timeout_ms") || 120_000);
}

function oxylabsRenderWaitSeconds() {
  return Number(process.env.OXYLABS_RENDER_WAIT_SECONDS || getSetting("oxylabs_render_wait_seconds") || 5);
}

function oxylabsEndpoint() {
  const mode = oxylabsMode();
  const configured = rawOxylabsEndpoint();
  if (!configured) {
    return mode === WEB_UNBLOCKER_MODE ? WEB_UNBLOCKER_ENDPOINT : WEB_SCRAPER_API_ENDPOINT;
  }
  if (mode === WEB_UNBLOCKER_MODE && configured === WEB_SCRAPER_API_ENDPOINT) {
    return WEB_UNBLOCKER_ENDPOINT;
  }
  if (mode === WEB_SCRAPER_API_MODE && configured === WEB_UNBLOCKER_ENDPOINT) {
    return WEB_SCRAPER_API_ENDPOINT;
  }
  return configured;
}

function oxylabsGeoLocation() {
  return (getSetting("oxylabs_geo_location") || process.env.OXYLABS_GEO_LOCATION || DEFAULT_GEO).trim();
}

export function syncOxylabsSettingsFromEnv() {
  if (process.env.OXYLABS_MODE && !getSetting("oxylabs_mode")) {
    setSetting("oxylabs_mode", process.env.OXYLABS_MODE.trim());
  }
  if (process.env.OXYLABS_USERNAME && !getSetting("oxylabs_username")) {
    setSetting("oxylabs_username", process.env.OXYLABS_USERNAME.trim());
  }
  if (process.env.OXYLABS_PASSWORD && !getSetting("oxylabs_password")) {
    setSetting("oxylabs_password", process.env.OXYLABS_PASSWORD.trim());
  }
  if (process.env.OXYLABS_ENDPOINT && !getSetting("oxylabs_endpoint")) {
    setSetting("oxylabs_endpoint", process.env.OXYLABS_ENDPOINT.trim());
  }
  if (process.env.OXYLABS_GEO_LOCATION && !getSetting("oxylabs_geo_location")) {
    setSetting("oxylabs_geo_location", process.env.OXYLABS_GEO_LOCATION.trim());
  }
}
