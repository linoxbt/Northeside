import { DripRefused, dripConfigFromEnv, requestDrip } from "@northeside/core";
import { z } from "zod";
import { HttpError, json, limitWrites, requireSession, route } from "@/lib/server/api";
import { getCtx } from "@/lib/server/ctx";
import { userById } from "@/lib/server/services/accounts";

const body = z.object({ deviceId: z.string().min(16).max(128) });

/** POST /api/v1/drip: a small amount of QIEV3 for a brand-new, empty wallet (idempotent per wallet). */
export const POST = route(async (req) => {
  const s = await requireSession();
  await limitWrites(s, "drip", 3, 10);
  const { deviceId } = body.parse(await req.json());
  const user = await userById(s.userId);
  if (!user) throw new HttpError(401, "unauthenticated", "Sign in first");
  try {
    const r = await requestDrip(getCtx(), dripConfigFromEnv(), {
      userId: s.userId,
      wallet: s.wallet,
      deviceId,
      emailVerified: user.emailVerified,
    });
    return json(r);
  } catch (e) {
    if (e instanceof DripRefused) throw new HttpError(e.code === "not_configured" ? 503 : 409, e.code, e.message);
    throw e;
  }
});
