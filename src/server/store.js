import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  ActivityEventType,
  assignRanks,
  AuctionStatus,
  buildLatestStandings,
  calculateBidTotal,
  computeAuctionStatus,
  evaluateExtension,
  normalizeTriggerTypes,
  TriggerType,
} from "../domain/auction-engine.js";
import {
  clamp,
  formatDateInputValue,
  shiftDateByDays,
  shiftIsoByMinutes,
} from "../utils/format.js";

const databasePath = path.join(process.cwd(), "data", "auction.db");
let database;

const triggerTypeValues = Object.values(TriggerType)
  .map((value) => `'${value}'`)
  .join(", ");

class AppError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
  }
}

function invariant(condition, message, statusCode = 400) {
  if (!condition) {
    throw new AppError(message, statusCode);
  }
}

function toRoundedNumber(value) {
  return Math.round(Number(value) * 100) / 100;
}

function parseText(payload, key, label) {
  const value = String(payload[key] ?? "").trim();
  invariant(value.length > 0, `${label} is required.`);
  return value;
}

function parseInteger(payload, key, label, minimum = 0) {
  const value = Number.parseInt(String(payload[key] ?? ""), 10);
  invariant(Number.isInteger(value), `${label} must be a whole number.`);
  invariant(value >= minimum, `${label} must be at least ${minimum}.`);
  return value;
}

function parseMoney(payload, key, label) {
  const value = Number(String(payload[key] ?? ""));
  invariant(Number.isFinite(value), `${label} must be a number.`);
  invariant(value >= 0, `${label} cannot be negative.`);
  return toRoundedNumber(value);
}

function parseDateTime(payload, key, label) {
  const raw = String(payload[key] ?? "").trim();
  const date = new Date(raw);
  invariant(raw.length > 0 && !Number.isNaN(date.getTime()), `${label} is required.`);
  return date.toISOString();
}

function parseDateOnly(payload, key, label) {
  const raw = String(payload[key] ?? "").trim();
  invariant(/^\d{4}-\d{2}-\d{2}$/.test(raw), `${label} must be a valid date.`);
  return raw;
}

function parseTriggerTypes(payload) {
  const raw = payload.triggerTypes ?? payload.trigger_types ?? [];
  const values = Array.isArray(raw) ? raw : [raw];
  const triggerTypes = normalizeTriggerTypes(values);
  invariant(triggerTypes.length > 0, "Select at least one auction extension trigger.");
  return triggerTypes;
}

