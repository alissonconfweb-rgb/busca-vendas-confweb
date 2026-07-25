import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

const DEFAULT_QUERIES = [
  "creatina 1kg",
  "fone bluetooth",
  "cafeteira eletrica",
  "mochila masculina",
  "caixa de som bluetooth",
  "vestido feminino",
  "bola de futebol",
  "flores artificiais",
  "garrafa termica",
  "smartwatch feminino",
  "copo termico",
  "tenis masculino",
];

const args = parseArgs(process.argv.slice(2));
loadEnvFile(".env.local");
loadEnvFile(".env");

const target = String(args.target || "api").toLowerCase();
const baseUrl = trimTrailingSlash(args.base || process.env.STRESS_BASE_URL || "http://127.0.0.1:3001");
const requests = positiveInt(args.requests || args.n || (target === "zyte" ? 3 : 10), "requests");
const concurrency = positiveInt(args.concurrency || args.c || (target === "zyte" ? 1 : 2), "concurrency");
const timeoutMs = positiveInt(args.timeout || process.env.STRESS_TIMEOUT_MS || 180000, "timeout");
const fresh = args.fresh === undefined ? target === "zyte" : boolArg(args.fresh);
const yes = boolArg(args.yes);
const queries = buildQueryList(args, requests);
const reportDir = resolve(process.cwd(), "data", "stress");

if (!["api", "zyte"].includes(target)) {
  fail("Use --target=api ou --target=zyte.");
}

if (target === "zyte") {
  process.env.ZYTE_CACHE_MS = fresh ? "0" : process.env.ZYTE_CACHE_MS || "";
  process.env.ZYTE_STALE_CACHE_MS = fresh ? "0" : process.env.ZYTE_STALE_CACHE_MS || "";
}

const estimatedMaxZyteCalls = estimateMaxZyteCalls(requests);
if (target === "zyte" && !yes && (requests > 3 || concurrency > 1)) {
  fail(
    [
      "Teste direto na Zyte bloqueado por seguranca.",
      `Este lote pode consumir ate aproximadamente ${estimatedMaxZyteCalls} chamadas Zyte.`,
      "Rode novamente com --yes quando tiver certeza do volume.",
    ].join(" "),
  );
}

console.log(`Busca Vendas stress test`);
console.log(`Alvo: ${target}${target === "api" ? ` (${baseUrl})` : ""}`);
console.log(`Buscas: ${requests} | Concorrencia: ${concurrency} | Fresh: ${fresh ? "sim" : "nao"}`);
console.log(`Estimativa maxima Zyte: ate ${estimatedMaxZyteCalls} chamadas no pior caso\n`);

const startedAt = new Date();
const results = target === "api"
  ? await runApiStress()
  : await runDirectZyteStress();
const finishedAt = new Date();

const summary = summarize(results, startedAt, finishedAt);
mkdirSync(reportDir, { recursive: true });
const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
const jsonPath = resolve(reportDir, `zyte-stress-${stamp}.json`);
const csvPath = resolve(reportDir, `zyte-stress-${stamp}.csv`);
writeFileSync(jsonPath, JSON.stringify({ summary, results }, null, 2));
writeFileSync(csvPath, toCsv(results));

printSummary(summary);
console.log(`\nRelatorio JSON: ${jsonPath}`);
console.log(`Relatorio CSV:  ${csvPath}`);

async function runApiStress() {
  const email = args.email || process.env.STRESS_EMAIL;
  const password = args.password || process.env.STRESS_PASSWORD;
  if (!email || !password) {
    fail("Para --target=api informe --email e --password, ou STRESS_EMAIL/STRESS_PASSWORD.");
  }

  const cookie = await login(baseUrl, email, password);
  return runPool(queries, concurrency, (query, index) => runApiSearch({ query, index, cookie }));
}

async function login(base, email, password) {
  const response = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  const data = parseJson(text);
  if (!response.ok) {
    fail(`Login falhou (${response.status}): ${data?.error || text.slice(0, 180)}`);
  }
  const cookie = extractCookie(response);
  if (!cookie) {
    fail("Login respondeu OK, mas nao retornou cookie de sessao.");
  }
  return cookie;
}

