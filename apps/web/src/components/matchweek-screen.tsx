import { MatchweekView } from "./matchweek";
import { SportsbookShell } from "./sportsbook";
import { ButtonLink, Card } from "./ui";
import { loadOrFail, safely } from "@/lib/server/configured";
import { getById, getCurrent, listMatchweeks, type MatchweekTab } from "@/lib/server/services/matchweeks";

const WAT = { timeZone: "Africa/Lagos" } as const;

/** The sportsbook board for one matchweek (the current one unless ?mw= picks another). */
export async function MatchweekScreen({ mwParam, base = "/" }: { mwParam?: string; base?: string }) {
  // The matchweek is the page's data: a failure shows the error page, not "opens soon" (audit B13).
  const [mw, tabs] = await Promise.all([
    loadOrFail(() => (mwParam && /^\d+$/.test(mwParam) ? getById(Number(mwParam)) : getCurrent()), null),
    safely(() => listMatchweeks(), [] as MatchweekTab[]),
  ]);
  return (
    <SportsbookShell tabs={tabs} activeId={mw?.id ?? null} base={base}>
      {mw && mw.status === "draft" ? (
        // Not on-chain yet: no crowd, no live data, nothing to seal (audit B12).
        <Card className="space-y-4 py-8">
          <div className="text-center">
            <p className="eyebrow">Matchweek {mw.id}</p>
            <p className="mt-2 text-[22px] tracking-[-0.02em]">Opens soon</p>
            <p className="mt-1 text-[14px] text-muted">
              Picks open a few days before the first kickoff,{" "}
              {new Date(mw.lockTime).toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", ...WAT })} WAT.
            </p>
          </div>
          {mw.fixtures.length ? (
            <ul className="divide-y divide-line rounded-2xl border border-line text-[14px]">
              {mw.fixtures.map((f) => (
                <li key={f.index} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span>
                    {f.home} v {f.away}
                  </span>
                  <span className="font-mono text-[12px] text-muted">
                    {new Date(f.kickoff).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", ...WAT })}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      ) : mw ? (
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
