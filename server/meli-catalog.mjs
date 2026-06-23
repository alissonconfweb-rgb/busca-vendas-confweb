import { buildProductQuerySpec, matchesProductQuery, normalizeProductSearchQuery } from "./product-match.mjs";

export async function searchMercadoLivreCatalog({ query, accessToken, siteId = "MLB" }) {
  if (!accessToken) {
    return emptyCatalogResult("Catalogo Mercado Livre sem token OAuth.");
  }

  const productsResponse = await fetchJson(
    `https://api.mercadolibre.com/products/search?site_id=${encodeURIComponent(siteId)}&q=${encodeURIComponent(normalizeProductSearchQuery(query))}&limit=40`,
    accessToken,
  );

  if (!productsResponse.ok) {
    return emptyCatalogResult(`Catalogo Mercado Livre respondeu ${productsResponse.status}.`);
  }

  const productsData = productsResponse.data;
  const spec = buildProductQuerySpec(query);
  const exactProducts = (productsData.results || [])
    .filter((product) => product.status === "active" && product.name && matchesProductQuery(product.name, spec).ok)
    .slice(0, 12);
  const items = [];

  for (const product of exactProducts) {
    if (items.length >= 3) {
      break;
    }

    const [detailResponse, offersResponse] = await Promise.all([
      fetchJson(`https://api.mercadolibre.com/products/${encodeURIComponent(product.id)}`, accessToken),
      fetchJson(`https://api.mercadolibre.com/products/${encodeURIComponent(product.id)}/items`, accessToken),
    ]);

    if (!offersResponse.ok || !offersResponse.data?.results?.length) {
      continue;
    }

    const offer = chooseOffer(offersResponse.data.results);
    const price = Number(offer.price || 0);
    if (!price) {
      continue;
    }

    const detail = detailResponse.ok ? detailResponse.data : product;
    const offersTotal = Number(offersResponse.data.paging?.total || offersResponse.data.results.length || 1);

    items.push({
      id: offer.item_id || product.id,
      title: detail.name || product.name,
      subtitle: `Catalogo oficial Mercado Livre - ${offersTotal} oferta(s) ativa(s)`,
      image: String(detail.pictures?.[0]?.url || "").replace("http://", "https://"),
      price,
      soldQuantity: null,
      salesMetricLabel: "Nao divulgado",
      revenue: null,
      revenueMetricLabel: "Aguardando API",
      permalink: `https://www.mercadolivre.com.br/p/${product.id}${offer.item_id ? `?item_id=${offer.item_id}` : ""}`,
    });
  }

  const averageTicket = items.length ? items.reduce((sum, item) => sum + item.price, 0) / items.length : 0;

  if (!items.length) {
    return emptyCatalogResult(`O catalogo oficial nao retornou ofertas ativas que batem exatamente com "${query}".`);
  }

  return {
    ok: true,
    source: "mercado_livre_catalog",
    metricsMode: "market_signal",
    salesAvailable: false,
    message: "Produtos e ofertas reais do catalogo oficial Mercado Livre com filtro exato. Vendas por anuncio ainda nao estao liberadas pela API, entao nao foram simuladas.",
    items,
    exactMatches: items.length,
    totalAvailable: productsData.paging?.total || items.length,
    totals: {
      demand: 0,
      revenue: 0,
      averageTicket,
    },
  };
}

function chooseOffer(offers) {
  return [...offers].sort((a, b) => offerScore(a) - offerScore(b))[0];
}

function offerScore(offer) {
  const fulfillmentBonus = offer.shipping?.logistic_type === "fulfillment" ? -20 : 0;
  const price = Number(offer.price || 999999);
  return fulfillmentBonus + price / 1000;
}

async function fetchJson(url, accessToken) {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "BuscaVendasConfweb/1.0",
      },
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      data: text ? JSON.parse(text) : {},
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: { message: error instanceof Error ? error.message : "Falha Mercado Livre." },
    };
  }
}

function emptyCatalogResult(message) {
  return {
    ok: false,
    source: "mercado_livre_catalog_empty",
    metricsMode: "market_signal",
    salesAvailable: false,
    message,
    items: [],
    exactMatches: 0,
    totalAvailable: 0,
    totals: { demand: 0, revenue: 0, averageTicket: 0 },
  };
}
