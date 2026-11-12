import "server-only";
import { PrivyClient } from "@privy-io/server-auth";

let client: PrivyClient | null | undefined;

function privy(): PrivyClient | null {
  if (client !== undefined) return client;
  const id = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const secret = process.env.PRIVY_APP_SECRET;
  client = id && secret ? new PrivyClient(id, secret) : null;
  return client;
}

export const privyEnabled = () => privy() !== null;

/** Verify a Privy access token and return the user's verified email (Privy verifies by OTP). */
export async function verifyPrivyToken(token: string): Promise<{ did: string; email: string | null } | null> {
  const p = privy();
  if (!p) return null;
  try {
    const claims = await p.verifyAuthToken(token);
    const user = await p.getUser(claims.userId);
    return { did: claims.userId, email: user.email?.address?.toLowerCase() ?? null };
  } catch {
    return null;
  }
}
