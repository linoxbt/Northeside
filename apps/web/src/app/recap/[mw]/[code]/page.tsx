import { recapFor, userByInviteCode, type Recap } from "@northeside/core";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RecapShare, RememberInvite } from "@/components/recap-share";
import { Container } from "@/components/ui";
import { loadOrFail } from "@/lib/server/configured";
import { getCtx } from "@/lib/server/ctx";

export const dynamic = "force-dynamic";

async function load(mwRaw: string, codeRaw: string): Promise<{ recap: Recap; code: string } | null> {
  const mw = Number(mwRaw);
  const code = codeRaw.toLowerCase();
  if (!Number.isInteger(mw)) return null;
  return loadOrFail(async () => {
    const ctx = getCtx();
    const u = await userByInviteCode(ctx, code);
    const recap = u ? await recapFor(ctx, mw, u.id) : null;
    return recap ? { recap, code } : null;
  }, null);
}

export async function generateMetadata({ params }: { params: Promise<{ mw: string; code: string }> }): Promise<Metadata> {
  const { mw, code } = await params;
  const d = await load(mw, code);
  if (!d) return { title: "Recap" };
  const { recap: r } = d;
  const title = `${r.name}: ${r.points} pts in Matchweek ${r.matchweekId}`;
  const description = `#${r.rank} of ${r.players}${r.beatPct > 0 ? `, beat ${r.beatPct}% of players` : ""}. Can you beat this? Free on Northeside.`;
  const image = `/api/v1/og/recap/${r.matchweekId}.${d.code}`;
  return { title, description, openGraph: { title, description, images: [image] }, twitter: { card: "summary_large_image", title, description, images: [image] } };
}

const CELL: Record<Recap["grid"][number]["cell"], string> = {
  exact: "bg-accent text-accent-ink",
  result: "bg-[#eda100] text-ink",
  miss: "bg-ink-2 text-white/60",
  skip: "border border-dashed border-line bg-white text-muted",
  void: "bg-line text-muted",
};

/** Public weekly recap: a player's matchweek in one card, shareable, and a way in for friends. */
export default async function RecapPage({ params }: { params: Promise<{ mw: string; code: string }> }) {
  const { mw, code } = await params;
  const d = await load(mw, code);
  if (!d) notFound();
  const r = d.recap;
  return (
    <Container className="pb-24 pt-6">
      <RememberInvite code={d.code} />
      <div className="mx-auto max-w-md space-y-3">
        <section className="overflow-hidden rounded-3xl bg-ink p-5 text-white">
          <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.1em] text-white/50">
            <span>Matchweek {r.matchweekId} recap</span>
            <span>{r.final ? "Final" : r.ready ? "Provisional" : "In play"}</span>
          </div>
          <p className="mt-4 truncate text-[15px] text-white/60">{r.name}</p>
          <p className="text-[64px] font-medium leading-none tracking-[-0.05em] tabular-nums">
            {r.points}
            <span className="ml-2 text-[22px] tracking-normal text-white/50">pts</span>
          </p>
          <p className="mt-2 text-[17px]">
            #{r.rank} of {r.players}
            {r.beatPct > 0 ? <span className="text-accent"> · beat {r.beatPct}%</span> : null}
          </p>
          <ol className="mt-5 grid grid-cols-5 gap-1.5" aria-label="Picks: exact, right result, miss, not picked or void">
            {r.grid.map((g, i) => (
              <li key={i} title={g.cell} className={`flex aspect-square items-center justify-center rounded-lg text-[16px] ${CELL[g.cell]}`}>
                {g.banker ? "★" : ""}
              </li>
            ))}
          </ol>
          <dl className="mt-5 grid grid-cols-4 gap-2 text-center">
            {[
              ["Exact", r.exact],
              ["Results", `${r.results}/${r.games}`],
              ["Streak", r.streak ? `🔥${r.streak}` : "–"],
              ["Level", r.level],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl bg-white/5 px-1 py-2">
                <dd className="truncate font-mono text-[15px] tabular-nums">{v}</dd>
                <dt className="text-[10px] text-white/50">{k}</dt>
              </div>
            ))}
          </dl>
        </section>

        {r.bestCall || r.banker ? (
          <section className="space-y-2 rounded-2xl border border-line bg-white p-4 text-[15px]">
            {r.bestCall ? (
              <p>
                <span className="mr-1.5" aria-hidden>
                  💥
                </span>
                <b className="font-medium">Best call:</b> {r.bestCall.home} {r.bestCall.pickHome}–{r.bestCall.pickAway} {r.bestCall.away}
                {r.bestCall.exact ? " (exact)" : ""}. {r.bestCall.sharePct <= 50 ? `Only ${r.bestCall.sharePct}%` : `${r.bestCall.sharePct}%`} of players called it.
              </p>
            ) : null}
            {r.banker ? (
              <p>
                <span className="mr-1.5" aria-hidden>
                  ⭐
                </span>
                <b className="font-medium">Banker:</b> {r.banker.home} v {r.banker.away}, {r.banker.points ? `+${r.banker.points} pts` : "missed"}.
              </p>
            ) : null}
          </section>
        ) : null}

        {r.lines.length ? (
          <section className="space-y-2 rounded-2xl border border-line bg-white p-4">
            <h2 className="text-[15px] font-medium">The matchweek in words</h2>
            <ul className="divide-y divide-line text-[14px] leading-6">
              {r.lines.map((l) => (
                <li key={`${l.home}-${l.away}`} className="py-2 text-ink-2">
                  {l.text}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <RecapShare recap={r} code={d.code} />

        <Link href="/sign-in?next=/play" prefetch={false} className="flex min-h-12 items-center justify-center rounded-full bg-accent text-[15px] font-medium text-accent-ink">
          Can you beat {r.points}? Play free
        </Link>
        <p className="text-center text-[12px] text-muted">
          🟩 exact · 🟨 right result · ⬛ miss · ⬜ not picked · ★ Banker.{" "}
          <Link href={`/proof/${r.matchweekId}`} prefetch={false} className="underline underline-offset-4">
            Every pick is on-chain
          </Link>
        </p>
      </div>
    </Container>
  );
}
