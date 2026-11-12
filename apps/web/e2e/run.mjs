// End-to-end run: real contracts on anvil, real Postgres, the production Next.js build, the
// operator CLI, and Chromium driving the UI with an injected EIP-6963 "QIE Wallet".
//
//   DATABASE_ADMIN_URL=postgres://postgres@127.0.0.1:54329/postgres node apps/web/e2e/run.mjs
//
// Options: SKIP_BUILD=1, LOCK_IN=240 (seconds until the first kickoff), OUT=<dir for screenshots>.
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createWalletClient, http, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import postgres from "postgres";
import { startMockFootball } from "./mock-football.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "../../..");
const WEB = resolve(here, "..");
const OUT = process.env.OUT ?? join(ROOT, "e2e-output");
mkdirSync(OUT, { recursive: true });
const RPC = "http://127.0.0.1:8545";
const APP = "http://localhost:3100";
const LOCK_IN = Number(process.env.LOCK_IN ?? 240);

const KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
  "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
  "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356",
];
const addr = (i) => privateKeyToAccount(KEYS[i]).address;
const procs = [];
const openPages = [];
const log = (...a) => console.log(`[e2e ${new Date().toISOString().slice(11, 19)}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(cond, what) {
  if (cond) log("PASS", what);
  else {
    failures++;
    log("FAIL", what);
  }
}

async function rpc(method, params = []) {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

async function waitFor(fn, what, ms = 60_000) {
  const end = Date.now() + ms;
  for (;;) {
    try {
      if (await fn()) return;
    } catch {}
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(500);
  }
}

function bg(cmd, args, opts) {
  // detached: own process group, so cleanup also stops children (next start forks next-server)
  const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], detached: true, ...opts });
  let tail = "";
  p.stdout.on("data", (d) => (tail = (tail + d).slice(-4000)));
  p.stderr.on("data", (d) => (tail = (tail + d).slice(-4000)));
  p.tail = () => tail;
  procs.push(p);
  return p;
}

/** Run the operator CLI without blocking the event loop (the mock provider lives in this process). */
function cli(env, ...args) {
  return new Promise((resolveCli, reject) => {
    const p = spawn("npx", ["tsx", join(ROOT, "ops/cli/src/index.ts"), ...args], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => {
      if (code !== 0) return reject(new Error(`cli ${args.join(" ")} failed: ${err || out}`));
      log(`cli ${args.join(" ")} ->`, out.trim().split("\n").slice(0, 3).join(" "));
      resolveCli(JSON.parse(out));
    });
  });
}

/** An EIP-1193 wallet in the page, backed by a dev key in Node. Announces itself as QIE Wallet. */
async function walletContext(browser, keyIndex) {
  const account = privateKeyToAccount(KEYS[keyIndex]);
  const client = createWalletClient({ account, transport: http(RPC), chain: { id: 31337, name: "anvil", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } } });
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1 });
  ctx.on("page", (p) => {
    openPages.push(p);
    p.on("console", (m) => m.type() === "error" && log("browser console error:", m.text().slice(0, 300)));
  });
  await ctx.exposeFunction("__nsWallet", async (method, paramsJson) => {
    const params = JSON.parse(paramsJson);
    try {
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts":
          return JSON.stringify({ result: [account.address] });
        case "eth_chainId":
          return JSON.stringify({ result: "0x7a69" });
        case "wallet_switchEthereumChain":
        case "wallet_addEthereumChain":
          return JSON.stringify({ result: null });
        case "personal_sign":
          return JSON.stringify({ result: await account.signMessage({ message: { raw: params[0] } }) });
        case "eth_signTypedData_v4": {
          const t = JSON.parse(params[1]);
          delete t.types.EIP712Domain;
          return JSON.stringify({ result: await account.signTypedData(t) });
        }
        case "eth_sendTransaction": {
          const tx = params[0];
          const hash = await client.sendTransaction({ to: tx.to, data: tx.data, value: tx.value ? BigInt(tx.value) : undefined, gas: tx.gas ? BigInt(tx.gas) : undefined });
          return JSON.stringify({ result: hash });
        }
        default:
          return JSON.stringify({ result: await rpc(method, params) });
      }
    } catch (e) {
      return JSON.stringify({ error: { code: -32603, message: String(e?.shortMessage ?? e?.message ?? e) } });
    }
  });
  await ctx.addInitScript(() => {
    const listeners = {};
    const provider = {
      isMetaMask: true, // QIE Wallet sets this for compatibility; the app must not rely on it
      async request({ method, params }) {
        const o = JSON.parse(await window.__nsWallet(method, JSON.stringify(params ?? [])));
        if (o.error) throw Object.assign(new Error(o.error.message), { code: o.error.code });
        return o.result;
      },
      on(ev, fn) {
        (listeners[ev] ||= []).push(fn);
      },
      removeListener(ev, fn) {
        listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn);
      },
    };
    const info = { uuid: "4f1b9c1e-qie-e2e", name: "QIE Wallet", icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E", rdns: "me.qiewallet" };
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
    window.qie = provider;
  });
  return { ctx, account };
}

/** Connect QIE Wallet and sign in. Auto sign-in may or may not fire; press "Sign in" if it remains. */
async function signInWithQie(page) {
  const panel = page.getByText("18+ only. Free to play");
  const qie = page.getByRole("button", { name: "QIE Wallet" });
  const sign = page.getByRole("button", { name: "Sign in", exact: true });
  await panel.waitFor({ timeout: 30_000 });
  if (await qie.isVisible().catch(() => false)) await qie.click({ timeout: 5_000 }).catch(() => {});
  for (let i = 0; i < 60; i++) {
    if (!(await panel.isVisible().catch(() => false))) return;
    if (i % 6 === 5 && (await sign.isVisible().catch(() => false))) await sign.click({ timeout: 2_000 }).catch(() => {});
    if (i % 6 === 5 && (await qie.isVisible().catch(() => false))) await qie.click({ timeout: 2_000 }).catch(() => {});
    await sleep(500);
  }
  throw new Error("sign-in did not complete");
}

async function playerSeals(browser, keyIndex, name, picks) {
  const { ctx, account } = await walletContext(browser, keyIndex);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${APP}/l/e2e-league`);
  await signInWithQie(page);
  await page.getByRole("button", { name: /^Join / }).waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: /^Join / }).click();
  await page.getByText("You are in").waitFor();
  await page.goto(APP);
  await page.getByText("One more step").waitFor({ timeout: 30_000 });
  await page.getByRole("textbox").first().fill(name);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByText("One more step").waitFor({ state: "detached" });

  const fixtures = await page.locator('[role="group"][aria-label$=" goals"]').evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  for (let i = 0; i < fixtures.length; i++) {
    const goals = i % 2 === 0 ? picks[i / 2].h : picks[(i - 1) / 2].a;
    const label = fixtures[i];
    for (let k = 0; k <= goals; k++) await page.getByRole("button", { name: `${label}: one more` }).click();
  }
  await page.screenshot({ path: join(OUT, `${name}-picks.png`), fullPage: true });
  await page.getByRole("button", { name: "Seal predictions" }).click();
  await page.getByText(/Sealed · v1/).waitFor({ timeout: 60_000 });
  await page.screenshot({ path: join(OUT, `${name}-sealed.png`), fullPage: true });
  check(errors.length === 0, `${name}: no page errors (${errors.join("; ")})`);
  return { ctx, page, account };
}

