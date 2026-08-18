import { isChampionItem, minimumChampionSales } from "./champion-policy.mjs";

export function isVerifiedSalesItem(item) {
  return Boolean(
    item
    && Number(item.price) > 0
    && Number(item.soldQuantity) > 0
    && Number(item.revenue) > 0
  );
}

export function isCompleteChampionResult(result) {
  return hasCompleteResultShape(result)
    && result.items.slice(0, 3).every(isChampionItem);
}

export function isCompleteEmergingOpportunityResult(result) {
  return Boolean(
    hasRealResultShape(result)
    && result.opportunityMode === "emerging"
    && result.items.slice(0, 3).every((item) => (
      isVerifiedSalesItem(item)
      && Number(item.soldQuantity) < minimumChampionSales()
    ))
  );
}

export function isCompleteDevelopingOpportunityResult(result) {
  return Boolean(
    hasRealResultShape(result)
    && result.opportunityMode === "developing"
    && result.items.slice(0, 3).every(isVerifiedSalesItem)
    && result.items.slice(0, 3).some((item) => Number(item.soldQuantity) >= minimumChampionSales())
    && (
      result.items.length < 3
      || result.items.slice(0, 3).some((item) => Number(item.soldQuantity) < minimumChampionSales())
    )
  );
}

export function isCompleteRealSalesResult(result) {
  return isCompleteChampionResult(result)
    || isCompleteEmergingOpportunityResult(result)
    || isCompleteDevelopingOpportunityResult(result);
}

function hasCompleteResultShape(result) {
  return hasRealResultShape(result) && result.items.length >= 3;
}

function hasRealResultShape(result) {
  return Boolean(
    result?.ok
    && result?.salesAvailable === true
    && Array.isArray(result?.items)
    && result.items.length >= 1
    && Number(result?.totals?.demand) > 0
    && Number(result?.totals?.revenue) > 0
  );
}
