import { redirect } from "next/navigation";
import { getCurrent } from "@/lib/server/services/matchweeks";

export const dynamic = "force-dynamic";

export default async function ProofIndex() {
  const mw = await getCurrent();
  redirect(mw ? `/proof/${mw.id}` : "/");
}
