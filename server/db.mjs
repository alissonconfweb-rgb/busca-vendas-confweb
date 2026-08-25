import { mkdirSync } from "node:fs";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { hashToken, randomToken } from "./security.mjs";
import { loadLocalEnv } from "./env.mjs";

loadLocalEnv();

export const DB_PATH = process.env.DB_PATH
  ? resolve(process.env.DB_PATH)
  : resolve(process.cwd(), "data", "busca-vendas.sqlite");
const SESSION_TTL_DAYS = Math.min(90, Number(process.env.SESSION_TTL_DAYS || 30));
const SESSION_TTL_MS = Math.max(1, SESSION_TTL_DAYS) * 24 * 60 * 60 * 1000;
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");
db.pragma("temp_store = MEMORY");

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
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS account_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      purpose TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_account_tokens_user_purpose
      ON account_tokens(user_id, purpose, expires_at);

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

    CREATE TABLE IF NOT EXISTS search_requests (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      query TEXT NOT NULL,
      cache_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      payload TEXT,
      error TEXT,
      delivered_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_search_requests_user_status
      ON search_requests(user_id, status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_search_requests_cache_status
      ON search_requests(cache_key, status, updated_at);

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

    CREATE TABLE IF NOT EXISTS provider_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      query_key TEXT,
      credits INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'completed',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_provider_usage_month
      ON provider_usage(provider, created_at);

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
  ensureColumn("users", "terms_accepted_at", "TEXT");
  ensureColumn("users", "privacy_accepted_at", "TEXT");
  ensureColumn("users", "password_changed_at", "TEXT");
  ensureColumn("users", "business_model", "TEXT");
  ensureColumn("users", "marketplace_experience", "TEXT");
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
  migrateSensitiveSettings();
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
    commercial_training_eyebrow: "Treinamento Confweb",
    commercial_training_title: "Agora, aprenda a aplicar e a vender muito com esses produtos, com o treinamento da Confweb.",
    commercial_training_body: "Hoje, a Confweb gerencia mais de 60 empresas no modelo de administração, gestão e escala. Você também pode ser um case de sucesso.",
    commercial_training_button: "Conhecer o treinamento",
    commercial_training_url: "https://www.confweb.com.br",
    commercial_support_text: "Precisa de ajuda? Fale com um especialista da Confweb.",
    commercial_support_button: "Conversar",
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
    scrapedo_search_pages: "1",
    scrapedo_detail_limit: "12",
    scrapedo_timeout_ms: "18000",
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
  const value = db.prepare("SELECT value FROM settings WHERE key = ?").get(key)?.value ?? null;
  return decryptSettingValue(key, value);
}

export function setSetting(key, value) {
  const storedValue = encryptSettingValue(key, String(value ?? ""));
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, storedValue);
}

export function settingsObject() {
  return Object.fromEntries(
    db.prepare("SELECT key, value FROM settings").all()
      .map((row) => [row.key, decryptSettingValue(row.key, row.value)]),
  );
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
  const token = randomToken(32);
  db.prepare("DELETE FROM sessions WHERE expires_at <= CURRENT_TIMESTAMP").run();
  db.prepare(`
    INSERT INTO sessions (token_hash, user_id, expires_at)
    VALUES (?, ?, ?)
  `).run(hashToken(token), userId, expires);
  return { token, expires };
}

export function userFromSession(token) {
  if (!token) {
    return null;
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

export function deleteSessionsForUser(userId) {
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

export function createAccountToken(userId, purpose, ttlMinutes = 30) {
  const token = randomToken(32);
  const expires = new Date(Date.now() + Math.max(5, ttlMinutes) * 60 * 1000).toISOString();
  db.prepare("DELETE FROM account_tokens WHERE user_id = ? AND purpose = ?").run(userId, purpose);
  db.prepare(`
    INSERT INTO account_tokens (user_id, purpose, token_hash, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(userId, purpose, hashToken(token), expires);
  return { token, expires };
}

export function consumeAccountToken(token, purpose) {
  const row = db.prepare(`
    SELECT *
    FROM account_tokens
    WHERE token_hash = ?
      AND purpose = ?
      AND consumed_at IS NULL
      AND expires_at > CURRENT_TIMESTAMP
  `).get(hashToken(token), purpose);
  if (!row) {
    return null;
  }
  db.prepare("UPDATE account_tokens SET consumed_at = CURRENT_TIMESTAMP WHERE id = ?").run(row.id);
  return row;
}

function migrateSensitiveSettings() {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  const update = db.prepare("UPDATE settings SET value = ? WHERE key = ?");
  const migrate = db.transaction(() => {
    for (const row of rows) {
      if (isSensitiveSetting(row.key) && row.value && !String(row.value).startsWith("enc:v1:")) {
        update.run(encryptSettingValue(row.key, row.value), row.key);
      }
    }
  });
  migrate();
}

function isSensitiveSetting(key) {
  return /(?:api[_-]?key|api[_-]?token|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|webhook[_-]?token|session[_-]?secret)$/i.test(
    String(key || ""),
  );
}

function encryptSettingValue(key, value) {
  if (!value || !isSensitiveSetting(key) || value.startsWith("enc:v1:")) {
    return value;
  }
  const secret = settingsEncryptionSecret();
  if (!secret) {
    return value;
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

function decryptSettingValue(key, value) {
  if (!isSensitiveSetting(key) || !String(value || "").startsWith("enc:v1:")) {
    return value;
  }
  const secret = settingsEncryptionSecret();
  if (!secret) {
    return "";
  }
  try {
    const [, , ivValue, tagValue, encryptedValue] = String(value).split(":");
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), Buffer.from(ivValue, "base64url"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return "";
  }
}

function settingsEncryptionSecret() {
  return process.env.SETTINGS_ENCRYPTION_KEY || process.env.SESSION_SECRET || "";
}

function encryptionKey(secret) {
  return createHash("sha256").update(secret).digest();
}
