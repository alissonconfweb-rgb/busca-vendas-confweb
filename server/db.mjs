import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHmac, timingSafeEqual } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "./vendor/sql-wasm.cjs";
import { hashToken, randomToken } from "./security.mjs";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(SERVER_DIR, "..");
const DB_PATH = process.env.DB_PATH
  ? resolve(process.env.DB_PATH)
  : resolve(process.cwd(), "data", "busca-vendas.sqlite");
const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS || 365);
const SESSION_TTL_MS = Math.max(1, SESSION_TTL_DAYS) * 24 * 60 * 60 * 1000;
mkdirSync(dirname(DB_PATH), { recursive: true });

const SQL = await initSqlJs({
  locateFile: (file) => resolve(SERVER_DIR, "vendor", file),
});

class SqlJsDatabase {
  constructor(SQLRuntime, dbPath, initialData) {
    this.dbPath = dbPath;
    this.inner = initialData ? new SQLRuntime.Database(new Uint8Array(initialData)) : new SQLRuntime.Database();
  }

  exec(sql) {
    const result = this.inner.exec(sql);
    this.persist();
    return result;
  }

  prepare(sql) {
    return new SqlJsStatement(this, sql);
  }

  persist() {
    const temporaryPath = `${this.dbPath}.tmp`;
    writeFileSync(temporaryPath, Buffer.from(this.inner.export()));
    renameSync(temporaryPath, this.dbPath);
  }

  lastInsertRowid() {
    return Number(this.inner.exec("SELECT last_insert_rowid() AS id")?.[0]?.values?.[0]?.[0] || 0);
  }
}

class SqlJsStatement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
  }

  run(...params) {
    const statement = this.database.inner.prepare(this.sql);
    try {
      statement.run(normalizeParams(params));
      const result = {
        changes: this.database.inner.getRowsModified(),
        lastInsertRowid: this.database.lastInsertRowid(),
      };
      result.lastInsertROWID = result.lastInsertRowid;
      this.database.persist();
      return result;
    } finally {
      statement.free();
    }
  }

  get(...params) {
    const statement = this.database.inner.prepare(this.sql);
    try {
      statement.bind(normalizeParams(params));
      return statement.step() ? statement.getAsObject() : undefined;
    } finally {
      statement.free();
    }
  }

  all(...params) {
    const rows = [];
    const statement = this.database.inner.prepare(this.sql);
    try {
      statement.bind(normalizeParams(params));
      while (statement.step()) {
        rows.push(statement.getAsObject());
      }
      return rows;
    } finally {
      statement.free();
    }
  }
}

function normalizeParams(params) {
  if (params.length === 1 && Array.isArray(params[0])) {
    return params[0];
  }
  return params;
}

export const db = new SqlJsDatabase(
  SQL,
  DB_PATH,
  existsSync(DB_PATH) ? readFileSync(DB_PATH) : null,
);

