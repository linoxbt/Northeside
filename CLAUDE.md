# Northeside — working rules

Northeside is a free weekly Premier League prediction game on QIE mainnet (chain 1990). Players seal
score predictions on-chain before kickoff; sponsors pay league hosts in QUSDC for verified,
returning players. Full spec: the "Northeside — Build Specification" doc.

## Decisions (locked)
1. No cash prizes to players before a permit. PrizeVault is designed, not deployed.
2. Sponsors pay hosts, not players (QUSDC per verified, returning player).
3. Players send their own commit transactions. No relayer, no forwarder. New wallets get a small,
   rate-limited QIEV3 gas drip.
4. Contracts on mainnet by Nov 17; predictions open Nov 18.
5. One vertical slice: no sponsor dashboard, no queues, no multisig, no S3.
6. QIE Pass is a verified-human badge and the unit for host payouts (one person = one player).
7. No token, no odds, no stakes, no random draws.

## Hard rules
- Money is `bigint` in base units (QUSDC has 6 decimals). Never JavaScript numbers or floats.
- Never hardcode contract or token addresses. They come from env/config.
- Contracts are not upgradeable. A new version is a new deployment.
- Compile for `evm_version = "shanghai"`: QIE mainnet rejects Cancun opcodes (TSTORE, MCOPY).
  OpenZeppelin is pinned to 5.4.0 because later versions emit MCOPY.
- The canonical commitment encoding lives in `contracts/src/libraries/CommitmentLib.sol` and
  `packages/commitments`. Any change updates `contracts/test/fixtures/golden-vectors.json` and both
  test suites.
- The chain is the source of truth. Postgres is an index; if they disagree, the chain wins.
- Never paste private keys, DATA_ENCRYPTION_KEY or PERSON_PEPPER into chats, logs or tools.
- No Premier League logos, crests or marks. Team names and fixtures are facts and are fine.
- No "win" language in UI or marketing.

## Workflow
- One FR ID per branch/PR where practical; commit messages start with the ID
  (`FR-11: seal flow sends commit() from the player's wallet`).
- Contracts: `pnpm test:contracts` (forge). Packages: `pnpm test` (vitest).
- Every AI-assisted change is read, tested and explainable by the developer before it lands.
