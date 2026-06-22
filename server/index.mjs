import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { db, createSession, deleteSession, findUserByEmail, getSetting, initDatabase, publicUser, setSetting, settingsObject, userFromSession } from "./db.mjs";
import { loadLocalEnv } from "./env.mjs";
import { buildMeliAuthorizationUrl, disconnectMeliOAuth, exchangeMeliAuthorizationCode, getMeliRedirectUri, searchMercadoLivre } from "./meli.mjs";
import { bootstrapAdminFromEnv } from "./bootstrap-admin.mjs";
import { syncMeliSettingsFromEnv, validateMeliSettingsInput, isValidMeliClientId, resolveMeliRedirectUri } from "./meli-config.mjs";
import { hashPassword, hashToken, randomToken, verifyPassword } from "./security.mjs";

loadLocalEnv();
initDatabase();

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || "0.0.0.0";
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const COOKIE = "bv_session";
const CREATOR_EMAIL = (process.env.CREATOR_EMAIL || "alisson.confweb@gmail.com").toLowerCase();
const DIST_DIR = resolve(process.cwd(), "dist");
const MELI_OAUTH_STATE_TTL_MS = 15 * 60 * 1000;

bootstrapAdminFromEnv(db);
syncMeliSettingsFromEnv();
db.prepare("UPDATE users SET role = 'admin', status = 'active', updated_at = CURRENT_TIMESTAMP WHERE lower(email) = ?").run(CREATOR_EMAIL);

const server = createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (error) {
    console.error(error);
    json(res, 500, { error: "Erro interno no servidor." });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Busca Vendas rodando em http://${HOST}:${PORT}`);
});

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
    return json(res, 200, { ok: true });
  }

  if (url.pathname === "/api/meli/notifications" && ["GET", "POST"].includes(method)) {
    await drainRequest(req);
    return json(res, 200, { ok: true });
  }

  if (url.pathname === "/api/auth/login" && method === "POST") {
    const body = await readJson(req);
    const user = findUserByEmail(body.email || "");

    if (!user || !verifyPassword(body.password || "", user.password_hash)) {
      return json(res, 401, { error: "E-mail ou senha inválidos." });
    }

    const session = createSession(user.id);
    setCookie(res, session.token, session.expires);
    return json(res, 200, { user: publicUserWithPermissions(user) });
  }

  if (url.pathname === "/api/auth/register" && method === "POST") {
    const body = await readJson(req);
    const email = required(body.email).toLowerCase();
    const password = required(body.password);
    if (password.length < 6) {
      return json(res, 400, { error: "A senha precisa ter pelo menos 6 caracteres." });
    }
    if (findUserByEmail(email)) {
      return json(res, 409, { error: "Esse e-mail já está cadastrado. Faça login para continuar." });
    }

    const result = db.prepare(`
      INSERT INTO users (name, email, password_hash, role, status, plan, search_limit)
      VALUES (?, ?, ?, 'user', 'active', 'free', 1)
    `).run(required(body.name), email, hashPassword(password));
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

  if (url.pathname === "/api/search" && method === "GET") {
    return handleSearch(req, res, user, url.searchParams.get("q") || "");
  }

  if (url.pathname === "/api/search-history" && method === "GET") {
    return json(res, 200, db.prepare(`
      SELECT id, query, source, total_demand, total_revenue, created_at
      FROM search_history
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT 30
    `).all(user.id));
  }

  if (url.pathname === "/api/support" && method === "GET") {
    return json(res, 200, db.prepare("SELECT * FROM support_tickets WHERE user_id = ? ORDER BY id DESC").all(user.id));
  }

  if (url.pathname === "/api/support" && method === "POST") {
    const body = await readJson(req);
    const result = db.prepare(`
      INSERT INTO support_tickets (user_id, subject, message, priority)
      VALUES (?, ?, ?, ?)
    `).run(user.id, required(body.subject), required(body.message), body.priority || "normal");
    return json(res, 201, db.prepare("SELECT * FROM support_tickets WHERE id = ?").get(result.lastInsertRowid));
  }

  if (url.pathname === "/api/tips" && method === "GET") {
    return json(res, 200, db.prepare("SELECT * FROM tips WHERE status = 'published' ORDER BY id DESC").all());
  }

  if (url.pathname.startsWith("/api/admin/")) {
    if (!canUseAdmin(user)) {
      return json(res, 403, { error: "Acesso restrito ao admin." });
    }
    return handleAdmin(req, res, url, user);
  }

  return json(res, 404, { error: "Rota não encontrada." });
}

