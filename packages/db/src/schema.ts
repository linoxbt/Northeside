import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Postgres is an index and a cache of the chain. It never decides who owns money: payouts are
 * claimable only with proofs against roots posted on-chain.
 *
 * Money and token amounts are numeric(78,0) in base units, mapped to bigint (never JS numbers).
 */
export const uint256 = customType<{ data: bigint; driverData: string }>({
  dataType: () => "numeric(78, 0)",
  toDriver: (v) => v.toString(),
  fromDriver: (v) => BigInt(v),
});

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------- accounts

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    privyDid: text("privy_did").unique(),
    /** HMAC-SHA256 of the lowercased email, for uniqueness and drip limits without storing it plain. */
    emailHash: text("email_hash").unique(),
    /** AES-256-GCM ciphertext of the email. */
    emailEnc: text("email_enc"),
    emailVerified: boolean("email_verified").notNull().default(false),
    displayName: text("display_name"),
    /** QIE ID as typed by the player; shown with a "self-reported" marker until resolved. */
    qieId: text("qie_id"),
    qieIdResolved: boolean("qie_id_resolved").notNull().default(false),
    adultConfirmedAt: timestamp("adult_confirmed_at", { withTimezone: true }),
    /** FR-19: the first host link a player joins through is their attributed league for the season. */
    attributedLeagueId: uuid("attributed_league_id"),
    attributionSource: text("attribution_source"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /** Bumped on sign-out-everywhere and deletion; sessions carrying an older version are rejected. */
    sessionVersion: integer("session_version").notNull().default(0),
    createdAt: createdAt(),
  },
);

export const wallets = pgTable(
  "wallets",
  {
    /** Lowercased 0x address. */
    address: text("address").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["embedded", "external"] }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("wallets_user_idx").on(t.userId)],
);

