import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Field encryption at rest (AES-256-GCM). The key comes from the environment (DATA_ENCRYPTION_KEY,
 * 32 bytes base64) and is never stored in the database. Format: v1.<iv>.<tag>.<ciphertext> (base64url).
 */
export class FieldCrypto {
  private readonly key: Buffer;

  constructor(keyBase64: string) {
    const key = Buffer.from(keyBase64, "base64");
    if (key.length !== 32) throw new Error("DATA_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
    this.key = key;
  }

  static fromEnv(env: Record<string, string | undefined> = process.env): FieldCrypto {
    const k = env.DATA_ENCRYPTION_KEY;
    if (!k) throw new Error("Missing env DATA_ENCRYPTION_KEY");
    return new FieldCrypto(k);
  }

  encrypt(plaintext: string, aad = ""): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    if (aad) cipher.setAAD(Buffer.from(aad));
    const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ["v1", iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
  }

  decrypt(token: string, aad = ""): string {
    const [v, iv, tag, ct] = token.split(".");
    if (v !== "v1" || !iv || !tag || ct === undefined) throw new Error("Unrecognised ciphertext format");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url"));
    if (aad) decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
  }

  /** Keyed hash for lookups (email uniqueness, device limits) without storing the value. */
  hmac(value: string): string {
    return createHmac("sha256", this.key).update(value).digest("hex");
  }
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
