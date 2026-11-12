# Deployment and launch runbook

Everything below the line "needs you" requires accounts, keys or funds that only the project owner
holds. Nothing in this repo sends a mainnet transaction on its own.

## 0. What is already verified

| Item | How |
| --- | --- |
| QIE mainnet chain id 1990, testnet 1983 | `eth_chainId` on the public RPCs |
| EVM level: Shanghai (PUSH0 yes, TSTORE no) | `eth_call` probes on mainnet. Contracts compile with `evm_version = "shanghai"`; OpenZeppelin pinned to 5.4.0 (5.5+ emits MCOPY) |
| QUSDC `0x3F43…5DA5`: symbol `QUSDC`, 6 decimals | `symbol()` / `decimals()` on mainnet; the deploy script re-checks both |
| Deploy script on a mainnet fork with the real QUSDC | `anvil --fork-url https://rpc1mainnet.qie.digital/`; 6.6M gas for all three contracts |
| One `commit()` costs about 70k gas | forge gas report; 0.00008 QIEV3 at the 1.125 gwei seen on 2026-11-12 |
| Full player loop in a browser | `apps/web/e2e/run.mjs` (see "Testing" in the README) |

## Needs you

### 1. Keys (generate offline, never paste into chats or tools)

| Key | Holds | Where it lives |
| --- | --- | --- |
| Admin | `DEFAULT_ADMIN_ROLE` on all contracts | hardware wallet only, never in any env |
| Deployer | gas for deployment, no roles | your machine, discard after |
| Operator | create matchweeks, post reward roots, pause | `OPERATOR_PRIVATE_KEY` (Vercel + CLI) |
| Results | propose results, finalize | `RESULTS_PRIVATE_KEY` (CLI only is fine) |
| Attester | signs QIE Pass attestations | `ATTESTER_PRIVATE_KEY` (Vercel) |
| Gas drip | sends QIEV3 to new players, no roles | `DRIP_PRIVATE_KEY` (Vercel), hold at most 2 days of budget |
| Challengers | challenge bad results | your second device and one trusted person |
| Treasury | receives platform fees | any address you control |

Fund the deployer, operator, results and attester keys with a little QIEV3 (a few cents each).

### 2. Measure gas and set the drip (spec 9.8)

```bash
cast send <matchweeks> "commit(uint32,bytes32)" 11 0x01… --rpc-url https://rpc1mainnet.qie.digital/ --private-key …
cast receipt <hash> --rpc-url https://rpc1mainnet.qie.digital/   # gasUsed x effectiveGasPrice
```

Set `DRIP_AMOUNT_WEI` to about 3x one commit (a seal plus two re-seals) and `DRIP_DAILY_CAP_WEI`
to the daily budget. If one commit costs more than $0.02, stop and rethink before launch.

### 3. Deploy the contracts

```bash
cd contracts
export DEPLOYER_PRIVATE_KEY=… ADMIN_ADDRESS=… OPERATOR_ADDRESS=… RESULTS_ADDRESS=… \
       ATTESTER_ADDRESS=… TREASURY_ADDRESS=… PAUSER_ADDRESS=<operator> \
       CHALLENGER_ADDRESSES=<you2>,<trusted> \
       QUSDC_ADDRESS=0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5
forge script script/Deploy.s.sol --rpc-url https://rpc1mainnet.qie.digital/ --broadcast
cat deployments/1990.json
```

Do a dry run against testnet (chain 1983, faucet at qie.digital/faucet) first: same command with
the testnet RPC and a test token (`QUSDC_ADDRESS` of a 6-decimal token named QUSDC).

### 4. Verify source on the explorer

```bash
forge verify-contract <address> src/NorthesideMatchweeks.sol:NorthesideMatchweeks \
  --chain-id 1990 --verifier blockscout --verifier-url https://mainnet.qie.digital/api/ \
  --constructor-args $(cast abi-encode "constructor(address,address,address,address,address[])" …)
```

If the explorer rejects it, upload Standard JSON input through its web page
(`forge verify-contract --show-standard-json-input …`). Repeat for HostRewards and IdentityAdapter.

### 5. Database (Supabase)

1. Create a project (EU or closest region to Lagos).
2. Use the **transaction pooler** connection string (port 6543) as `DATABASE_URL`.
3. Apply migrations: `DATABASE_URL=… pnpm --filter @northeside/db migrate`.
   Migration `0001_rls` enables row-level security on every table, so the anon API key exposes nothing.