export function initDatabase() {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      status TEXT NOT NULL DEFAULT 'active',
      plan TEXT NOT NULL DEFAULT 'free',
      search_limit INTEGER,
      searches_used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS search_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      query TEXT NOT NULL,
      source TEXT NOT NULL,
      total_demand INTEGER NOT NULL DEFAULT 0,
      total_revenue REAL NOT NULL DEFAULT 0,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS market_search_cache (
      key TEXT PRIMARY KEY,
      query TEXT NOT NULL,
      source TEXT NOT NULL,
      total_demand INTEGER NOT NULL DEFAULT 0,
      total_revenue REAL NOT NULL DEFAULT 0,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS market_item_cache (
      key TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      permalink TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      cta TEXT NOT NULL DEFAULT 'Ler agora',
      status TEXT NOT NULL DEFAULT 'published',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS support_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      priority TEXT NOT NULL DEFAULT 'normal',
      response TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS finance_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      type TEXT NOT NULL,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      due_date TEXT,
      paid_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS commercial_contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      channel TEXT NOT NULL,
      value TEXT NOT NULL,
      is_primary INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  ensureColumn("users", "phone", "TEXT");
  ensureColumn("users", "asaas_customer_id", "TEXT");
  ensureColumn("users", "email_verified_at", "TEXT");
  ensureColumn("users", "phone_verified_at", "TEXT");
  ensureColumn("users", "billing_status", "TEXT NOT NULL DEFAULT 'none'");
  ensureColumn("users", "billing_cycle", "TEXT");
  ensureColumn("users", "billing_provider_subscription_id", "TEXT");
  ensureColumn("users", "billing_payment_url", "TEXT");
  ensureColumn("users", "billing_access_until", "TEXT");
  ensureColumn("finance_records", "provider", "TEXT");
  ensureColumn("finance_records", "external_id", "TEXT");
  ensureColumn("finance_records", "provider_payment_id", "TEXT");
  ensureColumn("finance_records", "provider_subscription_id", "TEXT");
  ensureColumn("finance_records", "external_reference", "TEXT");
  ensureColumn("finance_records", "payment_url", "TEXT");
  ensureColumn("finance_records", "pix_payload", "TEXT");
  ensureColumn("finance_records", "plan", "TEXT");
  ensureColumn("finance_records", "billing_cycle", "TEXT");
  ensureColumn("finance_records", "billing_type", "TEXT");
  db.prepare(`
    UPDATE users
    SET billing_status = 'active'
    WHERE plan IN ('starter', 'scale')
      AND (billing_status IS NULL OR billing_status = 'none')
  `).run();
  seedDefaults();
}

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function seedDefaults() {
  const defaultSettings = {
    app_name: "Busca Vendas - Confweb",
    starter_monthly: "19.90",
    starter_yearly: "179.10",
    starter_search_limit: "10",
    scale_monthly: "39.90",
    scale_yearly: "359.10",
    commercial_cta: "Fale com um Especialista Certificado da Confweb",
    oxylabs_enabled: "false",
    oxylabs_mode: "web_unblocker",
    oxylabs_endpoint: "https://unblock.oxylabs.io:60000",
    oxylabs_geo_location: "Brazil",
    zyte_endpoint: "https://api.zyte.com/v1/extract",
    zyte_mode: "browser_html",
    zyte_search_enabled: "false",
    zyte_search_pages: "4",
    zyte_detail_limit: "60",
    zyte_ip_type: "auto",
    zyte_geolocation: "BR",
    scrapedo_enabled: "true",
    scrapedo_endpoint: "https://api.scrape.do/",
    scrapedo_search_pages: "2",
    scrapedo_detail_limit: "9",
    scrapedo_timeout_ms: "45000",
    scrapedo_verified: "false",
    meli_scraper_enabled: "false",
    proxy_enabled: "false",
    proxy_url: "",
    proxy_username: "",
    proxy_password: "",
    proxy_country: "Brazil",
    proxy_timeout_ms: "30000",
    min_champion_sales: "1000",
    market_cache_ttl_days: "7",
    market_cache_stale_days: "30",
    market_item_cache_ttl_days: "7",
    asaas_enabled: "false",
    asaas_environment: "sandbox",
    asaas_endpoint: "https://api-sandbox.asaas.com/v3",
    asaas_webhook_token: "",
    asaas_checkout_mode: "subscription",
    verification_required: "false",
    verification_channel: "email",
    meli_site_id: "MLB",
    meli_redirect_uri: "http://127.0.0.1:3001/api/meli/callback",
  };

  for (const [key, value] of Object.entries(defaultSettings)) {
    db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)").run(key, value);
  }

  if (
    ["Falar com Comercial Confweb", "Fale com um Especialista Certificado"].includes(
      getSetting("commercial_cta"),
    )
  ) {
    setSetting("commercial_cta", "Fale com um Especialista Certificado da Confweb");
  }

  const tipCount = db.prepare("SELECT COUNT(*) AS count FROM tips").get().count;
  if (tipCount === 0) {
    const insertTip = db.prepare("INSERT INTO tips (title, body, cta) VALUES (?, ?, ?)");
    insertTip.run(
      "Como encontrar produtos campeões para vender",
      "Valide demanda, ticket médio e concorrência antes de comprar estoque. Comece por palavras-chave amplas e refine pelos anúncios com mais giro.",
      "Ler guia",
    );
    insertTip.run(
      "Precificação que garante lucro",
      "Some custo do produto, taxa do marketplace, frete, embalagem e operação. A margem de contribuição mostra se a venda fica saudável.",
      "Ver fórmula",
    );
    insertTip.run(
      "Vender no Mercado Livre: primeiros passos",
      "Estruture título, imagens, envio e reputação. Produtos com boa demanda precisam de operação consistente para converter.",
      "Começar",
    );
  }

  const contactCount = db.prepare("SELECT COUNT(*) AS count FROM commercial_contacts").get().count;
  if (contactCount === 0) {
    db.prepare(
      "INSERT INTO commercial_contacts (name, channel, value, is_primary) VALUES (?, ?, ?, ?)",
    ).run("Comercial Confweb", "WhatsApp", "+55 11 99999-9999", 1);
  }

  const siteContactCount = db.prepare(`
    SELECT COUNT(*) AS count
    FROM commercial_contacts
    WHERE lower(channel) = lower(?) AND value = ?
  `).get("Site", "https://www.confweb.com.br").count;
  if (siteContactCount === 0) {
    db.prepare(
      "INSERT INTO commercial_contacts (name, channel, value, is_primary, status) VALUES (?, ?, ?, ?, ?)",
    ).run("Site Confweb", "Site", "https://www.confweb.com.br", 0, "active");
  }

  const secret = getSetting("session_secret");
  if (!secret) {
    setSetting("session_secret", randomToken(48));
  }
}

export function getSetting(key) {
  return db.prepare("SELECT value FROM settings WHERE key = ?").get(key)?.value ?? null;
}

export function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value ?? ""));
}

