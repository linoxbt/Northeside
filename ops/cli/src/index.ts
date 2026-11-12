#!/usr/bin/env -S npx tsx
/**
 * Northeside operator CLI. Every chain action prints its transaction hash and writes an audit row.
 *   pnpm cli <command> [args]      (reads .env from the repo root if present)
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { hostRewardsAbi, matchweeksAbi } from "@northeside/chain";
import {
  createCampaign,
  createContextFromEnv,
  createMatchweekOnChain,
  fetchResults,
  finalizeAndScore,
  fundCampaign,
  importFixtures,
  indexChain,
  postRewardRoot,
  postRewardRootsForMatchweek,
  publishResults,
  revealMatchweek,
  bigintReplacer,
  audit,
  confirm,
  type ResultsOverride,
} from "@northeside/core";
import { qieTransport, rpcUrlsFromEnv } from "@northeside/chain";
import { closeDb, schema } from "@northeside/db";
import { eq } from "drizzle-orm";
import { createWalletClient, getAddress, keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { int, parse, qusdc, str } from "./args";

const HELP = `northeside <command>

Matchweeks
  import-fixtures <id>                 pull fixtures for matchday <id> (draft only)
  create-matchweek <id>                import (if needed) and open it on-chain (fixtures root, lock = first kickoff)
  reveal <id>                          verify every stored payload against its commitment (after lock)
  fetch-results <id>                   compare both providers and store the check
  publish-results <id>                 propose results on-chain; blocks unless both providers agree
      [--override <file.json> --reason "..."]   manual results with a written reason (stored with the evidence)
  finalize <id>                        after the 12h window: score, finalize, post reward roots for active campaigns

Host rewards
  create-campaign --sponsor-name <s> --sponsor <0x..> --gross <QUSDC> --fee-bps <n> --rate <QUSDC>
                  --cap <QUSDC> --first <mw> --last <mw> --expiry <YYYY-MM-DD> --terms <file>
                  [--leagues a,b] [--self-funded]
  fund-campaign <id>                   fund from SPONSOR_PRIVATE_KEY (operator-assisted or self-funded)
  post-reward-root <campaign> <mw>     compute payouts and post the root

Operations
  index                                run the chain indexer once
  pause <matchweeks|rewards>           emergency pause (PAUSER_PRIVATE_KEY, else OPERATOR_PRIVATE_KEY)
  unpause <matchweeks|rewards>
  status <id>                          on-chain state of a matchweek
`;

function loadEnv() {
  for (const p of [resolve(process.cwd(), ".env"), resolve(import.meta.dirname, "../../../.env")]) {
    if (existsSync(p)) {
      process.loadEnvFile(p);
      return;
    }
  }
}

const out = (v: unknown) => console.log(JSON.stringify(v, bigintReplacer, 2));

async function main() {
  loadEnv();
  const a = parse(process.argv.slice(2));
  if (a.command === "help" || a.flags.help) return console.log(HELP);
  const ctx = createContextFromEnv(process.env);
  const id = () => int(a.positional[0], "id");
  const signerFor = (key: `0x${string}`) =>
    createWalletClient({ account: privateKeyToAccount(key), chain: ctx.chain, transport: qieTransport(ctx.chain, rpcUrlsFromEnv(process.env)) });

  switch (a.command) {
    case "import-fixtures":
      return out(await importFixtures(ctx, id()));
    case "create-matchweek": {
      const [existing] = await ctx.db.select({ id: schema.matchweeks.id }).from(schema.matchweeks).where(eq(schema.matchweeks.id, id()));
      if (!existing) out(await importFixtures(ctx, id()));
      return out(await createMatchweekOnChain(ctx, id()));
    }
    case "reveal":
      return out(await revealMatchweek(ctx, id()));
    case "fetch-results": {
      const c = await fetchResults(ctx, id());
      return out({ agreed: c.agreed, rows: c.rows.map((r) => ({ index: r.index, fixture: `${r.fixture.home}-${r.fixture.away}`, state: r.state, ...(r.state === "agree" ? { score: `${r.result.homeGoals}-${r.result.awayGoals} ${r.result.status}` } : { detail: r.detail }) })) });
    }
    case "publish-results": {
      let override: ResultsOverride | undefined;
      if (a.flags.override) {
        const results = JSON.parse(readFileSync(str(a.flags.override, "override"), "utf8"));
        override = { reason: str(a.flags.reason, "reason"), results };
      }
      return out(await publishResults(ctx, id(), override));
    }
    case "finalize": {
      const r = await finalizeAndScore(ctx, id());
      const roots = await postRewardRootsForMatchweek(ctx, id());
      return out({ ...r, rewardRoots: roots });
    }
    case "create-campaign": {
      const f = a.flags;
      const terms = readFileSync(str(f.terms, "terms"));
      return out(
        await createCampaign(ctx, {
          sponsorName: str(f["sponsor-name"], "sponsor-name"),
          sponsor: getAddress(str(f.sponsor, "sponsor")),
          grossAmount: qusdc(f.gross, "gross"),
          feeBps: int(f["fee-bps"], "fee-bps"),
          ratePerPlayer: qusdc(f.rate, "rate"),
          capPerHost: qusdc(f.cap, "cap"),
          firstMatchweek: int(f.first, "first"),
          lastMatchweek: int(f.last, "last"),
          expiry: new Date(`${str(f.expiry, "expiry")}T23:59:59Z`),
          leagues: typeof f.leagues === "string" ? f.leagues.split(",").map((s) => s.trim()).filter(Boolean) : null,
          termsHash: keccak256(toBytes(terms.toString("utf8"))),
          externalSponsor: !f["self-funded"],
        }),
      );
    }
    case "fund-campaign": {
      const key = process.env.SPONSOR_PRIVATE_KEY as `0x${string}` | undefined;
      if (!key) throw new Error("SPONSOR_PRIVATE_KEY is not set");
      return out(await fundCampaign(ctx, signerFor(key), id()));
    }
    case "post-reward-root":
      return out(await postRewardRoot(ctx, int(a.positional[0], "campaign"), int(a.positional[1], "mw")));
    case "index":
      return out(await indexChain(ctx));
    case "pause":
    case "unpause": {
      const target = a.positional[0];
      if (target !== "matchweeks" && target !== "rewards") throw new Error("pause target must be matchweeks or rewards");
      const key = (process.env.PAUSER_PRIVATE_KEY ?? process.env.OPERATOR_PRIVATE_KEY) as `0x${string}` | undefined;
      if (!key) throw new Error("PAUSER_PRIVATE_KEY or OPERATOR_PRIVATE_KEY is required");
      const signer = signerFor(key);
      const address = target === "matchweeks" ? ctx.deployment.matchweeks : ctx.deployment.hostRewards;
      const hash =
        target === "matchweeks"
          ? await signer.writeContract({ address, abi: matchweeksAbi, functionName: a.command })
          : await signer.writeContract({ address, abi: hostRewardsAbi, functionName: a.command });
      await confirm(ctx, hash, `${a.command}(${target})`);
      await audit(ctx, "pauser", a.command, { target }, hash);
      return out({ target, action: a.command, txHash: hash });
    }
    case "status": {
      const m = await ctx.publicClient.readContract({ address: ctx.deployment.matchweeks, abi: matchweeksAbi, functionName: "matchweek", args: [id()] });
      const names = ["None", "Open", "ResultsProposed", "Challenged", "Finalized"];
      return out({ ...m, status: names[m.status], lockTime: new Date(Number(m.lockTime) * 1000).toISOString(), disputeEnds: m.disputeEnds ? new Date(Number(m.disputeEnds) * 1000).toISOString() : null });
    }
    default:
      console.error(`Unknown command "${a.command}"\n`);
      console.log(HELP);
      process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
