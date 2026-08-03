import { createHash, randomBytes } from "node:crypto";
import { getSetting, setSetting } from "./db.mjs";
import { searchMercadoLivreCatalog } from "./meli-catalog.mjs";
import { enrichMercadoLivreCosts } from "./meli-costs.mjs";
import { searchMercadoLivreScraper } from "./meli-scraper.mjs";
import { isOxylabsConfigured, searchMercadoLivreOxylabs } from "./oxylabs.mjs";
import { isProxyConfigured, isProxyEnabled, proxyPlaywrightConfig } from "./proxy.mjs";
import { isScrapeDoEnabled, searchMercadoLivreScrapeDo } from "./scrapedo.mjs";
import { isZyteConfigured, isZyteSearchEnabled, searchMercadoLivreZyte } from "./zyte.mjs";
import { buildProductQuerySpec, matchesProductQuery, normalizeProductSearchQuery } from "./product-match.mjs";
import { isCompleteRealSalesResult } from "./search-result-policy.mjs";
import { minimumChampionSales } from "./champion-policy.mjs";
import { searchProviderPlan } from "./search-provider.mjs";

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  currency: "BRL",
  style: "currency",
});

const TOKEN_ENDPOINT = "https://api.mercadolibre.com/oauth/token";
const DEFAULT_AUTH_URL = "https://auth.mercadolivre.com.br/authorization";

function mapItem(item) {
  const soldQuantity = Number(item.sold_quantity ?? item.soldQuantity ?? 0);
  const price = Number(item.price ?? 0);

  return {
    id: item.id,
    title: item.title,
    subtitle: [
      item.condition === "new" ? "Novo" : item.condition,
      item.shipping?.logistic_type === "fulfillment" ? "Full" : "Marketplace",
    ]
      .filter(Boolean)
      .join(" - "),
    image: String(item.thumbnail || item.secure_thumbnail || "").replace("http://", "https://"),
    price,
    soldQuantity,
    revenue: Number((price * soldQuantity).toFixed(2)),
    permalink: item.permalink,
    categoryId: item.category_id || "",
    categoryName: "",
    weightKg: null,
    sellerId: item.seller?.id || item.seller_id || null,
    listingTypeId: item.listing_type_id || "",
    shippingMode: item.shipping?.mode || "",
    logisticType: item.shipping?.logistic_type || "",
    shippingDimensions: item.shipping?.dimensions || "",
    freeShipping: item.shipping?.free_shipping ?? null,
  };
}

export async function searchMercadoLivre(query, options = {}) {
  const provider = searchProviderPlan(
    getSetting("market_search_provider") || process.env.MARKET_SEARCH_PROVIDER || "auto",
  );
  const siteId = process.env.MELI_SITE_ID || getSetting("meli_site_id") || "MLB";
  let strictFailure = null;
  let accessToken = null;

  if (provider.useMercadoLivre) {
    accessToken = await getValidMeliAccessToken();
    if (!accessToken) {
      strictFailure = makeStrictFailure(
        query,
        "A API oficial do Mercado Livre ainda não está conectada.",
        "mercado_livre_not_connected",
      );
    } else {
      try {
        const catalog = addOpportunityMode(
          await searchMercadoLivreCatalog({ query, accessToken, siteId }),
        );
        if (hasCompleteSalesTop3(catalog)) {
          setSetting("meli_last_error", "");
          return enrichMercadoLivreCosts(catalog, { accessToken, siteId });
        }
        strictFailure = catalog;
        setSetting("meli_last_error", catalog.message || "O catálogo oficial não completou o Top 3 com vendas.");
      } catch (error) {
        const message = sanitizeSearchError(
          error instanceof Error ? error.message : "Falha ao consultar o catálogo oficial.",
        );
        strictFailure = makeStrictFailure(query, message, "mercado_livre_catalog_error");
        setSetting("meli_last_error", message);
      }

      const officialSearch = await searchMercadoLivreOfficialSearch(query, accessToken, siteId);
      accessToken = officialSearch.accessToken || accessToken;
      if (hasCompleteSalesTop3(officialSearch.result)) {
        setSetting("meli_last_error", "");
        return enrichMercadoLivreCosts(officialSearch.result, { accessToken, siteId });
      }
      strictFailure = officialSearch.result || strictFailure;
      setSetting(
        "meli_last_error",
        officialSearch.result?.message || "A API oficial não completou o Top 3 com vendas.",
      );
    }
  }

  if (provider.useScrapeDo) {
    if (isScrapeDoEnabled()) {
      try {
        const scrapeDo = await searchMercadoLivreScrapeDo(query, options);
        if (hasCompleteSalesTop3(scrapeDo)) {
          setSetting("scrapedo_last_error", "");
          accessToken ||= await getValidMeliAccessToken();
          return enrichMercadoLivreCosts(scrapeDo, { accessToken, siteId });
        }
        strictFailure = scrapeDo;
        setSetting("scrapedo_last_error", scrapeDo.message || "Scrape.do não completou o Top 3 com vendas públicas.");
      } catch (error) {
        const message = sanitizeSearchError(error instanceof Error ? error.message : "Falha ao consultar Scrape.do.");
        strictFailure = makeStrictFailure(query, message, "scrapedo_error");
        setSetting("scrapedo_last_error", message);
      }
    } else if (provider.mode === "scrapedo_only") {
      strictFailure = makeStrictFailure(
        query,
        "A Scrape.do foi selecionada, mas o token não está configurado ou ativo.",
        "scrapedo_not_configured",
      );
    }
  }

  if (strictFailure) {
    return strictFailure;
  }

  return makeStrictFailure(
    query,
    "Nenhuma fonte de pesquisa está configurada no painel admin.",
    "market_source_not_configured",
  );
}