export const notificationPrefs = pgTable("notification_prefs", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  telegramChatId: text("telegram_chat_id"),
  webPush: jsonb("web_push"),
  emailOptIn: boolean("email_opt_in").notNull().default(false),
  remindLock: boolean("remind_lock").notNull().default(true),
  remindResults: boolean("remind_results").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------- gas drip

export const drips = pgTable(
  "drips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    wallet: text("wallet").notNull(),
    deviceHash: text("device_hash").notNull(),
    /** HMAC of the verified email. Kept after account deletion so a re-sign-up cannot drip again. */
    emailHash: text("email_hash"),
    amountWei: uint256("amount_wei").notNull(),
    txHash: text("tx_hash"),
    status: text("status", { enum: ["pending", "sent", "confirmed", "failed"] }).notNull().default("pending"),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [
    // One drip per email (user), per wallet and per device, ever. Failed drips are deleted so they can retry.
    uniqueIndex("drips_user_uq").on(t.userId),
    uniqueIndex("drips_wallet_uq").on(t.wallet),
    uniqueIndex("drips_device_uq").on(t.deviceHash),
    uniqueIndex("drips_email_uq").on(t.emailHash),
    index("drips_created_idx").on(t.createdAt),
  ],
);

// ---------------------------------------------------------------- matchweeks and fixtures

export const matchweeks = pgTable("matchweeks", {
  /** Same id as on-chain. Premier League matchday number for the season. */
  id: integer("id").primaryKey(),
  season: integer("season").notNull(),
  status: text("status", {
    enum: ["draft", "open", "locked", "results_proposed", "challenged", "finalized"],
  })
    .notNull()
    .default("draft"),
  lockTime: timestamp("lock_time", { withTimezone: true }).notNull(),
  fixturesRoot: text("fixtures_root"),
  fixturesTree: jsonb("fixtures_tree"),
  scoringRulesHash: text("scoring_rules_hash"),
  createTx: text("create_tx"),
  resultsRoot: text("results_root"),
  resultsTree: jsonb("results_tree"),
  resultsCheck: jsonb("results_check"),
  evidenceUri: text("evidence_uri"),
  overrideReason: text("override_reason"),
  disputeEnds: timestamp("dispute_ends", { withTimezone: true }),
  revealsRoot: text("reveals_root"),
  revealsTree: jsonb("reveals_tree"),
  scoresRoot: text("scores_root"),
  scoresTree: jsonb("scores_tree"),
  finalizeTx: text("finalize_tx"),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const fixtures = pgTable(
  "fixtures",
  {
    matchweekId: integer("matchweek_id")
      .notNull()
      .references(() => matchweeks.id),
    idx: smallint("idx").notNull(),
    externalId: integer("external_id").notNull(),
    home: text("home").notNull(),
    away: text("away").notNull(),
    kickoff: timestamp("kickoff", { withTimezone: true }).notNull(),
    status: text("status", { enum: ["scheduled", "played", "void"] }).notNull().default("scheduled"),
    homeGoals: smallint("home_goals"),
    awayGoals: smallint("away_goals"),
  },
  (t) => [primaryKey({ columns: [t.matchweekId, t.idx] }), uniqueIndex("fixtures_external_uq").on(t.externalId)],
);

// ---------------------------------------------------------------- predictions

export const predictions = pgTable(
  "predictions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    wallet: text("wallet").notNull(),
    matchweekId: integer("matchweek_id")
      .notNull()
      .references(() => matchweeks.id),
    draft: jsonb("draft"),
    /** AES-256-GCM ciphertext of the full sealed payload, salt included. Revealed only after lock. */
    payloadEnc: text("payload_enc"),
    commitment: text("commitment"),
    /**
     * A re-seal whose transaction had no receipt yet. Kept beside the confirmed payload so a reverted
     * or dropped re-seal never replaces the payload that is actually on-chain; the reveal uses
     * whichever matches the chain, and the indexer promotes it when its Committed event arrives.
     */
    pendingPayloadEnc: text("pending_payload_enc"),
    pendingCommitment: text("pending_commitment"),
    pendingTxHash: text("pending_tx_hash"),
    version: integer("version").notNull().default(0),
    txHash: text("tx_hash"),
    txStatus: text("tx_status", { enum: ["none", "sent", "confirmed", "failed"] }).notNull().default("none"),
    sealedAt: timestamp("sealed_at", { withTimezone: true }),
    revealedAt: timestamp("revealed_at", { withTimezone: true }),
    /** Published after lock: the decrypted payload, so anyone can verify it. */
    revealPayload: jsonb("reveal_payload"),
    revealValid: boolean("reveal_valid"),
    revealError: text("reveal_error"),
    points: integer("points"),
    exactScores: integer("exact_scores"),
    rank: integer("rank"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("predictions_wallet_mw_uq").on(t.wallet, t.matchweekId),
    index("predictions_mw_idx").on(t.matchweekId),
    index("predictions_user_idx").on(t.userId),
  ],
);

// ---------------------------------------------------------------- leagues

export const leagues = pgTable(
  "leagues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    privacy: text("privacy", { enum: ["public", "private"] }).notNull().default("public"),
    hostUserId: uuid("host_user_id")
      .notNull()
      .references(() => users.id),
    /** Payout address for host rewards. */
    hostWallet: text("host_wallet").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("leagues_slug_uq").on(sql`lower(${t.slug})`), index("leagues_host_idx").on(t.hostUserId)],
);

export const leagueMembers = pgTable(
  "league_members",
  {
    leagueId: uuid("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    source: text("source"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.leagueId, t.userId] }), index("league_members_user_idx").on(t.userId)],
);

// ---------------------------------------------------------------- identity (QIE Pass)

export const identities = pgTable("identities", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** AES-256-GCM ciphertext of QIE's stable person reference. Never on-chain. */
  personRefEnc: text("person_ref_enc").notNull(),
  personHash: text("person_hash").notNull(),
  status: text("status", { enum: ["pending", "verified", "revoked"] }).notNull().default("pending"),
  mode: text("mode", { enum: ["A", "B"] }).notNull().default("B"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/** Mirror of IdentityAdapter.Verified / Revoked events. */
export const walletPersons = pgTable(
  "wallet_persons",
  {
    wallet: text("wallet").primaryKey(),
    personHash: text("person_hash").notNull(),
    txHash: text("tx_hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("wallet_persons_person_idx").on(t.personHash)],
);

// ---------------------------------------------------------------- host rewards

export const campaigns = pgTable("campaigns", {
  /** On-chain campaign id. */
  id: integer("id").primaryKey(),
  sponsorName: text("sponsor_name").notNull(),
  sponsor: text("sponsor").notNull(),
  grossAmount: uint256("gross_amount").notNull(),
  feeBps: integer("fee_bps").notNull(),
  budget: uint256("budget").notNull(),
  ratePerPlayer: uint256("rate_per_player").notNull(),
  capPerHost: uint256("cap_per_host").notNull(),
  firstMatchweek: integer("first_matchweek").notNull(),
  lastMatchweek: integer("last_matchweek").notNull(),
  expiry: timestamp("expiry", { withTimezone: true }).notNull(),
  /** Eligible league slugs; null = all leagues. */
  leagues: jsonb("leagues").$type<string[] | null>(),
  leaguesHash: text("leagues_hash").notNull(),
  termsHash: text("terms_hash").notNull(),
  status: text("status", { enum: ["pending", "active", "closed", "cancelled"] }).notNull().default("pending"),
  /** True only for campaigns funded by an outside sponsor; self-funded demos never count on /stats. */
  externalSponsor: boolean("external_sponsor").notNull().default(true),
  createTx: text("create_tx"),
  fundTx: text("fund_tx"),
  createdAt: createdAt(),
});

export const rewardRoots = pgTable(
  "reward_roots",
  {
    campaignId: integer("campaign_id")
      .notNull()
      .references(() => campaigns.id),
    matchweekId: integer("matchweek_id")
      .notNull()
      .references(() => matchweeks.id),
    root: text("root").notNull(),
    total: uint256("total").notNull(),
    reportUri: text("report_uri").notNull(),
    tree: jsonb("tree").notNull(),
    txHash: text("tx_hash"),
    /**
     * "pending" is written before postRoot is sent, so a crash after mining never loses the proofs.
     * "voided": the root reached the chain and the admin removed it (voidRoot); never re-posted.
     */
    status: text("status", { enum: ["pending", "confirmed", "voided"] }).notNull().default("confirmed"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.matchweekId] })],
);

export const rewardLeaves = pgTable(
  "reward_leaves",
  {
    campaignId: integer("campaign_id").notNull(),
    matchweekId: integer("matchweek_id").notNull(),
    host: text("host").notNull(),
    amount: uint256("amount").notNull(),
    countablePlayers: integer("countable_players").notNull(),
    proof: jsonb("proof").$type<string[]>().notNull(),
    claimTx: text("claim_tx"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.matchweekId, t.host] }), index("reward_leaves_host_idx").on(t.host)],
);

/** The audit trail behind each host payout: which persons counted. Hashed IDs only. */
export const countablePlayers = pgTable(
  "countable_players",
  {
    campaignId: integer("campaign_id").notNull(),
    matchweekId: integer("matchweek_id").notNull(),
    personHash: text("person_hash").notNull(),
    host: text("host").notNull(),
    leagueSlug: text("league_slug").notNull(),
  },
  (t) => [primaryKey({ columns: [t.personHash, t.matchweekId, t.campaignId] })],
);

// ---------------------------------------------------------------- chain index

export const chainEvents = pgTable(
  "chain_events",
  {
    chainId: integer("chain_id").notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    logIndex: integer("log_index").notNull(),
    txHash: text("tx_hash").notNull(),
    address: text("address").notNull(),
    eventName: text("event_name").notNull(),
    args: jsonb("args").notNull(),
    blockTime: timestamp("block_time", { withTimezone: true }),
    blockHash: text("block_hash"),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.chainId, t.txHash, t.logIndex] }),
    index("chain_events_name_idx").on(t.eventName),
    index("chain_events_block_idx").on(t.blockNumber),
  ],
);

/** Runtime switches the operator can flip without a redeploy (e.g. automation_paused). */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const indexerState = pgTable("indexer_state", {
  key: text("key").primaryKey(),
  lastBlock: bigint("last_block", { mode: "bigint" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------- operations

export const jobRuns = pgTable(
  "job_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    job: text("job").notNull(),
    runKey: text("run_key").notNull(),
    status: text("status", { enum: ["running", "ok", "failed"] }).notNull(),
    detail: jsonb("detail"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("job_runs_uq").on(t.job, t.runKey), index("job_runs_started_idx").on(t.startedAt)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    details: jsonb("details"),
    txHash: text("tx_hash"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_log_created_idx").on(t.createdAt)],
);

export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);

export const idempotencyKeys = pgTable("idempotency_keys", {
  key: text("key").primaryKey(),
  userId: uuid("user_id"),
  route: text("route").notNull(),
  response: jsonb("response"),
  createdAt: createdAt(),
});

/** One row per reminder actually sent, so the notify job never sends the same one twice. */
export const notificationsSent = pgTable(
  "notifications_sent",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["lock_24h", "lock_2h", "results"] }).notNull(),
    matchweekId: integer("matchweek_id").notNull(),
    channel: text("channel").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.kind, t.matchweekId] })],
);
