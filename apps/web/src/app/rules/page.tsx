import { RULES_V1_HASH, RULES_V1_TEXT } from "@northeside/scoring";
import { Card } from "@/components/ui";

export const metadata = { title: "Rules" };

export default function Rules() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold">How Northeside works</h1>
      <Card className="space-y-2 text-sm leading-relaxed">
        <h2 className="text-base font-bold">Scoring (rules v1)</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Exact score: <b>5 points</b>.</li>
          <li>Correct result (home win, draw or away win): <b>2 points</b>.</li>
          <li>Wrong: 0. A postponed or abandoned game is void and scores 0 for everyone.</li>
          <li>Tables rank by points, then exact scores. Players level on both share a rank. There are no random tie-breaks.</li>
        </ul>
        <p className="text-muted">These rules are hashed into every matchweek on-chain, so they cannot change after a matchweek opens.</p>
        <p className="mono text-xs text-muted">scoringRulesHash = keccak256({RULES_V1_TEXT}) = {RULES_V1_HASH}</p>
      </Card>
      <Card className="space-y-2 text-sm leading-relaxed">
        <h2 className="text-base font-bold">Sealing</h2>
        <p>When you seal, your browser makes a random secret (a salt) and combines it with your picks into a fingerprint (a hash). Your own wallet sends only that hash to the QIE blockchain. Nobody, including us, can read your picks from it.</p>
        <p>You can re-seal as often as you like until the first kickoff of the matchweek. After that the contract refuses any change. Then every player's picks and salt are published, and anyone can check them against the hashes sealed before kickoff. You can export your picks and salt at any time.</p>
        <h2 className="pt-2 text-base font-bold">Results</h2>
        <p>Final scores come from two independent data providers. If they disagree, nothing is published until the difference is resolved, and any manual decision is recorded with a written reason. Results stay open to challenge for 12 hours before they become final.</p>
        <h2 className="pt-2 text-base font-bold">Free, with no prizes</h2>
        <p>Northeside is free. There is nothing to buy, nothing to stake, no odds and no prizes for players. Sponsors pay league hosts for bringing real, returning players; that money never depends on who scores highest.</p>
      </Card>
    </div>
  );
}