async function searchMercadoLivreOfficialSearch(query, initialAccessToken, siteId) {
  let accessToken = initialAccessToken;
  const params = new URLSearchParams({
    q: normalizeProductSearchQuery(query),
    limit: "50",
    sort: "sold_quantity_desc",
  });

  let response;
  try {
    response = await searchWithToken(siteId, params, accessToken);
    if ([401, 403].includes(response.status) && getMeliRefreshToken()) {
      accessToken = await refreshMeliAccessToken();
      if (accessToken) {
        response = await searchWithToken(siteId, params, accessToken);
      }
    }
  } catch (error) {
    const message = sanitizeSearchError(
      error instanceof Error ? error.message : "Falha ao consultar a API oficial do Mercado Livre.",
    );
    return {
      accessToken,
      result: makeStrictFailure(query, message, "mercado_livre_search_error"),
    };
  }

  if (!response?.ok) {
    const body = response ? await response.text() : "";
    const message = response?.status === 403
      ? "O OAuth está conectado, mas o Mercado Livre não liberou a API oficial de busca para esta aplicação."
      : `Mercado Livre respondeu ${response?.status || "sem status"}: ${body.slice(0, 180)}`;
    return {
      accessToken,
      result: makeStrictFailure(
        query,
        message,
        response?.status === 403 ? "meli_forbidden" : "meli_error",
      ),
    };
  }

  const data = await response.json();
  const querySpec = buildProductQuerySpec(query);
  const items = (data.results || [])
    .map(mapItem)
    .filter((item) => (
      item.id
      && item.title
      && item.price > 0
      && item.soldQuantity > 0
      && matchesProductQuery(item.title, querySpec).ok
    ))
    .sort((a, b) => b.soldQuantity - a.soldQuantity)
    .slice(0, 3);
  const demand = items.reduce((sum, item) => sum + item.soldQuantity, 0);
  const revenue = items.reduce((sum, item) => sum + item.revenue, 0);
  const result = addOpportunityMode({
    ok: items.length >= 3,
    source: "mercado_livre",
    metricsMode: "sales",
    salesAvailable: items.length >= 3,
    strictRealOnly: true,
    message: items.length >= 3
      ? `Dados reais retornados pelo Mercado Livre. Receita estimada: ${currencyFormatter.format(revenue)}.`
      : "Mercado Livre respondeu, mas não trouxe 3 anúncios completos com vendas.",
    items,
    exactMatches: items.length,
    totalAvailable: data.paging?.total ?? items.length,
    totals: {
      demand,
      revenue,
      averageTicket: demand ? revenue / demand : 0,
      actualDemand: demand,
      isEstimated: false,
    },
  });

  return {
    accessToken,
    result: hasCompleteSalesTop3(result)
      ? result
      : makeStrictFailure(query, result.message, "mercado_livre_incomplete_sales"),
  };
}

