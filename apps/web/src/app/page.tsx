import { MatchweekView } from "@/components/matchweek";
import { Card } from "@/components/ui";
import { getById, getCurrent } from "@/lib/server/services/matchweeks";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ mw?: string }> }) {
  const { mw: mwParam } = await searchParams;
  const mw = mwParam && /^\d+$/.test(mwParam) ? await getById(Number(mwParam)) : await getCurrent();
  if (!mw) {
    return (
      <Card>
        <h1 className="text-xl font-bold">The next matchweek opens soon</h1>
        <p className="mt-2 text-muted">Fixtures appear here a few days before the first kickoff.</p>
      </Card>
    );
  }
  return <MatchweekView mw={mw} />;
}
