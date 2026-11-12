import {
  chainById,
  deploymentFromEnv,
  qieTransport,
  rpcUrlsFromEnv,
  type Deployment,
} from "@northeside/chain";
import { FieldCrypto, getDb, type Database } from "@northeside/db";
import { ApiFootballClient, FootballDataClient } from "@northeside/football";
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

export const consoleLogger: Logger = {
  info: (msg, data) => console.log(JSON.stringify({ level: "info", msg, ...data }, bigintReplacer)),
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
  crypto: FieldCrypto;
  /** Secret mixed into personHash. */
  pepper?: `0x${string}`;
  operator?: Signer;
  results?: Signer;
  attester?: Account;
  drip?: Signer;
  football?: { primary: FootballDataClient; secondary: ApiFootballClient };
  season: number;
  siteUrl: string;
  log: Logger;
  /** Operator alerts (Telegram). Never throws. */
  alert(message: string): Promise<void>;
  now(): Date;
}

type Env = Record<string, string | undefined>;

function signer(key: string | undefined, chain: Chain, transport: Transport): Signer | undefined {
  if (!key) return undefined;
  return createWalletClient({ account: privateKeyToAccount(key as `0x${string}`), chain, transport });
}

export function telegramAlerter(env: Env, log: Logger) {
  return async (message: string) => {
    const token = env.TELEGRAM_BOT_TOKEN;
    const chat = env.TELEGRAM_OPERATOR_CHAT_ID;
    if (!token || !chat) {
      log.warn("operator alert (Telegram not configured)", { message });
      return;
    }
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chat, text: `Northeside: ${message}`.slice(0, 4000) }),
      });
    } catch (e) {
      log.error("operator alert failed", { error: String(e) });
    }
  };
}

/** Build the context from environment variables. Only the keys present are loaded. */
export function createContextFromEnv(env: Env = process.env, overrides: Partial<CoreContext> = {}): CoreContext {
  const deployment = deploymentFromEnv(env);
  const chain = chainById(deployment.chainId);
  const transport = qieTransport(chain, rpcUrlsFromEnv(env));
  const publicClient = createPublicClient({ chain, transport }) as PublicClient;
  const log = consoleLogger;
  const pepper = env.PERSON_PEPPER as `0x${string}` | undefined;
  return {
    db: getDb(env.DATABASE_URL) as unknown as Database,
    chain,
    deployment,
    publicClient,
    crypto: FieldCrypto.fromEnv(env),
    pepper: pepper ? (pepper.startsWith("0x") ? pepper : (`0x${pepper}` as `0x${string}`)) : undefined,
    operator: signer(env.OPERATOR_PRIVATE_KEY, chain, transport),
    results: signer(env.RESULTS_PRIVATE_KEY, chain, transport),
    attester: env.ATTESTER_PRIVATE_KEY ? privateKeyToAccount(env.ATTESTER_PRIVATE_KEY as `0x${string}`) : undefined,
    drip: signer(env.DRIP_PRIVATE_KEY, chain, transport),
    football:
      env.FOOTBALL_DATA_API_KEY && env.API_FOOTBALL_KEY
        ? {
            primary: new FootballDataClient({ apiKey: env.FOOTBALL_DATA_API_KEY }),
            secondary: new ApiFootballClient({ apiKey: env.API_FOOTBALL_KEY }),
          }
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
