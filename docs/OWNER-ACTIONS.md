# Owner actions

Things only the owner can do: they need the admin wallet (`0x747DF176962e1495355562Fe30b65F276f0B8404`)
or an account login. Each item says why, exactly what to send, and how to check it worked.
Easiest: open **northeside.netlify.app/owner** and connect the admin wallet. It shows the pool and
the roles, and sections 1 and 2 below are buttons there (lower the cap, fund the pool, move the
pause power), each a transaction your wallet asks you to confirm. Otherwise, transactions go to QIE
mainnet (chain 1990) with value 0; paste the address and data into your wallet's "send / custom
data" screen, or use `cast send` with the admin key on a hardware wallet.

## Now (27 Nov 2026), in this order

| # | Action | Why | How |
| --- | --- | --- | --- |
| 1 | Alerts: create a Telegram bot, set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_OPERATOR_CHAT_ID` on Netlify (production), redeploy | Every URGENT alert (an $NSD root Northeside did not post, a matchweek or result it did not make) only reaches the logs until then; `/api/v1/status` stays `healthy: false` | docs/DEPLOYMENT.md, section 9. Email works too: `RESEND_API_KEY`, `EMAIL_FROM`, `ALERT_EMAIL_TO` |
| 2 | Send about 0.002 QIEV3 to the pauser `0x2AEa2d7b882775c8a03D1cdeEeCd7D2144A85353` | It is the only key that can pause NSDRewards, and it has no gas | Any wallet |
| 3 | Move the pause power (section 1) | The operator key on Netlify can still pause and unpause Matchweeks and HostRewards | /owner, step 3 |
| 4 | Grant `CHALLENGER_ROLE` to two independent wallets, each with a little QIEV3 | Today only the admin can challenge results | /owner, step 4 |
| 5 | Send about 0.01 QIEV3 to the deployer `0x0Efc90cA25692ADed121EF2B761CE4bBf32D3c34` | Pays for the on-chain badges contract (simulated: about 2.57M gas) | Any wallet; then the badges contract is deployed and switched on |
| 6 | Paste the QIE Pass partner docs (getpass.qie.digital/dashboard/docs) | Request format and signing for the QIE Pass provider; the endpoints and headers are known | Copy the page text |
| 7 | Set `NEXT_PUBLIC_CONTACT_EMAIL` | Privacy and Terms point to a data contact (NDPA) | Netlify, then redeploy |

Done: pool funded (48,000 NSD, cap 60,000), .qie-name verification live, legal-review gate dropped.

## 1. Move the pause power off the server (security, do first)

On the v1 contracts the operator key, which lives on Netlify, holds `PAUSER_ROLE` and on v1 that
role can also **unpause**. A leaked operator key could pause or unpause matchweeks and host rewards.
Give the role to the separate pauser key (`0x2AEa2d7b882775c8a03D1cdeEeCd7D2144A85353`, kept off
servers), then take it from the operator. Grant first, so there is never a moment with no pauser.

| # | To | Data | Does |
| --- | --- | --- | --- |
| 1 | `0xb9B7FF15Ab687621bF0B6D93064857f24F070d0B` (Matchweeks) | `0x2f2ff15d65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a0000000000000000000000002aea2d7b882775c8a03d1cdeeecd7d2144a85353` | `grantRole(PAUSER_ROLE, pauser)` |
| 2 | `0x8b2f938F40c6A6d62C79f82a1f2d8DB12b6D6246` (HostRewards) | same data as #1 | `grantRole(PAUSER_ROLE, pauser)` |
| 3 | `0xb9B7FF15Ab687621bF0B6D93064857f24F070d0B` (Matchweeks) | `0xd547741f65d7a28e3265b37a6474929f336521b332c1681b933f6cb9f3376673440d862a0000000000000000000000000dd4c52951e447b04c1f6c8fe61e112d36859798` | `revokeRole(PAUSER_ROLE, operator)` |
| 4 | `0x8b2f938F40c6A6d62C79f82a1f2d8DB12b6D6246` (HostRewards) | same data as #3 | `revokeRole(PAUSER_ROLE, operator)` |

Check: `cast call <contract> "hasRole(bytes32,address)(bool)" $(cast keccak PAUSER_ROLE) <address> --rpc-url https://rpc1mainnet.qie.digital/`
is `true` for the pauser and `false` for the operator on both. Afterwards emergency pauses use
`PAUSER_PRIVATE_KEY` = the pauser key with `pnpm cli pause matchweeks|rewards` from your own machine.

