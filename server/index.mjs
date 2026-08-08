import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import {
  db,
  createSession,
  deleteSession,
  deleteSessionsForUser,
  findUserByEmail,
  getSetting,
  initDatabase,
  publicUser,
  setSetting,
  settingsObject,
  userFromSession,
} from "./db.mjs";
import { buildMeliAuthorizationUrl, createMeliPkcePair, diagnoseMercadoLivreIntegration, disconnectMeliOAuth, exchangeMeliAuthorizationCode, getMeliRedirectUri, getValidMeliAccessToken, searchMercadoLivre, testMercadoLivreCatalog } from "./meli.mjs";
import { enrichMercadoLivreCosts } from "./meli-costs.mjs";
import { shouldUseMarketEstimate } from "./market-estimate.mjs";
import { bootstrapAdminFromEnv } from "./bootstrap-admin.mjs";
import { syncMeliSettingsFromEnv, validateMeliSettingsInput, isValidMeliClientId, resolveMeliRedirectUri } from "./meli-config.mjs";
import { syncOxylabsSettingsFromEnv, testOxylabsConnection } from "./oxylabs.mjs";
import { syncProxySettingsFromEnv, testProxyConnection } from "./proxy.mjs";
import { isZyteConfigured, isZyteSearchEnabled, syncZyteSettingsFromEnv, testZyteConnection } from "./zyte.mjs";
import {
  ensureScrapeDoSearchDepth,
  isScrapeDoConfigured,
  normalizeScrapeDoToken,
  scrapeDoUsageSummary,
  searchMercadoLivreCachedItems,
  syncScrapeDoSettingsFromEnv,
  testScrapeDoConnection,
} from "./scrapedo.mjs";
import { buildProductQuerySpec, matchesProductQuery, normalizedProductKey, normalizeProductSearchQuery } from "./product-match.mjs";
import {
  asaasWebhookUrl,
  billingBlocksSearch,
  configureAsaasApiKey,
  createAsaasCheckout,
  handleAsaasWebhook,
  refreshAsaasCheckoutStatus,
  setupAsaasIntegration,
  syncAsaasSettingsFromEnv,
  testAsaasConnection,
} from "./asaas.mjs";
import { lookupBrazilianPostalCode } from "./postal-code.mjs";
import { hashPassword, hashToken, randomToken, verifyPassword } from "./security.mjs";
import { applyRateLimit, MemoryRateLimiter } from "./rate-limit.mjs";
import { minimumChampionSales } from "./champion-policy.mjs";
import { isCompleteRealSalesResult } from "./search-result-policy.mjs";
import { normalizeSearchProviderMode } from "./search-provider.mjs";

initDatabase();

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || "0.0.0.0";
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const COOKIE = "bv_session";
const CREATOR_EMAIL = (process.env.CREATOR_EMAIL || process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const DIST_DIR = resolve(process.cwd(), "dist");
const MELI_OAUTH_STATE_TTL_MS = 15 * 60 * 1000;
const SEARCH_RESPONSE_TIMEOUT_MS = Number(process.env.SEARCH_RESPONSE_TIMEOUT_MS || 120_000);
const MARKET_CACHE_REFRESH_INTERVAL_MS = Number(process.env.MARKET_CACHE_REFRESH_INTERVAL_MS || 6 * 60 * 60_000);
const marketRefreshFlights = new Map();
const marketBackgroundRefreshAttempts = new Map();
let marketCacheRefreshTimer = null;
const rateLimiter = new MemoryRateLimiter();
const PUBLIC_SETTING_KEYS = new Set([
  "app_name",
  "starter_monthly",
  "starter_yearly",
  "starter_search_limit",
  "scale_monthly",
  "scale_yearly",
  "commercial_cta",
]);

bootstrapAdminFromEnv(db);
syncMeliSettingsFromEnv();
syncOxylabsSettingsFromEnv();
syncProxySettingsFromEnv();
syncZyteSettingsFromEnv();
syncScrapeDoSettingsFromEnv();
ensureScrapeDoSearchDepth();
syncAsaasSettingsFromEnv();
migrateMarketSearchCacheKeys();
pruneInvalidChampionCaches();
seedMarketItemCacheFromSearches();
if (isZyteConfigured() && isZyteSearchEnabled() && process.env.MELI_LOCAL_BROWSER_ENABLED !== "true") {
  enforceZytePrimarySettings();
}
if (CREATOR_EMAIL) {
  db.prepare("UPDATE users SET role = 'admin', status = 'active', updated_at = CURRENT_TIMESTAMP WHERE lower(email) = ?").run(CREATOR_EMAIL);
}

const server = createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (error) {
    console.error(error);
    if (res.headersSent) {
      res.end();
      return;
    }
    const status = Number(error?.statusCode || 500);
    json(res, status, {
      error: status >= 500 ? "Erro interno no servidor." : error.message,
    });
  }
});
server.requestTimeout = Math.max(135_000, SEARCH_RESPONSE_TIMEOUT_MS + 15_000);
server.headersTimeout = 15_000;
server.keepAliveTimeout = 5_000;

