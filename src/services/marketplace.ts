import { buildDemoProducts } from "../data/demoProducts";
import type { MarketplaceItem, SearchResponse } from "../types";

type MercadoLivreResult = {
  id: string;
  title: string;
  thumbnail?: string;
  price?: number;
  sold_quantity?: number;
  permalink?: string;
  shipping?: {
    logistic_type?: string;
  };
  attributes?: Array<{
    id: string;
    value_name?: string;
  }>;
};

type MercadoLivreResponse = {
  paging?: {
    total?: number;
  };
  results?: MercadoLivreResult[];
};

const SEARCH_ENDPOINT = import.meta.env.VITE_MELI_SEARCH_URL?.trim() ?? "";

const buildSubtitle = (item: MercadoLivreResult) => {
  const brand = item.attributes?.find((attribute) => attribute.id === "BRAND")?.value_name;
  const logistic =
    item.shipping?.logistic_type === "fulfillment" ? "Full" : "Marketplace";

  return [brand, logistic].filter(Boolean).join(" - ") || "Anúncio ativo no Mercado Livre";
};

const mapLiveItem = (item: MercadoLivreResult): MarketplaceItem | null => {
  if (!item.id || !item.title || !item.price || !item.permalink || !item.sold_quantity) {
    return null;
  }

  return {
    id: item.id,
    title: item.title,
    subtitle: buildSubtitle(item),
    image: (item.thumbnail || "").replace("http://", "https://"),
    price: item.price,
    soldQuantity: item.sold_quantity,
    permalink: item.permalink,
  };
};

export async function searchMarketplace(query: string): Promise<SearchResponse> {
  const trimmedQuery = query.trim();

  if (!SEARCH_ENDPOINT) {
    return {
      source: "demo",
      items: buildDemoProducts(trimmedQuery),
      totalAvailable: 10000,
      error: "Integração oficial do Mercado Livre ainda não configurada",
    };
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 6500);
  const params = new URLSearchParams({
    q: trimmedQuery,
    limit: "12",
    sort: "sold_quantity_desc",
  });

  try {
    const response = await fetch(`${SEARCH_ENDPOINT}?${params.toString()}`, {
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Mercado Livre respondeu ${response.status}`);
    }

    const data = (await response.json()) as MercadoLivreResponse;
    const items =
      data.results
        ?.map(mapLiveItem)
        .filter((item): item is MarketplaceItem => Boolean(item))
        .sort((a, b) => b.soldQuantity - a.soldQuantity)
        .slice(0, 3) ?? [];

    if (items.length < 3) {
      throw new Error("A busca pública não retornou vendas suficientes para montar o top 3.");
    }

    return {
      source: "live",
      items,
      totalAvailable: data.paging?.total ?? items.length,
    };
  } catch (error) {
    return {
      source: "demo",
      items: buildDemoProducts(trimmedQuery),
      totalAvailable: 10000,
      error: error instanceof Error ? error.message : "Busca pública indisponível",
    };
  } finally {
    window.clearTimeout(timeout);
  }
}