async function handleSearch(req, res, user, query) {
  const cleanQuery = query.trim();
  if (!cleanQuery) {
    return json(res, 400, { error: "Informe uma palavra-chave." });
  }

  if (user.role !== "admin" && user.search_limit !== null && user.searches_used >= user.search_limit) {
    return json(res, 402, { error: "Limite de pesquisas atingido. Faça upgrade para continuar." });
  }

  const result = await searchMercadoLivre(cleanQuery);
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

  if (user.role !== "admin" && result.ok) {
    db.prepare("UPDATE users SET searches_used = searches_used + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(user.id);
  }

  return json(res, 200, result);
}

async function handleAdmin(req, res, url, currentUser) {
  const method = req.method || "GET";
  const path = url.pathname.replace("/api/admin/", "");

  if (path === "meli/connect" && method === "GET") {
    if (!isCreator(currentUser)) {
      return json(res, 403, { error: "Somente o criador pode conectar o Mercado Livre." });
    }

    const clientId = process.env.MELI_CLIENT_ID || getSetting("meli_client_id");
    if (!clientId || !isValidMeliClientId(clientId) || !(process.env.MELI_CLIENT_SECRET || getSetting("meli_client_secret"))) {
      return json(res, 400, { error: "Configure o App ID numérico e a Secret Key do Mercado Livre antes de conectar." });
    }

    const state = randomToken();
    const redirectUri = oauthRedirectUriForRequest(url);
    const stateHash = hashToken(state);
    setSetting("meli_oauth_state_hash", stateHash);
    setSetting("meli_oauth_state_user_id", currentUser.id);
    setSetting("meli_oauth_state_created_at", new Date().toISOString());
    rememberMeliOAuthState(stateHash, currentUser.id);
    setSetting("meli_redirect_uri", redirectUri);
    setSetting("meli_last_error", "");

    const authorizationUrl = buildMeliAuthorizationUrl({ state, redirectUri });
    if (!authorizationUrl) {
      return json(res, 400, { error: "Configure App ID, Secret Key e Redirect URI antes de conectar." });
    }

    return redirect(res, authorizationUrl);
  }

  if (path === "meli/disconnect" && method === "POST") {
    if (!isCreator(currentUser)) {
      return json(res, 403, { error: "Somente o criador pode desconectar o Mercado Livre." });
    }

    disconnectMeliOAuth();
    return json(res, 200, safeSettings(currentUser));
  }

  if (path === "summary" && method === "GET") {
    const users = db.prepare("SELECT COUNT(*) AS total FROM users").get().total;
    const searches = db.prepare("SELECT COUNT(*) AS total FROM search_history").get().total;
    const revenue = db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM finance_records WHERE status = 'paid'").get().total;
    const tickets = db.prepare("SELECT COUNT(*) AS total FROM support_tickets WHERE status != 'closed'").get().total;
    return json(res, 200, { users, searches, revenue, tickets });
  }

  if (path === "users" && method === "GET") {
    return json(res, 200, db.prepare("SELECT id, name, email, role, status, plan, search_limit, searches_used, created_at FROM users ORDER BY id DESC").all());
  }

  if (path === "users" && method === "POST") {
    const body = await readJson(req);
    const plan = body.plan || "free";
    const searchLimit = plan === "scale" ? null : nullableNumber(body.search_limit ?? (plan === "starter" ? 10 : 1));
    const email = required(body.email);
    const role = isCreator(currentUser) && (body.role === "admin" || email.toLowerCase() === CREATOR_EMAIL) ? "admin" : "user";
    const result = db.prepare(`
      INSERT INTO users (name, email, password_hash, role, status, plan, search_limit)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      required(body.name),
      email,
      hashPassword(required(body.password)),
      role,
      body.status || "active",
      plan,
      searchLimit,
    );
    return json(res, 201, db.prepare("SELECT id, name, email, role, status, plan, search_limit, searches_used, created_at FROM users WHERE id = ?").get(result.lastInsertRowid));
  }

  const userMatch = path.match(/^users\/(\d+)$/);
  if (userMatch && method === "PATCH") {
    const body = await readJson(req);
    const target = db.prepare("SELECT id, email, role FROM users WHERE id = ?").get(Number(userMatch[1]));
    if (!target) {
      return json(res, 404, { error: "Usuário não encontrado." });
    }
    const role = target.email.toLowerCase() === CREATOR_EMAIL
      ? "admin"
      : isCreator(currentUser) && (body.role === "admin" || body.role === "user")
        ? body.role
        : target.role;
    db.prepare(`
      UPDATE users SET name = ?, status = ?, plan = ?, search_limit = ?, role = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(body.name, body.status, body.plan, nullableNumber(body.search_limit), role, Number(userMatch[1]));
    return json(res, 200, { ok: true });
  }

  if (path === "settings" && method === "GET") {
    return json(res, 200, safeSettings({ role: "admin" }));
  }

  if (path === "settings" && method === "PATCH") {
    const body = await readJson(req);
    try {
      validateMeliSettingsInput(body);
    } catch (error) {
      return json(res, 400, { error: error instanceof Error ? error.message : "Configuração inválida." });
    }
    const keepWhenBlank = new Set(["meli_access_token", "meli_refresh_token", "meli_client_secret"]);
    for (const [key, value] of Object.entries(body)) {
      if (keepWhenBlank.has(key) && !String(value || "").trim() && getSetting(key)) {
        continue;
      }
      setSetting(key, normalizeSettingValue(key, value));
    }
    if (Object.keys(body).some((key) => key.startsWith("meli_"))) {
      setSetting("meli_last_error", "");
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
    db.prepare("UPDATE support_tickets SET status = ?, priority = ?, response = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(
      body.status,
      body.priority,
      body.response || null,
      Number(ticketMatch[1]),
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

  const financeMatch = path.match(/^finance\/(\d+)$/);
  if (financeMatch && method === "PATCH") {
    const body = await readJson(req);
    db.prepare(`
      UPDATE finance_records SET type = ?, description = ?, amount = ?, status = ?, due_date = ?, paid_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(body.type, body.description, Number(body.amount), body.status, body.due_date || null, body.paid_at || null, Number(financeMatch[1]));
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
      body.is_primary ? 1 : 0,
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
      body.is_primary ? 1 : 0,
      body.status,
      Number(contactMatch[1]),
    );
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { error: "Rota admin não encontrada." });
}

function safeSettings(user) {
  const settings = settingsObject();
  if (!canUseAdmin(user)) {
    delete settings.meli_access_token;
    delete settings.meli_refresh_token;
    delete settings.meli_client_secret;
    delete settings.meli_oauth_state_hash;
    delete settings.meli_oauth_state_user_id;
    delete settings.meli_oauth_state_created_at;
    delete settings.meli_oauth_states;
    delete settings.session_secret;
  } else if (settings.meli_access_token) {
    settings.meli_access_token_configured = "true";
    settings.meli_access_token = "";
  }
  if (canUseAdmin(user)) {
    settings.meli_refresh_token_configured = settings.meli_refresh_token ? "true" : "";
    settings.meli_client_secret_configured = settings.meli_client_secret ? "true" : "";
    settings.meli_oauth_connected = settings.meli_access_token_configured || settings.meli_refresh_token_configured ? "true" : "";
    settings.meli_redirect_uri = settings.meli_redirect_uri || resolveMeliRedirectUri();
    settings.meli_access_token = "";
    settings.meli_refresh_token = "";
    settings.meli_client_secret = "";
    delete settings.meli_oauth_state_hash;
    delete settings.meli_oauth_state_user_id;
    delete settings.meli_oauth_state_created_at;
    delete settings.meli_oauth_states;
    delete settings.session_secret;
  }
  return settings;
}

async function handleMeliCallback(req, res, url) {
  const user = userFromSession(readCookie(req, COOKIE));
  const frontendUrl = new URL(process.env.FRONTEND_ORIGIN || getSetting("frontend_origin") || url.origin);

  if (!user || !isCreator(user)) {
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

  if (!code || !state || !consumeMeliOAuthState(state, user.id)) {
    setSetting("meli_last_error", "Estado OAuth inválido. Tente conectar novamente.");
    frontendUrl.searchParams.set("meli", "invalid_state");
    return redirect(res, frontendUrl.toString());
  }

  try {
    await exchangeMeliAuthorizationCode({ code, redirectUri: oauthRedirectUriForRequest(url) });
    setSetting("meli_oauth_state_hash", "");
    setSetting("meli_oauth_state_user_id", "");
    setSetting("meli_oauth_state_created_at", "");
    setSetting("meli_oauth_states", "");
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

function rememberMeliOAuthState(stateHash, userId) {
  const now = Date.now();
  const states = readMeliOAuthStates()
    .filter((entry) => now - Number(entry.createdAt || 0) <= MELI_OAUTH_STATE_TTL_MS)
    .slice(-8);

  states.push({
    hash: stateHash,
    userId: String(userId),
    createdAt: now,
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

  const remainingStates = [];
  for (const entry of readMeliOAuthStates()) {
    const fresh = now - Number(entry.createdAt || 0) <= MELI_OAUTH_STATE_TTL_MS;
    const belongsToUser = !entry.userId || String(entry.userId) === String(userId);
    const matches = fresh && belongsToUser && entry.hash === stateHash;

    if (matches) {
      valid = true;
      continue;
    }
    if (fresh) {
      remainingStates.push(entry);
    }
  }

  setSetting("meli_oauth_states", remainingStates.length ? JSON.stringify(remainingStates) : "");
  return valid;
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

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
  }
  return body ? JSON.parse(body) : {};
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

function nullableNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  return Number(value);
}

function normalizeSettingValue(key, value) {
  if (key.startsWith("meli_") || key === "frontend_origin") {
    return String(value || "").trim();
  }
  return value;
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
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
  };
  return types[extname(filePath)] || "application/octet-stream";
}
