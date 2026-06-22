import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { hashToken, randomToken } from "./security.mjs";

const DB_PATH = resolve(process.cwd(), "data", "busca-vendas.sqlite");
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

export function initDatabase() {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
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

  seedDefaults();
}

function seedDefaults() {
  const defaultSettings = {
    app_name: "Busca Vendas - Confweb",
    starter_monthly: "19.90",
    starter_yearly: "179.10",
    starter_search_limit: "10",
    scale_monthly: "39.90",
    scale_yearly: "359.10",
    commercial_cta: "Falar com Comercial Confweb",
    meli_site_id: "MLB",
    meli_redirect_uri: "http://127.0.0.1:3001/api/meli/callback",
  };

  for (const [key, value] of Object.entries(defaultSettings)) {
    db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)").run(key, value);
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

  const { password_hash, ...safeUser } = user;
  return safeUser;
}

export function createSession(userId) {
  const token = randomToken();
  const tokenHash = hashToken(token);
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(
    tokenHash,
    userId,
    expires,
  );
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
