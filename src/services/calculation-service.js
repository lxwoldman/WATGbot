export function parseOddsFromMarket(marketText) {
  const match = String(marketText || "").match(/@\s*([0-9]+(?:\.[0-9]+)?)/);
  return match ? Number(match[1]) : 0;
}

export function computeFinalOdds(rawOdds, rebate) {
  const finalOdds = Number(rawOdds || 0) - Number(rebate || 0);
  return Math.max(finalOdds, 0);
}

export function computeAllocated(resources, exchangeRate = 1) {
  return resources
    .filter((resource) => resource.enabled !== false && resource.includeInAllocation)
    .reduce((sum, resource) => {
      const amount = Number(resource.amount || 0);
      if (resource.currency === "RMB") {
        const rate = Number(exchangeRate || 0) || 1;
        return sum + amount / rate;
      }
      return sum + amount;
    }, 0);
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
