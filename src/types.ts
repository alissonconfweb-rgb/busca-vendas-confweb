export type PlanId = "free" | "starter" | "scale";

export type MarketplaceItem = {
  id: string;
  title: string;
  subtitle: string;
  image: string;
  price: number;
  soldQuantity: number;
  permalink: string;
};

export type SearchResponse = {
  source: "live" | "demo";
  items: MarketplaceItem[];
  totalAvailable: number;
  error?: string;
};