function addOpportunityMode(result) {
  if (!result?.ok || !Array.isArray(result.items) || result.items.length < 3) {
    return result;
  }
  const threshold = minimumChampionSales();
  const sales = result.items.slice(0, 3).map((item) => Number(item.soldQuantity || 0));
  if (sales.every((quantity) => quantity > 0 && quantity < threshold)) {
    return { ...result, opportunityMode: "emerging" };
  }
  if (sales.some((quantity) => quantity > 0 && quantity < threshold)) {
    return { ...result, opportunityMode: "developing" };
  }
  return result;
}

async function searchMercadoLivreLegacy(query) {
  const siteId = process.env.MELI_SITE_ID || getSetting("meli_site_id") || "MLB";
  let accessToken = await getValidMeliAccessToken();
  const strictRealData = true;
  let strictFailure = null;

  if (accessToken) {
    try {
      const catalog = await searchMercadoLivreCatalog({ query, accessToken, siteId });
      if (hasCompleteSalesTop3(catalog)) {
        setSetting("meli_last_error", "");
        return catalog;
      }
      strictFailure = catalog;
      setSetting("meli_last_error", catalog.message || "O catálogo oficial não completou o Top 3 com vendas.");
    } catch (error) {
      const message = sanitizeSearchError(
        error instanceof Error ? error.message : "Falha ao consultar o catálogo oficial.",
      );
      strictFailure = makeStrictFailure(query, message, "mercado_livre_catalog_error");
      setSetting("meli_last_error", message);
    }
  }

  if (isScrapeDoEnabled()) {
    try {
      const scrapeDo = await searchMercadoLivreScrapeDo(query);
      if (hasCompleteSalesTop3(scrapeDo)) {
        setSetting("scrapedo_last_error", "");
        return scrapeDo;
      }
      strictFailure = scrapeDo;
      setSetting("scrapedo_last_error", scrapeDo.message || "Scrape.do não completou o Top 3 com vendas públicas.");
    } catch (error) {
      const message = sanitizeSearchError(error instanceof Error ? error.message : "Falha ao consultar Scrape.do.");
      strictFailure = makeStrictFailure(query, message, "scrapedo_error");
      setSetting("scrapedo_last_error", message);
    }
  }

  if (isZyteConfigured() && isZyteSearchEnabled()) {
    try {
      const zyte = await searchMercadoLivreZyte(query);
      if (hasCompleteSalesTop3(zyte)) {
        setSetting("zyte_last_error", "");
        return zyte;
      }
      strictFailure = zyte;
      setSetting("zyte_last_error", zyte.message || "Zyte não retornou 3 anúncios completos com vendas públicas.");
    } catch (error) {
      const message = sanitizeSearchError(error instanceof Error ? error.message : "Falha ao consultar Zyte.");
      strictFailure = {
        ok: false,
        source: "zyte_error",
        strictRealOnly: true,
        metricsMode: "sales",
        salesAvailable: false,
        message,
        items: [],
        exactMatches: 0,
        totalAvailable: 0,
        totals: { demand: 0, revenue: 0, averageTicket: 0, actualDemand: 0 },
      };
      setSetting("zyte_last_error", message);
    }
  }

  if (isMeliScraperEnabled()) {
    const scraped = await searchMercadoLivreScraper(query, { accessToken, siteId });
    if (hasCompleteSalesTop3(scraped)) {
      setSetting("meli_last_error", "");
      setSetting("proxy_last_error", "");
      return scraped;
    }

    strictFailure = makeStrictFailure(query, scraped?.message || "Motor Confweb nao completou o Top 3 com vendas publicas.");
    setSetting("meli_last_error", scraped?.message || "Motor Confweb nao completou o Top 3 com vendas publicas.");

    if (isProxyEnabled() && isProxyConfigured()) {
      try {
        const proxied = await searchMercadoLivreScraper(query, {
          accessToken,
          siteId,
          proxy: proxyPlaywrightConfig(),
        });
        if (hasCompleteSalesTop3(proxied)) {
          setSetting("proxy_last_error", "");
          return proxied;
        }
        const message = proxied?.message || "Proxy nao completou o Top 3 com vendas publicas.";
        strictFailure = makeStrictFailure(query, message, proxied?.source || "mercado_livre_proxy_incomplete_sales");
        setSetting("proxy_last_error", message);
      } catch (error) {
        const message = sanitizeSearchError(error instanceof Error ? error.message : "Falha ao consultar Mercado Livre via proxy.");
        strictFailure = makeStrictFailure(query, message, "mercado_livre_proxy_error");
        setSetting("proxy_last_error", message);
      }
    }
  }

  if (isOxylabsConfigured()) {
    try {
      const oxylabs = await searchMercadoLivreOxylabs(query);
      if (oxylabs.ok && (!strictRealData || hasCompleteSalesTop3(oxylabs))) {
        setSetting("oxylabs_last_error", "");
        return oxylabs;
      }
      setSetting("oxylabs_last_error", oxylabs.message || "Oxylabs não retornou métricas para essa busca.");
    } catch (error) {
      setSetting("oxylabs_last_error", error instanceof Error ? error.message : "Falha ao consultar Oxylabs.");
    }
  }

  // accessToken and siteId are resolved before the primary Confweb engine runs.

  if (!accessToken) {
    if (strictFailure) {
      return strictFailure;
    }

    return {
      ok: false,
      source: "not_configured",
      strictRealOnly: true,
      metricsMode: "sales",
      salesAvailable: false,
      message: "Nao consegui ler dados reais agora. O painel admin pode reconectar o Mercado Livre ou tentar novamente em instantes.",
      items: [],
      totalAvailable: 0,
      totals: { demand: 0, revenue: 0, averageTicket: 0 },
    };
  }

  const params = new URLSearchParams({
    q: normalizeProductSearchQuery(query),
    limit: "3",
    sort: "sold_quantity_desc",
  });

  let response = await searchWithToken(siteId, params, accessToken);

  if ([401, 403].includes(response.status) && getMeliRefreshToken()) {
    accessToken = await refreshMeliAccessToken();
    if (accessToken) {
      response = await searchWithToken(siteId, params, accessToken);
    }
  }

  if (!response.ok) {
    const body = await response.text();
    if (response.status === 403) {
      let scraped = null;
      if (isMeliScraperEnabled()) {
        scraped = await searchMercadoLivreScraper(query, { accessToken, siteId });
        if (scraped.ok && (!strictRealData || hasCompleteSalesTop3(scraped))) {
          return scraped;
        }
        console.warn("[meli] Search API blocked and public-page fallback failed", {
          source: scraped.source,
          message: scraped.message,
        });
        setSetting("meli_last_error", `Fallback publico falhou: ${scraped.message}`);
      }

      const catalog = strictRealData ? null : await searchMercadoLivreCatalog({ query, accessToken, siteId });
      if (catalog?.ok) {
        return catalog;
      }
      if (catalog) {
        console.warn("[meli] Catalog fallback failed after Search API block", {
          source: catalog.source,
          message: catalog.message,
        });
      }

      if (strictFailure) {
        return strictFailure;
      }

      const fallbackMessages = [
        "OAuth conectado, mas o Mercado Livre bloqueou a API oficial de busca para este app.",
        scraped?.message,
        catalog?.message,
      ].filter(Boolean);

      return {
        ok: false,
        source: "meli_forbidden",
        strictRealOnly: true,
        metricsMode: "sales",
        salesAvailable: false,
        message: fallbackMessages.join(" "),
        items: [],
        totalAvailable: 0,
        totals: { demand: 0, revenue: 0, averageTicket: 0 },
      };
    }
    return {
      ok: false,
      source: "meli_error",
      strictRealOnly: true,
      metricsMode: "sales",
      salesAvailable: false,
      message: `Mercado Livre respondeu ${response.status}: ${body.slice(0, 180)}`,
      items: [],
      totalAvailable: 0,
      totals: { demand: 0, revenue: 0, averageTicket: 0 },
    };
  }

  const data = await response.json();
  const querySpec = buildProductQuerySpec(query);
  const items = (data.results || [])
    .map(mapItem)
    .filter((item) => item.id && item.title && item.price > 0 && item.soldQuantity > 0 && matchesProductQuery(item.title, querySpec).ok)
    .sort((a, b) => b.soldQuantity - a.soldQuantity)
    .slice(0, 3);
  const demand = items.reduce((sum, item) => sum + item.soldQuantity, 0);
  const revenue = items.reduce((sum, item) => sum + item.revenue, 0);

  if (!hasCompleteSalesTop3({ ok: true, salesAvailable: true, items })) {
    return makeStrictFailure(query, "Mercado Livre respondeu, mas nao trouxe 3 anuncios completos com vendas.", "mercado_livre_incomplete_sales");
  }

  return {
    ok: true,
    source: "mercado_livre",
    metricsMode: "sales",
    salesAvailable: true,
    message: `Dados reais retornados pelo Mercado Livre. Receita estimada: ${currencyFormatter.format(revenue)}.`,
    items,
    exactMatches: items.length,
    totalAvailable: data.paging?.total ?? items.length,
    totals: {
      demand,
      revenue,
      averageTicket: demand ? revenue / demand : 0,
    },
  };
}

