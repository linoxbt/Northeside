import {
  chainById,
  deploymentFromEnv,
  qieTransport,
  rpcUrlsFromEnv,
  type Deployment,
} from "@northeside/chain";
import { FieldCrypto, getDb, type Database } from "@northeside/db";
import { ApiFootballClient, FootballDataClient, TheSportsDbClient, type ResultsSource } from "@northeside/football";
import {
  createPublicClient,
  createWalletClient,
  type Account,
  type Chain,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export interface Logger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

/** Structured logs go to stderr so stdout stays clean for CLI output (and for piping it). */
export const consoleLogger: Logger = {
  info: (msg, data) => console.error(JSON.stringify({ level: "info", msg, ...data }, bigintReplacer)),
  warn: (msg, data) => console.warn(JSON.stringify({ level: "warn", msg, ...data }, bigintReplacer)),
  error: (msg, data) => console.error(JSON.stringify({ level: "error", msg, ...data }, bigintReplacer)),
};

export function bigintReplacer(_k: string, v: unknown) {
  return typeof v === "bigint" ? v.toString() : v;
}

/** JSON-safe copy for jsonb columns: bigints become decimal strings. */
export function toJson<T>(value: T): object {
  return JSON.parse(JSON.stringify(value, bigintReplacer)) as object;
}

export type Signer = WalletClient<Transport, Chain, Account>;

export interface CoreContext {
  db: Database;
  chain: Chain;
  deployment: Deployment;
  publicClient: PublicClient;
  /** The RPC endpoints behind publicClient; the indexer pins one per pass (audit B8). */
  rpcUrls?: readonly string[];
  crypto: FieldCrypto;
  /** Secret mixed into personHash. */
  pepper?: `0x${string}`;
  operator?: Signer;
  results?: Signer;
  attester?: Account;
  drip?: Signer;
  football?: { primary: FootballDataClient; secondary: ResultsSource };
  season: number;
  siteUrl: string;
  log: Logger;
  /** Operator alerts (Telegram and/or email). Never throws; resolves true when a channel accepted it. */
  alert(message: string): Promise<boolean | void>;
  now(): Date;
}

type Env = Record<string, string | undefined>;

function signer(key: string | undefined, chain: Chain, transport: Transport): Signer | undefined {
  if (!key) return undefined;
  return createWalletClient({ account: privateKeyToAccount(key as `0x${string}`), chain, transport });
}

/** Which operator alert channels are configured (the status page is unhealthy without one). */
export function alertChannels(env: Env) {
  return {
    telegram: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_OPERATOR_CHAT_ID),
    email: Boolean(env.RESEND_API_KEY && env.EMAIL_FROM && env.ALERT_EMAIL_TO),
  };
}

/**
 * Operator alerts, sent to every configured channel: Telegram (TELEGRAM_BOT_TOKEN and
 * TELEGRAM_OPERATOR_CHAT_ID) and email through Resend (RESEND_API_KEY, EMAIL_FROM, ALERT_EMAIL_TO).
 * Never throws; with no channel the alert is only logged.
 */
export function telegramAlerter(env: Env, log: Logger) {
  return async (message: string) => {
    const text = `Northeside: ${message}`;
    const channels = alertChannels(env);
    if (!channels.telegram && !channels.email) {
      log.warn("operator alert (no alert channel configured)", { message });
      return false;
    }
    const sends: Promise<unknown>[] = [];
    if (channels.telegram) {
      sends.push(
        fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: env.TELEGRAM_OPERATOR_CHAT_ID, text: text.slice(0, 4000) }),
          signal: AbortSignal.timeout(10_000),
        }).then((r) => {
          if (!r.ok) throw new Error(`telegram ${r.status}`);
        }),
      );
    }
    if (channels.email) {
      sends.push(
        fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
          body: JSON.stringify({
            from: env.EMAIL_FROM,
            to: env.ALERT_EMAIL_TO!.split(",").map((x) => x.trim()).filter(Boolean),
            subject: `${message.startsWith("URGENT") ? "URGENT " : ""}Northeside alert: ${message.slice(0, 80)}`,
            text,
          }),
          signal: AbortSignal.timeout(10_000),
        }).then((r) => {
          if (!r.ok) throw new Error(`resend ${r.status}`);
        }),
      );
    }
    const results = await Promise.allSettled(sends);
    for (const r of results) {
      if (r.status === "rejected") log.error("operator alert failed", { error: String(r.reason) });
    }
    return results.some((r) => r.status === "fulfilled");
  };
}

