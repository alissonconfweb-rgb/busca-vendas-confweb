import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const databasePath = join(tmpdir(), `busca-vendas-session-${process.pid}.sqlite`);
process.env.DB_PATH = databasePath;
process.env.SESSION_SECRET = "teste-de-sessao-com-mais-de-64-caracteres-busca-vendas-confweb";
process.env.SETTINGS_ENCRYPTION_KEY = "teste-de-criptografia-com-mais-de-64-caracteres-busca-vendas";

const {
  createSession,
  db,
  deleteSession,
  getSetting,
  initDatabase,
  setSetting,
  userFromSession,
} = await import("../server/db.mjs");

initDatabase();

test("persiste a sessao com token protegido e permite revogacao", () => {
  const result = db.prepare(`
    INSERT INTO users (name, email, password_hash, role, status, plan, search_limit)
    VALUES (?, ?, ?, 'user', 'active', 'free', 1)
  `).run("Cliente Sessao", "cliente-sessao@teste.local", "hash");

  const session = createSession(result.lastInsertRowid);
  const stored = db.prepare("SELECT token_hash FROM sessions WHERE user_id = ?").get(result.lastInsertRowid);
  const storedSession = db.prepare("SELECT expires_at FROM sessions WHERE user_id = ?").get(result.lastInsertRowid);

  assert.ok(session.token.length >= 40);
  assert.notEqual(stored.token_hash, session.token);
  assert.match(storedSession.expires_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(userFromSession(session.token)?.email, "cliente-sessao@teste.local");

  deleteSession(session.token);
  assert.equal(userFromSession(session.token), null);
});

test("criptografa credenciais de integracao no banco", () => {
  setSetting("asaas_api_key", "$aact_hmlg_uma-chave-de-teste");
  const stored = db.prepare("SELECT value FROM settings WHERE key = 'asaas_api_key'").get();

  assert.match(stored.value, /^enc:v1:/);
  assert.equal(getSetting("asaas_api_key"), "$aact_hmlg_uma-chave-de-teste");
});

test.after(() => {
  db.close();
  rmSync(databasePath, { force: true });
  rmSync(`${databasePath}-wal`, { force: true });
  rmSync(`${databasePath}-shm`, { force: true });
});
