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
  if (rows.length === 0) return <p className="p-4 text-sm text-muted">{empty}</p>;
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs uppercase text-muted">
        <tr>
          <th className="px-4 py-2 font-semibold">#</th>
          <th className="py-2 font-semibold">Player</th>
          <th className="py-2 text-right font-semibold">Exact</th>
          <th className="px-4 py-2 text-right font-semibold">Pts</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rows.map((r, i) => (
          <tr key={`${r.rank}-${r.name}-${i}`}>
            <td className="px-4 py-2.5 tabular-nums text-muted">{r.rank}</td>
            <td className="py-2.5">
              <span className="font-semibold">{r.name}</span> {r.verified ? <VerifiedBadge /> : null}
              {r.qieId && !r.qieIdResolved ? <span className="ml-1 text-xs text-muted">(self-reported)</span> : null}
            </td>
            <td className="py-2.5 text-right tabular-nums">{r.exactScores}</td>
            <td className="px-4 py-2.5 text-right font-bold tabular-nums">{r.points}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
