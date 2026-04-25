import test from "node:test";
import assert from "node:assert/strict";

import {
  assignRanks,
  AuctionStatus,
  buildLatestStandings,
  computeAuctionStatus,
  evaluateExtension,
  TriggerType,
} from "../src/domain/auction-engine.js";

function standing(supplierId, totalAmount, createdAt) {
  return {
    supplierId,
    totalAmount,
    createdAt,
  };
}

test("extends when a bid is received during the trigger window", () => {
  const auction = {
    bidStartAt: "2026-04-25T09:00:00.000Z",
    currentBidCloseAt: "2026-04-25T10:00:00.000Z",
    forcedBidCloseAt: "2026-04-25T10:20:00.000Z",
  };

  const result = evaluateExtension({
    auction,
    triggerWindowMinutes: 10,
    extensionDurationMinutes: 5,
    enabledTriggers: [TriggerType.BID_RECEIVED],
    beforeStandings: [],
    afterStandings: [],
    submittedAt: "2026-04-25T09:55:00.000Z",
  });

  assert.equal(result.shouldExtend, true);
  assert.equal(result.nextCloseAt, "2026-04-25T10:05:00.000Z");
  assert.match(result.reasons[0], /Bid received/i);
});

test("caps extension at the forced close time", () => {
  const auction = {
    bidStartAt: "2026-04-25T09:00:00.000Z",
    currentBidCloseAt: "2026-04-25T10:00:00.000Z",
    forcedBidCloseAt: "2026-04-25T10:03:00.000Z",
  };

  const result = evaluateExtension({
    auction,
    triggerWindowMinutes: 10,
    extensionDurationMinutes: 5,
    enabledTriggers: [TriggerType.BID_RECEIVED],
    beforeStandings: [],
    afterStandings: [],
    submittedAt: "2026-04-25T09:59:00.000Z",
  });

  assert.equal(result.shouldExtend, true);
  assert.equal(result.nextCloseAt, "2026-04-25T10:03:00.000Z");
  assert.equal(result.cappedByForcedClose, true);
});

test("extends on any rank change when configured", () => {
  const before = assignRanks(
    buildLatestStandings([
      standing(1, 120000, "2026-04-25T09:40:00.000Z"),
      standing(2, 118000, "2026-04-25T09:42:00.000Z"),
    ]),
  );

  const after = assignRanks(
    buildLatestStandings([
      standing(1, 120000, "2026-04-25T09:40:00.000Z"),
      standing(2, 118000, "2026-04-25T09:42:00.000Z"),
      standing(3, 117000, "2026-04-25T09:58:00.000Z"),
    ]),
  );

  const result = evaluateExtension({
    auction: {
      bidStartAt: "2026-04-25T09:00:00.000Z",
      currentBidCloseAt: "2026-04-25T10:00:00.000Z",
      forcedBidCloseAt: "2026-04-25T10:20:00.000Z",
    },
    triggerWindowMinutes: 10,
    extensionDurationMinutes: 5,
    enabledTriggers: [TriggerType.ANY_RANK_CHANGE],
    beforeStandings: before,
    afterStandings: after,
    submittedAt: "2026-04-25T09:58:00.000Z",
  });

  assert.equal(result.shouldExtend, true);
  assert.match(result.reasons[0], /ranking changed/i);
});

test("extends only when leader changes for L1 trigger", () => {
  const before = assignRanks(
    buildLatestStandings([
      standing(1, 110000, "2026-04-25T09:45:00.000Z"),
      standing(2, 111000, "2026-04-25T09:46:00.000Z"),
    ]),
  );

  const after = assignRanks(
    buildLatestStandings([
      standing(1, 110000, "2026-04-25T09:45:00.000Z"),
      standing(2, 109500, "2026-04-25T09:57:00.000Z"),
    ]),
  );

  const result = evaluateExtension({
    auction: {
      bidStartAt: "2026-04-25T09:00:00.000Z",
      currentBidCloseAt: "2026-04-25T10:00:00.000Z",
      forcedBidCloseAt: "2026-04-25T10:20:00.000Z",
    },
    triggerWindowMinutes: 10,
    extensionDurationMinutes: 5,
    enabledTriggers: [TriggerType.LOWEST_BIDDER_CHANGE],
    beforeStandings: before,
    afterStandings: after,
    submittedAt: "2026-04-25T09:57:00.000Z",
  });

  assert.equal(result.shouldExtend, true);
  assert.match(result.reasons[0], /lowest bidder changed/i);
});

test("computes auction status with forced close taking precedence", () => {
  const auction = {
    bidStartAt: "2026-04-25T09:00:00.000Z",
    currentBidCloseAt: "2026-04-25T10:05:00.000Z",
    forcedBidCloseAt: "2026-04-25T10:00:00.000Z",
  };

  assert.equal(computeAuctionStatus(auction, new Date("2026-04-25T09:30:00.000Z")), AuctionStatus.ACTIVE);
  assert.equal(
    computeAuctionStatus(auction, new Date("2026-04-25T10:00:00.000Z")),
    AuctionStatus.FORCE_CLOSED,
  );
});
