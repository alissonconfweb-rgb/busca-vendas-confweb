import { getSetting, setSetting } from "./db.mjs";

export function isValidMeliClientId(value) {
  return /^\d{4,20}$/.test(String(value || "").trim());
}

export function isValidMeliRedirectUri(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (!url.pathname.endsWith("/api/meli/callback")) {
      return false;
    }
    return url.protocol === "https:" || url.hostname === "127.0.0.1" || url.hostname === "localhost";
  } catch {
    return false;
  }
}

export function resolveMeliRedirectUri() {
  const fromEnv = process.env.MELI_REDIRECT_URI?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  const external = process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL;
  if (external) {
    return `${external.replace(/\/$/, "")}/api/meli/callback`;
  }

  const fromSetting = getSetting("meli_redirect_uri")?.trim();
  if (fromSetting) {
    return fromSetting;
  }

  return "http://127.0.0.1:3001/api/meli/callback";
}

export function syncMeliSettingsFromEnv() {
  if (process.env.MELI_CLIENT_ID?.trim()) {
    setSetting("meli_client_id", process.env.MELI_CLIENT_ID.trim());
  }
  if (process.env.MELI_CLIENT_SECRET?.trim()) {
    setSetting("meli_client_secret", process.env.MELI_CLIENT_SECRET.trim());
  }
  if (process.env.MELI_SITE_ID?.trim()) {
    setSetting("meli_site_id", process.env.MELI_SITE_ID.trim());
  }

  setSetting("meli_redirect_uri", resolveMeliRedirectUri());

  const currentClientId = getSetting("meli_client_id");
  if (currentClientId && !isValidMeliClientId(currentClientId)) {
    setSetting("meli_client_id", "");
    setSetting(
      "meli_last_error",
      "App ID inválido salvo anteriormente. Informe o número da aplicação no DevCenter do Mercado Livre, não o e-mail da conta.",
    );
  }
}

export function validateMeliSettingsInput(body) {
  if (body.meli_client_id !== undefined) {
    const clientId = String(body.meli_client_id || "").trim();
    if (clientId && !isValidMeliClientId(clientId)) {
      throw new Error("App ID do Mercado Livre inválido. Use o número da aplicação no DevCenter, não o e-mail da conta.");
    }
  }

  if (body.meli_redirect_uri !== undefined) {
    const redirectUri = String(body.meli_redirect_uri || "").trim();
    if (redirectUri && !isValidMeliRedirectUri(redirectUri)) {
      throw new Error("Redirect URI inválida. Use a URL HTTPS que termina em /api/meli/callback.");
    }
  }
}