export async function testMercadoLivreCatalog(query = "creatina 1kg") {
  const siteId = process.env.MELI_SITE_ID || getSetting("meli_site_id") || "MLB";
  const accessToken = await getValidMeliAccessToken();
  if (!accessToken) {
    throw new Error("Conecte o OAuth do Mercado Livre antes de testar o catálogo oficial.");
  }
  return searchMercadoLivreCatalog({ query, accessToken, siteId });
}

export async function testMercadoLivreConnection() {
  const accessToken = await getValidMeliAccessToken();
  if (!accessToken) {
    throw new Error("Autorize a conta do Mercado Livre antes de validar a conexão.");
  }

  const response = await fetch("https://api.mercadolibre.com/users/me", {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "BuscaVendasConfweb/1.0",
    },
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }

  if (!response.ok) {
    const detail = data.message || data.error || text || "sem detalhe";
    throw new Error(`Mercado Livre respondeu ${response.status}: ${String(detail).slice(0, 180)}`);
  }

  setSetting("meli_user_id", data.id || getSetting("meli_user_id") || "");
  setSetting("meli_last_error", "");
  return {
    ok: true,
    userId: data.id || null,
    nickname: data.nickname || "",
  };
}

function makeStrictFailure(query, message, source = "market_data_pending") {
  const safeMessage = sanitizeSearchError(message);
  return {
    ok: false,
    source,
    strictRealOnly: true,
    metricsMode: "sales",
    salesAvailable: false,
    message: `${safeMessage} O Busca Vendas só exibe demanda quando encontra 3 anúncios reais com quantidade de vendas pública.`,
    items: [],
    exactMatches: 0,
    totalAvailable: 0,
    totals: { demand: 0, revenue: 0, averageTicket: 0, actualDemand: 0 },
    query,
  };
}

