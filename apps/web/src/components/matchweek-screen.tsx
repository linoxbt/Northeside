import { MatchweekView } from "./matchweek";
import { SportsbookShell } from "./sportsbook";
import { ButtonLink, Card } from "./ui";
import { safely } from "@/lib/server/configured";
import { getById, getCurrent, listMatchweeks, type MatchweekTab } from "@/lib/server/services/matchweeks";

/** The sportsbook board for one matchweek (the current one unless ?mw= picks another). */
export async function MatchweekScreen({ mwParam, base = "/" }: { mwParam?: string; base?: string }) {
  const [mw, tabs] = await Promise.all([
    safely(() => (mwParam && /^\d+$/.test(mwParam) ? getById(Number(mwParam)) : getCurrent()), null),
    safely(() => listMatchweeks(), [] as MatchweekTab[]),
  ]);
  return (
    <SportsbookShell tabs={tabs} activeId={mw?.id ?? null} base={base}>
      {mw ? (
        <MatchweekView mw={mw} />
      ) : (
        <Card className="space-y-3 py-10 text-center">
          <p className="text-[20px] tracking-[-0.02em]">The next matchweek opens soon.</p>
          <ButtonLink href="/leagues" variant="primary" arrow>
            Find a league
          </ButtonLink>
        </Card>
      )}
    </SportsbookShell>
  );
}
