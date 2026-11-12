import { VerifiedBadge } from "./ui";

export interface BoardRowDTO {
  rank: number;
  name: string;
  qieId: string | null;
  qieIdResolved: boolean;
  verified: boolean;
  points: number;
  exactScores: number;
}

export function Board({ rows, empty = "No scores yet. Tables fill in once a matchweek is finalized." }: { rows: BoardRowDTO[]; empty?: string }) {
  if (rows.length === 0) return <p className="bg-white px-6 py-16 text-center text-[15px] text-muted">{empty}</p>;
  return (
    <table className="w-full bg-white text-[15px]">
      <thead>
        <tr className="border-b border-line">
          <th scope="col" className="eyebrow w-16 px-5 py-3 text-left font-normal">#</th>
          <th scope="col" className="eyebrow py-3 text-left font-normal">Player</th>
          <th scope="col" className="eyebrow py-3 text-right font-normal">Exact</th>
          <th scope="col" className="eyebrow px-5 py-3 text-right font-normal">Pts</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rows.map((r, i) => (
          <tr key={`${r.rank}-${r.name}-${i}`} className="transition-colors hover:bg-subtle">
            <td className="px-5 py-3.5 font-mono text-[13px] text-muted">{String(r.rank).padStart(2, "0")}</td>
            <td className="py-3.5">
              <span className="tracking-[-0.01em]">{r.name}</span> {r.verified ? <VerifiedBadge /> : null}
              {r.qieId && !r.qieIdResolved ? <span className="ml-2 font-mono text-[11px] uppercase tracking-[0.06em] text-muted">self-reported</span> : null}
            </td>
            <td className="py-3.5 text-right font-mono text-[14px] text-ink-2">{r.exactScores}</td>
            <td className="px-5 py-3.5 text-right text-[17px] tracking-[-0.02em]">{r.points}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