server.listen(PORT, HOST, () => {
  console.log(`Busca Vendas rodando em http://${HOST}:${PORT}`);
  startMarketCacheRefreshWorker();
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  if (marketCacheRefreshTimer) {
    clearTimeout(marketCacheRefreshTimer);
  }
  console.log(`${signal} recebido. Encerrando o Busca Vendas...`);
  server.close((error) => {
    if (error) {
      console.error("Falha ao encerrar o servidor.", error);
      process.exitCode = 1;
    }
    process.exit();
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const method = req.method || "GET";

  if (!url.pathname.startsWith("/api")) {
    return serveStatic(req, res, url);
  }

  if (method === "OPTIONS") {
    return json(res, 204, null);
  }

  if (url.pathname === "/api/health") {
    return json(res, 200, healthPayload());
  }

  const exemptFromGlobalLimit = url.pathname === "/api/asaas/webhook"
    || url.pathname === "/api/meli/notifications";
  if (
    !exemptFromGlobalLimit
    && !limitRequest(req, res, "global", clientIp(req), 300, 60_000)
  ) {
    return;
  }

  if (
    ["POST", "PATCH", "PUT", "DELETE"].includes(method)
    && !exemptFromGlobalLimit
    && !hasTrustedRequestOrigin(req)
  ) {
    return json(res, 403, { error: "Origem da requisição não autorizada." });
  }

  if (url.pathname === "/api/meli/notifications" && ["GET", "POST"].includes(method)) {
    await drainRequest(req);
    return json(res, 200, { ok: true });
  }

  if (url.pathname === "/api/asaas/webhook" && method === "POST") {
    const result = await handleAsaasWebhook(req, process.env.PUBLIC_URL || url.origin);
    return json(res, result.status, result.body);
  }

  if (url.pathname === "/api/auth/recovery-request" && method === "POST") {
    if (!limitRequest(req, res, "recovery-ip", clientIp(req), 3, 60 * 60_000)) {
      return;
    }
    const body = await readJson(req);
    const email = normalizeEmail(body.email);
    if (!limitRequest(req, res, "recovery-email", email || "invalid", 2, 60 * 60_000)) {
      return;
    }
    if (isValidEmail(email)) {
      const account = findUserByEmail(email);
      if (account) {
        const existing = db.prepare(`
          SELECT id
          FROM support_tickets
          WHERE user_id = ?
            AND subject = 'Recuperação de acesso'
            AND status = 'open'
            AND created_at >= datetime('now', '-24 hours')
          LIMIT 1
        `).get(account.id);
        if (!existing) {
          db.prepare(`
            INSERT INTO support_tickets (user_id, subject, message, status, priority)
            VALUES (?, 'Recuperação de acesso', ?, 'open', 'high')
          `).run(
            account.id,
            `O usuário solicitou recuperação de senha para ${email}. Confirme a identidade antes de definir uma senha temporária no painel de usuários.`,
          );
        }
      }
    }
    return json(res, 200, {
      message: "Se a conta existir, a solicitação foi registrada. A equipe Confweb entrará em contato pelos dados cadastrados.",
    });
  }

  if (url.pathname === "/api/auth/login" && method === "POST") {
    if (!limitRequest(req, res, "login-ip", clientIp(req), 10, 15 * 60_000)) {
      return;
    }
    const body = await readJson(req);
    const email = normalizeEmail(body.email);
    if (!limitRequest(req, res, "login-email", email || "invalid", 10, 15 * 60_000)) {
      return;
    }
    const user = findUserByEmail(email);

    if (!user || !verifyPassword(body.password || "", user.password_hash)) {
      return json(res, 401, { error: "E-mail ou senha inválidos." });
    }
    if (user.status !== "active") {
      return json(res, 403, { error: "Esta conta está bloqueada. Fale com o suporte da Confweb." });
    }

    const session = createSession(user.id);
    setCookie(res, session.token, session.expires);
    return json(res, 200, { user: publicUserWithPermissions(user) });
  }

  if (url.pathname === "/api/auth/register" && method === "POST") {
    if (!limitRequest(req, res, "register", clientIp(req), 5, 60 * 60_000)) {
      return;
    }
    const body = await readJson(req);
    const email = normalizeEmail(required(body.email));
    const password = required(body.password);
    const phone = normalizePhone(required(body.phone));
    if (!isValidEmail(email)) {
      return json(res, 400, { error: "Informe um e-mail válido." });
    }
    if (phone.length < 10 || phone.length > 13) {
      return json(res, 400, { error: "Informe um telefone válido com DDD." });
    }
    const passwordError = validateNewPassword(password);
    if (passwordError) {
      return json(res, 400, { error: passwordError });
    }
    if (!booleanValue(body.acceptedTerms) || !booleanValue(body.acceptedPrivacy)) {
      return json(res, 400, { error: "Aceite os Termos de Uso e a Política de Privacidade para criar a conta." });
    }
    if (findUserByEmail(email)) {
      return json(res, 409, { error: "Esse e-mail já está cadastrado. Faça login para continuar." });
    }

    const result = db.prepare(`
      INSERT INTO users (
        name, email, phone, password_hash, role, status, plan, search_limit,
        terms_accepted_at, privacy_accepted_at
      )
      VALUES (?, ?, ?, ?, 'user', 'active', 'free', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(required(body.name).slice(0, 100), email, phone, hashPassword(password));
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(result.lastInsertRowid);
    const session = createSession(user.id);
    setCookie(res, session.token, session.expires);
    return json(res, 201, { user: publicUserWithPermissions(user) });
  }

  if (url.pathname === "/api/auth/logout" && method === "POST") {
    deleteSession(readCookie(req, COOKIE));
    clearCookie(res);
    return json(res, 200, { ok: true });
  }

  if (url.pathname === "/api/auth/me" && method === "GET") {
    const currentUser = userFromSession(readCookie(req, COOKIE));
    return json(res, 200, { user: currentUser ? publicUserWithPermissions(currentUser) : null });
  }

  if (url.pathname === "/api/meli/callback" && method === "GET") {
    return handleMeliCallback(req, res, url);
  }

  if (url.pathname === "/api/public/bootstrap" && method === "GET") {
    return json(res, 200, publicBootstrapPayload());
  }

  const user = requireUser(req, res);
  if (!user) {
    return;
  }

  if (url.pathname === "/api/bootstrap" && method === "GET") {
    return json(res, 200, {
      user: publicUserWithPermissions(user),
      settings: safeSettings(user),
      tips: db.prepare("SELECT * FROM tips WHERE status = 'published' ORDER BY id DESC").all(),
      contacts: db.prepare("SELECT * FROM commercial_contacts WHERE status = 'active' ORDER BY is_primary DESC, id DESC").all(),
      tickets: db.prepare("SELECT * FROM support_tickets WHERE user_id = ? ORDER BY id DESC").all(user.id),
    });
  }

  if (url.pathname === "/api/account/password" && method === "POST") {
    if (!limitRequest(req, res, "password-change", user.id, 5, 60 * 60_000)) {
      return;
    }
    const body = await readJson(req);
    const currentPassword = String(body.currentPassword || "");
    const newPassword = String(body.newPassword || "");

    if (!currentPassword || !newPassword) {
      return json(res, 400, { error: "Informe a senha atual e a nova senha." });
    }

    const passwordError = validateNewPassword(newPassword);
    if (passwordError) {
      return json(res, 400, { error: passwordError });
    }

    const fullUser = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
    if (!fullUser || !verifyPassword(currentPassword, fullUser.password_hash)) {
      return json(res, 401, { error: "Senha atual incorreta." });
    }

    db.prepare(`
      UPDATE users
      SET password_hash = ?, password_changed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      hashPassword(newPassword),
      user.id,
    );
    deleteSessionsForUser(user.id);
    const session = createSession(user.id);
    setCookie(res, session.token, session.expires);

    return json(res, 200, { ok: true, message: "Senha atualizada com sucesso." });
  }

  if (url.pathname === "/api/search" && method === "POST") {
    const body = await readJson(req);
    return handleSearch(req, res, user, body.q || "", {
      fresh: canUseAdmin(user) && ["1", "true", "yes", "sim"].includes(String(url.searchParams.get("fresh") || "").toLowerCase()),
    });
  }

  if (url.pathname === "/api/search-history" && method === "GET") {
    const rows = db.prepare(`
      SELECT id, query, source, total_demand, total_revenue, payload, created_at
      FROM search_history
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT 30
    `).all(user.id);
    return json(res, 200, rows
      .map((row) => {
        const result = parseSearchPayload(row.payload);
        if (!isCompleteRealSalesResult(result)) {
          return null;
        }

        return {
          id: row.id,
          query: row.query,
          source: row.source,
          total_demand: result.totals.demand,
          total_revenue: result.totals.revenue,
          created_at: row.created_at,
          result,
        };
      })
      .filter(Boolean));
  }

  const historyMatch = url.pathname.match(/^\/api\/search-history\/(\d+)$/);
  if (historyMatch && method === "GET") {
    const record = db.prepare(`
      SELECT id, query, source, total_demand, total_revenue, payload, created_at
      FROM search_history
      WHERE id = ? AND user_id = ?
    `).get(Number(historyMatch[1]), user.id);

    if (!record) {
      return json(res, 404, { error: "Pesquisa não encontrada." });
    }

    const result = await resolveMarketSearch(record.query);
    if (!isCompleteRealSalesResult(result)) {
      return json(res, 410, { error: "Essa pesquisa salva é antiga e não contém três anúncios reais completos. Faça uma nova busca para atualizar." });
    }

    db.prepare(`
      UPDATE search_history
      SET source = ?, total_demand = ?, total_revenue = ?, payload = ?
      WHERE id = ? AND user_id = ?
    `).run(
      result.source,
      result.totals.demand,
      result.totals.revenue,
      JSON.stringify(result),
      record.id,
      user.id,
    );

    return json(res, 200, {
      id: record.id,
      query: record.query,
      created_at: record.created_at,
      result: canUseAdmin(user) ? result : publicSearchResult(result),
    });
  }

  if (url.pathname === "/api/support" && method === "GET") {
    return json(res, 200, db.prepare("SELECT * FROM support_tickets WHERE user_id = ? ORDER BY id DESC").all(user.id));
  }

  if (url.pathname === "/api/support" && method === "POST") {
    if (!limitRequest(req, res, "support", user.id, 10, 60 * 60_000)) {
      return;
    }
    const body = await readJson(req);
    const subject = required(body.subject).slice(0, 120);
    const message = required(body.message).slice(0, 3000);
    const priority = oneOf(body.priority || "normal", ["low", "normal", "high"], "Prioridade inválida.");
    const result = db.prepare(`
      INSERT INTO support_tickets (user_id, subject, message, priority)
      VALUES (?, ?, ?, ?)
    `).run(user.id, subject, message, priority);
    return json(res, 201, db.prepare("SELECT * FROM support_tickets WHERE id = ?").get(result.lastInsertRowid));
  }

  if (url.pathname === "/api/tips" && method === "GET") {
    return json(res, 200, db.prepare("SELECT * FROM tips WHERE status = 'published' ORDER BY id DESC").all());
  }

  if (url.pathname === "/api/postal-code" && method === "GET") {
    if (!limitRequest(req, res, "postal-code", user.id, 30, 60 * 60_000)) {
      return;
    }
    try {
      const address = await lookupBrazilianPostalCode(url.searchParams.get("cep") || "");
      return json(res, 200, address);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível validar o CEP.";
      return json(res, 400, { error: message });
    }
  }

  if (url.pathname === "/api/checkout/start" && method === "POST") {
    if (!limitRequest(req, res, "checkout", user.id, 6, 10 * 60_000)) {
      return;
    }
    const body = await readJson(req);
    try {
      const result = await createAsaasCheckout({
        user,
        body,
        settings: settingsObject(),
        remoteIp: clientIp(req),
      });
      const refreshedUser = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
      return json(res, 200, { ...result, user: publicUserWithPermissions(refreshedUser) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível criar o checkout.";
      setSetting("asaas_last_error", message);
      return json(res, 400, { error: message });
    }
  }

  if (url.pathname === "/api/checkout/status" && method === "GET") {
    try {
      const result = await refreshAsaasCheckoutStatus({
        user,
        financeId: url.searchParams.get("id"),
      });
      const refreshedUser = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
      return json(res, 200, { ...result, user: publicUserWithPermissions(refreshedUser) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível consultar a compra.";
      return json(res, 400, { error: message });
    }
  }

  if (url.pathname.startsWith("/api/admin/")) {
    if (!canUseAdmin(user)) {
      return json(res, 403, { error: "Acesso restrito ao admin." });
    }
    return handleAdmin(req, res, url, user);
  }

  return json(res, 404, { error: "Rota não encontrada." });
}

async function handleSearch(req, res, user, query, options = {}) {
  if (!limitRequest(req, res, "search-user", user.id, canUseAdmin(user) ? 60 : 20, 60_000)) {
    return;
  }
  if (!limitRequest(req, res, "search-ip", clientIp(req), 30, 60_000)) {
    return;
  }
  const cleanQuery = query.trim();
  if (!cleanQuery) {
    return json(res, 400, { error: "Informe uma palavra-chave." });
  }

  if (!canUseAdmin(user) && billingBlocksSearch(user)) {
    return json(res, 402, {
      error: "Seu pagamento mensal está pendente. Regularize a cobrança para continuar pesquisando.",
      code: "PAYMENT_REQUIRED",
      paymentUrl: user.billing_payment_url || "",
    });
  }

  if (user.role !== "admin" && user.search_limit !== null && user.searches_used >= user.search_limit) {
    return json(res, 402, { error: "Limite de pesquisas atingido. Faça upgrade para continuar." });
  }

  let result = await resolveMarketSearch(cleanQuery, { fresh: options.fresh });
  if (shouldUseMarketEstimate(result)) {
    result = strictRealSearchUnavailable(
      cleanQuery,
      result?.message || "A fonte real ainda não retornou 3 anúncios completos com vendas públicas.",
    );
  }
  const responseResult = canUseAdmin(user) ? result : publicSearchResult(result);
  if (isCompleteRealSalesResult(result)) {
    db.prepare(`
      INSERT INTO search_history (user_id, query, source, total_demand, total_revenue, payload)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      user.id,
      cleanQuery,
      result.source,
      result.totals.demand,
      result.totals.revenue,
      JSON.stringify(result),
    );
  }

  if (user.role !== "admin" && isBillableSearchResult(result)) {
    db.prepare("UPDATE users SET searches_used = searches_used + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(user.id);
  }

  return json(res, 200, responseResult);
}

async function resolveMarketSearch(query, options = {}) {
  const cleanQuery = String(query || "").trim();
  const refreshFallback = options.fresh
    ? getFreshCachedSearchResult(cleanQuery) || getStaleCachedSearchResult(cleanQuery)
    : null;
  let result = options.fresh ? null : getFreshCachedSearchResult(cleanQuery);

  if (!result && !options.fresh) {
    const staleResult = getStaleCachedSearchResult(cleanQuery);
    if (staleResult) {
      const refreshed = enforceChampionThreshold(cleanQuery, await scheduleMarketSearchRefresh(cleanQuery));
      result = isBillableSearchResult(refreshed) ? refreshed : staleResult;
    }
  }

  if (!result && !options.fresh) {
    result = searchMercadoLivreCachedItems(cleanQuery);
    if (isBillableSearchResult(result)) {
      saveMarketSearchCache(cleanQuery, result);
    }
  }

  if (!result) {
    result = enforceChampionThreshold(
      cleanQuery,
      await searchWithResponseGuard(cleanQuery, { forceRefresh: options.fresh === true }),
    );
    if (isBillableSearchResult(result)) {
      saveMarketSearchCache(cleanQuery, result);
    }
  }

  if (!isBillableSearchResult(result) && refreshFallback) {
    result = {
      ...refreshFallback,
      source: "confweb_cache",
      message: "O último resultado real continua disponível enquanto a atualização automática tenta novamente.",
      cacheHit: true,
      cacheStale: true,
      refreshPending: true,
      providerCreditsUsed: 0,
    };
  }

  if (isBillableSearchResult(result) && result.items.some((item) => !item.marketplaceFees)) {
    const accessToken = await getValidMeliAccessToken();
    result = await enrichMercadoLivreCosts(result, {
      accessToken,
      siteId: process.env.MELI_SITE_ID || getSetting("meli_site_id") || "MLB",
    });
  }

  return result;
}

function isBillableSearchResult(result) {
  return isCompleteRealSalesResult(result);
}

function enforceChampionThreshold(query, result) {
  if (!result || result.source === "market_estimate" || result.salesAvailable === false || result.metricsMode === "market_signal") {
    return result;
  }

  if (!result.ok || isCompleteRealSalesResult(result)) {
    return result;
  }

  return incompleteChampionResult(
    query,
    "Resultado descartado: não encontrei 3 anúncios com vendas públicas reais. Vou tentar outra fonte para completar a lista.",
  );
}

function incompleteChampionResult(query, message) {
  return {
    ok: false,
    source: "invalid_champion_result",
    strictRealOnly: true,
    metricsMode: "sales",
    salesAvailable: false,
    message,
    items: [],
    exactMatches: 0,
    totalAvailable: 0,
    totals: { demand: 0, revenue: 0, averageTicket: 0, actualDemand: 0 },
    query,
  };
}

function getFreshCachedSearchResult(query) {
  const ttlMs = marketCacheTtlMs();
  if (ttlMs <= 0) {
    return null;
  }

  const row = findMarketSearchCacheRow(query);
  if (!row) {
    return getFreshHistoryCachedSearchResult(query, ttlMs);
  }

  const updatedAt = Date.parse(`${String(row.updated_at).replace(" ", "T")}Z`);
  if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > ttlMs) {
    return null;
  }

  const payload = parseSearchPayload(row.payload);
  if (!isBillableSearchResult(payload) || !cachedResultMatchesQuery(payload, query)) {
    return null;
  }

  return {
    ...payload,
    source: "confweb_cache",
    message: `Resultado recuperado da base interna Confweb. Atualizado em ${new Date(row.updated_at).toLocaleDateString("pt-BR")}.`,
    cacheHit: true,
    cachedAt: row.updated_at,
    providerCreditsSaved: Number(payload.providerCreditsUsed || 0),
    providerCreditsUsed: 0,
  };
}

function getFreshHistoryCachedSearchResult(query, ttlMs) {
  const key = marketCacheKey(query);
  const rows = db.prepare(`
    SELECT query, payload, created_at
    FROM search_history
    ORDER BY id DESC
    LIMIT 500
  `).all();

  for (const row of rows) {
    if (marketCacheKey(row.query) !== key) {
      continue;
    }

    const createdAt = Date.parse(`${String(row.created_at).replace(" ", "T")}Z`);
    if (!Number.isFinite(createdAt) || Date.now() - createdAt > ttlMs) {
      continue;
    }

    const payload = parseSearchPayload(row.payload);
    if (!isBillableSearchResult(payload) || !cachedResultMatchesQuery(payload, query)) {
      continue;
    }

    return {
      ...payload,
      source: "confweb_cache",
      message: `Resultado recuperado da base interna Confweb. Atualizado em ${new Date(row.created_at).toLocaleDateString("pt-BR")}.`,
      cacheHit: true,
      cachedAt: row.created_at,
      providerCreditsSaved: Number(payload.providerCreditsUsed || 0),
      providerCreditsUsed: 0,
    };
  }

  return null;
}

function getStaleCachedSearchResult(query) {
  const freshTtlMs = marketCacheTtlMs();
  const staleTtlMs = marketCacheStaleTtlMs();
  if (freshTtlMs <= 0 || staleTtlMs <= freshTtlMs) {
    return null;
  }

  const direct = findMarketSearchCacheRow(query);
  if (direct) {
    const cached = staleSearchResultFromRow(direct, direct.updated_at, freshTtlMs, staleTtlMs, query);
    if (cached) {
      return cached;
    }
  }

  const key = marketCacheKey(query);
  const rows = db.prepare(`
    SELECT query, payload, created_at
    FROM search_history
    ORDER BY id DESC
    LIMIT 500
  `).all();
  for (const row of rows) {
    if (marketCacheKey(row.query) !== key) {
      continue;
    }
    const cached = staleSearchResultFromRow(row, row.created_at, freshTtlMs, staleTtlMs, query);
    if (cached) {
      return cached;
    }
  }
  return null;
}

function staleSearchResultFromRow(row, timestamp, freshTtlMs, staleTtlMs, query) {
  const updatedAt = Date.parse(`${String(timestamp).replace(" ", "T")}Z`);
  const age = Date.now() - updatedAt;
  if (!Number.isFinite(updatedAt) || age <= freshTtlMs || age > staleTtlMs) {
    return null;
  }

  const payload = parseSearchPayload(row.payload);
  if (!isBillableSearchResult(payload) || !cachedResultMatchesQuery(payload, query)) {
    return null;
  }

  return {
    ...payload,
    source: "confweb_cache",
    message: "Resultado recuperado da base interna Confweb. Atualização automática em andamento.",
    cacheHit: true,
    cacheStale: true,
    cachedAt: timestamp,
    providerCreditsSaved: Number(payload.providerCreditsUsed || 0),
    providerCreditsUsed: 0,
  };
}

function cachedResultMatchesQuery(result, query) {
  if (!Array.isArray(result?.items) || result.items.length < 3) {
    return false;
  }
  if (
    result.source === "scrapedo_mercado_livre"
    && result.rankingStrategy !== "visible_sales_v3"
  ) {
    return false;
  }
  const spec = buildProductQuerySpec(query);
  return result.items.slice(0, 3).every((item) => matchesProductQuery(item?.title || "", spec).ok);
}

function scheduleMarketSearchRefresh(query) {
  const key = marketCacheKey(query);
  if (marketRefreshFlights.has(key)) {
    return marketRefreshFlights.get(key);
  }

  const refresh = searchWithResponseGuard(query, { forceRefresh: true })
    .then((result) => {
      if (isBillableSearchResult(result)) {
        saveMarketSearchCache(query, result);
      }
      return result;
    })
    .catch((error) => {
      console.error(`Falha ao atualizar cache de "${query}":`, error);
      return null;
    })
    .finally(() => marketRefreshFlights.delete(key));
  marketRefreshFlights.set(key, refresh);
  return refresh;
}

function saveMarketSearchCache(query, result) {
  db.prepare(`
    INSERT INTO market_search_cache (key, query, source, total_demand, total_revenue, payload, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET
      query = excluded.query,
      source = excluded.source,
      total_demand = excluded.total_demand,
      total_revenue = excluded.total_revenue,
      payload = excluded.payload,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    marketCacheKey(query),
    query,
    result.source || "mercado_livre",
    Number(result.totals?.demand || 0),
    Number(result.totals?.revenue || 0),
    JSON.stringify(result),
  );
}

function marketCacheKey(query) {
  const spec = buildProductQuerySpec(query);
  const tokens = [...spec.tokens].sort();
  const measures = spec.measures
    .map((measure) => `${measure.kind}-${Number(measure.value).toFixed(3)}`)
    .sort();
  return normalizedProductKey([...tokens, ...measures].join(" ") || normalizeProductSearchQuery(query));
}

function legacyMarketCacheKey(query) {
  return normalizedProductKey(normalizeProductSearchQuery(query));
}

function findMarketSearchCacheRow(query) {
  return db.prepare(`
    SELECT *
    FROM market_search_cache
    WHERE key = ? OR key = ?
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(marketCacheKey(query), legacyMarketCacheKey(query));
}

function migrateMarketSearchCacheKeys() {
  if (getSetting("market_cache_key_version") === "2") {
    return;
  }

  const rows = db.prepare("SELECT * FROM market_search_cache").all();
  for (const row of rows) {
    const canonicalKey = marketCacheKey(row.query);
    if (!canonicalKey || canonicalKey === row.key) {
      continue;
    }
    db.prepare(`
      INSERT INTO market_search_cache (key, query, source, total_demand, total_revenue, payload, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        query = excluded.query,
        source = excluded.source,
        total_demand = excluded.total_demand,
        total_revenue = excluded.total_revenue,
        payload = excluded.payload,
        updated_at = excluded.updated_at
    `).run(
      canonicalKey,
      row.query,
      row.source,
      row.total_demand,
      row.total_revenue,
      row.payload,
      row.created_at,
      row.updated_at,
    );
    db.prepare("DELETE FROM market_search_cache WHERE key = ?").run(row.key);
  }
  setSetting("market_cache_key_version", "2");
}

function pruneInvalidChampionCaches() {
  const minimum = minimumChampionSales();
  if (getSetting("champion_cache_policy_min") === String(minimum)) {
    return;
  }

  const removeCache = db.prepare("DELETE FROM market_search_cache WHERE key = ?");
  const removeHistory = db.prepare("DELETE FROM search_history WHERE id = ?");
  const prune = db.transaction(() => {
    for (const row of db.prepare("SELECT key, payload FROM market_search_cache").all()) {
      if (!isCompleteRealSalesResult(parseSearchPayload(row.payload))) {
        removeCache.run(row.key);
      }
    }
    for (const row of db.prepare("SELECT id, payload FROM search_history").all()) {
      if (!isCompleteRealSalesResult(parseSearchPayload(row.payload))) {
        removeHistory.run(row.id);
      }
    }
    setSetting("champion_cache_policy_min", String(minimum));
  });
  prune();
}

function seedMarketItemCacheFromSearches() {
  if (getSetting("market_item_cache_seed_version") === "1") {
    return;
  }

  const rows = db.prepare("SELECT payload FROM market_search_cache").all();
  for (const row of rows) {
    const result = parseSearchPayload(row.payload);
    if (!isBillableSearchResult(result)) {
      continue;
    }
    for (const item of result.items.slice(0, 3)) {
      const href = item.permalink || item.href || "";
      const key = String(item.id || href || normalizedProductKey(item.title)).trim();
      const cachedItem = {
        ...item,
        href,
      };
      db.prepare(`
        INSERT OR IGNORE INTO market_item_cache (key, title, permalink, payload)
        VALUES (?, ?, ?, ?)
      `).run(key, item.title, href, JSON.stringify(cachedItem));
    }
  }
  setSetting("market_item_cache_seed_version", "1");
}

function marketCacheTtlMs() {
  const days = Number(getSetting("market_cache_ttl_days") || process.env.MARKET_CACHE_TTL_DAYS || 7);
  return Number.isFinite(days) && days > 0 ? days * 24 * 60 * 60 * 1000 : 0;
}

function marketCacheStaleTtlMs() {
  const days = Number(getSetting("market_cache_stale_days") || process.env.MARKET_CACHE_STALE_DAYS || 30);
  return Number.isFinite(days) && days > 0 ? days * 24 * 60 * 60 * 1000 : 0;
}

function parseSearchPayload(payload) {
  try {
    return JSON.parse(payload || "{}");
  } catch {
    return null;
  }
}

async function searchWithResponseGuard(query, options = {}) {
  let settled = false;
  let timeoutId;
  const realSearch = searchMercadoLivre(query, options)
    .then((result) => {
      settled = true;
      const validated = enforceChampionThreshold(query, result);
      if (isBillableSearchResult(validated)) {
        saveMarketSearchCache(query, validated);
      }
      return result;
    })
    .catch((error) => {
      settled = true;
      const message = sanitizeSearchError(error instanceof Error ? error.message : "Falha inesperada ao consultar a fonte real.");
      return strictRealSearchUnavailable(query, message);
    });

  const timeout = new Promise((resolve) => {
    timeoutId = setTimeout(() => {
      if (!settled) {
        resolve(strictRealSearchUnavailable(query, "A leitura real ultrapassou o tempo ideal de resposta."));
      }
    }, SEARCH_RESPONSE_TIMEOUT_MS);
  });

  const result = await Promise.race([realSearch, timeout]);
  if (timeoutId) {
    clearTimeout(timeoutId);
  }
  return result;
}

function startMarketCacheRefreshWorker() {
  if (!Number.isFinite(MARKET_CACHE_REFRESH_INTERVAL_MS) || MARKET_CACHE_REFRESH_INTERVAL_MS <= 0) {
    return;
  }

  const scheduleNext = (delay) => {
    marketCacheRefreshTimer = setTimeout(async () => {
      try {
        await refreshOneRecentlyUsedMarketCache();
      } catch (error) {
        console.error("Falha na atualização automática da base de pesquisas:", error);
      } finally {
        if (!shuttingDown) {
          scheduleNext(MARKET_CACHE_REFRESH_INTERVAL_MS);
        }
      }
    }, delay);
    marketCacheRefreshTimer.unref();
  };

  scheduleNext(Math.min(60_000, MARKET_CACHE_REFRESH_INTERVAL_MS));
}

async function refreshOneRecentlyUsedMarketCache() {
  const usage = scrapeDoUsageSummary();
  if (usage.active > 0 || usage.queued > 0 || usage.remaining === 0) {
    return;
  }

  const recentQueries = db.prepare(`
    SELECT query, COUNT(*) AS uses
    FROM search_history
    WHERE created_at >= datetime('now', '-30 days')
    GROUP BY lower(trim(query))
    ORDER BY uses DESC, MAX(created_at) DESC
    LIMIT 250
  `).all();
  const useByKey = new Map(recentQueries.map((row) => [marketCacheKey(row.query), Number(row.uses || 0)]));
  const now = Date.now();
  const retryAfterMs = Math.max(MARKET_CACHE_REFRESH_INTERVAL_MS, 60 * 60_000);
  const candidate = db.prepare(`
    SELECT key, query, updated_at
    FROM market_search_cache
    ORDER BY updated_at ASC
    LIMIT 250
  `).all().find((row) => {
    const updatedAt = Date.parse(`${String(row.updated_at).replace(" ", "T")}Z`);
    const lastAttempt = marketBackgroundRefreshAttempts.get(row.key) || 0;
    return useByKey.has(row.key)
      && Number.isFinite(updatedAt)
      && now - updatedAt > marketCacheTtlMs()
      && now - lastAttempt >= retryAfterMs;
  });

  if (!candidate) {
    return;
  }

  marketBackgroundRefreshAttempts.set(candidate.key, now);
  const refreshed = enforceChampionThreshold(candidate.query, await scheduleMarketSearchRefresh(candidate.query));
  if (isBillableSearchResult(refreshed)) {
    marketBackgroundRefreshAttempts.delete(candidate.key);
    console.log(`Base interna atualizada automaticamente: "${candidate.query}".`);
  }
}

function strictRealSearchUnavailable(query, message) {
  return {
    ok: false,
    source: "market_data_pending",
    strictRealOnly: true,
    metricsMode: "sales",
    salesAvailable: false,
    message: `${sanitizeSearchError(message)} Não exibimos estimativas quando a fonte real está configurada.`,
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
    return "O navegador local do servidor está indisponível. Use a fonte oficial ou o fallback residencial configurado no painel admin.";
  }
  if (/captcha|verificacao|verificação|seguranca|segurança|suspicious|account-verification/i.test(text)) {
    return "O Mercado Livre pediu verificação de segurança para a leitura automática.";
  }
  return text.length > 220 ? `${text.slice(0, 220)}...` : text;
}

function realOnlySearchEnabled() {
  const externalProviderEnabled = isScrapeDoConfigured() || (isZyteConfigured() && isZyteSearchEnabled());
  const scraperFallback = externalProviderEnabled ? "false" : "true";
  const scraperEnabled = (process.env.MELI_SCRAPER_ENABLED || getSetting("meli_scraper_enabled") || scraperFallback) !== "false";
  return scraperEnabled
    || getSetting("proxy_enabled") === "true"
    || isScrapeDoConfigured()
    || (isZyteConfigured() && isZyteSearchEnabled());
}

function enforceZytePrimarySettings() {
  setSetting("zyte_search_enabled", "true");
  setSetting("zyte_mode", "browser_html");
  setSetting("zyte_endpoint", "https://api.zyte.com/v1/extract");
  setSetting("zyte_search_pages", "4");
  setSetting("zyte_detail_limit", "60");
  setSetting("meli_scraper_enabled", "false");
  setSetting("proxy_enabled", "false");
  setSetting("proxy_url", "");
  setSetting("min_champion_sales", "1000");
  setSetting("market_cache_ttl_days", "7");
  setSetting("zyte_last_error", "");
}

async function handleAdmin(req, res, url, currentUser) {
  const method = req.method || "GET";
  const path = url.pathname.replace("/api/admin/", "");

  if (path === "search-provider/configure" && method === "POST") {
    if (!canManageIntegrations(currentUser)) {
      return json(res, 403, { error: "Somente administradores autorizados podem escolher o motor de busca." });
    }

    const body = await readJson(req);
    const mode = normalizeSearchProviderMode(body.mode);
    setSetting("market_search_provider", mode);
    return json(res, 200, {
      ok: true,
      mode,
      message: mode === "meli_only"
        ? "Motor salvo: somente Mercado Livre. A Scrape.do não será consumida."
        : mode === "scrapedo_only"
          ? "Motor salvo: somente Scrape.do."
          : "Motor automático salvo: Mercado Livre primeiro e Scrape.do apenas em emergência.",
    });
  }

  if (path === "meli/configure" && method === "POST") {
    if (!canManageIntegrations(currentUser)) {
      return json(res, 403, { error: "Somente administradores autorizados podem configurar o Mercado Livre." });
    }

    const body = await readJson(req);
    const clientId = String(body.clientId || "").trim();
    const suppliedSecret = String(body.clientSecret || "").trim();
    const currentClientId = getSetting("meli_client_id");
    const currentSecret = getSetting("meli_client_secret") || process.env.MELI_CLIENT_SECRET || "";

    if (!isValidMeliClientId(clientId)) {
      return json(res, 400, { error: "Informe o Client ID numérico exibido no DevCenter do Mercado Livre." });
    }
    if (clientId !== currentClientId && !suppliedSecret) {
      return json(res, 400, { error: "Informe também a Secret Key da nova aplicação." });
    }

    const clientSecret = suppliedSecret || currentSecret;
    if (!clientSecret) {
      return json(res, 400, { error: "Informe a Secret Key exibida no DevCenter do Mercado Livre." });
    }

    const credentialsChanged = clientId !== currentClientId || (suppliedSecret && suppliedSecret !== currentSecret);
    if (credentialsChanged) {
      disconnectMeliOAuth();
    }

    const redirectUri = resolveMeliRedirectUri();
    setSetting("meli_client_id", clientId);
    setSetting("meli_client_secret", clientSecret);
    setSetting("meli_credentials_managed_in_panel", "true");
    setSetting("meli_site_id", "MLB");
    setSetting("meli_redirect_uri", redirectUri);
    setSetting("meli_last_error", "");

    return json(res, 200, {
      ok: true,
      redirectUri,
      message: "Credenciais salvas. Autorize agora a conta principal do Mercado Livre.",
    });
  }

  if (path === "meli/connect" && method === "GET") {
    if (!canManageIntegrations(currentUser)) {
      return json(res, 403, { error: "Somente administradores autorizados podem conectar o Mercado Livre." });
    }

    const clientId = getSetting("meli_client_id") || process.env.MELI_CLIENT_ID;
    if (!clientId || !isValidMeliClientId(clientId) || !(getSetting("meli_client_secret") || process.env.MELI_CLIENT_SECRET)) {
      return json(res, 400, { error: "Configure o App ID numérico e a Secret Key do Mercado Livre antes de conectar." });
    }

    const state = randomToken();
    const { codeVerifier, codeChallenge } = createMeliPkcePair();
    const redirectUri = oauthRedirectUriForRequest(url);
    const stateHash = hashToken(state);
    setSetting("meli_oauth_state_hash", stateHash);
    setSetting("meli_oauth_state_user_id", currentUser.id);
    setSetting("meli_oauth_state_created_at", new Date().toISOString());
    setSetting("meli_oauth_code_verifier", codeVerifier);
    rememberMeliOAuthState(stateHash, currentUser.id, codeVerifier);
    setSetting("meli_redirect_uri", redirectUri);
    setSetting("meli_last_error", "");

    const authorizationUrl = buildMeliAuthorizationUrl({ state, redirectUri, codeChallenge });
    if (!authorizationUrl) {
      return json(res, 400, { error: "Configure App ID, Secret Key e Redirect URI antes de conectar." });
    }

    return redirect(res, authorizationUrl);
  }

  if (path === "meli/disconnect" && method === "POST") {
    if (!canManageIntegrations(currentUser)) {
      return json(res, 403, { error: "Somente administradores autorizados podem desconectar o Mercado Livre." });
    }

    disconnectMeliOAuth();
    return json(res, 200, safeSettings(currentUser));
  }

  if (path === "meli/catalog-test" && method === "POST") {
    if (!canManageIntegrations(currentUser)) {
      return json(res, 403, { error: "Somente administradores autorizados podem testar o catálogo oficial." });
    }
    try {
      const result = await testMercadoLivreCatalog("creatina 1kg");
      if (!result.ok) {
        setSetting("meli_last_error", result.message || "O catálogo oficial não completou o teste.");
        return json(res, 422, { ok: false, error: result.message, result });
      }
      setSetting("meli_last_error", "");
      return json(res, 200, {
        ok: true,
        result,
        message: `Catálogo oficial conectado: ${result.items.length} campeões reais encontrados.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao testar o catálogo oficial.";
      setSetting("meli_last_error", message);
      return json(res, 400, { ok: false, error: message });
    }
  }

  if (path === "meli/test" && method === "POST") {
    if (!canManageIntegrations(currentUser)) {
      return json(res, 403, { error: "Somente administradores autorizados podem validar o Mercado Livre." });
    }
    try {
      const result = await diagnoseMercadoLivreIntegration();
      return json(res, 200, {
        ...result,
        message: result.summary,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao validar o Mercado Livre.";
      setSetting("meli_last_error", message);
      return json(res, 400, { ok: false, error: message });
    }
  }

  if (path === "oxylabs/test" && method === "POST") {
    try {
      const result = await testOxylabsConnection();
      setSetting("oxylabs_last_error", "");
      return json(res, 200, { ...result, message: "Oxylabs conectado com sucesso." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao testar Oxylabs.";
      setSetting("oxylabs_last_error", message);
      return json(res, 400, { ok: false, error: message });
    }
  }

  if (path === "zyte/test" && method === "POST") {
    try {
      const result = await testZyteConnection();
      setSetting("zyte_last_error", "");
      return json(res, 200, { ...result, message: "Zyte conectada com sucesso." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao testar Zyte.";
      setSetting("zyte_last_error", message);
      return json(res, 400, { ok: false, error: message });
    }
  }

  if (path === "scrapedo/test" && method === "POST") {
    try {
      const result = await testScrapeDoConnection();
      rememberScrapeDoAccountStatus(result);
      const message = result.available === false
        ? "Token válido, mas a conta Scrape.do está sem créditos. Contrate ou renove o plano para liberar pesquisas de produtos novos."
        : "Scrape.do conectada com sucesso.";
      setSetting("scrapedo_last_error", result.available === false ? message : "");
      setSetting("scrapedo_verified", "true");
      return json(res, 200, { ...result, message });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao testar Scrape.do.";
      setSetting("scrapedo_last_error", message);
      setSetting("scrapedo_verified", "false");
      return json(res, 400, { ok: false, error: message });
    }
  }

  if (path === "scrapedo/configure" && method === "POST") {
    const body = await readJson(req);
    const suppliedToken = normalizeScrapeDoToken(body.token);
    const existingToken = getSetting("scrapedo_api_token") || process.env.SCRAPEDO_API_TOKEN || "";
    if (!suppliedToken && !existingToken) {
      return json(res, 400, { error: "Cole o token da Scrape.do antes de salvar." });
    }

    if (suppliedToken) {
      setSetting("scrapedo_api_token", suppliedToken);
      setSetting("scrapedo_verified", "false");
    }
    setSetting("scrapedo_enabled", "true");
    setSetting("scrapedo_endpoint", "https://api.scrape.do/");
    setSetting("scrapedo_search_pages", "4");
    setSetting("scrapedo_detail_limit", "36");
    setSetting("scrapedo_timeout_ms", "45000");
    const requestedCacheTtl = Number(body.cacheTtlDays || getSetting("market_cache_ttl_days") || 7);
    const cacheTtlDays = Number.isFinite(requestedCacheTtl)
      ? Math.min(30, Math.max(1, requestedCacheTtl))
      : 7;
    setSetting("market_cache_ttl_days", String(cacheTtlDays));
    setSetting("market_cache_stale_days", "30");
    setSetting("market_item_cache_ttl_days", String(cacheTtlDays));
    setSetting("zyte_search_enabled", "false");
    setSetting("meli_scraper_enabled", "false");
    setSetting("proxy_enabled", "false");
    setSetting("oxylabs_enabled", "false");

    try {
      const result = await testScrapeDoConnection();
      rememberScrapeDoAccountStatus(result);
      const message = result.available === false
        ? "Token salvo, mas a conta Scrape.do está sem créditos. Contrate ou renove o plano para liberar pesquisas de produtos novos."
        : "Token salvo e Scrape.do validada com sucesso.";
      setSetting("scrapedo_last_error", result.available === false ? message : "");
      setSetting("scrapedo_verified", "true");
      return json(res, 200, {
        ...result,
        saved: true,
        configured: true,
        message,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Falha ao validar Scrape.do.";
      const message = `Token salvo, mas o teste falhou: ${detail}`;
      setSetting("scrapedo_last_error", detail);
      setSetting("scrapedo_verified", "false");
      return json(res, 200, { ok: false, saved: true, configured: true, error: message });
    }
  }

  if (path === "proxy/test" && method === "POST") {
    try {
      const result = await testProxyConnection();
      setSetting("proxy_last_error", "");
      return json(res, 200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao testar proxy.";
      setSetting("proxy_last_error", message);
      return json(res, 400, { ok: false, error: message });
    }
  }

  if (path === "asaas/test" && method === "POST") {
    try {
      const result = await testAsaasConnection();
      setSetting("asaas_last_error", "");
      return json(res, 200, { ...result, message: "Asaas conectada com sucesso." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao testar Asaas.";
      setSetting("asaas_last_error", message);
      return json(res, 400, { ok: false, error: message });
    }
  }

  if (path === "asaas/configure" && method === "POST") {
    const body = await readJson(req);
    const suppliedKey = String(body.apiKey || "").trim();
    const existingKey = getSetting("asaas_api_key") || process.env.ASAAS_API_KEY || "";
    try {
      const environment = suppliedKey
        ? configureAsaasApiKey(suppliedKey)
        : getSetting("asaas_environment") || "sandbox";
      if (!suppliedKey && !existingKey) {
        return json(res, 400, { error: "Cole a API Key da Asaas antes de salvar." });
      }
      const result = await setupAsaasIntegration({
        email: currentUser.email,
        publicUrl: process.env.PUBLIC_URL || getSetting("frontend_origin"),
      });
      return json(res, 200, {
        ...result,
        environment,
        message: environment === "production"
          ? "Asaas Produção validado e webhook oficial preparado."
          : "Asaas Sandbox validado e webhook de testes preparado.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao preparar a integração Asaas.";
      setSetting("asaas_webhook_ready", "false");
      setSetting("asaas_last_error", message);
      return json(res, 400, { ok: false, error: message });
    }
  }

  if (path === "asaas/setup" && method === "POST") {
    try {
      const result = await setupAsaasIntegration({
        email: currentUser.email,
        publicUrl: process.env.PUBLIC_URL || getSetting("frontend_origin"),
      });
      return json(res, 200, {
        ...result,
        message: result.environment === "production"
          ? "Asaas Produção e webhook oficial validados."
          : "Asaas Sandbox e webhook de testes validados.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao preparar a integração Asaas.";
      setSetting("asaas_webhook_ready", "false");
      setSetting("asaas_last_error", message);
      return json(res, 400, { ok: false, error: message });
    }
  }

  if (path === "summary" && method === "GET") {
    const users = db.prepare("SELECT COUNT(*) AS total FROM users").get().total;
    const searches = db.prepare("SELECT COUNT(*) AS total FROM search_history").get().total;
    const revenue = db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM finance_records WHERE status = 'paid'").get().total;
    const tickets = db.prepare("SELECT COUNT(*) AS total FROM support_tickets WHERE status != 'closed'").get().total;
    return json(res, 200, { users, searches, revenue, tickets });
  }

  if (path === "search-cache" && method === "GET") {
    const filter = String(url.searchParams.get("q") || "").trim();
    const where = filter ? "WHERE query LIKE ?" : "";
    const params = filter ? [`%${filter}%`] : [];
    const ttlDays = Math.max(1, Number(getSetting("market_cache_ttl_days") || 7));
    const staleDays = Math.max(ttlDays, Number(getSetting("market_cache_stale_days") || 30));
    const cacheRows = db.prepare(`
      SELECT *
      FROM market_search_cache
      ${where}
      ORDER BY updated_at DESC
    `).all(...params);
    const historyRows = db.prepare("SELECT user_id, query FROM search_history").all();
    const usageByKey = new Map();

    for (const history of historyRows) {
      const key = marketCacheKey(history.query);
      const current = usageByKey.get(key) || { count: 0, users: new Set() };
      current.count += 1;
      current.users.add(Number(history.user_id));
      usageByKey.set(key, current);
    }

    let fresh = 0;
    let stale = 0;
    let expired = 0;
    let estimatedCreditsSaved = 0;
    const records = cacheRows.map((row) => {
      const result = parseSearchPayload(row.payload) || {};
      const updatedAt = Date.parse(`${String(row.updated_at).replace(" ", "T")}Z`);
      const ageDays = Number.isFinite(updatedAt) ? Math.max(0, (Date.now() - updatedAt) / 86_400_000) : staleDays + 1;
      const status = ageDays <= ttlDays ? "fresh" : ageDays <= staleDays ? "stale" : "expired";
      if (status === "fresh") {
        fresh += 1;
      } else if (status === "stale") {
        stale += 1;
      } else {
        expired += 1;
      }

      const usage = usageByKey.get(row.key) || { count: 0, users: new Set() };
      const providerCreditsUsed = Math.max(0, Number(result.providerCreditsUsed || result.creditsUsed || 0));
      estimatedCreditsSaved += Math.max(0, usage.count - 1) * providerCreditsUsed;

      return {
        key: row.key,
        query: row.query,
        source: row.source,
        total_demand: Number(row.total_demand || result.totals?.demand || 0),
        total_revenue: Number(row.total_revenue || result.totals?.revenue || 0),
        items_count: Array.isArray(result.items) ? result.items.length : 0,
        usage_count: usage.count,
        users_count: usage.users.size,
        provider_credits_used: providerCreditsUsed,
        created_at: row.created_at,
        updated_at: row.updated_at,
        age_days: Number(ageDays.toFixed(2)),
        status,
        items: Array.isArray(result.items) ? result.items.slice(0, 3) : [],
      };
    });
    const itemCache = db.prepare("SELECT COUNT(*) AS total FROM market_item_cache").get().total || 0;
    const historyUses = [...usageByKey.values()].reduce((total, usage) => total + Math.max(0, usage.count - 1), 0);

    return json(res, 200, {
      summary: {
        total: records.length,
        fresh,
        stale,
        expired,
        itemCache,
        historyUses,
        estimatedCreditsSaved,
      },
      ttlDays,
      staleDays,
      records,
    });
  }

  if (path === "search-cache/refresh" && method === "POST") {
    const body = await readJson(req);
    const key = required(body.key);
    const row = db.prepare("SELECT key, query FROM market_search_cache WHERE key = ?").get(key);
    if (!row) {
      return json(res, 404, { error: "Pesquisa não encontrada na base interna." });
    }

    const refreshed = enforceChampionThreshold(
      row.query,
      await searchWithResponseGuard(row.query, { forceRefresh: true }),
    );
    if (!isBillableSearchResult(refreshed)) {
      return json(res, 422, {
        error: refreshed?.message || "A fonte não retornou três anúncios completos. O resultado anterior foi preservado.",
      });
    }

    saveMarketSearchCache(row.query, refreshed);
    return json(res, 200, {
      ok: true,
      message: `Pesquisa "${row.query}" atualizada com dados reais.`,
    });
  }

  if (path === "search-cache" && method === "DELETE") {
    const body = await readJson(req);
    const key = required(body.key);
    const row = db.prepare("SELECT key, query FROM market_search_cache WHERE key = ?").get(key);
    if (!row) {
      return json(res, 404, { error: "Pesquisa não encontrada na base interna." });
    }

    const matchingHistoryIds = db.prepare("SELECT id, query FROM search_history").all()
      .filter((history) => marketCacheKey(history.query) === key)
      .map((history) => Number(history.id));
    const removeHistory = db.prepare("DELETE FROM search_history WHERE id = ?");
    for (const id of matchingHistoryIds) {
      removeHistory.run(id);
    }
    db.prepare("DELETE FROM market_search_cache WHERE key = ?").run(key);

    return json(res, 200, {
      ok: true,
      removedHistoryRecords: matchingHistoryIds.length,
    });
  }

  if (path === "users" && method === "GET") {
    return json(res, 200, db.prepare(`
      SELECT id, name, email, phone, role, status, plan, search_limit, searches_used,
             billing_status, billing_cycle, billing_payment_url, billing_access_until, created_at
      FROM users
      ORDER BY id DESC
    `).all());
  }

  if (path === "users" && method === "POST") {
    const body = await readJson(req);
    const plan = body.plan || "free";
    const name = required(body.name).slice(0, 100);
    const email = normalizeEmail(required(body.email));
    const phone = normalizePhone(required(body.phone));
    const password = required(body.password);
    if (!isValidEmail(email)) {
      return json(res, 400, { error: "Informe um e-mail válido." });
    }
    if (phone.length < 10 || phone.length > 13) {
      return json(res, 400, { error: "Informe um telefone válido com DDD." });
    }
    const passwordError = validateNewPassword(password);
    if (passwordError) {
      return json(res, 400, { error: passwordError });
    }
    if (findUserByEmail(email)) {
      return json(res, 409, { error: "Esse e-mail já está cadastrado." });
    }
    const searchLimit = plan === "scale" ? null : nullableNumber(body.search_limit ?? (plan === "starter" ? 10 : 1));
    const role = isCreator(currentUser) && (body.role === "admin" || email.toLowerCase() === CREATOR_EMAIL) ? "admin" : "user";
    const billingStatus = ["starter", "scale"].includes(plan) ? "active" : "none";
    const result = db.prepare(`
      INSERT INTO users (name, email, phone, password_hash, role, status, plan, search_limit, billing_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      name,
      email,
      phone,
      hashPassword(password),
      role,
      body.status || "active",
      plan,
      searchLimit,
      billingStatus,
    );
    return json(res, 201, db.prepare(`
      SELECT id, name, email, phone, role, status, plan, search_limit, searches_used,
             billing_status, billing_cycle, billing_payment_url, billing_access_until, created_at
      FROM users
      WHERE id = ?
    `).get(result.lastInsertRowid));
  }

  const userMatch = path.match(/^users\/(\d+)$/);
  if (userMatch && method === "PATCH") {
    const body = await readJson(req);
    const target = db.prepare("SELECT id, email, role FROM users WHERE id = ?").get(Number(userMatch[1]));
    if (!target) {
      return json(res, 404, { error: "Usuário não encontrado." });
    }
    const newPassword = String(body.new_password || "");
    if (newPassword) {
      const passwordError = validateNewPassword(newPassword);
      if (passwordError) {
        return json(res, 400, { error: passwordError });
      }
    }
    const role = target.email.toLowerCase() === CREATOR_EMAIL
      ? "admin"
      : isCreator(currentUser) && (body.role === "admin" || body.role === "user")
        ? body.role
        : target.role;
    db.prepare(`
      UPDATE users
      SET name = ?,
          phone = ?,
          status = ?,
          plan = ?,
          search_limit = ?,
          role = ?,
          billing_status = CASE WHEN ? IN ('starter', 'scale') THEN 'active' ELSE 'none' END,
          billing_cycle = CASE WHEN ? IN ('starter', 'scale') THEN COALESCE(billing_cycle, 'monthly') ELSE NULL END,
          billing_provider_subscription_id = CASE WHEN ? IN ('starter', 'scale') THEN billing_provider_subscription_id ELSE NULL END,
          billing_payment_url = CASE WHEN ? IN ('starter', 'scale') THEN billing_payment_url ELSE NULL END,
          billing_access_until = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      body.name,
      String(body.phone || "").trim(),
      body.status,
      body.plan,
      nullableNumber(body.search_limit),
      role,
      body.plan,
      body.plan,
      body.plan,
      body.plan,
      Number(userMatch[1]),
    );
    if (newPassword) {
      db.prepare(`
        UPDATE users
        SET password_hash = ?, password_changed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(hashPassword(newPassword), Number(userMatch[1]));
      deleteSessionsForUser(Number(userMatch[1]));
    }
    return json(res, 200, { ok: true });
  }

  if (userMatch && method === "DELETE") {
    const targetId = Number(userMatch[1]);
    const target = db.prepare("SELECT id, email, role FROM users WHERE id = ?").get(targetId);
    if (!target) {
      return json(res, 404, { error: "Usuário não encontrado." });
    }
    if (target.id === currentUser.id) {
      return json(res, 403, { error: "Você não pode excluir sua própria conta." });
    }
    if (target.email.toLowerCase() === CREATOR_EMAIL) {
      return json(res, 403, { error: "A conta criadora não pode ser excluída." });
    }
    if (target.role === "admin" && !isCreator(currentUser)) {
      return json(res, 403, { error: "Somente o criador pode excluir outro administrador." });
    }

    db.prepare("DELETE FROM users WHERE id = ?").run(targetId);
    return json(res, 200, { ok: true });
  }

  if (path === "settings" && method === "GET") {
    return json(res, 200, safeSettings({ role: "admin" }));
  }

  if (path === "settings" && method === "PATCH") {
    const body = await readJson(req);
    if (Object.keys(body).some((key) => key.startsWith("meli_"))) {
      try {
        validateMeliSettingsInput(body);
      } catch (error) {
        return json(res, 400, { error: error instanceof Error ? error.message : "Configuração inválida." });
      }
    }
    const keepWhenBlank = new Set(["meli_access_token", "meli_refresh_token", "meli_client_secret", "oxylabs_password", "proxy_password", "zyte_api_key", "scrapedo_api_token", "asaas_api_key", "asaas_webhook_token"]);
    for (const [key, value] of Object.entries(body)) {
      if (keepWhenBlank.has(key) && !String(value || "").trim() && getSetting(key)) {
        continue;
      }
      setSetting(key, normalizeSettingValue(key, value));
    }
    if (
      ["true", "1", "yes", "sim"].includes(String(body.zyte_search_enabled || "").trim().toLowerCase())
      && (String(body.zyte_api_key || "").trim() || getSetting("zyte_api_key") || process.env.ZYTE_API_KEY)
    ) {
      enforceZytePrimarySettings();
    }
    if (Object.keys(body).some((key) => key.startsWith("meli_"))) {
      setSetting("meli_last_error", "");
    }
    if (Object.keys(body).some((key) => key.startsWith("oxylabs_"))) {
      setSetting("oxylabs_last_error", "");
    }
    if (Object.keys(body).some((key) => key.startsWith("zyte_"))) {
      setSetting("zyte_last_error", "");
    }
    if (Object.keys(body).some((key) => key.startsWith("proxy_"))) {
      setSetting("proxy_last_error", "");
    }
    if (Object.keys(body).some((key) => key.startsWith("asaas_"))) {
      setSetting("asaas_last_error", "");
    }
    return json(res, 200, safeSettings({ role: "admin" }));
  }

  if (path === "tips" && method === "GET") {
    return json(res, 200, db.prepare("SELECT * FROM tips ORDER BY id DESC").all());
  }

  if (path === "tips" && method === "POST") {
    const body = await readJson(req);
    const result = db.prepare("INSERT INTO tips (title, body, cta, status) VALUES (?, ?, ?, ?)").run(
      required(body.title),
      required(body.body),
      body.cta || "Ler agora",
      body.status || "published",
    );
    return json(res, 201, db.prepare("SELECT * FROM tips WHERE id = ?").get(result.lastInsertRowid));
  }

  const tipMatch = path.match(/^tips\/(\d+)$/);
  if (tipMatch && method === "PATCH") {
    const body = await readJson(req);
    db.prepare("UPDATE tips SET title = ?, body = ?, cta = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(
      body.title,
      body.body,
      body.cta,
      body.status,
      Number(tipMatch[1]),
    );
    return json(res, 200, { ok: true });
  }

  if (path === "support" && method === "GET") {
    return json(res, 200, db.prepare(`
      SELECT t.*, u.email AS user_email FROM support_tickets t
      LEFT JOIN users u ON u.id = t.user_id
      ORDER BY t.id DESC
    `).all());
  }

  const ticketMatch = path.match(/^support\/(\d+)$/);
  if (ticketMatch && method === "PATCH") {
    const body = await readJson(req);
    const ticketId = Number(ticketMatch[1]);
    const ticket = db.prepare("SELECT id FROM support_tickets WHERE id = ?").get(ticketId);
    if (!ticket) {
      return json(res, 404, { error: "Chamado não encontrado." });
    }
    const status = oneOf(body.status, ["open", "waiting", "closed"], "Status inválido.");
    const priority = oneOf(body.priority, ["low", "normal", "high"], "Prioridade inválida.");
    const response = String(body.response || "").trim().slice(0, 3000) || null;
    db.prepare("UPDATE support_tickets SET status = ?, priority = ?, response = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(
      status,
      priority,
      response,
      ticketId,
    );
    return json(res, 200, { ok: true });
  }

  if (path === "finance" && method === "GET") {
    return json(res, 200, db.prepare(`
      SELECT f.*, u.email AS user_email FROM finance_records f
      LEFT JOIN users u ON u.id = f.user_id
      ORDER BY f.id DESC
    `).all());
  }

  if (path === "finance" && method === "POST") {
    const body = await readJson(req);
    const result = db.prepare(`
      INSERT INTO finance_records (user_id, type, description, amount, status, due_date, paid_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(nullableNumber(body.user_id), required(body.type), required(body.description), Number(body.amount), body.status || "pending", body.due_date || null, body.paid_at || null);
    return json(res, 201, db.prepare("SELECT * FROM finance_records WHERE id = ?").get(result.lastInsertRowid));
  }

  if (path === "finance" && method === "DELETE") {
    const body = await readJson(req);
    const ids = [...new Set(
      (Array.isArray(body.ids) ? body.ids : [])
        .map(Number)
        .filter((id) => Number.isInteger(id) && id > 0),
    )];
    if (!ids.length) {
      return json(res, 400, { error: "Selecione pelo menos um registro financeiro." });
    }

    const placeholders = ids.map(() => "?").join(", ");
    const result = db.prepare(`DELETE FROM finance_records WHERE id IN (${placeholders})`).run(...ids);
    return json(res, 200, { ok: true, deleted: result.changes });
  }

  const financeMatch = path.match(/^finance\/(\d+)$/);
  if (financeMatch && method === "PATCH") {
    const body = await readJson(req);
    db.prepare(`
      UPDATE finance_records SET type = ?, description = ?, amount = ?, status = ?, due_date = ?, paid_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(body.type, body.description, Number(body.amount), body.status, body.due_date || null, body.paid_at || null, Number(financeMatch[1]));
    return json(res, 200, { ok: true });
  }

  if (financeMatch && method === "DELETE") {
    const financeId = Number(financeMatch[1]);
    const record = db.prepare("SELECT id FROM finance_records WHERE id = ?").get(financeId);
    if (!record) {
      return json(res, 404, { error: "Registro financeiro não encontrado." });
    }

    db.prepare("DELETE FROM finance_records WHERE id = ?").run(financeId);
    return json(res, 200, { ok: true });
  }

  if (path === "commercial-contacts" && method === "GET") {
    return json(res, 200, db.prepare("SELECT * FROM commercial_contacts ORDER BY is_primary DESC, id DESC").all());
  }

  if (path === "commercial-contacts" && method === "POST") {
    const body = await readJson(req);
    const result = db.prepare("INSERT INTO commercial_contacts (name, channel, value, is_primary, status) VALUES (?, ?, ?, ?, ?)").run(
      required(body.name),
      required(body.channel),
      required(body.value),
      boolValue(body.is_primary) ? 1 : 0,
      body.status || "active",
    );
    return json(res, 201, db.prepare("SELECT * FROM commercial_contacts WHERE id = ?").get(result.lastInsertRowid));
  }

  const contactMatch = path.match(/^commercial-contacts\/(\d+)$/);
  if (contactMatch && method === "PATCH") {
    const body = await readJson(req);
    db.prepare("UPDATE commercial_contacts SET name = ?, channel = ?, value = ?, is_primary = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(
      body.name,
      body.channel,
      body.value,
      boolValue(body.is_primary) ? 1 : 0,
      body.status || "active",
      Number(contactMatch[1]),
    );
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: "Rota admin não encontrada." });
}

function rememberScrapeDoAccountStatus(result) {
  const remainingCredits = result?.remainingCredits;
  if (remainingCredits !== null && remainingCredits !== undefined && Number.isFinite(Number(remainingCredits))) {
    setSetting("scrapedo_provider_remaining_credits", String(Math.max(0, Number(remainingCredits))));
  }
  setSetting("scrapedo_provider_checked_at", new Date().toISOString());
}

function safeSettings(user) {
  const settings = settingsObject();
  if (!canUseAdmin(user)) {
    return publicSettings(settings);
  } else if (settings.meli_access_token) {
    settings.meli_access_token_configured = "true";
    settings.meli_access_token = "";
  }
  if (canUseAdmin(user)) {
    settings.asaas_enabled = settings.asaas_enabled || process.env.ASAAS_ENABLED || "false";
    settings.asaas_environment = settings.asaas_environment || process.env.ASAAS_ENVIRONMENT || "sandbox";
    settings.asaas_endpoint = settings.asaas_endpoint || process.env.ASAAS_ENDPOINT || (settings.asaas_environment === "production" ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3");
    settings.asaas_api_key_configured = settings.asaas_api_key || process.env.ASAAS_API_KEY ? "true" : "";
    settings.asaas_webhook_token_configured = settings.asaas_webhook_token || process.env.ASAAS_WEBHOOK_TOKEN ? "true" : "";
    settings.asaas_connected = settings.asaas_api_key_configured ? "true" : "";
    settings.asaas_webhook_url = asaasWebhookUrl(process.env.PUBLIC_URL || settings.frontend_origin);
    settings.asaas_api_key = "";
    settings.asaas_webhook_token = "";
    settings.zyte_endpoint = settings.zyte_endpoint || process.env.ZYTE_ENDPOINT || "https://api.zyte.com/v1/extract";
    settings.zyte_mode = settings.zyte_mode || process.env.ZYTE_MODE || "browser_html";
    settings.zyte_search_enabled = settings.zyte_search_enabled || process.env.ZYTE_SEARCH_ENABLED || "false";
    settings.zyte_search_pages = settings.zyte_search_pages || process.env.ZYTE_SEARCH_PAGES || "4";
    settings.zyte_detail_limit = settings.zyte_detail_limit || process.env.ZYTE_DETAIL_LIMIT || "60";
    settings.zyte_ip_type = settings.zyte_ip_type || process.env.ZYTE_IP_TYPE || "auto";
    settings.zyte_geolocation = settings.zyte_geolocation || process.env.ZYTE_GEOLOCATION || "BR";
    settings.zyte_api_key_configured = settings.zyte_api_key || process.env.ZYTE_API_KEY ? "true" : "";
    settings.zyte_connected = settings.zyte_api_key_configured ? "true" : "";
    settings.zyte_api_key = "";
    settings.scrapedo_enabled = settings.scrapedo_enabled || process.env.SCRAPEDO_ENABLED || "true";
    settings.scrapedo_endpoint = settings.scrapedo_endpoint || process.env.SCRAPEDO_ENDPOINT || "https://api.scrape.do/";
    settings.scrapedo_search_pages = settings.scrapedo_search_pages || process.env.SCRAPEDO_SEARCH_PAGES || "4";
    settings.scrapedo_detail_limit = settings.scrapedo_detail_limit || process.env.SCRAPEDO_DETAIL_LIMIT || "36";
    settings.scrapedo_timeout_ms = settings.scrapedo_timeout_ms || process.env.SCRAPEDO_TIMEOUT_MS || "45000";
    settings.scrapedo_api_token_configured = settings.scrapedo_api_token || process.env.SCRAPEDO_API_TOKEN ? "true" : "";
    settings.scrapedo_connected = isScrapeDoConfigured() && settings.scrapedo_verified === "true" ? "true" : "";
    settings.scrapedo_available = settings.scrapedo_connected
      && settings.scrapedo_provider_remaining_credits !== "0"
      ? "true"
      : "";
    settings.scrapedo_api_token = "";
    settings.proxy_enabled = settings.proxy_enabled || process.env.PROXY_ENABLED || "false";
    settings.proxy_url = settings.proxy_url || process.env.PROXY_URL || "";
    settings.proxy_username = settings.proxy_username || process.env.PROXY_USERNAME || "";
    settings.proxy_country = settings.proxy_country || process.env.PROXY_COUNTRY || "Brazil";
    settings.proxy_timeout_ms = settings.proxy_timeout_ms || process.env.PROXY_TIMEOUT_MS || "30000";
    settings.min_champion_sales = settings.min_champion_sales || process.env.MIN_CHAMPION_SALES || "1000";
    settings.market_cache_ttl_days = settings.market_cache_ttl_days || process.env.MARKET_CACHE_TTL_DAYS || "7";
    settings.market_cache_stale_days = settings.market_cache_stale_days || process.env.MARKET_CACHE_STALE_DAYS || "30";
    settings.market_item_cache_ttl_days = settings.market_cache_ttl_days;
    settings.market_search_provider = normalizeSearchProviderMode(
      settings.market_search_provider || process.env.MARKET_SEARCH_PROVIDER || "auto",
    );
    settings.market_cache_entries = String(db.prepare("SELECT COUNT(*) AS total FROM market_search_cache").get().total || 0);
    settings.market_item_cache_entries = String(db.prepare("SELECT COUNT(*) AS total FROM market_item_cache").get().total || 0);
    const scrapeDoUsage = scrapeDoUsageSummary();
    settings.scrapedo_monthly_credits_used = String(scrapeDoUsage.used);
    settings.scrapedo_monthly_credit_budget = String(scrapeDoUsage.budget);
    settings.scrapedo_monthly_credits_remaining = scrapeDoUsage.remaining === null ? "" : String(scrapeDoUsage.remaining);
    settings.scrapedo_provider_searches = String(scrapeDoUsage.searches);
    settings.scrapedo_provider_failures = String(scrapeDoUsage.failures);
    settings.scrapedo_active_requests = String(scrapeDoUsage.active);
    settings.scrapedo_queued_requests = String(scrapeDoUsage.queued);
    settings.proxy_password_configured = settings.proxy_password || process.env.PROXY_PASSWORD ? "true" : "";
    settings.proxy_connected = settings.proxy_enabled === "true" && settings.proxy_url ? "true" : "";
    settings.proxy_password = "";
    settings.oxylabs_enabled = settings.oxylabs_enabled || process.env.OXYLABS_ENABLED || "false";
    settings.oxylabs_mode = settings.oxylabs_mode || process.env.OXYLABS_MODE || "web_unblocker";
    settings.oxylabs_username = settings.oxylabs_username || process.env.OXYLABS_USERNAME || "";
    settings.oxylabs_endpoint = settings.oxylabs_endpoint || process.env.OXYLABS_ENDPOINT || "https://unblock.oxylabs.io:60000";
    if (settings.oxylabs_mode === "web_unblocker" && settings.oxylabs_endpoint === "https://realtime.oxylabs.io/v1/queries") {
      settings.oxylabs_endpoint = "https://unblock.oxylabs.io:60000";
    }
    if (settings.oxylabs_mode === "web_scraper_api" && settings.oxylabs_endpoint === "https://unblock.oxylabs.io:60000") {
      settings.oxylabs_endpoint = "https://realtime.oxylabs.io/v1/queries";
    }
    settings.oxylabs_geo_location = settings.oxylabs_geo_location || process.env.OXYLABS_GEO_LOCATION || "Brazil";
    settings.oxylabs_password_configured = settings.oxylabs_password || process.env.OXYLABS_PASSWORD ? "true" : "";
    settings.oxylabs_connected = settings.oxylabs_enabled === "true" && settings.oxylabs_username && settings.oxylabs_password_configured ? "true" : "";
    settings.oxylabs_password = "";
    const meliManagedInPanel = settings.meli_credentials_managed_in_panel === "true";
    settings.meli_access_token_configured = settings.meli_access_token || (!meliManagedInPanel && process.env.MELI_ACCESS_TOKEN) ? "true" : "";
    settings.meli_refresh_token_configured = settings.meli_refresh_token || (!meliManagedInPanel && process.env.MELI_REFRESH_TOKEN) ? "true" : "";
    settings.meli_client_secret_configured = settings.meli_client_secret || (!meliManagedInPanel && process.env.MELI_CLIENT_SECRET) ? "true" : "";
    settings.meli_oauth_connected = settings.meli_access_token_configured || settings.meli_refresh_token_configured ? "true" : "";
    settings.meli_scraper_enabled = settings.meli_scraper_enabled || process.env.MELI_SCRAPER_ENABLED || (isZyteConfigured() ? "false" : "true");
    settings.meli_redirect_uri = settings.meli_redirect_uri || resolveMeliRedirectUri();
    settings.meli_access_token = "";
    settings.meli_refresh_token = "";
    settings.meli_client_secret = "";
    delete settings.meli_oauth_state_hash;
    delete settings.meli_oauth_state_user_id;
    delete settings.meli_oauth_state_created_at;
    delete settings.meli_oauth_states;
    delete settings.meli_oauth_code_verifier;
    delete settings.session_secret;
  }
  return settings;
}

function publicBootstrapPayload() {
  return {
    settings: publicSettings(settingsObject()),
    tips: db.prepare("SELECT * FROM tips WHERE status = 'published' ORDER BY id DESC").all(),
    contacts: db.prepare("SELECT * FROM commercial_contacts WHERE status = 'active' ORDER BY is_primary DESC, id DESC").all(),
  };
}

function publicSettings(settings) {
  return Object.fromEntries(Object.entries(settings).filter(([key]) => PUBLIC_SETTING_KEYS.has(key)));
}

function publicSearchResult(result) {
  if (result?.source === "market_estimate") {
    return result;
  }

  if (result?.source === "confweb_cache") {
    const {
      cacheHit,
      cacheStale,
      cachedAt,
      providerCreditsSaved,
      providerCreditsUsed,
      ...marketplaceResult
    } = result;
    return {
      ...marketplaceResult,
      source: "mercado_livre",
      message: "Dados públicos do Mercado Livre.",
    };
  }

  if (!result || result.ok) {
    if (result?.metricsMode === "market_signal" || result?.salesAvailable === false) {
      return {
        ...result,
        message: "Encontramos anúncios reais compatíveis com o produto pesquisado. As métricas completas serão exibidas quando a fonte oficial estiver disponível.",
        items: result.items.map((item) => ({
          ...item,
          salesMetricLabel: item.salesMetricLabel === "Nao divulgado" ? "Em validação" : item.salesMetricLabel,
          revenueMetricLabel: item.revenueMetricLabel === "Aguardando API" ? "Em validação" : item.revenueMetricLabel,
        })),
      };
    }
    return result;
  }

  if (result.source?.startsWith("zyte_") || result.source?.startsWith("scrapedo_")) {
    return {
      ...result,
      source: "market_data_pending",
      metricsMode: "sales",
      salesAvailable: false,
      message: "Não encontramos 3 anúncios com vendas públicas completas para este produto agora. Tente um termo mais específico ou pesquise novamente em instantes.",
    };
  }

  if (result.source === "meli_forbidden" || result.source?.startsWith("mercado_livre_") || result.source?.startsWith("oxylabs_")) {
    return {
      ...result,
      source: "market_data_pending",
      metricsMode: "market_signal",
      salesAvailable: false,
      message: "Ainda não conseguimos validar esse produto com a fonte oficial agora. Nossa equipe está preparando a consulta real para liberar as métricas completas.",
    };
  }

  return result;
}

async function handleMeliCallback(req, res, url) {
  const user = userFromSession(readCookie(req, COOKIE));
  const frontendUrl = new URL(process.env.FRONTEND_ORIGIN || getSetting("frontend_origin") || url.origin);

  if (!user || !canManageIntegrations(user)) {
    frontendUrl.searchParams.set("meli", "unauthorized");
    return redirect(res, frontendUrl.toString());
  }

  if (url.searchParams.get("error")) {
    setSetting("meli_last_error", url.searchParams.get("error_description") || url.searchParams.get("error"));
    frontendUrl.searchParams.set("meli", "error");
    return redirect(res, frontendUrl.toString());
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthState = code && state ? consumeMeliOAuthState(state, user.id) : { valid: false, codeVerifier: "" };

  if (!code || !state || !oauthState.valid) {
    setSetting("meli_last_error", "Estado OAuth inválido. Tente conectar novamente.");
    frontendUrl.searchParams.set("meli", "invalid_state");
    return redirect(res, frontendUrl.toString());
  }

  if (!oauthState.codeVerifier) {
    setSetting("meli_last_error", "Chave PKCE expirada. Clique em Conectar Mercado Livre novamente.");
    frontendUrl.searchParams.set("meli", "error");
    return redirect(res, frontendUrl.toString());
  }

  try {
    await exchangeMeliAuthorizationCode({ code, redirectUri: oauthRedirectUriForRequest(url), codeVerifier: oauthState.codeVerifier });
    setSetting("meli_oauth_state_hash", "");
    setSetting("meli_oauth_state_user_id", "");
    setSetting("meli_oauth_state_created_at", "");
    setSetting("meli_oauth_states", "");
    setSetting("meli_oauth_code_verifier", "");
    frontendUrl.searchParams.set("meli", "connected");
    return redirect(res, frontendUrl.toString());
  } catch (error) {
    setSetting("meli_last_error", error instanceof Error ? error.message : "Falha ao conectar Mercado Livre.");
    frontendUrl.searchParams.set("meli", "error");
    return redirect(res, frontendUrl.toString());
  }
}

function oauthRedirectUriForRequest(url) {
  return process.env.MELI_REDIRECT_URI || getSetting("meli_redirect_uri") || `${url.origin}/api/meli/callback`;
}

function rememberMeliOAuthState(stateHash, userId, codeVerifier) {
  const now = Date.now();
  const states = readMeliOAuthStates()
    .filter((entry) => now - Number(entry.createdAt || 0) <= MELI_OAUTH_STATE_TTL_MS)
    .slice(-8);

  states.push({
    hash: stateHash,
    userId: String(userId),
    createdAt: now,
    codeVerifier,
  });

  setSetting("meli_oauth_states", JSON.stringify(states));
}

function consumeMeliOAuthState(state, userId) {
  const stateHash = hashToken(state);
  const now = Date.now();
  const expectedStateHash = getSetting("meli_oauth_state_hash");
  const expectedUserId = getSetting("meli_oauth_state_user_id");
  let valid = Boolean(
    expectedStateHash &&
    expectedStateHash === stateHash &&
    (!expectedUserId || String(expectedUserId) === String(userId)),
  );
  let codeVerifier = valid ? getSetting("meli_oauth_code_verifier") : "";

  const remainingStates = [];
  for (const entry of readMeliOAuthStates()) {
    const fresh = now - Number(entry.createdAt || 0) <= MELI_OAUTH_STATE_TTL_MS;
    const belongsToUser = !entry.userId || String(entry.userId) === String(userId);
    const matches = fresh && belongsToUser && entry.hash === stateHash;

    if (matches) {
      valid = true;
      codeVerifier = entry.codeVerifier || codeVerifier;
      continue;
    }
    if (fresh) {
      remainingStates.push(entry);
    }
  }

  setSetting("meli_oauth_states", remainingStates.length ? JSON.stringify(remainingStates) : "");
  return { valid, codeVerifier };
}

function readMeliOAuthStates() {
  try {
    const states = JSON.parse(getSetting("meli_oauth_states") || "[]");
    return Array.isArray(states) ? states : [];
  } catch {
    return [];
  }
}

function publicUserWithPermissions(user) {
  return {
    ...publicUser(user),
    can_admin: canUseAdmin(user),
    is_creator: isCreator(user),
  };
}

function canUseAdmin(user) {
  return Boolean(user && (user.role === "admin" || isCreator(user)));
}

function canManageIntegrations(user) {
  return canUseAdmin(user);
}

function isCreator(user) {
  return Boolean(user?.email && user.email.toLowerCase() === CREATOR_EMAIL);
}

function requireUser(req, res) {
  const user = userFromSession(readCookie(req, COOKIE));
  if (!user) {
    json(res, 401, { error: "Login necessário." });
    return null;
  }
  return user;
}

function readCookie(req, name) {
  const cookieHeader = req.headers.cookie || "";
  for (const part of cookieHeader.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) {
      return decodeURIComponent(value.join("="));
    }
  }
  return null;
}

function cookieSuffix(expires) {
  const secure = IS_PRODUCTION ? "; Secure" : "";
  return `; HttpOnly; SameSite=Lax; Path=/; Expires=${new Date(expires).toUTCString()}${secure}`;
}

function setCookie(res, token, expires) {
  res.setHeader("Set-Cookie", `${COOKIE}=${encodeURIComponent(token)}${cookieSuffix(expires)}`);
}

function clearCookie(res) {
  const secure = IS_PRODUCTION ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
}

async function readJson(req, { maxBytes = 64 * 1024 } = {}) {
  const contentLength = Number(req.headers["content-length"] || 0);
  if (contentLength > maxBytes) {
    throw requestError(413, "A requisição ultrapassou o tamanho permitido.");
  }
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  if (contentLength > 0 && !contentType.includes("application/json")) {
    throw requestError(415, "Envie os dados no formato JSON.");
  }

  const chunks = [];
  let receivedBytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    receivedBytes += buffer.length;
    if (receivedBytes > maxBytes) {
      throw requestError(413, "A requisição ultrapassou o tamanho permitido.");
    }
    chunks.push(buffer);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  if (!body) {
    return {};
  }
  try {
    return JSON.parse(body);
  } catch {
    throw requestError(400, "O conteúdo enviado não é um JSON válido.");
  }
}

async function drainRequest(req) {
  for await (const _chunk of req) {
    // Mercado Livre only needs a fast 200 response for webhook delivery checks.
  }
}

function json(res, status, payload) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
  };

  if (!IS_PRODUCTION) {
    const devOrigin = process.env.FRONTEND_ORIGIN || "http://127.0.0.1:5173";
    headers["Access-Control-Allow-Origin"] = devOrigin;
    headers["Access-Control-Allow-Credentials"] = "true";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
    headers["Access-Control-Allow-Methods"] = "GET,POST,PATCH,OPTIONS";
  }

  res.writeHead(status, headers);
  res.end(payload === null ? "" : JSON.stringify(payload));
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function required(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    throw new Error("Campo obrigatório ausente.");
  }
  return text;
}

function oneOf(value, allowed, message) {
  const normalized = String(value ?? "").trim();
  if (!allowed.includes(normalized)) {
    throw new Error(message);
  }
  return normalized;
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  return Number(value);
}

function boolValue(value) {
  return value === true || value === 1 || value === "1" || value === "true" || value === "on";
}

function normalizeSettingValue(key, value) {
  if (key.startsWith("meli_") || key.startsWith("oxylabs_") || key.startsWith("proxy_") || key.startsWith("zyte_") || key.startsWith("scrapedo_") || key.startsWith("asaas_") || key.startsWith("market_") || key === "min_champion_sales" || key === "frontend_origin") {
    return String(value || "").trim();
  }
  return value;
}

function clientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket?.remoteAddress || "127.0.0.1";
}

function limitRequest(req, res, scope, identity, limit, windowMs) {
  return applyRateLimit({
    limiter: rateLimiter,
    req,
    res,
    scope,
    identity: String(identity || clientIp(req)),
    limit,
    windowMs,
  });
}

function hasTrustedRequestOrigin(req) {
  const origin = String(req.headers.origin || "").trim();
  if (!origin) {
    return true;
  }
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const protocol = forwardedProto || (req.socket?.encrypted ? "https" : "http");
  const requestOrigin = req.headers.host ? `${protocol}://${req.headers.host}` : "";
  const allowedOrigins = [
    process.env.PUBLIC_URL,
    process.env.FRONTEND_ORIGIN,
    requestOrigin,
    !IS_PRODUCTION ? "http://127.0.0.1:5173" : "",
    !IS_PRODUCTION ? "http://localhost:5173" : "",
  ]
    .filter(Boolean)
    .map((value) => {
      try {
        return new URL(value).origin;
      } catch {
        return "";
      }
    });
  return allowedOrigins.includes(origin);
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase().slice(0, 254);
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 13);
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(String(value || ""));
}

function booleanValue(value) {
  return value === true || ["true", "1", "on", "yes"].includes(String(value || "").toLowerCase());
}

function validateNewPassword(value) {
  const password = String(value || "");
  if (password.length < 10) {
    return "A senha precisa ter pelo menos 10 caracteres.";
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    return "Use uma senha com letras maiúsculas, minúsculas e pelo menos um número.";
  }
  return "";
}

function requestError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function healthPayload() {
  const database = db.prepare("SELECT 1 AS ok").get()?.ok === 1;
  return {
    ok: database,
    database,
    uptimeSeconds: Math.floor(process.uptime()),
    version: process.env.APP_VERSION || "development",
  };
}

function serveStatic(req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return json(res, 405, { error: "Método não permitido." });
  }

  const pathname = decodeURIComponent(url.pathname);
  const requestedPath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const absolutePath = resolve(DIST_DIR, requestedPath);
  const indexPath = join(DIST_DIR, "index.html");
  const filePath = absolutePath.startsWith(DIST_DIR) && existsSync(absolutePath) && statSync(absolutePath).isFile()
    ? absolutePath
    : indexPath;

  if (!existsSync(filePath)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Build não encontrado. Rode npm run build.");
    return;
  }

  res.writeHead(200, {
    "Content-Type": contentTypeFor(filePath),
    "Cache-Control": filePath === indexPath ? "no-store" : "public, max-age=31536000, immutable",
  });

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  createReadStream(filePath).pipe(res);
}

function contentTypeFor(filePath) {
  const types = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
  };
  return types[extname(filePath)] || "application/octet-stream";
}
