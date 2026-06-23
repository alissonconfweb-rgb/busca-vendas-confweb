import { createHash, randomBytes } from "node:crypto";
import { getSetting, setSetting } from "./db.mjs";
import { searchMercadoLivreCatalog } from "./meli-catalog.mjs";
import { searchMercadoLivreScraper } from "./meli-scraper.mjs";
import { isOxylabsConfigured, searchMercadoLivreOxylabs } from "./oxylabs.mjs";
import { buildProductQuerySpec, matchesProductQuery } from "./product-match.mjs";

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
  };
}

export async function searchMercadoLivre(query) {
  if (isOxylabsConfigured()) {
    try {
      const oxylabs = await searchMercadoLivreOxylabs(query);
      if (oxylabs.ok) {
        setSetting("oxylabs_last_error", "");
        return oxylabs;
      }
      setSetting("oxylabs_last_error", oxylabs.message || "Oxylabs nao retornou metricas para essa busca.");
    } catch (error) {
      setSetting("oxylabs_last_error", error instanceof Error ? error.message : "Falha ao consultar Oxylabs.");
    }
  }

  let accessToken = await getValidMeliAccessToken();
  const siteId = process.env.MELI_SITE_ID || getSetting("meli_site_id") || "MLB";

  if (!accessToken) {
    if (isMeliScraperEnabled()) {
      const scraped = await searchMercadoLivreScraper(query);
      if (scraped.ok) {
        return scraped;
      }
      console.warn("[meli] OAuth not configured and public-page fallback failed", {
        source: scraped.source,
        message: scraped.message,
      });
      setSetting("meli_last_error", `Fallback publico falhou: ${scraped.message}`);
    }

    return {
      ok: false,
      source: "not_configured",
      message: "Nao consegui ler dados reais agora. O painel admin pode reconectar o Mercado Livre ou tentar novamente em instantes.",
      items: [],
      totalAvailable: 0,
      totals: { demand: 0, revenue: 0, averageTicket: 0 },
    };
  }

  const params = new URLSearchParams({
    q: query,
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
        if (scraped.ok) {
          return scraped;
        }
        console.warn("[meli] Search API blocked and public-page fallback failed", {
          source: scraped.source,
          message: scraped.message,
        });
        setSetting("meli_last_error", `Fallback publico falhou: ${scraped.message}`);
      }

      const catalog = await searchMercadoLivreCatalog({ query, accessToken, siteId });
      if (catalog.ok) {
        return catalog;
      }
      console.warn("[meli] Catalog fallback failed after Search API block", {
        source: catalog.source,
        message: catalog.message,
      });

      const fallbackMessages = [
        "OAuth conectado, mas o Mercado Livre bloqueou a API oficial de busca para este app.",
        scraped?.message,
        catalog.message,
      ].filter(Boolean);

      return {
        ok: false,
        source: "meli_forbidden",
        metricsMode: "market_signal",
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
    .filter((item) => item.id && item.title && item.price > 0 && matchesProductQuery(item.title, querySpec).ok)
    .sort((a, b) => b.soldQuantity - a.soldQuantity)
    .slice(0, 3);
  const demand = items.reduce((sum, item) => sum + item.soldQuantity, 0);
  const revenue = items.reduce((sum, item) => sum + item.revenue, 0);

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
  return (process.env.MELI_SCRAPER_ENABLED || getSetting("meli_scraper_enabled") || "true") !== "false";
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
  const envToken = process.env.MELI_ACCESS_TOKEN;
  if (envToken) {
    return envToken;
  }

  const accessToken = getSetting("meli_access_token");
  const expiresAt = Number(getSetting("meli_token_expires_at") || 0);

  if (accessToken && (!expiresAt || expiresAt > Date.now() + 60_000)) {
    return accessToken;
  }

  return (await refreshMeliAccessToken()) || accessToken;
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
    throw new Error(describeMeliTokenError(response.status, data, text, "Mercado Livre OAuth nao retornou access_token."));
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
  return (process.env.MELI_CLIENT_ID || getSetting("meli_client_id") || "").trim();
}

function getMeliClientSecret() {
  return (process.env.MELI_CLIENT_SECRET || getSetting("meli_client_secret") || "").trim();
}

function getMeliRefreshToken() {
  return (process.env.MELI_REFRESH_TOKEN || getSetting("meli_refresh_token") || "").trim();
}
