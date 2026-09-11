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

const BUNDLE_WORDS = ["kit", "combo", "conjunto", "jogo", "pack", "pacote"];
const EQUIVALENT_TOKEN_GROUPS = [
  new Set(["conjunto", "jogo"]),
  new Set(["faqueiro", "talher"]),
];
const OPTIONAL_MODIFIER_WORDS = new Set([
  "aco",
  "aluminio",
  "borracha",
  "couro",
  "ferro",
  "madeira",
  "mdf",
  "mdp",
  "metal",
  "moda",
  "plastico",
  "tecido",
  "vidro",
]);
const COMPONENT_WORDS = new Set([
  "base",
  "estrutura",
  "gaveta",
  "peca",
  "perna",
  "pernas",
  "pe",
  "pes",
  "prateleira",
  "suporte",
  "tampo",
]);
const TOKEN_CORRECTIONS = new Map([
  ["bluetooh", "bluetooth"],
  ["bluethoot", "bluetooth"],
  ["bluetoth", "bluetooth"],
  ["bluetooht", "bluetooth"],
  ["bluetoot", "bluetooth"],
  ["blutooht", "bluetooth"],
  ["blutooth", "bluetooth"],
  ["calsa", "calca"],
  ["calssa", "calca"],
  ["escrinaninha", "escrivaninha"],
  ["escrivanina", "escrivaninha"],
  ["escrivaninhaa", "escrivaninha"],
  ["langerie", "lingerie"],
  ["rpk", "npk"],
  ["windbanner", "wind banner"],
]);
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
  const correctedNormalizedQuery = normalizeCorrectedText(query);
  const measures = extractMeasures(query);
  const tokens = tokenizeProductText(query);
  const allowsBundle = hasBundleSignal(query);

  return {
    original: String(query || "").trim(),
    normalized: correctedNormalizedQuery,
    rawNormalized: normalizedQuery,
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

  const requiredTokens = spec.tokens.filter((token) => !OPTIONAL_MODIFIER_WORDS.has(token));
  const tokensToMatch = requiredTokens.length ? requiredTokens : spec.tokens;

  for (const token of tokensToMatch) {
    if (!tokenMatchesTitle(token, titleTokens, normalizedTitle)) {
      return { ok: false, reason: `Termo ausente: ${token}` };
    }
  }

  if (isUnrequestedComponent(title, spec)) {
    return { ok: false, reason: "Resultado parece uma peca, nao o produto completo." };
  }

  if (spec.measures.length && !hasCompatibleMeasures(title, spec.measures)) {
    return { ok: false, reason: "Medida/peso diferente da busca." };
  }

  if (hasUnrequestedBundle(title, spec)) {
    return { ok: false, reason: "Resultado parece kit/combo, mas a busca não pediu kit." };
  }

  if (spec.isCreatineQuery && hasUnrequestedSupplementTerms(title, spec.normalized)) {
    return { ok: false, reason: "Resultado mistura outro suplemento ao produto buscado." };
  }

  return { ok: true, reason: "Correspondencia exata." };
}

export function matchesMarketplaceSearchResult(title, specOrQuery) {
  const spec = typeof specOrQuery === "string" ? buildProductQuerySpec(specOrQuery) : specOrQuery;
  const exactMatch = matchesProductQuery(title, spec);
  if (exactMatch.ok) {
    return { ...exactMatch, matchMode: "exact" };
  }

  const normalizedTitle = normalizeText(title);
  const titleTokens = new Set(tokenizeProductText(title));
  const relevantTokens = spec.tokens.filter((token) => !OPTIONAL_MODIFIER_WORDS.has(token));
  const tokensToMatch = relevantTokens.length ? relevantTokens : spec.tokens;
  const matchedTokens = tokensToMatch.filter((token) => tokenMatchesTitle(token, titleTokens, normalizedTitle));
  const numericTokens = tokensToMatch.filter((token) => /\d/.test(token));
  const minimumCoverage = tokensToMatch.length <= 2 ? 1 : 0.6;
  const minimumMatches = Math.ceil(tokensToMatch.length * minimumCoverage);

  if (
    matchedTokens.length < minimumMatches
    || matchedTokens.length / tokensToMatch.length < minimumCoverage
    || numericTokens.some((token) => !matchedTokens.includes(token))
  ) {
    return { ok: false, reason: exactMatch.reason, matchMode: "rejected" };
  }

  if (isUnrequestedComponent(title, spec)) {
    return { ok: false, reason: "Resultado parece uma peca, nao o produto completo.", matchMode: "rejected" };
  }

  if (spec.measures.length && !hasCompatibleMeasures(title, spec.measures)) {
    return { ok: false, reason: "Medida/peso diferente da busca.", matchMode: "rejected" };
  }

  if (hasUnrequestedBundle(title, spec)) {
    return { ok: false, reason: "Resultado parece kit/combo, mas a busca não pediu kit.", matchMode: "rejected" };
  }

  if (spec.isCreatineQuery && hasUnrequestedSupplementTerms(title, spec.normalized)) {
    return { ok: false, reason: "Resultado mistura outro suplemento ao produto buscado.", matchMode: "rejected" };
  }

  return {
    ok: true,
    reason: "Correspondencia relevante retornada pela busca do marketplace.",
    matchMode: "marketplace",
    matchedTokens,
  };
}

