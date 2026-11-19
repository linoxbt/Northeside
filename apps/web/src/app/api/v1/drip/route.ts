import { DripRefused, dripConfigFromEnv, requestDrip } from "@northeside/core";
import { z } from "zod";
import { HttpError, clientIp, json, limitWrites, quotaLeft, rateLimit, requireSession, route } from "@/lib/server/api";
import { getCtx } from "@/lib/server/ctx";
import { requireAdult, userById } from "@/lib/server/services/accounts";

const body = z.object({ deviceId: z.string().min(16).max(128) });

/** The /64 network of an IPv6 address; IPv4 addresses as they are. */
function networkOf(ip: string): string {
  if (!ip.includes(":")) return ip;
  const full = ip.split("%")[0]!;
  const [head = "", tail = ""] = full.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const groups = full.includes("::") ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
  return `${groups.slice(0, 4).map((g) => (g || "0").toLowerCase()).join(":")}::/64`;
}

/** POST /api/v1/drip: a small amount of QIEV3 for a brand-new, empty wallet (idempotent per wallet). */
export const POST = route(async (req) => {
  const s = await requireSession();
  await limitWrites(s, "drip", 3, 10);
  // The device id is client-chosen, so also cap drips actually sent per network per day (audit S5).
  // IPv6 clients usually hold a whole /64: count the network, not the address (audit S9).
  const ipKey = `drip:ip-day:${networkOf(await clientIp())}`;
  await quotaLeft(ipKey, 5, 24 * 3600);
  const { deviceId } = body.parse(await req.json());
  await requireAdult(s.userId);
  const user = await userById(s.userId);
  if (!user) throw new HttpError(401, "unauthenticated", "Sign in first");
  try {
    const r = await requestDrip(getCtx(), dripConfigFromEnv(), {
      userId: s.userId,
      wallet: s.wallet,
      deviceId,
      emailVerified: user.emailVerified,
      emailHash: user.emailHash,
      email: user.emailEnc ? (() => {
        try {
          return getCtx().crypto.decrypt(user.emailEnc!, `email:${user.id}`);
        } catch {
          return null;
        }
      })() : null,
    });
    if (r.status !== "already") await rateLimit(ipKey, Number.MAX_SAFE_INTEGER, 24 * 3600);
    return json(r);
  } catch (e) {
    if (e instanceof DripRefused) throw new HttpError(e.code === "not_configured" ? 503 : 409, e.code, e.message);
    throw e;
  }
});