export function settingsObject() {
  return Object.fromEntries(db.prepare("SELECT key, value FROM settings").all().map((row) => [row.key, row.value]));
}

export function findUserByEmail(email) {
  return db.prepare("SELECT * FROM users WHERE lower(email) = lower(?)").get(email);
}

export function publicUser(user) {
  if (!user) {
    return null;
  }

  const {
    password_hash,
    asaas_customer_id,
    billing_provider_subscription_id,
    ...safeUser
  } = user;
  return safeUser;
}

export function createSession(userId) {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const expires = new Date(expiresAt).toISOString();
  const token = createSignedSessionToken(userId, expiresAt);
  return { token, expires };
}

export function userFromSession(token) {
  if (!token) {
    return null;
  }

  const signedSession = readSignedSessionToken(token);
  if (signedSession) {
    const user = db.prepare("SELECT * FROM users WHERE id = ? AND status = 'active'").get(signedSession.userId);
    if (user) {
      return user;
    }
  }

  const row = db.prepare(`
    SELECT u.*
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP AND u.status = 'active'
  `).get(hashToken(token));
  return row ?? null;
}

export function deleteSession(token) {
  if (token) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
  }
}

function createSignedSessionToken(userId, expiresAt) {
  const payload = Buffer.from(JSON.stringify({
    userId: Number(userId),
    expiresAt: Number(expiresAt),
    nonce: randomToken(12),
  })).toString("base64url");
  return `v2.${payload}.${sessionSignature(payload)}`;
}

function readSignedSessionToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || parts[0] !== "v2") {
    return null;
  }

  const [, payload, signature] = parts;
  if (!isValidSignature(payload, signature)) {
    return null;
  }

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!session.userId || !session.expiresAt || Number(session.expiresAt) <= Date.now()) {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

function sessionSignature(payload) {
  return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

function isValidSignature(payload, signature) {
  const expected = Buffer.from(sessionSignature(payload));
  const actual = Buffer.from(String(signature || ""));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function sessionSecret() {
  const secret = process.env.SESSION_SECRET || getSetting("session_secret");
  if (secret) {
    return secret;
  }
  const generated = randomToken(48);
  setSetting("session_secret", generated);
  return generated;
}
