import { json, limitWrites, route } from "@/lib/server/api";
import { issueNonce } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  await limitWrites(null, "nonce", 0, 30);
  return json({ nonce: issueNonce() });
});
