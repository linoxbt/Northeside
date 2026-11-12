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

## Mainnet deployment (2026-11-12)

Audited first (`docs/AUDIT.md`). Deployed from `0x6e2E…6Bf4` (no role afterwards) at block
11852159, source verified on the QIE explorer. Record: `contracts/deployments/1990.json`.

| Contract | Address |
| --- | --- |
| `NorthesideMatchweeks` | `0xb9B7FF15Ab687621bF0B6D93064857f24F070d0B` |
| `HostRewards` | `0x8b2f938F40c6A6d62C79f82a1f2d8DB12b6D6246` |
| `IdentityAdapter` | `0x7Bdef3854f9bC0B25271Cee756274fEb3d33eAA9` |
| QUSDC (existing) | `0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5` |

| Role | Address |
| --- | --- |
| Admin (`DEFAULT_ADMIN_ROLE` on all three), treasury, challenger | `0x747DF176962e1495355562Fe30b65F276f0B8404` (owner's wallet) |
| Operator + pauser (`OPERATOR_PRIVATE_KEY` on Netlify) | `0x0dD4C52951E447b04C1f6C8Fe61E112D36859798` |
| Results (`RESULTS_PRIVATE_KEY` on Netlify) | `0xADAabFbbfA07068F66EA96616469e6B6805C1c8b` |
| Attester | `0x7705339BF84F843240e9F25d403bFF4ad5746ba4` |

Launch caps: 500 QUSDC per campaign, 2,000 QUSDC total. The four `NEXT_PUBLIC_*` contract
variables are set on Netlify and the site runs in live mode.

## Already configured on Netlify (site `northeside`)

| Variable | Kind |
| --- | --- |
| `DATABASE_URL`, `DATA_ENCRYPTION_KEY`, `SESSION_SECRET`, `PERSON_PEPPER` | secret |
| `CRON_SECRET` (scheduled functions call the cron routes with it) | secret |
| `ATTESTER_PRIVATE_KEY` — address `0x7705339BF84F843240e9F25d403bFF4ad5746ba4` | secret |
| `DRIP_PRIVATE_KEY` — address `0x6d4b7841Bce434Ac6abBC9194b4e39ea6c8D86bd` | secret |
| `VAPID_PRIVATE_KEY` / `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (web push) | secret / public |
| `DRIP_AMOUNT_WEI` = 0.0006 QIEV3, `DRIP_DAILY_CAP_WEI` = 0.18 QIEV3 | plain (re-measure gas, adjust) |
| `NEXT_PUBLIC_CHAIN_ID` / `CHAIN_ID` = 1990, `NEXT_PUBLIC_QUSDC_ADDRESS`, `NEXT_PUBLIC_SITE_URL`, `SEASON` | plain |

Use the attester address as `ATTESTER_ADDRESS` when deploying the contracts. Fund the drip address
with QIEV3 (two days of the daily cap is enough). The `NEXT_PUBLIC_*` contract variables and the
operator and results keys are set (see "Mainnet deployment").

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

**Done:** project `northeside` (ref `lwjcuimxhcttezjwyncc`, eu-west-2 London, free plan) with all
migrations applied and RLS on all 22 tables. Netlify holds `DATABASE_URL` (transaction pooler,
port 6543), `DATA_ENCRYPTION_KEY`, `SESSION_SECRET` and `PERSON_PEPPER` as secret variables. The
database password is not stored anywhere else; reset it in the Supabase dashboard if you need
direct access, then update `DATABASE_URL` on Netlify. Never rotate `PERSON_PEPPER` after launch.
`CRON_SECRET` is deliberately unset until the contracts exist, so scheduled jobs stay idle.

Where raw Postgres connections are blocked, apply future migrations over HTTPS with
`python3 packages/db/scripts/apply-via-management-api.py lwjcuimxhcttezjwyncc` (from `packages/db`).

For a fresh setup:

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

## Weekly operations (automated on Netlify)

Netlify scheduled functions run the whole week with the operator and results keys stored as
Netlify secrets. Every step is idempotent, re-checks the chain first, and alerts the operator.

| Schedule | Function → route | What it does |
| --- | --- | --- |
| every minute | `cron-index-chain` → `index-chain` | mirrors contract events into Postgres |
| daily | `cron-import-fixtures` → `import-fixtures` | imports the next matchday; flags kickoff changes |
| every 5 min | `cron-lock-and-reveal` → `lock-and-reveal` | after lock, reveals and verifies every stored payload |
| every 15 min | `cron-fetch-results` → `fetch-results` | compares both football providers after the last game |
| every 10 min | `cron-weekly-ops` → background `weekly-ops` | runs the four on-chain steps below, in order, each with the full 60 s route limit |
| | → `open-matchweeks` | creates each imported matchweek on-chain once its lock is within `OPEN_DAYS_BEFORE_LOCK` days (default 6) |
| | → `publish-results` | when both providers agree (fresh check) and the chain allows it (last kickoff + `RESULTS_BUFFER_SECONDS`, default 3 h): closes reveals, scores, and proposes the results, reveals and scores roots |
| | → `finalize` | after the 12-hour challenge window: confirms the roots and stores ranks |
| | → `post-reward-roots` | posts each active campaign's host payout root; hosts can claim 24 h later |

Needs a person:

| Situation | Action |
| --- | --- |
| providers disagree | investigate; `pnpm cli publish-results <id> --override results.json --reason "…"` |
| results challenged | automation stops for that matchweek; publish corrected results with the CLI |
| wrong reward root, nothing claimed yet | `replaceRoot` on `HostRewards` (operator key), restarts the 24-hour delay |
| sponsor signs | `pnpm cli create-campaign …`, then the sponsor funds |
| stop all automated transactions | set `AUTOMATION_PAUSED=1` on Netlify and redeploy |
| emergency | `pnpm cli pause matchweeks` / `pnpm cli pause rewards` (pauser = operator key) |

`/api/v1/status` shows indexer lag, drip balance and the last job runs.
