import { getSetting } from "./db.mjs";

export function minimumChampionSales() {
  const value = Number(getSetting("min_champion_sales") || process.env.MIN_CHAMPION_SALES || 1000);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1000;
}

export function isChampionItem(item) {
  return Boolean(
    item
    && Number(item.price) > 0
    && Number(item.soldQuantity) >= minimumChampionSales()
    && Number(item.revenue) > 0
  );
}
