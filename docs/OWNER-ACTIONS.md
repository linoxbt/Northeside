# Owner actions

Things only the owner can do: they need the admin wallet (`0x747DF176962e1495355562Fe30b65F276f0B8404`)
or an account login. Each item says why, exactly what to send, and how to check it worked.
Transactions go to QIE mainnet (chain 1990) with value 0; paste the address and data into your
wallet's "send / custom data" screen, or use `cast send` with the admin key on a hardware wallet.

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

## 2. Fund the $NSD reward pool (rewards cannot pay until this is done)

Season 1 is 300,000 NSD (docs/TOKENOMICS.md). Send them from the admin wallet to `NSDRewards`:

| To | Data | Does |
| --- | --- | --- |
| `0xac23edcF998dDff02F3Bc08d9Dad2A9dE05f34DF` ($NSD token) | `0xa9059cbb00000000000000000000000031afa5801f3fb5444df458569429d4e82483395f000000000000000000000000000000000000000000003f870857a3e0e3800000` | `transfer(NSDRewards, 300,000 NSD)` |

Check: `cast call 0x31aFa5801f3FB5444dF458569429d4e82483395f "available()(uint256)" --rpc-url https://rpc1mainnet.qie.digital/` shows `300000000000000000000000`.
Tokens that are not owed to anyone can be taken back any time with `withdrawAvailable` (admin).

## 3. Turn on verification (nobody can claim $NSD without it)

Rewards go to verified people only (IdentityAdapter `personOf`). QIE Pass verification is not wired
up yet (build task: QIE ID verification). Until it is, every reward run skips with "no verified
players to reward" and nothing is paid.

## 4. Rotate secrets that were pasted into chat

These values passed through a chat and should be replaced. Do one at a time and redeploy after each.

| Secret | Where to rotate | Then update |
| --- | --- | --- |
| Supabase database password | Supabase → Project settings → Database → Reset password | Netlify `DATABASE_URL` (production) for site `northeside`, then redeploy. The site is down between the reset and the redeploy (this happened on 26 Nov), so do both back to back. |
| Privy app secret | Privy dashboard → App settings → API keys → rotate secret | Netlify `PRIVY_APP_SECRET` on `northeside` and `northeside-testnet` |
| Fortytwo API key | Fortytwo dashboard → API keys → revoke and create | Netlify `FORTYTWO_API_KEY` on `northeside-testnet`, and on `northeside` to turn the assistant on there |

## 5. Alerts (status page shows "unhealthy" until one is set)

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

CLAUDE.md decision 1: $NSD rewards need legal review before players are paid. The Terms are at
version 1.3 with an $NSD clause, marked "pending review by Nigerian counsel".
