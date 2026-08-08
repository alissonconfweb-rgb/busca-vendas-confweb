import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { buildProductQuerySpec, normalizedProductKey } from "../server/product-match.mjs";
import { hashToken } from "../server/security.mjs";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer(url, child) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Servidor de teste encerrou com código ${child.exitCode}.`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // The child process is still starting.
    }
    await delay(100);
  }
  throw new Error("Servidor de teste não iniciou a tempo.");
}

test("entrega uma coleta concluída depois da resposta inicial sem cobrar duas vezes", async (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "busca-vendas-search-job-"));
  const databasePath = join(tempDir, "search-job.sqlite");
  const port = 34_000 + (process.pid % 1_000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const origin = "http://127.0.0.1:5173";
  const child = spawn(process.execPath, ["server/index.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ADMIN_EMAIL: "admin-search-job@teste.local",
      ADMIN_PASSWORD: "TesteBusca123",
      CREATOR_EMAIL: "admin-search-job@teste.local",
      DB_PATH: databasePath,
      FRONTEND_ORIGIN: origin,
      HOST: "127.0.0.1",
      MARKET_SEARCH_PROVIDER: "meli_only",
      NODE_ENV: "test",
      PORT: String(port),
    },
    stdio: "ignore",
  });

  context.after(async () => {
    child.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(2_000)]);
    rmSync(tempDir, { recursive: true, force: true });
  });

  await waitForServer(`${baseUrl}/api/health`, child);
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ email: "admin-search-job@teste.local", password: "TesteBusca123" }),
  });
  assert.equal(login.status, 200);
  assert.match(login.headers.get("cache-control") || "", /no-store/);
  const cookie = (login.headers.get("set-cookie") || "").match(/bv_session_v2=[^;,]+/)?.[0];
  assert.ok(cookie);

  const query = "produto fluxo";
  const started = await fetch(`${baseUrl}/api/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, Origin: origin },
    body: JSON.stringify({ q: query }),
  });
  assert.equal(started.status, 202);
  const pending = await started.json();
  assert.equal(pending.pending, true);

  const items = [1, 2, 3].map((index) => ({
    id: `MLB-TESTE-${index}`,
    title: `Produto fluxo campeão ${index}`,
    subtitle: "Mercado Livre",
    image: "https://http2.mlstatic.com/teste.jpg",
    price: 100 + index,
    soldQuantity: 1_000 * index,
    revenue: (100 + index) * 1_000 * index,
    permalink: `https://produto.mercadolivre.com.br/MLB-TESTE-${index}`,
  }));
  const demand = items.reduce((sum, item) => sum + item.soldQuantity, 0);
  const revenue = items.reduce((sum, item) => sum + item.revenue, 0);
  const result = {
    ok: true,
    source: "mercado_livre",
    metricsMode: "sales",
    salesAvailable: true,
    message: "Dados reais retornados pelo Mercado Livre.",
    items,
    exactMatches: 3,
    totalAvailable: 3,
    totals: { demand, revenue, averageTicket: revenue / demand, actualDemand: demand, isEstimated: false },
  };
  const spec = buildProductQuerySpec(query);
  const cacheKey = normalizedProductKey([...spec.tokens].sort().join(" "));
  const database = new Database(databasePath);
  database.prepare(`
    INSERT INTO market_search_cache (key, query, source, total_demand, total_revenue, payload, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(cacheKey, query, result.source, demand, revenue, JSON.stringify(result));

  const firstStatus = await fetch(`${baseUrl}/api/search-status/${pending.requestId}`, {
    headers: { Cookie: cookie, Origin: origin },
  });
  assert.equal(firstStatus.status, 200);
  const delivered = await firstStatus.json();
  assert.equal(delivered.pending, false);
  assert.equal(delivered.result.items.length, 3);

  const secondStatus = await fetch(`${baseUrl}/api/search-status/${pending.requestId}`, {
    headers: { Cookie: cookie, Origin: origin },
  });
  assert.equal(secondStatus.status, 200);
  assert.equal(database.prepare("SELECT COUNT(*) count FROM search_history").get().count, 1);

  const userId = database.prepare("SELECT id FROM users WHERE email = ?").get("admin-search-job@teste.local").id;
  const legacyToken = "legacy-session-token-for-migration";
  database.prepare(`
    INSERT INTO sessions (token_hash, user_id, expires_at)
    VALUES (?, ?, datetime('now', '+1 day'))
  `).run(hashToken(legacyToken), userId);
  const migrated = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Cookie: `bv_session=${legacyToken}`, Origin: origin },
  });
  assert.equal((await migrated.json()).user.email, "admin-search-job@teste.local");
  assert.match(migrated.headers.get("set-cookie") || "", /bv_session_v2=/);
  database.close();
});