function sanitizeSearchError(message) {
  const text = String(message || "").trim();
  if (!text) {
    return "Não foi possível concluir a leitura real agora.";
  }
  if (/libatk-bridge|shared libraries|browserType\.launch|chrome-headless-shell|playwright|executable/i.test(text)) {
    return "O servidor não conseguiu abrir o navegador automático do Motor Confweb. Use a Zyte/proxy como fonte principal ou peça ao cPanel para instalar as dependências do Chromium.";
  }
  if (/captcha|verificacao|verificação|seguranca|segurança|suspicious|account-verification/i.test(text)) {
    return "O Mercado Livre pediu verificação de segurança para a leitura automática.";
  }
  return text.length > 220 ? `${text.slice(0, 220)}...` : text;
}

function hasCompleteSalesTop3(result) {
  return isCompleteRealSalesResult(result);
}

function searchWithToken(siteId, params, accessToken) {
  return fetch(`https://api.mercadolibre.com/sites/${siteId}/search?${params}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "BuscaVendasConfweb/1.0",
    },
  });
}

function isMeliScraperEnabled() {
  if (
    (isScrapeDoEnabled() || isZyteConfigured())
    && process.env.MELI_LOCAL_BROWSER_ENABLED !== "true"
  ) {
    return false;
  }
  const configured = process.env.MELI_SCRAPER_ENABLED || getSetting("meli_scraper_enabled");
  const fallback = isZyteConfigured() ? "false" : "true";
  return String(configured || fallback).trim().toLowerCase() !== "false";
}

export function createMeliPkcePair() {
  const codeVerifier = randomBytes(64).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}

export function buildMeliAuthorizationUrl({ state, redirectUri, codeChallenge } = {}) {
  const clientId = getMeliClientId();
  const finalRedirectUri = redirectUri || getMeliRedirectUri();

  if (!clientId || !finalRedirectUri) {
    return null;
  }

  const url = new URL(process.env.MELI_AUTH_URL || getSetting("meli_auth_url") || DEFAULT_AUTH_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", finalRedirectUri);
  if (state) {
    url.searchParams.set("state", state);
  }
  if (codeChallenge) {
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
  }
  return url.toString();
}

export async function exchangeMeliAuthorizationCode({ code, redirectUri, codeVerifier }) {
  const clientId = getMeliClientId();
  const clientSecret = getMeliClientSecret();
  const finalRedirectUri = redirectUri || getMeliRedirectUri();

  if (!clientId || !clientSecret || !finalRedirectUri) {
    throw new Error("Configure App ID, Secret Key e Redirect URI do Mercado Livre.");
  }

  const data = await postToken({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: finalRedirectUri,
    ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
  });
  persistTokenData(data);
  return data;
}

export async function refreshMeliAccessToken() {
  const refreshToken = getMeliRefreshToken();
  const clientId = getMeliClientId();
  const clientSecret = getMeliClientSecret();

  if (!refreshToken || !clientId || !clientSecret) {
    return null;
  }

  try {
    const data = await postToken({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    });
    persistTokenData(data);
    return data.access_token || null;
  } catch (error) {
    setSetting("meli_last_error", error instanceof Error ? error.message : "Falha ao renovar token.");
    return null;
  }
}

export async function getValidMeliAccessToken() {
  const accessToken = getSetting("meli_access_token");
  const expiresAt = Number(getSetting("meli_token_expires_at") || 0);

  if (accessToken && (!expiresAt || expiresAt > Date.now() + 60_000)) {
    return accessToken;
  }

  const managedInPanel = getSetting("meli_credentials_managed_in_panel") === "true";
  return (await refreshMeliAccessToken()) || accessToken || (!managedInPanel ? process.env.MELI_ACCESS_TOKEN : null) || null;
}

export function getMeliRedirectUri() {
  return (process.env.MELI_REDIRECT_URI || getSetting("meli_redirect_uri") || "").trim();
}

export function disconnectMeliOAuth() {
  for (const key of [
    "meli_access_token",
    "meli_refresh_token",
    "meli_token_expires_at",
    "meli_user_id",
    "meli_oauth_connected_at",
    "meli_last_error",
    "meli_oauth_code_verifier",
    "meli_oauth_state_hash",
    "meli_oauth_state_user_id",
    "meli_oauth_state_created_at",
    "meli_oauth_states",
  ]) {
    setSetting(key, "");
  }
}

async function postToken(payload) {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "BuscaVendasConfweb/1.0",
    },
    body: new URLSearchParams(payload),
  });

  const text = await response.text();
  const data = parseMeliTokenResponse(text, response.status);

  if (!response.ok) {
    throw new Error(describeMeliTokenError(response.status, data, text));
  }

  if (!data.access_token) {
    throw new Error(describeMeliTokenError(response.status, data, text, "Mercado Livre OAuth não retornou access_token."));
  }

  return data;
}

function parseMeliTokenResponse(text, status) {
  if (!text || !text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Mercado Livre OAuth respondeu ${status}, mas retornou JSON invalido: ${text.slice(0, 180)}`);
  }
}

