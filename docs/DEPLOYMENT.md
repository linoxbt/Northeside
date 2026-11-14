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
| `NEXT_PUBLIC_PRIVY_APP_ID` / `PRIVY_APP_SECRET` (email sign-in; Privy app "Northeside", allowed domain northeside.netlify.app) | public / secret |
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
| Operator | create matchweeks, post reward roots | `OPERATOR_PRIVATE_KEY` (Netlify secret, production only; ops-worker) |
| Results | propose results, finalize | `RESULTS_PRIVATE_KEY` (Netlify secret, production only; ops-worker) |
| Pauser | emergency pause only | a separate key kept off servers (`PAUSER_PRIVATE_KEY` for the CLI); only the admin can unpause (v1.1) |
| Attester | signs QIE Pass attestations | `ATTESTER_PRIVATE_KEY` (Netlify secret) |
| Gas drip | sends QIEV3 to new players, no roles | `DRIP_PRIVATE_KEY` (Netlify secret), hold at most 2 days of budget |
| Challengers | challenge bad results | at least two keys independent of the admin: your second device and one trusted person |
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

Apply new migrations after a deploy that adds one, from anywhere, through the app itself:
`curl -H "Authorization: Bearer $CRON_SECRET" https://<site>/api/v1/cron/migrate` (the `migrate`
job applies the embedded migrations and records them exactly like drizzle's migrator), or
`pnpm cli migrate` with `DATABASE_URL` set. The Management API script
(`packages/db/scripts/apply-via-management-api.py`) still works where only HTTPS is available.

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

The site runs on **Netlify**: project `northeside` (https://northeside.netlify.app), live mode.
`apps/web/netlify.toml` configures the build. `pnpm build` first bundles the ops worker
(`apps/web/worker/ops-worker.ts` → `netlify/functions/ops-worker.mjs`, esbuild), then builds Next.
Two functions run the operation: `cron-ops` (scheduled, every 5 minutes) starts `ops-worker`
(background), which makes one pass of every job in-process.

Environment rules on Netlify: every secret exists in the **production** context only (deploy
previews and branch deploys get none, so untrusted pull-request builds cannot reach the keys or
the database). `NEXT_PUBLIC_*` values are inlined at build time: change them, then redeploy.
Functions run on `AWS_LAMBDA_JS_RUNTIME=nodejs22.x`.

Deploys today are made with the Netlify CLI, recording the commit in the deploy message:

```bash
netlify build --offline --context production --filter @northeside/web   # NEXT_PUBLIC_* in the shell env
netlify deploy --prod --no-build --filter @northeside/web --dir apps/web/.netlify/static --message "$(git rev-parse --short HEAD)"
```

To switch to Git deploys (recommended once `main` holds the release): in Netlify link the GitHub
repo, production branch `main`, base directory empty, package directory `apps/web`.

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
profile shows "coming soon" instead of a "Get verified" button, marketing pages say payouts start
once Pass is live, and host payouts count nobody. The adapter and attestation flow are built and tested (Mode B); wiring the real provider is
one `PassProvider` implementation in `packages/core/src/identity.ts`. Do not claim live QIE Pass
integration until a real verification has gone through on mainnet.

## Weekly operations (automated on Netlify)

The whole week runs on Netlify with the operator and results keys stored as production-only
secrets. Every step is idempotent, re-checks the chain first, and alerts the operator.

Everything runs in one Netlify background function, `ops-worker`, started every 5 minutes by the
scheduled function `cron-ops`. Each start makes one pass of every job (about 15 s of compute, so
~130k function-seconds a month, inside the free plan); a database lease stops overlapping runs.

| Job | What it does |
| --- | --- |
| `index-chain` | mirrors contract events into Postgres (one transaction per chunk; stops and alerts on a reorg) |
| `import-fixtures` | every 6 h: refreshes draft matchweeks, re-checks open ones for moved kickoffs, imports the next matchday |
| `lock-and-reveal` | after lock, reveals and verifies every stored payload. Payloads are accepted only until 10 minutes after the first kickoff, so nobody can pick which seal to reveal once scores are known |
| `fetch-results` | compares both football providers after the last game in the matchweek window (at most every 15 min per matchweek, to save API quota); alerts on conflicts, and every 6 h while games are still missing 12 h after the last kickoff |
| `notify` | lock reminders and results notices with rank change |
| `drip-health` | drip balance alert at one day of cap; frees dropped drips |
| `check-providers` | every 6 h: asks API-Football for the next matchweek, so a bad key or a plan that does not cover the season fails (and alerts) days before results are due |
| `open-matchweeks` | creates each imported matchweek on-chain once its lock is within `OPEN_DAYS_BEFORE_LOCK` days (default 6) |
| `publish-results` | when both providers agree (fresh check) and the chain allows it (last kickoff + `RESULTS_BUFFER_SECONDS`, default 3 h): closes reveals, scores, and proposes the results, reveals and scores roots |
| `finalize` | after the 12-hour challenge window: confirms the roots and stores ranks (also for a matchweek finalized by hand or first seen by the indexer) |
| `post-reward-roots` | posts each active campaign's host payout root; hosts can claim 24 h later |

Needs a person:

| Situation | Action |
| --- | --- |
| providers disagree | investigate; `pnpm cli publish-results <id> --override results.json --reason "…"` |
| results challenged | automation stops for that matchweek; publish corrected results with the CLI |
| wrong reward root, nothing claimed yet | `replaceRoot` on `HostRewards` (operator key), restarts the 24-hour delay; or the admin calls `voidRoot` (v1.1). Automation never re-posts a voided root: after fixing the cause, `pnpm cli reset-reward-root <campaign> <mw>` and the next run posts a fresh one |
| sponsor signs | `pnpm cli create-campaign …`, then the sponsor funds |
| stop all automated transactions | `pnpm cli automation pause` (no redeploy), or `AUTOMATION_PAUSED=1` on Netlify and redeploy |
| emergency | `pnpm cli pause matchweeks` / `pnpm cli pause rewards` (PAUSER_PRIVATE_KEY; on v1 the pauser is the operator key). Only the admin can unpause on v1.1 |

`/api/v1/status` shows indexer lag, drip balance and the last job runs.