function createSchema(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rfqs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'BRITISH_AUCTION',
      bid_start_at TEXT NOT NULL,
      initial_bid_close_at TEXT NOT NULL,
      current_bid_close_at TEXT NOT NULL,
      forced_bid_close_at TEXT NOT NULL,
      service_date TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auction_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rfq_id INTEGER NOT NULL UNIQUE REFERENCES rfqs(id) ON DELETE CASCADE,
      trigger_window_minutes INTEGER NOT NULL,
      extension_duration_minutes INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auction_trigger_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rfq_id INTEGER NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
      trigger_type TEXT NOT NULL CHECK (trigger_type IN (${triggerTypeValues})),
      created_at TEXT NOT NULL,
      UNIQUE (rfq_id, trigger_type)
    );

    CREATE TABLE IF NOT EXISTS bids (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rfq_id INTEGER NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
      supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
      carrier_name TEXT NOT NULL,
      freight_charges REAL NOT NULL,
      origin_charges REAL NOT NULL,
      destination_charges REAL NOT NULL,
      transit_time_days INTEGER NOT NULL,
      quote_valid_until TEXT NOT NULL,
      total_amount REAL NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rfq_id INTEGER NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      message TEXT NOT NULL,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_rfqs_current_bid_close_at ON rfqs(current_bid_close_at);
    CREATE INDEX IF NOT EXISTS idx_bids_rfq_created_at ON bids(rfq_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_logs_rfq_created_at ON activity_logs(rfq_id, created_at DESC);
  `);
}

function seedDatabase(db) {
  const existing = db.prepare("SELECT COUNT(*) AS count FROM rfqs").get();

  if (existing.count > 0) {
    return;
  }

  const now = new Date().toISOString();

  const insertSupplier = db.prepare(`
    INSERT OR IGNORE INTO suppliers (code, name)
    VALUES (:code, :name)
  `);

  const suppliers = [
    { code: "BLD", name: "Blue Dart Logistics" },
    { code: "MRS", name: "Maersk Surface" },
    { code: "SFX", name: "Safexpress Network" },
    { code: "DLV", name: "Delhivery Freight" },
  ];

  for (const supplier of suppliers) {
    insertSupplier.run(supplier);
  }

  const supplierMap = new Map(
    db
      .prepare("SELECT id, code, name FROM suppliers ORDER BY id")
      .all()
      .map((row) => [row.code, row]),
  );

  const insertRfq = db.prepare(`
    INSERT INTO rfqs (
      reference_id,
      name,
      mode,
      bid_start_at,
      initial_bid_close_at,
      current_bid_close_at,
      forced_bid_close_at,
      service_date,
      created_at
    ) VALUES (
      :referenceId,
      :name,
      'BRITISH_AUCTION',
      :bidStartAt,
      :initialBidCloseAt,
      :currentBidCloseAt,
      :forcedBidCloseAt,
      :serviceDate,
      :createdAt
    )
  `);

  const insertConfig = db.prepare(`
    INSERT INTO auction_configs (
      rfq_id,
      trigger_window_minutes,
      extension_duration_minutes,
      created_at
    ) VALUES (
      :rfqId,
      :triggerWindowMinutes,
      :extensionDurationMinutes,
      :createdAt
    )
  `);

  const insertTrigger = db.prepare(`
    INSERT INTO auction_trigger_rules (rfq_id, trigger_type, created_at)
    VALUES (:rfqId, :triggerType, :createdAt)
  `);

  const insertBid = db.prepare(`
    INSERT INTO bids (
      rfq_id,
      supplier_id,
      carrier_name,
      freight_charges,
      origin_charges,
      destination_charges,
      transit_time_days,
      quote_valid_until,
      total_amount,
      created_at
    ) VALUES (
      :rfqId,
      :supplierId,
      :carrierName,
      :freightCharges,
      :originCharges,
      :destinationCharges,
      :transitTimeDays,
      :quoteValidUntil,
      :totalAmount,
      :createdAt
    )
  `);

  const insertLog = db.prepare(`
    INSERT INTO activity_logs (
      rfq_id,
      event_type,
      message,
      metadata_json,
      created_at
    ) VALUES (
      :rfqId,
      :eventType,
      :message,
      :metadataJson,
      :createdAt
    )
  `);

  const seedAuctions = [
    {
      referenceId: "RFQ-BA-1001",
      name: "Delhi to Mumbai electronics linehaul",
      bidStartAt: shiftIsoByMinutes(now, -120),
      initialBidCloseAt: shiftIsoByMinutes(now, -2),
      currentBidCloseAt: shiftIsoByMinutes(now, 8),
      forcedBidCloseAt: shiftIsoByMinutes(now, 20),
      serviceDate: shiftDateByDays(now, 3),
      config: {
        triggerWindowMinutes: 10,
        extensionDurationMinutes: 10,
        triggers: [
          TriggerType.BID_RECEIVED,
          TriggerType.ANY_RANK_CHANGE,
          TriggerType.LOWEST_BIDDER_CHANGE,
        ],
      },
      bids: [
        {
          supplierCode: "BLD",
          carrierName: "Blue Dart Logistics",
          freightCharges: 108000,
          originCharges: 9000,
          destinationCharges: 8000,
          transitTimeDays: 3,
          quoteValidUntil: shiftDateByDays(now, 7),
          createdAt: shiftIsoByMinutes(now, -95),
        },
        {
          supplierCode: "MRS",
          carrierName: "Maersk Surface",
          freightCharges: 106000,
          originCharges: 7000,
          destinationCharges: 7000,
          transitTimeDays: 4,
          quoteValidUntil: shiftDateByDays(now, 6),
          createdAt: shiftIsoByMinutes(now, -70),
        },
        {
          supplierCode: "SFX",
          carrierName: "Safexpress Network",
          freightCharges: 103000,
          originCharges: 8000,
          destinationCharges: 8500,
          transitTimeDays: 3,
          quoteValidUntil: shiftDateByDays(now, 6),
          createdAt: shiftIsoByMinutes(now, -43),
        },
        {
          supplierCode: "BLD",
          carrierName: "Blue Dart Logistics",
          freightCharges: 100000,
          originCharges: 7000,
          destinationCharges: 7500,
          transitTimeDays: 3,
          quoteValidUntil: shiftDateByDays(now, 7),
          createdAt: shiftIsoByMinutes(now, -7),
        },
      ],
      logs: [
        {
          eventType: ActivityEventType.TIME_EXTENDED,
          message:
            "Auction extended by 10 minutes because a new bid was received during the trigger window and the L1 ranking changed.",
          metadataJson: JSON.stringify({
            previousCloseAt: shiftIsoByMinutes(now, -2),
            nextCloseAt: shiftIsoByMinutes(now, 8),
            triggerTypes: [TriggerType.BID_RECEIVED, TriggerType.LOWEST_BIDDER_CHANGE],
          }),
          createdAt: shiftIsoByMinutes(now, -7),
        },
      ],
    },
    {
      referenceId: "RFQ-BA-1002",
      name: "Bengaluru to Pune auto components haul",
      bidStartAt: shiftIsoByMinutes(now, 40),
      initialBidCloseAt: shiftIsoByMinutes(now, 120),
      currentBidCloseAt: shiftIsoByMinutes(now, 120),
      forcedBidCloseAt: shiftIsoByMinutes(now, 180),
      serviceDate: shiftDateByDays(now, 5),
      config: {
        triggerWindowMinutes: 15,
        extensionDurationMinutes: 10,
        triggers: [TriggerType.BID_RECEIVED, TriggerType.ANY_RANK_CHANGE],
      },
      bids: [],
      logs: [],
    },
    {
      referenceId: "RFQ-BA-1003",
      name: "Chennai export stuffing slot",
      bidStartAt: shiftIsoByMinutes(now, -300),
      initialBidCloseAt: shiftIsoByMinutes(now, -30),
      currentBidCloseAt: shiftIsoByMinutes(now, -30),
      forcedBidCloseAt: shiftIsoByMinutes(now, 60),
      serviceDate: shiftDateByDays(now, 2),
      config: {
        triggerWindowMinutes: 10,
        extensionDurationMinutes: 5,
        triggers: [TriggerType.LOWEST_BIDDER_CHANGE],
      },
      bids: [
        {
          supplierCode: "DLV",
          carrierName: "Delhivery Freight",
          freightCharges: 68000,
          originCharges: 5500,
          destinationCharges: 5200,
          transitTimeDays: 2,
          quoteValidUntil: shiftDateByDays(now, 3),
          createdAt: shiftIsoByMinutes(now, -120),
        },
        {
          supplierCode: "SFX",
          carrierName: "Safexpress Network",
          freightCharges: 65500,
          originCharges: 4900,
          destinationCharges: 5000,
          transitTimeDays: 2,
          quoteValidUntil: shiftDateByDays(now, 3),
          createdAt: shiftIsoByMinutes(now, -58),
        },
      ],
      logs: [],
    },
    {
      referenceId: "RFQ-BA-1004",
      name: "Kolkata bonded warehouse transfer",
      bidStartAt: shiftIsoByMinutes(now, -1_440),
      initialBidCloseAt: shiftIsoByMinutes(now, -70),
      currentBidCloseAt: shiftIsoByMinutes(now, -30),
      forcedBidCloseAt: shiftIsoByMinutes(now, -5),
      serviceDate: shiftDateByDays(now, 1),
      config: {
        triggerWindowMinutes: 10,
        extensionDurationMinutes: 5,
        triggers: [TriggerType.ANY_RANK_CHANGE],
      },
      bids: [
        {
          supplierCode: "BLD",
          carrierName: "Blue Dart Logistics",
          freightCharges: 72000,
          originCharges: 5000,
          destinationCharges: 4600,
          transitTimeDays: 1,
          quoteValidUntil: shiftDateByDays(now, 2),
          createdAt: shiftIsoByMinutes(now, -180),
        },
        {
          supplierCode: "MRS",
          carrierName: "Maersk Surface",
          freightCharges: 70500,
          originCharges: 4700,
          destinationCharges: 4500,
          transitTimeDays: 1,
          quoteValidUntil: shiftDateByDays(now, 2),
          createdAt: shiftIsoByMinutes(now, -36),
        },
      ],
      logs: [
        {
          eventType: ActivityEventType.TIME_EXTENDED,
          message:
            "Final extension capped at the forced close boundary to prevent the auction from running past the hard stop.",
          metadataJson: JSON.stringify({
            cappedByForcedClose: true,
            nextCloseAt: shiftIsoByMinutes(now, -30),
          }),
          createdAt: shiftIsoByMinutes(now, -36),
        },
      ],
    },
  ];

  db.exec("BEGIN");

  try {
    for (const auction of seedAuctions) {
      const auctionInsert = insertRfq.run({
        referenceId: auction.referenceId,
        name: auction.name,
        bidStartAt: auction.bidStartAt,
        initialBidCloseAt: auction.initialBidCloseAt,
        currentBidCloseAt: auction.currentBidCloseAt,
        forcedBidCloseAt: auction.forcedBidCloseAt,
        serviceDate: auction.serviceDate,
        createdAt: auction.bidStartAt,
      });
      const rfqId = Number(auctionInsert.lastInsertRowid);

      insertConfig.run({
        rfqId,
        triggerWindowMinutes: auction.config.triggerWindowMinutes,
        extensionDurationMinutes: auction.config.extensionDurationMinutes,
        createdAt: auction.bidStartAt,
      });

      for (const triggerType of auction.config.triggers) {
        insertTrigger.run({
          rfqId,
          triggerType,
          createdAt: auction.bidStartAt,
        });
      }

      for (const bid of auction.bids) {
        const supplier = supplierMap.get(bid.supplierCode);
        const totalAmount = calculateBidTotal(bid);

        insertBid.run({
          rfqId,
          supplierId: supplier.id,
          carrierName: bid.carrierName,
          freightCharges: bid.freightCharges,
          originCharges: bid.originCharges,
          destinationCharges: bid.destinationCharges,
          transitTimeDays: bid.transitTimeDays,
          quoteValidUntil: bid.quoteValidUntil,
          totalAmount,
          createdAt: bid.createdAt,
        });

        insertLog.run({
          rfqId,
          eventType: ActivityEventType.BID_SUBMITTED,
          message: `${supplier.name} submitted a bid for INR ${Math.round(totalAmount).toLocaleString("en-IN")}.`,
          metadataJson: JSON.stringify({
            supplierId: supplier.id,
            totalAmount,
          }),
          createdAt: bid.createdAt,
        });
      }

      for (const log of auction.logs) {
        insertLog.run({
          rfqId,
          eventType: log.eventType,
          message: log.message,
          metadataJson: log.metadataJson,
          createdAt: log.createdAt,
        });
      }

      insertLog.run({
        rfqId,
        eventType: ActivityEventType.RFQ_CREATED,
        message: `RFQ ${auction.referenceId} was created with British Auction rules enabled.`,
        metadataJson: JSON.stringify({
          triggerWindowMinutes: auction.config.triggerWindowMinutes,
          extensionDurationMinutes: auction.config.extensionDurationMinutes,
        }),
        createdAt: auction.bidStartAt,
      });
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function mapAuctionRow(row) {
  return {
    id: row.id,
    referenceId: row.reference_id,
    name: row.name,
    mode: row.mode,
    bidStartAt: row.bid_start_at,
    initialBidCloseAt: row.initial_bid_close_at,
    currentBidCloseAt: row.current_bid_close_at,
    forcedBidCloseAt: row.forced_bid_close_at,
    serviceDate: row.service_date,
    createdAt: row.created_at,
  };
}

function mapConfigRow(row) {
  return {
    id: row.id,
    rfqId: row.rfq_id,
    triggerWindowMinutes: row.trigger_window_minutes,
    extensionDurationMinutes: row.extension_duration_minutes,
    createdAt: row.created_at,
  };
}

function mapSupplierRow(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
  };
}

function mapBidRow(row) {
  return {
    id: row.id,
    rfqId: row.rfq_id,
    supplierId: row.supplier_id,
    carrierName: row.carrier_name,
    freightCharges: row.freight_charges,
    originCharges: row.origin_charges,
    destinationCharges: row.destination_charges,
    transitTimeDays: row.transit_time_days,
    quoteValidUntil: row.quote_valid_until,
    totalAmount: row.total_amount,
    createdAt: row.created_at,
  };
}

function mapLogRow(row) {
  return {
    id: row.id,
    rfqId: row.rfq_id,
    eventType: row.event_type,
    message: row.message,
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null,
    createdAt: row.created_at,
  };
}

function getRowsByRfqId(rows, mapper) {
  const grouped = new Map();

  for (const row of rows) {
    const mapped = mapper(row);
    const list = grouped.get(mapped.rfqId) ?? [];
    list.push(mapped);
    grouped.set(mapped.rfqId, list);
  }

  return grouped;
}

function hydrateBid(bid, suppliersById) {
  const supplier = suppliersById.get(bid.supplierId);
  return {
    ...bid,
    supplierCode: supplier?.code ?? "UNK",
    supplierName: supplier?.name ?? bid.carrierName,
  };
}

function buildAuctionRecord({ auction, config, triggerTypes, bids, logs, now }) {
  const standings = assignRanks(buildLatestStandings(bids));
  const allBidsSorted = [...bids].sort(
    (left, right) =>
      left.totalAmount - right.totalAmount ||
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
  const status = computeAuctionStatus(auction, now);
  const statusProgress = clamp(
    (new Date(now).getTime() - new Date(auction.bidStartAt).getTime()) /
      (new Date(auction.forcedBidCloseAt).getTime() - new Date(auction.bidStartAt).getTime()) *
      100,
    0,
    100,
  );

  return {
    ...auction,
    config,
    triggerTypes,
    bids,
    allBidsSorted,
    activityLogs: [...logs].sort(
      (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
    ),
    standings,
    status,
    lowestBid: standings[0] ?? null,
    totalBids: bids.length,
    activeSupplierCount: standings.length,
    scheduleProgress: Math.round(statusProgress),
    extensionCapReached:
      new Date(auction.currentBidCloseAt).getTime() >= new Date(auction.forcedBidCloseAt).getTime(),
    isLive: status === AuctionStatus.ACTIVE,
  };
}

function getDataMaps(db) {
  const auctions = db.prepare("SELECT * FROM rfqs ORDER BY bid_start_at ASC").all().map(mapAuctionRow);
  const configs = new Map(
    db
      .prepare("SELECT * FROM auction_configs")
      .all()
      .map((row) => {
        const mapped = mapConfigRow(row);
        return [mapped.rfqId, mapped];
      }),
  );
  const triggersByRfq = getRowsByRfqId(
    db.prepare("SELECT rfq_id, trigger_type, created_at FROM auction_trigger_rules ORDER BY id ASC").all(),
    (row) => ({
      rfqId: row.rfq_id,
      triggerType: row.trigger_type,
      createdAt: row.created_at,
    }),
  );
  const suppliersById = new Map(
    db
      .prepare("SELECT * FROM suppliers ORDER BY name ASC")
      .all()
      .map((row) => {
        const mapped = mapSupplierRow(row);
        return [mapped.id, mapped];
      }),
  );
  const bidsByRfq = getRowsByRfqId(
    db.prepare("SELECT * FROM bids ORDER BY created_at ASC").all(),
    mapBidRow,
  );
  const logsByRfq = getRowsByRfqId(
    db.prepare("SELECT * FROM activity_logs ORDER BY created_at DESC").all(),
    mapLogRow,
  );

  return {
    auctions,
    configs,
    triggersByRfq,
    suppliersById,
    bidsByRfq,
    logsByRfq,
  };
}

function ensureDatabase() {
  if (!database) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    const candidate = new DatabaseSync(databasePath);

    try {
      createSchema(candidate);
      seedDatabase(candidate);
      database = candidate;
    } catch (error) {
      database = undefined;
      candidate.close?.();
      throw error;
    }
  }

  return database;
}

function getAuctionAggregateById(db, auctionId, now = new Date()) {
  const maps = getDataMaps(db);
  const auction = maps.auctions.find((entry) => entry.id === auctionId);
  invariant(auction, "Auction not found.", 404);

  const config = maps.configs.get(auction.id);
  const bids = (maps.bidsByRfq.get(auction.id) ?? []).map((bid) => hydrateBid(bid, maps.suppliersById));
  const logs = maps.logsByRfq.get(auction.id) ?? [];
  const triggerTypes = (maps.triggersByRfq.get(auction.id) ?? []).map((trigger) => trigger.triggerType);

  return buildAuctionRecord({
    auction,
    config,
    triggerTypes,
    bids,
    logs,
    now,
  });
}

export function getStoreErrorMessage(error) {
  if (error instanceof AppError) {
    return error.message;
  }

  return "Unexpected server error.";
}

export function isStoreError(error) {
  return error instanceof AppError;
}

export function listSuppliers() {
  const db = ensureDatabase();

  return db.prepare("SELECT * FROM suppliers ORDER BY name ASC").all().map(mapSupplierRow);
}

export function listAuctions(now = new Date()) {
  const db = ensureDatabase();
  const maps = getDataMaps(db);
  const statusOrder = new Map([
    [AuctionStatus.ACTIVE, 0],
    [AuctionStatus.SCHEDULED, 1],
    [AuctionStatus.CLOSED, 2],
    [AuctionStatus.FORCE_CLOSED, 3],
  ]);

  return maps.auctions
    .map((auction) =>
      buildAuctionRecord({
        auction,
        config: maps.configs.get(auction.id),
        triggerTypes: (maps.triggersByRfq.get(auction.id) ?? []).map((trigger) => trigger.triggerType),
        bids: (maps.bidsByRfq.get(auction.id) ?? []).map((bid) => hydrateBid(bid, maps.suppliersById)),
        logs: maps.logsByRfq.get(auction.id) ?? [],
        now,
      }),
    )
    .sort((left, right) => {
      const leftRank = statusOrder.get(left.status) ?? 99;
      const rightRank = statusOrder.get(right.status) ?? 99;

      return (
        leftRank - rightRank ||
        new Date(left.currentBidCloseAt).getTime() - new Date(right.currentBidCloseAt).getTime()
      );
    });
}

export function getAuctionById(auctionId, now = new Date()) {
  const db = ensureDatabase();
  return getAuctionAggregateById(db, auctionId, now);
}

export function createAuction(payload) {
  const db = ensureDatabase();
  const referenceId = parseText(payload, "referenceId", "RFQ reference ID").toUpperCase();
  const name = parseText(payload, "name", "RFQ name");
  const bidStartAt = parseDateTime(payload, "bidStartAt", "Bid start date and time");
  const bidCloseAt = parseDateTime(payload, "bidCloseAt", "Bid close date and time");
  const forcedBidCloseAt = parseDateTime(
    payload,
    "forcedBidCloseAt",
    "Forced bid close date and time",
  );
  const serviceDate = parseDateOnly(payload, "serviceDate", "Pickup / service date");
  const triggerWindowMinutes = parseInteger(
    payload,
    "triggerWindowMinutes",
    "Trigger window",
    1,
  );
  const extensionDurationMinutes = parseInteger(
    payload,
    "extensionDurationMinutes",
    "Extension duration",
    1,
  );
  const triggerTypes = parseTriggerTypes(payload);
  const createdAt = new Date().toISOString();

  invariant(
    new Date(bidCloseAt).getTime() > new Date(bidStartAt).getTime(),
    "Bid close time must be later than the bid start time.",
  );
  invariant(
    new Date(forcedBidCloseAt).getTime() > new Date(bidCloseAt).getTime(),
    "Forced bid close time must always be greater than the bid close time.",
  );
  invariant(
    serviceDate >= formatDateInputValue(bidStartAt),
    "Pickup / service date should be on or after the bid start date.",
  );

  const existingReference = db
    .prepare("SELECT id FROM rfqs WHERE reference_id = :referenceId")
    .get({ referenceId });
  invariant(!existingReference, `RFQ reference ${referenceId} already exists.`);

  const insertRfq = db.prepare(`
    INSERT INTO rfqs (
      reference_id,
      name,
      mode,
      bid_start_at,
      initial_bid_close_at,
      current_bid_close_at,
      forced_bid_close_at,
      service_date,
      created_at
    ) VALUES (
      :referenceId,
      :name,
      'BRITISH_AUCTION',
      :bidStartAt,
      :bidCloseAt,
      :bidCloseAt,
      :forcedBidCloseAt,
      :serviceDate,
      :createdAt
    )
  `);

  const insertConfig = db.prepare(`
    INSERT INTO auction_configs (
      rfq_id,
      trigger_window_minutes,
      extension_duration_minutes,
      created_at
    ) VALUES (
      :rfqId,
      :triggerWindowMinutes,
      :extensionDurationMinutes,
      :createdAt
    )
  `);

  const insertTrigger = db.prepare(`
    INSERT INTO auction_trigger_rules (rfq_id, trigger_type, created_at)
    VALUES (:rfqId, :triggerType, :createdAt)
  `);

  const insertLog = db.prepare(`
    INSERT INTO activity_logs (
      rfq_id,
      event_type,
      message,
      metadata_json,
      created_at
    ) VALUES (
      :rfqId,
      :eventType,
      :message,
      :metadataJson,
      :createdAt
    )
  `);

  db.exec("BEGIN");

  try {
    const rfqResult = insertRfq.run({
      referenceId,
      name,
      bidStartAt,
      bidCloseAt,
      forcedBidCloseAt,
      serviceDate,
      createdAt,
    });
    const rfqId = Number(rfqResult.lastInsertRowid);

    insertConfig.run({
      rfqId,
      triggerWindowMinutes,
      extensionDurationMinutes,
      createdAt,
    });

    for (const triggerType of triggerTypes) {
      insertTrigger.run({
        rfqId,
        triggerType,
        createdAt,
      });
    }

    insertLog.run({
      rfqId,
      eventType: ActivityEventType.RFQ_CREATED,
      message: `RFQ ${referenceId} was created with British Auction rules enabled.`,
      metadataJson: JSON.stringify({
        triggerWindowMinutes,
        extensionDurationMinutes,
        triggerTypes,
      }),
      createdAt,
    });

    db.exec("COMMIT");

    return {
      id: rfqId,
      referenceId,
      name,
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function submitBid(auctionId, payload) {
  const db = ensureDatabase();
  const supplierId = parseInteger(payload, "supplierId", "Supplier", 1);
  const carrierName = parseText(payload, "carrierName", "Carrier name");
  const freightCharges = parseMoney(payload, "freightCharges", "Freight charges");
  const originCharges = parseMoney(payload, "originCharges", "Origin charges");
  const destinationCharges = parseMoney(payload, "destinationCharges", "Destination charges");
  const transitTimeDays = parseInteger(payload, "transitTimeDays", "Transit time", 1);
  const quoteValidUntil = parseDateOnly(payload, "quoteValidUntil", "Quote validity");
  const createdAt = new Date().toISOString();

  db.exec("BEGIN IMMEDIATE");

  try {
    const supplier = db
      .prepare("SELECT id, code, name FROM suppliers WHERE id = :supplierId")
      .get({ supplierId });
    invariant(supplier, "Selected supplier does not exist.");

    const auction = getAuctionAggregateById(db, auctionId, new Date(createdAt));
    invariant(auction.status === AuctionStatus.ACTIVE, "Bidding is only allowed while the auction is active.");

    const totalAmount = calculateBidTotal({
      freightCharges,
      originCharges,
      destinationCharges,
    });

    const currentSupplierStanding = auction.standings.find((standing) => standing.supplierId === supplierId);
    if (currentSupplierStanding) {
      invariant(
        totalAmount < currentSupplierStanding.totalAmount,
        `New total must be lower than ${supplier.name}'s latest standing quote.`,
      );
    }

    const insertBid = db.prepare(`
      INSERT INTO bids (
        rfq_id,
        supplier_id,
        carrier_name,
        freight_charges,
        origin_charges,
        destination_charges,
        transit_time_days,
        quote_valid_until,
        total_amount,
        created_at
      ) VALUES (
        :rfqId,
        :supplierId,
        :carrierName,
        :freightCharges,
        :originCharges,
        :destinationCharges,
        :transitTimeDays,
        :quoteValidUntil,
        :totalAmount,
        :createdAt
      )
    `);

    const insertLog = db.prepare(`
      INSERT INTO activity_logs (
        rfq_id,
        event_type,
        message,
        metadata_json,
        created_at
      ) VALUES (
        :rfqId,
        :eventType,
        :message,
        :metadataJson,
        :createdAt
      )
    `);

    const updateAuction = db.prepare(`
      UPDATE rfqs
      SET current_bid_close_at = :currentBidCloseAt
      WHERE id = :rfqId
    `);

    const bidInsert = insertBid.run({
      rfqId: auctionId,
      supplierId,
      carrierName,
      freightCharges,
      originCharges,
      destinationCharges,
      transitTimeDays,
      quoteValidUntil,
      totalAmount,
      createdAt,
    });

    const newBid = {
      id: Number(bidInsert.lastInsertRowid),
      rfqId: auctionId,
      supplierId,
      supplierCode: supplier.code,
      supplierName: supplier.name,
      carrierName,
      freightCharges,
      originCharges,
      destinationCharges,
      transitTimeDays,
      quoteValidUntil,
      totalAmount,
      createdAt,
    };

    const afterStandings = assignRanks(buildLatestStandings([...auction.bids, newBid]));
    const extension = evaluateExtension({
      auction,
      triggerWindowMinutes: auction.config.triggerWindowMinutes,
      extensionDurationMinutes: auction.config.extensionDurationMinutes,
      enabledTriggers: auction.triggerTypes,
      beforeStandings: auction.standings,
      afterStandings,
      submittedAt: createdAt,
    });

    insertLog.run({
      rfqId: auctionId,
      eventType: ActivityEventType.BID_SUBMITTED,
      message: `${supplier.name} submitted a new bid for INR ${Math.round(totalAmount).toLocaleString("en-IN")}.`,
      metadataJson: JSON.stringify({
        bidId: newBid.id,
        supplierId,
        totalAmount,
      }),
      createdAt,
    });

    if (extension.shouldExtend) {
      updateAuction.run({
        rfqId: auctionId,
        currentBidCloseAt: extension.nextCloseAt,
      });

      insertLog.run({
        rfqId: auctionId,
        eventType: ActivityEventType.TIME_EXTENDED,
        message: `Auction extended by ${extension.extendedByMinutes} minutes because ${extension.reasons.join(
          " and ",
        ).toLowerCase()}.`,
        metadataJson: JSON.stringify({
          previousCloseAt: auction.currentBidCloseAt,
          nextCloseAt: extension.nextCloseAt,
          reasons: extension.reasons,
          cappedByForcedClose: extension.cappedByForcedClose,
        }),
        createdAt,
      });
    }

    db.exec("COMMIT");

    return {
      auctionId,
      supplierName: supplier.name,
      totalAmount,
      extension,
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function getDashboardMetrics(auctions) {
  return {
    activeAuctions: auctions.filter((auction) => auction.status === AuctionStatus.ACTIVE).length,
    totalAuctions: auctions.length,
    totalBids: auctions.reduce((sum, auction) => sum + auction.totalBids, 0),
    suppliersCompeting: auctions.reduce((sum, auction) => sum + auction.activeSupplierCount, 0),
  };
}

export function getCreateFormDefaults(now = new Date()) {
  const base = now.toISOString();
  return {
    referenceId: `RFQ-BA-${String(now.getTime()).slice(-6)}`,
    name: "New British Auction RFQ",
    bidStartAt: shiftIsoByMinutes(base, 60),
    bidCloseAt: shiftIsoByMinutes(base, 180),
    forcedBidCloseAt: shiftIsoByMinutes(base, 240),
    serviceDate: shiftDateByDays(base, 4),
    triggerWindowMinutes: 10,
    extensionDurationMinutes: 5,
    triggerTypes: Object.values(TriggerType),
  };
}

export { AppError };
