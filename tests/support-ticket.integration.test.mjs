import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

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

test("acompanha o chamado no painel mesmo antes de o SMTP ser configurado", async (context) => {
  const tempDir = mkdtempSync(join(tmpdir(), "busca-vendas-support-ticket-"));
  const databasePath = join(tempDir, "support-ticket.sqlite");
  const port = 36_000 + (process.pid % 1_000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const origin = "http://127.0.0.1:5173";
  const email = "admin-support-ticket@teste.local";
  const password = "TesteBusca123";
  const child = spawn(process.execPath, ["server/index.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ADMIN_EMAIL: email,
      ADMIN_PASSWORD: password,
      CREATOR_EMAIL: email,
      DB_PATH: databasePath,
      FRONTEND_ORIGIN: origin,
      HOST: "127.0.0.1",
      NODE_ENV: "test",
      PORT: String(port),
      SUPPORT_SMTP_PASSWORD: "",
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
    body: JSON.stringify({ email, password }),
  });
  assert.equal(login.status, 200);
  const cookie = (login.headers.get("set-cookie") || "").match(/bv_session_v2=[^;,]+/)?.[0];
  assert.ok(cookie);

  const opened = await fetch(`${baseUrl}/api/support`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, Origin: origin },
    body: JSON.stringify({
      subject: "Preciso de ajuda",
      message: "Não consigo concluir a análise.",
      priority: "high",
    }),
  });
  assert.equal(opened.status, 201);
  const ticket = await opened.json();
  assert.equal(ticket.status, "open");
  assert.equal(ticket.notification_email_status, "not_configured");
  assert.equal("notification_email_error" in ticket, false);
  assert.equal("notification_email_message_id" in ticket, false);

  const answered = await fetch(`${baseUrl}/api/admin/support/${ticket.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookie, Origin: origin },
    body: JSON.stringify({
      status: "open",
      priority: "high",
      response: "Recebemos seu chamado e vamos ajudar.",
    }),
  });
  assert.equal(answered.status, 200);
  const answerResult = await answered.json();
  assert.equal(answerResult.status, "waiting");
  assert.equal(answerResult.emailStatus, "not_configured");

  const listed = await fetch(`${baseUrl}/api/support`, {
    headers: { Cookie: cookie, Origin: origin },
  });
  assert.equal(listed.status, 200);
  const tickets = await listed.json();
  assert.equal(tickets.length, 1);
  assert.equal(tickets[0].status, "waiting");
  assert.equal(tickets[0].response, "Recebemos seu chamado e vamos ajudar.");
  assert.equal(tickets[0].response_email_status, "not_configured");

  const resolved = await fetch(`${baseUrl}/api/admin/support/${ticket.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookie, Origin: origin },
    body: JSON.stringify({
      status: "closed",
      priority: "high",
      response: "Recebemos seu chamado e vamos ajudar.",
    }),
  });
  assert.equal(resolved.status, 200);
  assert.equal((await resolved.json()).status, "closed");

  const afterResolve = await fetch(`${baseUrl}/api/support`, {
    headers: { Cookie: cookie, Origin: origin },
  });
  assert.equal(afterResolve.status, 200);
  assert.equal((await afterResolve.json())[0].status, "closed");

  const database = new Database(databasePath, { readonly: true });
  const stored = database.prepare(`
    SELECT notification_email_status, notification_email_error,
           response_email_status, response_email_error
    FROM support_tickets WHERE id = ?
  `).get(ticket.id);
  assert.equal(stored.notification_email_status, "not_configured");
  assert.match(stored.notification_email_error, /senha SMTP/i);
  assert.equal(stored.response_email_status, "not_configured");
  assert.match(stored.response_email_error, /senha SMTP/i);
  database.close();
});