export function normalizedProductKey(text) {
  return normalizeText(text).replace(/\s+/g, "-");
}

export function normalizeProductSearchQuery(text) {
  return normalizeCorrectedText(text);
}

export function buildMarketplaceSearchQueries(query) {
  const exactQuery = normalizeProductSearchQuery(query);
  const spec = buildProductQuerySpec(query);
  const tokens = spec.tokens;
  const variants = [exactQuery];

  if (tokens.length >= 4) {
    const descriptiveTokens = tokens.filter((token) => token.length >= 5 || /\d/.test(token));
    if (descriptiveTokens.length >= 2) {
      variants.push(descriptiveTokens.join(" "));
    }
    variants.push([...tokens.slice(0, 2), tokens.at(-1)].join(" "));
  }

  if (tokens.length >= 3) {
    variants.push(tokens.slice(0, 3).join(" "));
    variants.push(tokens.slice(0, 2).join(" "));
  }

  return [...new Set(variants.map((value) => value.trim()).filter(Boolean))].slice(0, 5);
}

export function interpretMarketplaceQuery(query, candidateTitles = []) {
  const spec = buildProductQuerySpec(query);
  const titleTokenRows = candidateTitles
    .slice(0, 24)
    .map((title) => [...new Set(tokenizeProductText(title))]);
  const tokenStats = new Map();

  titleTokenRows.forEach((tokens, titleIndex) => {
    tokens.forEach((token) => {
      if (token.length < 3 || /\d/.test(token)) {
        return;
      }
      const current = tokenStats.get(token) || { token, occurrences: 0, rankScore: 0 };
      current.occurrences += 1;
      current.rankScore += 1 / (titleIndex + 1);
      tokenStats.set(token, current);
    });
  });

  const corrections = [];
  const interpretedTokens = spec.tokens.map((token) => {
    if (
      token.length < 4
      || /\d/.test(token)
      || titleTokenRows.some((titleTokens) => titleTokens.some((titleToken) => isDirectTokenMatch(token, titleToken)))
    ) {
      return token;
    }

    const candidates = [...tokenStats.values()]
      .map((candidate) => {
        const distance = damerauLevenshteinDistance(token, candidate.token);
        const similarity = 1 - (distance / Math.max(token.length, candidate.token.length));
        return { ...candidate, distance, similarity };
      })
      .filter((candidate) => {
        const distanceLimit = token.length >= 10 ? 3 : token.length >= 7 ? 2 : 1;
        return candidate.distance <= distanceLimit
          && candidate.similarity >= 0.7
          && (candidate.token[0] === token[0] || candidate.distance === 1);
      })
      .sort((left, right) => (
        left.distance - right.distance
        || right.occurrences - left.occurrences
        || right.rankScore - left.rankScore
        || left.token.localeCompare(right.token)
      ));
    const best = candidates[0];
    if (!best) {
      return token;
    }

    const confidence = best.distance === 1
      || (best.distance === 2 && token.length >= 8 && best.occurrences >= 2)
      ? "high"
      : "medium";
    corrections.push({
      from: token,
      to: best.token,
      confidence,
      occurrences: best.occurrences,
    });
    return best.token;
  });

  const hasKnownCorrection = spec.normalized !== spec.rawNormalized;
  const corrected = hasKnownCorrection || corrections.length > 0;
  const confidence = corrections.some((correction) => correction.confidence === "medium")
    ? "medium"
    : corrected
      ? "high"
      : "none";

  return {
    originalQuery: spec.original,
    normalizedQuery: spec.normalized,
    interpretedQuery: corrections.length ? interpretedTokens.join(" ") : spec.normalized,
    corrected,
    confidence,
    corrections,
  };
}

