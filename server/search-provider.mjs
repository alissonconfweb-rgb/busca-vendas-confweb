export const SEARCH_PROVIDER_MODES = Object.freeze({
  AUTO: "auto",
  MERCADO_LIVRE_ONLY: "meli_only",
  SCRAPE_DO_ONLY: "scrapedo_only",
});

const VALID_MODES = new Set(Object.values(SEARCH_PROVIDER_MODES));

export function normalizeSearchProviderMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  return VALID_MODES.has(mode) ? mode : SEARCH_PROVIDER_MODES.AUTO;
}

export function searchProviderPlan(value) {
  const mode = normalizeSearchProviderMode(value);
  return {
    mode,
    useMercadoLivre: mode !== SEARCH_PROVIDER_MODES.SCRAPE_DO_ONLY,
    useScrapeDo: mode !== SEARCH_PROVIDER_MODES.MERCADO_LIVRE_ONLY,
  };
}
