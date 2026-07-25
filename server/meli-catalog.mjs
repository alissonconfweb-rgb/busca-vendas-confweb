import {
  buildProductQuerySpec,
  matchesProductQuery,
  normalizeProductSearchQuery,
} from "./product-match.mjs";

const API_ROOT = "https://api.mercadolibre.com";
const MAX_PRODUCT_DETAILS = 24;
const DETAIL_CONCURRENCY = 8;

export async function searchMercadoLivreCatalog({ query, accessToken, siteId = "MLB" }) {
  if (!accessToken) {
    return emptyCatalogResult("Catálogo Mercado Livre sem token OAuth.");
  }

  const normalizedQuery = normalizeProductSearchQuery(query);
  const spec = buildProductQuerySpec(query);
  const candidates = new Map();

  const [productsResponse, discoveryResponse] = await Promise.all([
    fetchJson(
      `${API_ROOT}/products/search?status=active&site_id=${encodeURIComponent(siteId)}&q=${encodeURIComponent(normalizedQuery)}&limit=50`,
      accessToken,
    ),
    fetchJson(
      `${API_ROOT}/sites/${encodeURIComponent(siteId)}/domain_discovery/search?q=${encodeURIComponent(normalizedQuery)}&limit=3`,
    ),
  ]);

  if (productsResponse.ok) {
    for (const product of productsResponse.data?.results || []) {
      if (product?.id && product?.status === "active") {
        addCandidate(candidates, {
          id: product.id,
          type: "PRODUCT",
          searchProduct: product,
          searchPosition: candidates.size + 1,
        });
      }
    }
  }

  const discovery = Array.isArray(discoveryResponse.data)
    ? discoveryResponse.data.find((entry) => entry?.category_id)
    : null;
  if (discovery?.category_id) {
    const highlightsResponse = await fetchJson(
      `${API_ROOT}/highlights/${encodeURIComponent(siteId)}/category/${encodeURIComponent(discovery.category_id)}`,
      accessToken,
    );
    if (highlightsResponse.ok) {
      for (const highlight of highlightsResponse.data?.content || []) {
        if (!highlight?.id) {
          continue;
        }
        addCandidate(candidates, {
          id: highlight.id,
          type: normalizeHighlightType(highlight),
          highlightPosition: Number(highlight.position || 999),
          categoryId: discovery.category_id,
          categoryName: discovery.category_name || "",
        });
      }
    }
  }

  if (!candidates.size) {
    const status = productsResponse.status || discoveryResponse.status || 0;
    return emptyCatalogResult(
      status
        ? `Catálogo Mercado Livre respondeu ${status}, mas não retornou candidatos.`
        : "Catálogo Mercado Livre não retornou candidatos.",
    );
  }

  const orderedCandidates = [...candidates.values()]
    .sort((a, b) => (
      Number(a.highlightPosition || 999) - Number(b.highlightPosition || 999)
      || Number(a.searchPosition || 999) - Number(b.searchPosition || 999)
    ))
    .slice(0, MAX_PRODUCT_DETAILS);

  const detailed = await mapWithConcurrency(
    orderedCandidates,
    DETAIL_CONCURRENCY,
    (candidate) => fetchCandidateDetail(candidate, accessToken, siteId),
  );

  const completeItems = detailed
    .filter(Boolean)
    .filter((item) => (
      item.title
      && item.price > 0
      && item.soldQuantity > 0
      && matchesProductQuery(item.title, spec).ok
    ))
    .sort((a, b) => (
      b.soldQuantity - a.soldQuantity
      || a.highlightPosition - b.highlightPosition
      || a.searchPosition - b.searchPosition
    ));

  const items = dedupeItems(completeItems).slice(0, 3);
  const demand = items.reduce((sum, item) => sum + item.soldQuantity, 0);
  const revenue = items.reduce((sum, item) => sum + item.revenue, 0);

  if (items.length < 3) {
    return {
      ...emptyCatalogResult(
        `A API oficial encontrou ${items.length} produto(s) exato(s) com preço e vendas públicas para "${query}".`,
      ),
      source: "mercado_livre_catalog_incomplete_sales",
      exactMatches: items.length,
      totalAvailable: candidates.size,
    };
  }

  return {
    ok: true,
    source: "mercado_livre_catalog_champions",
    metricsMode: "sales",
    salesAvailable: true,
    strictRealOnly: true,
    message: "Dados reais do catálogo oficial e do ranking de mais vendidos do Mercado Livre.",
    items,
    exactMatches: items.length,
    totalAvailable: candidates.size,
    totals: {
      demand,
      revenue,
      averageTicket: demand ? revenue / demand : 0,
      actualDemand: demand,
      isEstimated: false,
    },
  };
}