/** Build the context from environment variables. Only the keys present are loaded. */
/**
 * The second, independent results source. TheSportsDB (free public key) by default;
 * RESULTS_SECONDARY=api-football uses API-Football, whose current season needs a paid plan.
 */
export function secondarySource(env: Env): ResultsSource {
  const choice = (env.RESULTS_SECONDARY ?? "thesportsdb").toLowerCase();
  if (choice === "api-football") {
    if (!env.API_FOOTBALL_KEY) throw new Error("RESULTS_SECONDARY=api-football needs API_FOOTBALL_KEY");
    return new ApiFootballClient({ apiKey: env.API_FOOTBALL_KEY, baseUrl: env.API_FOOTBALL_BASE_URL });
  }
  if (choice !== "thesportsdb") throw new Error(`RESULTS_SECONDARY must be thesportsdb or api-football, not ${choice}`);
  return new TheSportsDbClient({ apiKey: env.THESPORTSDB_API_KEY, baseUrl: env.THESPORTSDB_BASE_URL });
}

export function createContextFromEnv(env: Env = process.env, overrides: Partial<CoreContext> = {}): CoreContext {
  const deployment = deploymentFromEnv(env);
  const chain = chainById(deployment.chainId);
  const rpcUrls = rpcUrlsFromEnv(env) ?? chain.rpcUrls.default.http;
  const transport = qieTransport(chain, rpcUrls);
  const publicClient = createPublicClient({ chain, transport }) as PublicClient;
  const log = consoleLogger;
  // A malformed pepper would only fail on first use; reject it at start-up and leave it unset, so
  // anything that needs it reports "PERSON_PEPPER is not configured" (audit B18).
  const rawPepper = env.PERSON_PEPPER ? (env.PERSON_PEPPER.startsWith("0x") ? env.PERSON_PEPPER : `0x${env.PERSON_PEPPER}`) : undefined;
  const pepperOk = !!rawPepper && /^0x[0-9a-fA-F]{64}$/.test(rawPepper);
  if (rawPepper && !pepperOk) log.error("PERSON_PEPPER must be 32 bytes of hex; ignoring it");
  const pepper = pepperOk ? (rawPepper as `0x${string}`) : undefined;
  return {
    db: getDb(env.DATABASE_URL) as unknown as Database,
    chain,
    deployment,
    publicClient,
    rpcUrls,
    crypto: FieldCrypto.fromEnv(env),
    pepper,
    operator: signer(env.OPERATOR_PRIVATE_KEY, chain, transport),
    results: signer(env.RESULTS_PRIVATE_KEY, chain, transport),
    attester: env.ATTESTER_PRIVATE_KEY ? privateKeyToAccount(env.ATTESTER_PRIVATE_KEY as `0x${string}`) : undefined,
    drip: signer(env.DRIP_PRIVATE_KEY, chain, transport),
    football: env.FOOTBALL_DATA_API_KEY
      ? { primary: new FootballDataClient({ apiKey: env.FOOTBALL_DATA_API_KEY, baseUrl: env.FOOTBALL_DATA_BASE_URL }), secondary: secondarySource(env) }
      : undefined,
    season: Number(env.SEASON ?? 2026),
    siteUrl: env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
    log,
    alert: telegramAlerter(env, log),
    now: () => new Date(),
    ...overrides,
  };
}

export function need<T>(value: T | undefined, what: string): T {
  if (value === undefined || value === null) throw new Error(`${what} is not configured`);
  return value;
}