### 6. Privy (email sign-in and embedded wallets)

1. Create a Privy app; enable email login and Ethereum embedded wallets.
2. Add the production domain to allowed origins.
3. Set `NEXT_PUBLIC_PRIVY_APP_ID` and `PRIVY_APP_SECRET`.
4. Day-one test on chain 1990: email login, embedded wallet created, receives a drip, sends
   `commit()`. If Privy misbehaves on chain 1990, unset `NEXT_PUBLIC_PRIVY_APP_ID`: the app falls
   back to EIP-6963 wallets (QIE Wallet first) with no code change.

### 7. Hosting

The site runs on **Netlify** today: project `northeside` (https://northeside.netlify.app), in
preview mode until the backend variables below are set. `apps/web/netlify.toml` configures the
build; scheduled functions in `apps/web/netlify/functions` call the cron routes once
`CRON_SECRET` is set (Netlify scheduled functions stop at 30 s, so the indexer runs one pass a
minute there).

To connect Git deploys: in Netlify, link the GitHub repo, leave the base directory empty and set
the package directory to `apps/web`. To deploy by hand from a machine with the Netlify CLI:

```bash
netlify build --context production --filter @northeside/web
netlify deploy --prod --no-build --filter @northeside/web --dir apps/web/.netlify/static
```

Preview mode ends when `DATABASE_URL`, `DATA_ENCRYPTION_KEY`, `SESSION_SECRET` and the three
`NEXT_PUBLIC_*_ADDRESS` variables are set (then redeploy: public values are inlined at build time).

#### Vercel (alternative)

1. Import the repo, root directory `apps/web`, framework Next.js. Install command
   `pnpm install --frozen-lockfile` at the repo root (Vercel detects the pnpm workspace).
2. Set every variable in `.env.example` (production values). Generate secrets with
   `openssl rand -base64 32` (`DATA_ENCRYPTION_KEY`, `SESSION_SECRET`, `CRON_SECRET`) and
   `openssl rand -hex 32` (`PERSON_PEPPER`; never rotate it after launch).
3. `vercel.json` schedules the jobs. Per-minute crons need a paid plan; on Hobby, enable the
   GitHub Actions fallback in `.github/workflows/cron.yml` (set `APP_URL` and `CRON_SECRET` secrets).
4. Custom domain with HTTPS only (QIE Wallet injects no provider on `file://` or plain http).

### 8. Data providers

- football-data.org free tier: `FOOTBALL_DATA_API_KEY` (10 calls/min is plenty).
- API-Football free plan: `API_FOOTBALL_KEY`.
- `SEASON=2026` for 2026/27.

### 9. Telegram (optional, Should)

1. Create a bot with @BotFather; set `TELEGRAM_BOT_TOKEN`, `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME`.
2. Pick a random `TELEGRAM_WEBHOOK_SECRET` and register the webhook:
   `curl "https://api.telegram.org/bot$TOKEN/setWebhook?url=https://<domain>/api/v1/telegram/webhook&secret_token=$SECRET"`
3. Mini App: BotFather → Bot Settings → Configure Mini App → URL `https://<domain>/tg`.
4. `TELEGRAM_OPERATOR_CHAT_ID` = your chat id for operator alerts (job failures, challenges, drip).

### 10. QIE Pass

Until QIE publishes how a dApp checks Pass status, leave `QIE_PASS_MODE` unset on mainnet: the
"Get verified" button reports that verification is not available yet, and host payouts count
nobody. The adapter and attestation flow are built and tested (Mode B); wiring the real provider is
one `PassProvider` implementation in `packages/core/src/identity.ts`. Do not claim live QIE Pass
integration until a real verification has gone through on mainnet.

## Weekly operations

| When | Command |
| --- | --- |
| 4-5 days before lock | `pnpm cli create-matchweek <id>` |
| automatic after lock | reveal job (cron) verifies every payload |
| after the last game | `pnpm cli fetch-results <id>` then `pnpm cli publish-results <id>` |
| providers disagree | investigate; if needed `pnpm cli publish-results <id> --override results.json --reason "…"` |
| 12 hours later | `pnpm cli finalize <id>` (scores, finalizes, posts reward roots) |
| sponsor signs | `pnpm cli create-campaign …` then the sponsor funds (or `fund-campaign` with their key) |
| emergency | `pnpm cli pause matchweeks` / `pnpm cli pause rewards` |

`/api/v1/status` shows indexer lag, drip balance and the last job runs.