export function tokenizeProductText(text) {
  const withoutMeasures = stripMeasures(text);
  return normalizeCorrectedText(withoutMeasures)
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

function isUnrequestedComponent(title, spec) {
  const titleTokens = tokenizeProductText(title);
  const firstTitleToken = titleTokens[0] || "";
  if (!COMPONENT_WORDS.has(firstTitleToken)) {
    return false;
  }
  return !spec.tokens.some((token) => COMPONENT_WORDS.has(token));
}

function hasUnrequestedSupplementTerms(title, normalizedQuery) {
  const normalizedTitle = normalizeText(title);
  return SUPPLEMENT_EXTRA_TERMS.some((term) => !normalizedQuery.includes(term) && normalizedTitle.includes(term));
}

function hasUnrequestedBundle(title, spec) {
  if (spec.allowsBundle || !hasBundleSignal(title)) {
    return false;
  }
  const normalizedTitle = normalizeText(title);
  const isCompleteProduct = /\bkit completo\b/.test(normalizedTitle);
  const hasExplicitQuantity = /\b(?:kit|pack|pacote)(?:\s+completo)?\s+(?:com\s+)?\d+\b/.test(normalizedTitle);
  return !isCompleteProduct || hasExplicitQuantity;
}

function tokenMatchesTitle(token, titleTokens, normalizedTitle) {
  if ([...titleTokens].some((titleToken) => isDirectTokenMatch(token, titleToken))) {
    return true;
  }

  if (token.length < 5) {
    return false;
  }

  return [...titleTokens].some((titleToken) =>
    titleToken[0] === token[0]
    && Math.abs(titleToken.length - token.length) <= 1
    && levenshteinDistance(titleToken, token) <= 1,
  );
}

function isDirectTokenMatch(left, right) {
  return left === right
    || isPortugueseSingularPluralMatch(left, right)
    || areEquivalentProductTokens(left, right);
}

function areEquivalentProductTokens(left, right) {
  return EQUIVALENT_TOKEN_GROUPS.some((group) => {
    const leftMatchesGroup = [...group].some((term) => left === term || isPortugueseSingularPluralMatch(left, term));
    const rightMatchesGroup = [...group].some((term) => right === term || isPortugueseSingularPluralMatch(right, term));
    return leftMatchesGroup && rightMatchesGroup;
  });
}

function normalizeCorrectedText(text) {
  return normalizeText(text)
    .replace(/\bt\s*shirts?\b/g, "camiseta")
    .split(" ")
    .map(correctToken)
    .join(" ")
    .trim();
}

function isPortugueseSingularPluralMatch(left, right) {
  if (left === right || left.length < 3 || right.length < 3) {
    return false;
  }
  const singular = left.length < right.length ? left : right;
  const plural = left.length < right.length ? right : left;
  return portuguesePluralForms(singular).has(plural);
}

function portuguesePluralForms(singular) {
  const forms = new Set();

  if (singular.endsWith("ao")) {
    const stem = singular.slice(0, -2);
    forms.add(`${stem}oes`);
    forms.add(`${stem}aes`);
    forms.add(`${singular}s`);
    return forms;
  }

  const ending = singular.at(-1);
  if (/[aeiou]/.test(ending)) {
    forms.add(`${singular}s`);
  }
  if (/[rz]/.test(ending)) {
    forms.add(`${singular}es`);
  }
  if (ending === "m") {
    forms.add(`${singular.slice(0, -1)}ns`);
  }
  if (singular.endsWith("al")) {
    forms.add(`${singular.slice(0, -2)}ais`);
  }
  if (singular.endsWith("el")) {
    forms.add(`${singular.slice(0, -2)}eis`);
  }
  if (singular.endsWith("ol")) {
    forms.add(`${singular.slice(0, -2)}ois`);
  }
  if (singular.endsWith("ul")) {
    forms.add(`${singular.slice(0, -2)}uis`);
  }
  if (singular.endsWith("il")) {
    forms.add(`${singular.slice(0, -2)}is`);
  }

  return forms;
}

function correctToken(token) {
  return TOKEN_CORRECTIONS.get(token) || token;
}

function levenshteinDistance(a, b) {
  if (a === b) {
    return 0;
  }

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[b.length];
}

function damerauLevenshteinDistance(a, b) {
  const rows = a.length + 1;
  const columns = b.length + 1;
  const matrix = Array.from({ length: rows }, () => new Array(columns).fill(0));

  for (let row = 0; row < rows; row += 1) {
    matrix[row][0] = row;
  }
  for (let column = 0; column < columns; column += 1) {
    matrix[0][column] = column;
  }

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const substitutionCost = a[row - 1] === b[column - 1] ? 0 : 1;
      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + substitutionCost,
      );
      if (
        row > 1
        && column > 1
        && a[row - 1] === b[column - 2]
        && a[row - 2] === b[column - 1]
      ) {
        matrix[row][column] = Math.min(matrix[row][column], matrix[row - 2][column - 2] + 1);
      }
    }
  }

  return matrix[a.length][b.length];
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