async function runApiSearch({ query, index, cookie }) {
  const url = new URL(`${baseUrl}/api/search`);
  url.searchParams.set("q", query);
  if (fresh) {
    url.searchParams.set("fresh", "1");
  }

  return timedSearch({ query, index }, async () => {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        Cookie: cookie,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    const data = parseJson(text);
    if (!response.ok) {
      throw new Error(`${response.status}: ${data?.error || text.slice(0, 220)}`);
    }
    if (!data || typeof data !== "object") {
      throw new Error(`Resposta nao JSON: ${text.slice(0, 220)}`);
    }
    return data;
  });
}

async function runDirectZyteStress() {
  const { searchMercadoLivreZyte, syncZyteSettingsFromEnv } = await import("../server/zyte.mjs");
  syncZyteSettingsFromEnv();
  return runPool(queries, concurrency, (query, index) => timedSearch({ query, index }, () => searchMercadoLivreZyte(query)));
}

async function timedSearch({ query, index }, callback) {
  const started = performance.now();
  try {
    const data = await callback();
    const ms = Math.round(performance.now() - started);
    const row = resultRow({ index, query, ms, data });
    logProgress(row);
    return row;
  } catch (error) {
    const ms = Math.round(performance.now() - started);
    const row = {
      index: index + 1,
      query,
      ok: false,
      ms,
      seconds: round(ms / 1000, 2),
      source: "error",
      cacheHit: false,
      items: 0,
      demand: 0,
      revenue: 0,
      error: error instanceof Error ? error.message : String(error),
    };
    logProgress(row);
    return row;
  }
}

function resultRow({ index, query, ms, data }) {
  const items = Array.isArray(data.items) ? data.items : [];
  return {
    index: index + 1,
    query,
    ok: Boolean(data.ok),
    ms,
    seconds: round(ms / 1000, 2),
    source: data.source || "",
    cacheHit: Boolean(data.cacheHit || /cache/i.test(String(data.message || ""))),
    items: items.length,
    demand: Number(data.totals?.demand || 0),
    revenue: Number(data.totals?.revenue || 0),
    averageTicket: Number(data.totals?.averageTicket || 0),
    message: data.message || "",
    firstTitle: items[0]?.title || "",
    error: data.ok ? "" : data.error || data.message || "Resultado incompleto",
  };
}

async function runPool(items, size, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function runWorker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(size, items.length) }, runWorker));
  return results;
}

function buildQueryList(options, total) {
  const fromFile = options.file ? readFileSync(resolve(String(options.file)), "utf8").split(/\r?\n/) : [];
  const inline = options.queries ? String(options.queries).split(",") : [];
  const source = [...fromFile, ...inline]
    .map((item) => item.trim())
    .filter(Boolean);
  const pool = source.length ? source : DEFAULT_QUERIES;
  const list = [];
  for (let index = 0; index < total; index += 1) {
    list.push(pool[index % pool.length]);
  }
  return list;
}

function summarize(rows, startedAt, finishedAt) {
  const durations = rows.map((row) => row.ms).sort((a, b) => a - b);
  const okRows = rows.filter((row) => row.ok);
  const bySource = {};
  const errors = {};
  for (const row of rows) {
    bySource[row.source || "sem fonte"] = (bySource[row.source || "sem fonte"] || 0) + 1;
    if (!row.ok) {
      const key = String(row.error || "erro").slice(0, 160);
      errors[key] = (errors[key] || 0) + 1;
    }
  }
  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    totalSeconds: round((finishedAt.getTime() - startedAt.getTime()) / 1000, 2),
    target,
    baseUrl: target === "api" ? baseUrl : "",
    requests: rows.length,
    concurrency,
    fresh,
    estimatedMaxZyteCalls,
    ok: okRows.length,
    failed: rows.length - okRows.length,
    successRate: rows.length ? round((okRows.length / rows.length) * 100, 2) : 0,
    cacheHits: rows.filter((row) => row.cacheHit).length,
    avgSeconds: round(rows.reduce((sum, row) => sum + row.ms, 0) / Math.max(1, rows.length) / 1000, 2),
    p50Seconds: round(percentile(durations, 50) / 1000, 2),
    p95Seconds: round(percentile(durations, 95) / 1000, 2),
    requestsPerMinute: round(rows.length / Math.max(1, (finishedAt.getTime() - startedAt.getTime()) / 60000), 2),
    validSearchesPerMinute: round(okRows.length / Math.max(1, (finishedAt.getTime() - startedAt.getTime()) / 60000), 2),
    totalDemand: okRows.reduce((sum, row) => sum + row.demand, 0),
    totalRevenue: round(okRows.reduce((sum, row) => sum + row.revenue, 0), 2),
    bySource,
    errors,
  };
}