function describeMeliTokenError(status, data, text, fallback = "") {
  const detail = data.message || data.error_description || data.error || fallback;
  if (detail) {
    return `Mercado Livre OAuth respondeu ${status}: ${detail}`;
  }
  if (!text || !text.trim()) {
    return `Mercado Livre OAuth respondeu ${status} sem corpo de resposta. Confira Secret Key, Redirect URI e tente reconectar.`;
  }
  return `Mercado Livre OAuth respondeu ${status}: ${text.slice(0, 180)}`;
}

function persistTokenData(data) {
  if (data.access_token) {
    setSetting("meli_access_token", data.access_token);
  }
  if (data.refresh_token) {
    setSetting("meli_refresh_token", data.refresh_token);
  }
  if (data.expires_in) {
    setSetting("meli_token_expires_at", Date.now() + Number(data.expires_in) * 1000);
  }
  if (data.user_id) {
    setSetting("meli_user_id", data.user_id);
  }
  setSetting("meli_oauth_connected_at", new Date().toISOString());
  setSetting("meli_last_error", "");
}

function getMeliClientId() {
  return (getSetting("meli_client_id") || process.env.MELI_CLIENT_ID || "").trim();
}

function getMeliClientSecret() {
  return (getSetting("meli_client_secret") || process.env.MELI_CLIENT_SECRET || "").trim();
}

function getMeliRefreshToken() {
  return (getSetting("meli_refresh_token") || process.env.MELI_REFRESH_TOKEN || "").trim();
}
