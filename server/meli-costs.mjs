const API_BASE = "https://api.mercadolibre.com";
const LISTING_TYPES = Object.freeze({
  classic: "gold_special",
  premium: "gold_pro",
});

export async function enrichMercadoLivreCosts(result, { accessToken, siteId = "MLB" } = {}) {
  if (!result?.ok || !Array.isArray(result.items) || !accessToken) {
    return result;
  }

  const items = await Promise.all(result.items.map(async (item) => {
    const [fees, shippingQuote] = await Promise.all([
      fetchOfficialListingFees(item, { accessToken, siteId }).catch(() => null),
      fetchOfficialShippingQuote(item, { accessToken }).catch(() => null),
    ]);
    return {
      ...item,
      ...(fees ? { marketplaceFees: fees } : {}),
      ...(shippingQuote ? { shippingQuote } : {}),
    };
  }));

  return { ...result, items };
}

export async function fetchOfficialListingFees(item, { accessToken, siteId = "MLB" } = {}) {
  if (!accessToken || !item?.categoryId || !(Number(item.price) > 0)) {
    return null;
  }

  const params = new URLSearchParams({
    category_id: String(item.categoryId),
    price: String(Number(item.price)),
    currency_id: "BRL",
  });
  if (item.shippingMode) {
    params.set("shipping_modes", String(item.shippingMode));
  }
  if (item.logisticType) {
    params.set("logistic_type", String(item.logisticType));
  }
  const billableWeightGrams = shippingWeightGrams(item);
  if (billableWeightGrams) {
    params.set("billable_weight", String(billableWeightGrams));
  }

  const response = await mercadoLivreFetch(
    `${API_BASE}/sites/${encodeURIComponent(siteId)}/listing_prices?${params}`,
    accessToken,
  );
  const rows = flattenRows(response);
  const classic = normalizeFee(rows.find((row) => row?.listing_type_id === LISTING_TYPES.classic));
  const premium = normalizeFee(rows.find((row) => row?.listing_type_id === LISTING_TYPES.premium));
  if (!classic && !premium) {
    return null;
  }

  return {
    source: "mercado_livre_official",
    calculatedAt: new Date().toISOString(),
    ...(classic ? { classic } : {}),
    ...(premium ? { premium } : {}),
  };
}

export async function fetchOfficialShippingQuote(item, { accessToken } = {}) {
  const sellerId = Number(item?.sellerId || 0);
  const itemId = String(item?.id || "").toUpperCase();
  if (!accessToken || !sellerId || !/^MLB\d+$/.test(itemId)) {
    return null;
  }

  const params = new URLSearchParams({
    item_id: itemId,
    free_shipping: String(item.freeShipping ?? Number(item.price) >= 79),
    verbose: "true",
  });
  const response = await mercadoLivreFetch(
    `${API_BASE}/users/${sellerId}/shipping_options/free?${params}`,
    accessToken,
  );
  const coverage = response?.coverage?.all_country;
  const amount = Number(coverage?.list_cost);
  if (!Number.isFinite(amount) || amount < 0) {
    return null;
  }

  return {
    amount,
    billableWeightKg: Number(coverage?.billable_weight) > 0
      ? Number((Number(coverage.billable_weight) / 1000).toFixed(3))
      : null,
    currencyId: coverage?.currency_id || "BRL",
    source: "mercado_livre_official",
    approximate: true,
    calculatedAt: new Date().toISOString(),
  };
}

async function mercadoLivreFetch(url, accessToken) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "BuscaVendasConfweb/1.0",
    },
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const detail = data?.message || data?.error || text || "sem detalhe";
    throw new Error(`Mercado Livre respondeu ${response.status}: ${String(detail).slice(0, 160)}`);
  }
  return data;
}

function normalizeFee(row) {
  if (!row) {
    return null;
  }
  const details = row.sale_fee_details || {};
  const total = Number(row.sale_fee_amount);
  const fixedFee = Number(details.fixed_fee || 0);
  const percentageFee = Number(details.percentage_fee || 0);
  if (!Number.isFinite(total) || total < 0 || !Number.isFinite(percentageFee)) {
    return null;
  }
  return {
    listingTypeId: row.listing_type_id,
    listingTypeName: row.listing_type_name || "",
    saleFeeAmount: total,
    percentageFee,
    fixedFee: Number.isFinite(fixedFee) ? fixedFee : 0,
    financingFee: Number(details.financing_add_on_fee || 0),
  };
}

function flattenRows(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => (Array.isArray(entry) ? flattenRows(entry) : [entry]));
}

function shippingWeightGrams(item) {
  const dimensions = String(item?.shippingDimensions || "");
  const dimensionsMatch = dimensions.match(/,\s*(\d+)\s*$/);
  if (dimensionsMatch) {
    return Number(dimensionsMatch[1]);
  }
  const weightKg = Number(item?.weightKg);
  return Number.isFinite(weightKg) && weightKg > 0 ? Math.round(weightKg * 1000) : 0;
}