function printSummary(summary) {
  console.log("\nResumo");
  console.log(`Sucesso: ${summary.ok}/${summary.requests} (${summary.successRate}%)`);
  console.log(`Cache hits: ${summary.cacheHits}`);
  console.log(`Tempo medio: ${summary.avgSeconds}s | p50: ${summary.p50Seconds}s | p95: ${summary.p95Seconds}s`);
  console.log(`Rendimento: ${summary.requestsPerMinute} buscas/min | ${summary.validSearchesPerMinute} buscas validas/min`);
  console.log(`Demanda total retornada: ${summary.totalDemand.toLocaleString("pt-BR")}`);
  console.log(`Receita total retornada: ${summary.totalRevenue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`);
  console.log(`Fontes: ${JSON.stringify(summary.bySource)}`);
  if (Object.keys(summary.errors).length) {
    console.log(`Erros: ${JSON.stringify(summary.errors)}`);
  }
}

function logProgress(row) {
  const status = row.ok ? "OK" : "FALHA";
  const cache = row.cacheHit ? " cache" : "";
  const demand = row.demand ? ` demanda=${row.demand.toLocaleString("pt-BR")}` : "";
  const revenue = row.revenue ? ` receita=${row.revenue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}` : "";
  const error = row.ok ? "" : ` erro=${String(row.error).slice(0, 120)}`;
  console.log(`[${row.index}/${requests}] ${status}${cache} ${row.seconds}s "${row.query}" source=${row.source} items=${row.items}${demand}${revenue}${error}`);
}

function toCsv(rows) {
  const header = ["index", "query", "ok", "seconds", "source", "cacheHit", "items", "demand", "revenue", "averageTicket", "firstTitle", "error"];
  return [
    header.join(","),
    ...rows.map((row) => header.map((key) => csvCell(row[key])).join(",")),
  ].join("\n");
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function estimateMaxZyteCalls(total) {
  const pages = Number(process.env.ZYTE_SEARCH_PAGES || 4);
  const details = Number(process.env.ZYTE_DETAIL_LIMIT || 60);
  return total * (Math.max(1, pages) + Math.max(1, details));
}

function positiveInt(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    fail(`--${name} precisa ser um numero inteiro positivo.`);
  }
  return number;
}

function boolArg(value) {
  if (value === true || value === "") {
    return true;
  }
  return ["1", "true", "yes", "sim"].includes(String(value || "").toLowerCase());
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const [key, inlineValue] = arg.slice(2).split("=");
    if (inlineValue !== undefined) {
      parsed[key] = inlineValue;
    } else if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
      parsed[key] = argv[index + 1];
      index += 1;
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
}

function loadEnvFile(file) {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) {
    return;
  }
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function extractCookie(response) {
  const raw = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  return raw.map((item) => item.split(";")[0]).join("; ");
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function percentile(values, p) {
  if (!values.length) {
    return 0;
  }
  const index = Math.ceil((p / 100) * values.length) - 1;
  return values[Math.max(0, Math.min(values.length - 1, index))];
}

function trimTrailingSlash(value) {
  return String(value).replace(/\/+$/, "");
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