async function fetchCandidateDetail(candidate, accessToken, siteId) {
  if (candidate.type === "PRODUCT") {
    const response = await fetchJson(
      `${API_ROOT}/products/${encodeURIComponent(candidate.id)}`,
      accessToken,
    );
    if (!response.ok) {
      return null;
    }
    return mapProduct(candidate, response.data, siteId);
  }

  if (candidate.type === "ITEM" && /^MLB\d+$/i.test(candidate.id)) {
    const response = await fetchJson(
      `${API_ROOT}/items/${encodeURIComponent(candidate.id)}`,
      accessToken,
    );
    if (!response.ok) {
      return null;
    }
    return mapItem(candidate, response.data);
  }

  if (candidate.type === "USER_PRODUCT" && /^MLBU\d+$/i.test(candidate.id)) {
    const response = await fetchJson(
      `${API_ROOT}/user-products/${encodeURIComponent(candidate.id)}`,
      accessToken,
    );
    if (!response.ok) {
      return null;
    }
    const itemId = linkedItemId(response.data, siteId);
    const itemResponse = itemId
      ? await fetchJson(`${API_ROOT}/items/${encodeURIComponent(itemId)}`, accessToken)
      : null;
    return mapUserProduct(candidate, response.data, itemResponse?.ok ? itemResponse.data : null);
  }

  return null;
}

function mapProduct(candidate, detail, siteId) {
  const winner = detail?.buy_box_winner || {};
  const soldQuantity = positiveNumber(detail?.sold_quantity)
    || positiveNumber(winner?.sold_quantity);
  const price = positiveNumber(winner?.price)
    || positiveNumber(detail?.price)
    || positiveNumber(candidate.searchProduct?.buy_box_winner?.price);
  const itemId = winner?.item_id || candidate.searchProduct?.buy_box_winner?.item_id || "";
  const title = detail?.name || candidate.searchProduct?.name || "";
  const permalink = detail?.permalink
    || candidate.searchProduct?.permalink
    || `https://www.mercadolivre.com.br/p/${detail?.id || candidate.id}`;
  const image = firstImage(detail) || firstImage(candidate.searchProduct);

  return {
    id: itemId || detail?.id || candidate.id,
    catalogProductId: detail?.id || candidate.id,
    title,
    subtitle: candidate.highlightPosition < 999
      ? `${candidate.highlightPosition}º mais vendido na categoria`
      : "Produto do catálogo oficial Mercado Livre",
    image: String(image || "").replace("http://", "https://"),
    price,
    soldQuantity,
    estimatedSoldQuantity: null,
    revenue: Number((price * soldQuantity).toFixed(2)),
    estimatedRevenue: null,
    permalink: normalizeProductPermalink(permalink, siteId, detail?.id || candidate.id, itemId),
    categoryId: winner?.category_id || candidate.categoryId || "",
    categoryName: candidate.categoryName || "",
    weightKg: productWeightKg(detail),
    highlightPosition: candidate.highlightPosition || 999,
    searchPosition: candidate.searchPosition || 999,
  };
}

function mapItem(candidate, detail) {
  const price = positiveNumber(detail?.price);
  const soldQuantity = positiveNumber(detail?.sold_quantity);
  return {
    id: detail?.id || candidate.id,
    title: detail?.title || "",
    subtitle: candidate.highlightPosition < 999
      ? `${candidate.highlightPosition}º mais vendido na categoria`
      : "Anúncio do Mercado Livre",
    image: String(detail?.thumbnail || detail?.pictures?.[0]?.secure_url || "").replace("http://", "https://"),
    price,
    soldQuantity,
    estimatedSoldQuantity: null,
    revenue: Number((price * soldQuantity).toFixed(2)),
    estimatedRevenue: null,
    permalink: detail?.permalink || "",
    categoryId: detail?.category_id || candidate.categoryId || "",
    categoryName: candidate.categoryName || "",
    weightKg: productWeightKg(detail),
    highlightPosition: candidate.highlightPosition || 999,
    searchPosition: candidate.searchPosition || 999,
  };
}