## 2. Fund the $NSD reward pool, in installments (rewards cannot pay until this is done)

Season 1 is 300,000 NSD (docs/TOKENOMICS.md), but **do not send it all at once**. The final review
found that the server keys together (operator + results + attester, all on Netlify) could create
and finalize made-up matchweeks and claim up to the per-matchweek cap from each, so whatever sits
in the pool is what a leak could take. Keep the pool small and the cap close to a real week:

1. Set up alerts first (section 5). The indexer now sends an URGENT alert for any matchweek or
   result proposal Northeside did not make; you then have the 12-hour dispute window plus the
   24-hour claim delay to challenge, pause (pauser key) or `voidRoot` (admin).
2. Lower the cap from 100,000 to 60,000 NSD (the largest real root: the last matchweek's weekly
   24,000 plus the 36,000 finale):

| To | Data | Does |
| --- | --- | --- |
| `0x31aFa5801f3FB5444dF458569429d4e82483395f` (NSDRewards) | `0x848d35c7000000000000000000000000000000000000000000000cb49b44ba602d800000` | `setMaxPerMatchweek(60,000 NSD)` |

3. Fund two weeks at a time (48,000 NSD), topping up as roots are claimed; before matchweek 21,
   add the finale (36,000 plus any rollover):

| To | Data | Does |
| --- | --- | --- |
| `0xac23edcF998dDff02F3Bc08d9Dad2A9dE05f34DF` ($NSD token) | `0xa9059cbb00000000000000000000000031afa5801f3fb5444df458569429d4e82483395f000000000000000000000000000000000000000000000a2a15d09519be000000` | `transfer(NSDRewards, 48,000 NSD)` |

A week whose root is larger than the pool simply waits (the post fails with `InsufficientPool`, you
get an alert, and it is retried after you top up, as long as that is within 14 days of the week being finalized). Check the pool:
`cast call 0x31aFa5801f3FB5444dF458569429d4e82483395f "available()(uint256)" --rpc-url https://rpc1mainnet.qie.digital/`.
Tokens that are not owed to anyone can be taken back any time with `withdrawAvailable` (admin).

## 3. Verification (done: .qie name fallback)

Rewards go to verified people only (IdentityAdapter `personOf`). Until QIE Pass can be checked,
`QIE_PASS_MODE=qie-name` is set on Netlify: on their profile a player verifies with the .qie name
their signed-in wallet owns and confirms one transaction from that wallet. One name verifies one
account. A wallet only counts for a matchweek's rewards if it was verified before that week locked.

## 4. Rotate secrets that were pasted into chat

These values passed through a chat and should be replaced. Do one at a time and redeploy after each.

| Secret | Where to rotate | Then update |
| --- | --- | --- |
| Supabase database password | Supabase → Project settings → Database → Reset password | Netlify `DATABASE_URL` (production) for site `northeside`, then redeploy. The site is down between the reset and the redeploy (this happened on 26 Nov), so do both back to back. |
| Privy app secret | Privy dashboard → App settings → API keys → rotate secret | Netlify `PRIVY_APP_SECRET` on `northeside` and `northeside-testnet` |
| Fortytwo API key | Fortytwo dashboard → API keys → revoke and create | Netlify `FORTYTWO_API_KEY` on `northeside-testnet`, and on `northeside` to turn the assistant on there |

## 5. Alerts (status page shows "unhealthy" until one is set; needed before funding the pool)

Either a Telegram bot (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_OPERATOR_CHAT_ID`; docs/DEPLOYMENT.md) or a
Sentry DSN (`SENTRY_DSN`) on Netlify, then redeploy. Without one, failed jobs and challenges are
only in the logs.

## 6. Contracts v1.1 (audit fixes are not on mainnet yet)

The live Matchweeks, HostRewards and IdentityAdapter are v1 (source commit `7c92418`, bytecode
re-checked on 26 Nov). Contracts are not upgradeable, so the audit fixes in the current source
(claims enforce the rate and cap, pause holds results, results no sooner than 2 hours after lock,
pausable identity) need a new deployment and a switch-over between matchweeks. Needs: a funded
deployer key (created and handed over first), the pauser above, and two challenger keys
independent of the admin.

## 7. Legal

Dropped by the owner for the hackathon (26 Nov 2026). Terms and Privacy are at version 1.4.