async function portFree(port) {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) });
    return false;
  } catch {
    return true;
  }
}

async function main() {
  // A leftover server would serve a stale build (Next renames its process to next-server).
  for (const port of [3100, 8545, 4010]) {
    if (!(await portFree(port))) throw new Error(`port ${port} is in use; stop the old process first`);
  }
  // ---------------------------------------------------------------- chain
  log("starting anvil");
  bg("anvil", ["--port", "8545", "--hardfork", "shanghai", "--chain-id", "31337", "--silent"]);
  await waitFor(async () => (await rpc("eth_chainId")) === "0x7a69", "anvil");

  log("deploying contracts");
  execFileSync("forge", ["script", "script/Deploy.s.sol", "--rpc-url", RPC, "--broadcast", "--silent"], {
    cwd: join(ROOT, "contracts"),
    env: {
      ...process.env,
      DEPLOYER_PRIVATE_KEY: KEYS[0],
      ADMIN_ADDRESS: addr(1),
      OPERATOR_ADDRESS: addr(2),
      RESULTS_ADDRESS: addr(3),
      ATTESTER_ADDRESS: addr(4),
      TREASURY_ADDRESS: addr(5),
      PAUSER_ADDRESS: addr(2),
      CHALLENGER_ADDRESSES: addr(1),
    },
    stdio: "inherit",
  });
  const dep = JSON.parse(readFileSync(join(ROOT, "contracts/deployments/31337.json"), "utf8"));
  log("deployed", dep);

  // ---------------------------------------------------------------- database
  const adminUrl = process.env.DATABASE_ADMIN_URL ?? "postgres://postgres@127.0.0.1:54329/postgres";
  const admin = postgres(adminUrl, { max: 1 });
  await admin.unsafe("drop database if exists northeside_e2e with (force)");
  await admin.unsafe("create database northeside_e2e");
  await admin.end();
  const DATABASE_URL = adminUrl.replace(/\/[^/]+$/, "/northeside_e2e");
  execFileSync("npx", ["tsx", "src/migrate.ts"], { cwd: join(ROOT, "packages/db"), env: { ...process.env, DATABASE_URL }, stdio: "inherit" });

  // ---------------------------------------------------------------- env
  const { url: footballUrl } = await startMockFootball(4010);
  const env = {
    ...process.env,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    DATABASE_URL,
    DATA_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    PERSON_PEPPER: `0x${randomBytes(32).toString("hex")}`,
    SESSION_SECRET: randomBytes(32).toString("base64"),
    CRON_SECRET: "e2e-cron-secret",
    NEXT_PUBLIC_CHAIN_ID: "31337",
    CHAIN_ID: "31337",
    NEXT_PUBLIC_MATCHWEEKS_ADDRESS: dep.matchweeks,
    NEXT_PUBLIC_HOST_REWARDS_ADDRESS: dep.hostRewards,
    NEXT_PUBLIC_IDENTITY_ADDRESS: dep.identity,
    NEXT_PUBLIC_QUSDC_ADDRESS: dep.qusdc,
    NEXT_PUBLIC_DEPLOYED_AT_BLOCK: "0",
    NEXT_PUBLIC_SITE_URL: APP,
    QIE_RPC_URLS: RPC,
    OPERATOR_PRIVATE_KEY: KEYS[2],
    RESULTS_PRIVATE_KEY: KEYS[3],
    ATTESTER_PRIVATE_KEY: KEYS[4],
    FOOTBALL_DATA_API_KEY: "e2e",
    API_FOOTBALL_KEY: "e2e",
    FOOTBALL_DATA_BASE_URL: `${footballUrl}/v4`,
    API_FOOTBALL_BASE_URL: footballUrl,
    MIN_LEAD_SECONDS: "60",
    QIE_PASS_MODE: "mock",
    SEASON: "2026",
  };

  // ---------------------------------------------------------------- web app
  if (!process.env.SKIP_BUILD) {
    log("building web app (production)");
    execFileSync("npx", ["next", "build"], { cwd: WEB, env, stdio: ["ignore", "ignore", "inherit"] });
  }
  log("starting web app");
  const web = bg("npx", ["next", "start", "-p", "3100"], { cwd: WEB, env });
  await waitFor(async () => (await fetch(`${APP}/api/v1/matchweeks/current`)).ok, "web app", 90_000).catch((e) => {
    console.log(web.tail());
    throw e;
  });

  // ---------------------------------------------------------------- matchweek 11 opens
  const chainNow = Number(BigInt((await rpc("eth_getBlockByNumber", ["latest", false])).timestamp));
  const start = Math.max(chainNow, Math.floor(Date.now() / 1000)) + LOCK_IN;
  const iso = (t) => new Date(t * 1000).toISOString();
  const fixtures = [
    { id: 1101, home: "Arsenal", away: "Chelsea", utcDate: iso(start) },
    { id: 1102, home: "Everton", away: "Liverpool", utcDate: iso(start + 3 * 3600) },
    { id: 1103, home: "Fulham", away: "Brentford", utcDate: iso(start + 26 * 3600) },
  ];
  await fetch(`${footballUrl}/__set`, { method: "POST", body: JSON.stringify({ matchday: 11, fixtures }) });
  await cli(env, "import-fixtures", "11");
  const created = await cli(env, "create-matchweek", "11");
  check(/^0x/.test(created.txHash ?? ""), "create-matchweek sent a transaction");

  // A host and their league (host signs in through the UI too)
  const browser = await chromium.launch();
  {
    const { ctx } = await walletContext(browser, 6);
    const page = await ctx.newPage();
    await page.goto(`${APP}/host`);
    await signInWithQie(page);
    await page.getByRole("button", { name: "Create league" }).waitFor({ timeout: 30_000 });
    await page.getByLabel("Name", { exact: true }).fill("E2E League");
    await page.getByLabel(/Link:/).fill("e2e-league");
    await page.getByRole("button", { name: "Create league" }).click();
    await page.getByRole("link", { name: "/l/e2e-league" }).waitFor();
    await page.screenshot({ path: join(OUT, "host.png"), fullPage: true });
    check(true, "host created a league through the UI");
    await ctx.close();
  }

  // ---------------------------------------------------------------- two players seal from their own wallets
  const ada = await playerSeals(browser, 7, "Ada", [{ h: 2, a: 1 }, { h: 1, a: 1 }, { h: 0, a: 0 }]);
  const bo = await playerSeals(browser, 5, "Bo", [{ h: 1, a: 0 }, { h: 0, a: 2 }, { h: 2, a: 2 }]);

  // the commit was sent by the player's wallet, not a relayer
  const commits = await rpc("eth_getLogs", [{ address: dep.matchweeks, fromBlock: "0x0", toBlock: "latest" }]);
  const senders = new Set();
  for (const l of commits) {
    const tx = await rpc("eth_getTransactionByHash", [l.transactionHash]);
    senders.add(getAddress(tx.from));
  }
  check(senders.has(addr(7)) && senders.has(addr(5)), "commit() transactions were sent from the players' own wallets");

  // ---------------------------------------------------------------- lock, reveal, results, finalize
  const waitMs = start * 1000 - Date.now() + 2000;
  log(`waiting ${Math.ceil(waitMs / 1000)}s for the first kickoff (lock)`);
  if (waitMs > 0) await sleep(waitMs);
  await rpc("evm_mine");

  // after lock the UI must refuse changes
  await ada.page.reload();
  check(await ada.page.getByText("Locked").first().isVisible(), "UI shows the matchweek as locked after kickoff");

  const rev = await cli(env, "reveal", "11");
  check(rev.valid === 2 && rev.invalid === 0, "both reveals verified against on-chain commitments");

  await fetch(`${footballUrl}/__set`, {
    method: "POST",
    body: JSON.stringify({
      matchday: 11,
      results: [
        { id: 1101, status: "FINISHED", home: 2, away: 1 },
        { id: 1102, status: "FINISHED", home: 0, away: 2 },
        { id: 1103, status: "POSTPONED" },
      ],
    }),
  });
  const fr = await cli(env, "fetch-results", "11");
  check(fr.agreed === true, "both providers agree (including a postponed game)");
  await cli(env, "publish-results", "11");
  await rpc("evm_increaseTime", [12 * 3600 + 60]);
  await rpc("evm_mine");
  const fin = await cli(env, "finalize", "11");
  check(fin.players === 2, "finalized with 2 scored players");
  for (let i = 0; i < 4; i++) await rpc("evm_mine");
  await cli(env, "index");

  // ---------------------------------------------------------------- read side, through the UI
  const page = ada.page;
  await page.goto(`${APP}/leaderboard?mw=11`);
  const rows = await page.locator("tbody tr").allInnerTexts();
  log("leaderboard", rows);
  // Ada: 2-1 exact (5) + 1-1 vs 0-2 wrong (0) + void = 5. Bo: 1-0 outcome (2) + 0-2 exact (5) = 7.
  check(rows[0]?.includes("Bo") && rows[0]?.includes("7"), "Bo leads with 7 points");
  check(rows[1]?.includes("Ada") && rows[1]?.includes("5"), "Ada second with 5 points");
  await page.screenshot({ path: join(OUT, "leaderboard.png"), fullPage: true });

  await page.goto(`${APP}/proof/11`);
  check((await page.getByText("reveal verified").count()) === 2, "Proof page shows 2 verified reveals");
  await page.locator("details summary").first().click();
  const payload = await page.locator("details pre").first().innerText();
  await page.getByLabel("Payload JSON").fill(payload);
  await page.getByRole("button", { name: "Recompute in my browser" }).click();
  check(await page.getByText("Match: these picks are exactly what was sealed before lock.").isVisible(), "in-browser verifier recomputes the commitment");
  await page.screenshot({ path: join(OUT, "proof.png"), fullPage: true });

  await page.goto(APP + "/?mw=11");
  await page.getByText("Sealed receipt").waitFor();
  check(await page.getByText(/^5$/).first().isVisible().catch(() => false), "receipt shows Ada's 5 points");
  await page.screenshot({ path: join(OUT, "results.png"), fullPage: true });

  const stats = await (await fetch(`${APP}/api/v1/stats`)).json();
  check(stats.activatedWallets === 2 && stats.transactions.commits === 2, "stats count 2 activated wallets and 2 commits");

  const og = await fetch(`${APP}/api/v1/og/result/11.${addr(7)}?format=story`);
  check(og.ok && og.headers.get("content-type")?.includes("image/png"), "share card renders");

  const status = await (await fetch(`${APP}/api/v1/status`)).json();
  check(status.indexedBlock !== null, "status page reports the indexed block");

  const cron = await fetch(`${APP}/api/v1/cron/drip-health`);
  check(cron.status === 401, "cron endpoints refuse requests without the secret");

  // JS shipped to the player route (spec: under 250 KB gzipped)
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  let jsBytes = 0;
  p2.on("response", async (r) => {
    if (r.url().endsWith(".js")) jsBytes += Number(r.headers()["content-length"] ?? (await r.body().catch(() => Buffer.alloc(0))).length);
  });
  await p2.goto(APP, { waitUntil: "networkidle" });
  log(`player route JS transferred: ${(jsBytes / 1024).toFixed(0)} KB`);

  await browser.close();
  log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch(async (e) => {
    console.error(e);
    process.exitCode = 1;
    for (const [i, p] of openPages.entries()) {
      try {
        await p.screenshot({ path: join(OUT, `failure-${i}.png`), fullPage: true });
        log(`failure page ${i} (${p.url()}):`, (await p.locator("main").innerText()).slice(0, 800));
      } catch {}
    }
  })
  .finally(() => {
    for (const p of procs) {
      try {
        process.kill(-p.pid, "SIGTERM");
      } catch {}
    }
    setTimeout(() => process.exit(), 500);
  });
