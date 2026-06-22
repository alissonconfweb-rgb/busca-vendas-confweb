const STOPWORDS = new Set([
  "a",
  "as",
  "com",
  "da",
  "das",
  "de",
  "do",
  "dos",
  "e",
  "em",
  "na",
  "no",
  "para",
  "por",
  "sem",
  "the",
]);

const BUNDLE_WORDS = ["kit", "combo", "conjunto", "pack", "pacote"];
const SUPPLEMENT_EXTRA_TERMS = [
  "albumina",
  "bcaa",
  "coqueteleira",
  "glutamina",
  "hipercalorico",
  "isomaltulose",
  "isolate",
  "pre treino",
  "pretreino",
  "termogenico",
  "vitamina",
  "whey",
];

const MEASURE_RE_SOURCE = "(\\d+(?:[,.]\\d+)?)\\s*(kg|kgs|quilo|quilos|kilo|kilos|g|gr|grama|gramas|l|litro|litros|ml|mililitro|mililitros)\\b";
const STORAGE_RE_SOURCE = "(\\d+(?:[,.]\\d+)?)\\s*(gb|giga|gigabytes|tb|tera|terabytes)\\b";

export function buildProductQuerySpec(query) {
  const normalizedQuery = normalizeText(query);
  const measures = extractMeasures(query);
  const tokens = tokenizeProductText(query);
  const allowsBundle = hasBundleSignal(query);

  return {
    original: String(query || "").trim(),
    normalized: normalizedQuery,
    tokens,
    measures,
    allowsBundle,
    isCreatineQuery: tokens.includes("creatina"),
  };
}

export function matchesProductQuery(title, specOrQuery) {
  const spec = typeof specOrQuery === "string" ? buildProductQuerySpec(specOrQuery) : specOrQuery;
  const normalizedTitle = normalizeText(title);
  const titleTokens = new Set(tokenizeProductText(title));

  if (!spec.tokens.length) {
    return { ok: false, reason: "Busca sem termos validos." };
  }

  for (const token of spec.tokens) {
    if (!titleTokens.has(token) && !normalizedTitle.includes(token)) {
      return { ok: false, reason: `Termo ausente: ${token}` };
    }
  }

  if (spec.measures.length && !hasCompatibleMeasures(title, spec.measures)) {
    return { ok: false, reason: "Medida/peso diferente da busca." };
  }

  if (!spec.allowsBundle && hasBundleSignal(title)) {
    return { ok: false, reason: "Resultado parece kit/combo, mas a busca nao pediu kit." };
  }

  if (spec.isCreatineQuery && hasUnrequestedSupplementTerms(title, spec.normalized)) {
    return { ok: false, reason: "Resultado mistura outro suplemento ao produto buscado." };
  }

  return { ok: true, reason: "Correspondencia exata." };
}

export function normalizedProductKey(text) {
  return normalizeText(text).replace(/\s+/g, "-");
}

export function tokenizeProductText(text) {
  const withoutMeasures = stripMeasures(text);
  return normalizeText(withoutMeasures)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token && !STOPWORDS.has(token));
}

export function extractMeasures(text) {
  const source = normalizeMeasureText(text);
  const measures = [];

  for (const match of source.matchAll(new RegExp(MEASURE_RE_SOURCE, "gi"))) {
    const value = Number(String(match[1]).replace(",", "."));
    const unit = match[2].toLowerCase();
    const converted = convertMeasure(value, unit);
    if (converted) {
      measures.push(converted);
    }
  }

  for (const match of source.matchAll(new RegExp(STORAGE_RE_SOURCE, "gi"))) {
    const value = Number(String(match[1]).replace(",", "."));
    const unit = match[2].toLowerCase();
    measures.push({
      kind: "storage",
      value: unit.startsWith("t") ? value * 1024 : value,
      unit: "gb",
    });
  }

  return measures;
}

function hasCompatibleMeasures(title, requiredMeasures) {
  const titleMeasures = extractMeasures(title);
  if (!titleMeasures.length) {
    return false;
  }

  return requiredMeasures.every((required) =>
    titleMeasures.some((candidate) =>
      candidate.kind === required.kind && almostSameMeasure(candidate.value, required.value, required.kind),
    ),
  );
}

function almostSameMeasure(candidate, required, kind) {
  const tolerance = kind === "storage" ? 0.1 : Math.max(1, required * 0.015);
  return Math.abs(candidate - required) <= tolerance;
}

function convertMeasure(value, unit) {
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  if (["kg", "kgs", "quilo", "quilos", "kilo", "kilos"].includes(unit)) {
    return { kind: "weight", value: value * 1000, unit: "g" };
  }
  if (["g", "gr", "grama", "gramas"].includes(unit)) {
    return { kind: "weight", value, unit: "g" };
  }
  if (["l", "litro", "litros"].includes(unit)) {
    return { kind: "volume", value: value * 1000, unit: "ml" };
  }
  if (["ml", "mililitro", "mililitros"].includes(unit)) {
    return { kind: "volume", value, unit: "ml" };
  }

  return null;
}

function stripMeasures(text) {
  return normalizeMeasureText(text)
    .replace(new RegExp(MEASURE_RE_SOURCE, "gi"), " ")
    .replace(new RegExp(STORAGE_RE_SOURCE, "gi"), " ");
}

function hasBundleSignal(text) {
  const normalized = normalizeText(text);
  const measurable = normalizeMeasureText(text);
  return (
    BUNDLE_WORDS.some((word) => new RegExp(`\\b${word}\\b`, "i").test(normalized)) ||
    measurable.includes("+") ||
    /\b\d+\s*x\b/i.test(measurable)
  );
}

function hasUnrequestedSupplementTerms(title, normalizedQuery) {
  const normalizedTitle = normalizeText(title);
  return SUPPLEMENT_EXTRA_TERMS.some((term) => !normalizedQuery.includes(term) && normalizedTitle.includes(term));
}

function normalizeMeasureText(text) {
  return stripAccents(String(text || ""))
    .toLowerCase()
    .replace(/,/g, ".")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(text) {
  return stripAccents(String(text || ""))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripAccents(text) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
