import { redirect } from "next/navigation";
import { safely } from "@/lib/server/configured";
import { getCurrent } from "@/lib/server/services/matchweeks";

export const dynamic = "force-dynamic";

export default async function ProofIndex() {
  const mw = await safely(() => getCurrent(), null);
  redirect(mw ? `/proof/${mw.id}` : "/docs#results");
}
