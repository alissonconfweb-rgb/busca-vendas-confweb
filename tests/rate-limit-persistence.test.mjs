import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { SqliteRateLimiter } from "../server/rate-limit.mjs";

const databasePath = join(tmpdir(), `busca-vendas-rate-limit-${process.pid}.sqlite`);
const firstDb = new Database(databasePath);
const secondDb = new Database(databasePath);
for (const database of [firstDb, secondDb]) {
  database.pragma("busy_timeout = 5000");
}
firstDb.exec(`
  CREATE TABLE rate_limit_buckets (
    key TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0,
    reset_at INTEGER NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);

const firstLimiter = new SqliteRateLimiter(firstDb);
const secondLimiter = new SqliteRateLimiter(secondDb);

test("duas instancias compartilham o mesmo limite persistente", () => {
  assert.equal(firstLimiter.consume("login:ip", { limit: 2, windowMs: 60_000 }).allowed, true);
  assert.equal(secondLimiter.consume("login:ip", { limit: 2, windowMs: 60_000 }).allowed, true);
  const blocked = firstLimiter.consume("login:ip", { limit: 2, windowMs: 60_000 });

  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  assert.equal(firstDb.prepare("SELECT count FROM rate_limit_buckets WHERE key = ?").get("login:ip").count, 3);
});

test.after(() => {
  clearInterval(firstLimiter.cleanupTimer);
  clearInterval(secondLimiter.cleanupTimer);
  firstDb.close();
  secondDb.close();
  rmSync(databasePath, { force: true });
  rmSync(`${databasePath}-wal`, { force: true });
  rmSync(`${databasePath}-shm`, { force: true });
});