function mapUserProduct(candidate, detail, itemDetail) {
  const price = positiveNumber(detail?.price)
    || positiveNumber(itemDetail?.price)
    || positiveNumber(detail?.listing_sites?.[0]?.price);
  const soldQuantity = positiveNumber(detail?.sold_quantity)
    || positiveNumber(detail?.sales_quantity)
    || positiveNumber(itemDetail?.sold_quantity);
  const title = detail?.name
    || detail?.user_product_name
    || detail?.family_name
    || itemDetail?.title
    || "";

  return {
    id: itemDetail?.id || detail?.id || candidate.id,
    userProductId: detail?.id || candidate.id,
    title,
    subtitle: candidate.highlightPosition < 999
      ? `${candidate.highlightPosition}º mais vendido na categoria`
      : "Produto líder no ranking do Mercado Livre",
    image: String(firstImage(detail) || firstImage(itemDetail) || "").replace("http://", "https://"),
    price,
    soldQuantity,
    estimatedSoldQuantity: null,
    revenue: Number((price * soldQuantity).toFixed(2)),
    estimatedRevenue: null,
    permalink: itemDetail?.permalink
      || detail?.permalink
      || `https://lista.mercadolivre.com.br/${encodeURIComponent(title)}`,
    categoryId: detail?.category_id || itemDetail?.category_id || candidate.categoryId || "",
    categoryName: candidate.categoryName || "",
    weightKg: productWeightKg(detail) || productWeightKg(itemDetail),
    highlightPosition: candidate.highlightPosition || 999,
    searchPosition: candidate.searchPosition || 999,
  };
}

function linkedItemId(detail, siteId) {
  const listingSites = Array.isArray(detail?.listing_sites) ? detail.listing_sites : [];
  const siteListing = listingSites.find((entry) => entry?.site_id === siteId) || listingSites[0] || {};
  const candidates = [
    detail?.item_id,
    detail?.item?.id,
    detail?.items?.[0]?.id,
    detail?.item_ids?.[0],
    siteListing?.item_id,
    siteListing?.item?.id,
  ];
  return String(candidates.find((value) => /^MLB\d+$/i.test(String(value || ""))) || "");
}

function addCandidate(candidates, next) {
  const current = candidates.get(next.id) || {};
  candidates.set(next.id, {
    id: next.id,
    type: next.type || current.type || "PRODUCT",
    searchProduct: next.searchProduct || current.searchProduct || null,
    searchPosition: next.searchPosition || current.searchPosition || 999,
    highlightPosition: next.highlightPosition || current.highlightPosition || 999,
    categoryId: next.categoryId || current.categoryId || "",
    categoryName: next.categoryName || current.categoryName || "",
  });
}

function normalizeHighlightType(highlight) {
  if (/^MLBU/i.test(highlight.id || "")) {
    return "USER_PRODUCT";
  }
  return String(highlight.type || "PRODUCT").toUpperCase();
}

function firstImage(product) {
  return product?.pictures?.[0]?.secure_url
    || product?.pictures?.[0]?.url
    || product?.thumbnail
    || "";
}

function productWeightKg(detail) {
  const attributes = [
    ...(detail?.attributes || []),
    ...(detail?.buy_box_winner?.item_override_attributes || []),
  ];
  for (const attribute of attributes) {
    if (!/(?:PACKAGE_)?WEIGHT|PESO/i.test(attribute?.id || attribute?.name || "")) {
      continue;
    }
    const number = positiveNumber(attribute?.value_struct?.number);
    const unit = String(attribute?.value_struct?.unit || attribute?.value_name || "").toLowerCase();
    if (number > 0) {
      return unit.includes("kg") ? number : Number((number / 1000).toFixed(3));
    }
    const match = String(attribute?.value_name || "").match(/(\d+(?:[.,]\d+)?)\s*(kg|g|gr)/i);
    if (match) {
      const value = Number(match[1].replace(",", "."));
      return match[2].toLowerCase() === "kg" ? value : Number((value / 1000).toFixed(3));
    }
  }
  return null;
}

function normalizeProductPermalink(permalink, siteId, productId, itemId) {
  const fallback = siteId === "MLB"
    ? `https://www.mercadolivre.com.br/p/${productId}`
    : String(permalink || "");
  try {
    const url = new URL(permalink || fallback);
    if (itemId) {
      url.searchParams.set("item_id", itemId);
    }
    return url.toString();
  } catch {
    return fallback;
  }
}

function dedupeItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.catalogProductId || item.id;
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

async function mapWithConcurrency(values, concurrency, worker) {
  const results = new Array(values.length);
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(values[index]);
      }
    },
  );
  await Promise.all(runners);
  return results;
}

async function fetchJson(url, accessToken = "") {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        "User-Agent": "BuscaVendasConfweb/1.0",
      },
      signal: AbortSignal.timeout(8_000),
    });
    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { message: text.slice(0, 180) };
    }
    return {
      ok: response.ok,
      status: response.status,
      data,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: { message: error instanceof Error ? error.message : "Falha Mercado Livre." },
    };
  }
}

function positiveNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function emptyCatalogResult(message) {
  return {
    ok: false,
    source: "mercado_livre_catalog_empty",
    strictRealOnly: true,
    metricsMode: "sales",
    salesAvailable: false,
    message,
    items: [],
    exactMatches: 0,
    totalAvailable: 0,
    totals: { demand: 0, revenue: 0, averageTicket: 0, actualDemand: 0 },
  };
}
