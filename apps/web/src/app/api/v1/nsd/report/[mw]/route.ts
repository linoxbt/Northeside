import { schema } from "@northeside/db";
import { asc, eq } from "drizzle-orm";
import { HttpError, json, route } from "@/lib/server/api";
import { getCtx } from "@/lib/server/ctx";

export const dynamic = "force-dynamic";

/** GET /api/v1/nsd/report/:mw: the public report behind a matchweek's $NSD root (its reportURI). */
export const GET = route(async (_req, { params }: { params: Promise<{ mw: string }> }) => {
  const mw = Number((await params).mw);
  if (!Number.isInteger(mw) || mw < 0) throw new HttpError(400, "bad_id", "Bad matchweek");
  const { db } = getCtx();
  const [root] = await db.select().from(schema.nsdRoots).where(eq(schema.nsdRoots.matchweekId, mw));
  if (!root) throw new HttpError(404, "not_found", "No $NSD root for this matchweek");
  const leaves = await db.select().from(schema.nsdLeaves).where(eq(schema.nsdLeaves.matchweekId, mw)).orderBy(asc(schema.nsdLeaves.rank));
  return json({
    matchweekId: mw,
    root: root.root,
    total: root.total.toString(),
    status: root.status,
    txHash: root.txHash,
    rule: "Verified people only, one entry per person (first-sealed verified wallet), ranked by points then exact scores; ties split the positions they occupy.",
    leaves: leaves.map((l) => ({ wallet: l.wallet, rank: l.rank, points: l.points, amount: l.amount.toString() })),
  });
});
