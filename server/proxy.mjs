import { getSetting, setSetting } from "./db.mjs";

export function isProxyEnabled() {
  return ["true", "1", "yes", "sim"].includes(proxyEnabledValue());
}

export function isProxyConfigured() {
  return Boolean(proxyPlaywrightConfig());
}

export function proxyPlaywrightConfig() {
  const rawUrl = proxyUrl();
  if (!rawUrl) {
    return null;
  }

  const normalized = /^[a-z][a-z0-9+.-]*:\/\//i.test(rawUrl) ? rawUrl : `http://${rawUrl}`;
  try {
    const url = new URL(normalized);
    const username = proxyUsername() || decodeURIComponent(url.username || "");
    const password = proxyPassword() || decodeURIComponent(url.password || "");
    url.username = "";
    url.password = "";

    return {
      server: url.toString().replace(/\/$/, ""),
      ...(username ? { username } : {}),
      ...(password ? { password } : {}),
    };
  } catch {
    return null;
  }
}

export async function testProxyConnection() {
  const proxy = proxyPlaywrightConfig();
  if (!isProxyEnabled()) {
    throw new Error("Ative o proxy no painel admin antes de testar.");
  }
  if (!proxy) {
    throw new Error("Configure a URL do proxy no painel admin.");
  }

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    headless: true,
    proxy,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.goto("https://api.ipify.org?format=json", { waitUntil: "domcontentloaded", timeout: proxyTimeoutMs() });
    const body = await page.textContent("body", { timeout: proxyTimeoutMs() }).catch(() => "");
    return {
      ok: true,
      proxyIp: parseProxyIp(body),
      message: "Proxy conectado com sucesso.",
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

export function syncProxySettingsFromEnv() {
  const values = {
    proxy_enabled: process.env.PROXY_ENABLED,
    proxy_url: process.env.PROXY_URL,
    proxy_username: process.env.PROXY_USERNAME,
    proxy_password: process.env.PROXY_PASSWORD,
    proxy_country: process.env.PROXY_COUNTRY,
    proxy_timeout_ms: process.env.PROXY_TIMEOUT_MS,
  };

  for (const [key, value] of Object.entries(values)) {
    if (value && !getSetting(key)) {
      setSetting(key, value.trim());
    }
  }
}

function proxyEnabledValue() {
  return (getSetting("proxy_enabled") ?? process.env.PROXY_ENABLED ?? "false").trim().toLowerCase();
}

function proxyUrl() {
  return (getSetting("proxy_url") || process.env.PROXY_URL || "").trim();
}

function proxyUsername() {
  return (getSetting("proxy_username") || process.env.PROXY_USERNAME || "").trim();
}

function proxyPassword() {
  return (getSetting("proxy_password") || process.env.PROXY_PASSWORD || "").trim();
}

function proxyTimeoutMs() {
  return Number(getSetting("proxy_timeout_ms") || process.env.PROXY_TIMEOUT_MS || 30_000);
}

function parseProxyIp(text) {
  try {
    return JSON.parse(text || "{}")?.ip || "";
  } catch {
    return String(text || "").trim();
  }
}
