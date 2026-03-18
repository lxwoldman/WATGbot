export function parseOddsFromMarket(marketText) {
  const match = String(marketText || "").match(/@\s*([0-9]+(?:\.[0-9]+)?)/);
  return match ? Number(match[1]) : 0;
}

export function computeFinalOdds(rawOdds, rebate) {
  const finalOdds = Number(rawOdds || 0) - Number(rebate || 0);
  return Math.max(finalOdds, 0);
}

export function computeAllocated(resources) {
  return resources
    .filter((resource) => resource.sendEnabled)
    .reduce((sum, resource) => sum + Number(resource.amount || 0), 0);
}

export function computeGap(targetTotal, allocated) {
  return Math.max(Number(targetTotal || 0) - Number(allocated || 0), 0);
}

export function computeTargetTotal(ticket) {
  return Number(ticket.deliveryTarget || 0) + Number(ticket.internalTarget || 0);
}

export function cleanMarketText(marketText) {
  return String(marketText || "").split("@")[0].trim();
}

export function buildReceiptText({ slipCount, league, teams, marketText, finalOdds, amount }) {
  return `${slipCount}.${league}\n${teams}\n${cleanMarketText(marketText)} @ ${Number(finalOdds).toFixed(2)}确${amount}`;
}
