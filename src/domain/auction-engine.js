export const TriggerType = Object.freeze({
  BID_RECEIVED: "BID_RECEIVED",
  ANY_RANK_CHANGE: "ANY_RANK_CHANGE",
  LOWEST_BIDDER_CHANGE: "LOWEST_BIDDER_CHANGE",
});

export const AuctionStatus = Object.freeze({
  SCHEDULED: "Scheduled",
  ACTIVE: "Active",
  CLOSED: "Closed",
  FORCE_CLOSED: "Force Closed",
});

export const ActivityEventType = Object.freeze({
  RFQ_CREATED: "RFQ_CREATED",
  BID_SUBMITTED: "BID_SUBMITTED",
  TIME_EXTENDED: "TIME_EXTENDED",
});

const validTriggerTypes = new Set(Object.values(TriggerType));

function toEpoch(value) {
  return new Date(value).getTime();
}

function compareBidOrder(left, right) {
  return left.totalAmount - right.totalAmount || toEpoch(left.createdAt) - toEpoch(right.createdAt);
}

export function calculateBidTotal(charges) {
  return Number(charges.freightCharges) + Number(charges.originCharges) + Number(charges.destinationCharges);
}

export function normalizeTriggerTypes(triggerTypes) {
  return [...new Set((triggerTypes ?? []).filter((value) => validTriggerTypes.has(value)))];
}

export function buildLatestStandings(bids) {
  const latestBySupplier = new Map();

  for (const bid of bids) {
    const existing = latestBySupplier.get(bid.supplierId);

    if (!existing || toEpoch(bid.createdAt) > toEpoch(existing.createdAt)) {
      latestBySupplier.set(bid.supplierId, bid);
    }
  }

  return [...latestBySupplier.values()].sort(compareBidOrder);
}

export function assignRanks(bids) {
  return bids.map((bid, index) => ({
    ...bid,
    rank: index + 1,
  }));
}

export function buildRankMap(standings) {
  const ranks = new Map();

  for (const standing of standings) {
    ranks.set(standing.supplierId, standing.rank ?? standings.indexOf(standing) + 1);
  }

  return ranks;
}

export function computeAuctionStatus(auction, now = new Date()) {
  const nowEpoch = now instanceof Date ? now.getTime() : toEpoch(now);

  if (nowEpoch >= toEpoch(auction.forcedBidCloseAt)) {
    return AuctionStatus.FORCE_CLOSED;
  }

  if (nowEpoch < toEpoch(auction.bidStartAt)) {
    return AuctionStatus.SCHEDULED;
  }

  if (nowEpoch <= toEpoch(auction.currentBidCloseAt)) {
    return AuctionStatus.ACTIVE;
  }

  return AuctionStatus.CLOSED;
}

export function hasAnyRankChange(beforeStandings, afterStandings) {
  const beforeRanks = buildRankMap(beforeStandings);
  const afterRanks = buildRankMap(afterStandings);
  const supplierIds = new Set([...beforeRanks.keys(), ...afterRanks.keys()]);

  for (const supplierId of supplierIds) {
    if (beforeRanks.get(supplierId) !== afterRanks.get(supplierId)) {
      return true;
    }
  }

  return false;
}

export function hasLowestBidderChange(beforeStandings, afterStandings) {
  const beforeLeader = beforeStandings[0]?.supplierId ?? null;
  const afterLeader = afterStandings[0]?.supplierId ?? null;
  return beforeLeader !== afterLeader;
}

export function evaluateExtension({
  auction,
  triggerWindowMinutes,
  extensionDurationMinutes,
  enabledTriggers,
  beforeStandings,
  afterStandings,
  submittedAt,
}) {
  const currentCloseEpoch = toEpoch(auction.currentBidCloseAt);
  const forcedCloseEpoch = toEpoch(auction.forcedBidCloseAt);
  const submittedEpoch = toEpoch(submittedAt);
  const triggerWindowStartEpoch = currentCloseEpoch - triggerWindowMinutes * 60_000;
  const withinTriggerWindow = submittedEpoch >= triggerWindowStartEpoch && submittedEpoch <= currentCloseEpoch;
  const normalizedTriggers = normalizeTriggerTypes(enabledTriggers);
  const reasons = [];

  if (!withinTriggerWindow || currentCloseEpoch >= forcedCloseEpoch) {
    return {
      shouldExtend: false,
      reasons,
      nextCloseAt: auction.currentBidCloseAt,
      extendedByMinutes: 0,
      withinTriggerWindow,
      cappedByForcedClose: false,
    };
  }

  if (normalizedTriggers.includes(TriggerType.BID_RECEIVED)) {
    reasons.push("Bid received inside the trigger window");
  }

  if (
    normalizedTriggers.includes(TriggerType.ANY_RANK_CHANGE) &&
    hasAnyRankChange(beforeStandings, afterStandings)
  ) {
    reasons.push("Supplier ranking changed inside the trigger window");
  }

  if (
    normalizedTriggers.includes(TriggerType.LOWEST_BIDDER_CHANGE) &&
    hasLowestBidderChange(beforeStandings, afterStandings)
  ) {
    reasons.push("Lowest bidder changed inside the trigger window");
  }

  if (reasons.length === 0) {
    return {
      shouldExtend: false,
      reasons,
      nextCloseAt: auction.currentBidCloseAt,
      extendedByMinutes: 0,
      withinTriggerWindow,
      cappedByForcedClose: false,
    };
  }

  const proposedCloseEpoch = currentCloseEpoch + extensionDurationMinutes * 60_000;
  const nextCloseEpoch = Math.min(proposedCloseEpoch, forcedCloseEpoch);
  const extendedByMinutes = Math.round((nextCloseEpoch - currentCloseEpoch) / 60_000);

  return {
    shouldExtend: nextCloseEpoch > currentCloseEpoch,
    reasons,
    nextCloseAt: new Date(nextCloseEpoch).toISOString(),
    extendedByMinutes,
    withinTriggerWindow,
    cappedByForcedClose: proposedCloseEpoch > forcedCloseEpoch,
  };
}

export function formatTriggerType(triggerType) {
  switch (triggerType) {
    case TriggerType.BID_RECEIVED:
      return "Bid received in last X minutes";
    case TriggerType.ANY_RANK_CHANGE:
      return "Any supplier rank change in last X minutes";
    case TriggerType.LOWEST_BIDDER_CHANGE:
      return "Lowest bidder (L1) rank change in last X minutes";
    default:
      return triggerType;
  }
}
