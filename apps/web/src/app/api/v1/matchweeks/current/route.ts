import { json, route } from "@/lib/server/api";
import { getCurrent } from "@/lib/server/services/matchweeks";

export const dynamic = "force-dynamic";

export const GET = route(async () => json({ matchweek: await getCurrent() }));
