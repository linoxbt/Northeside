import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Field encryption at rest (AES-256-GCM). The base key comes from the environment
 * (DATA_ENCRYPTION_KEY, 32 bytes base64) and is never stored in the database.
 *
 * - New ciphertexts: v2.<keyId>.<iv>.<tag>.<ciphertext> (base64url), encrypted with a subkey derived
 *   from the base key by HKDF-SHA256, so encryption never uses the same key as the lookup HMAC; the key
 *   id names which base key made it (audit 27 Nov, L5).
 * - Older ciphertexts: v1.<iv>.<tag>.<ciphertext>, encrypted with the base key directly; still read.
 * - Rotation: set the new key as DATA_ENCRYPTION_KEY and the old one(s) in DATA_ENCRYPTION_KEY_PREVIOUS
 *   (comma separated). Everything stored still decrypts; new writes use the new key. The lookup HMAC
 *   (email and device limits) uses the current base key: rotating the key starts new hashes, so a
 *   rotation also needs the stored email/device hashes recomputed before the old key is retired.
 */
export class FieldCrypto {
  private readonly key: Buffer;
  private readonly keys: { id: string; base: Buffer; enc: Buffer }[];

  constructor(keyBase64: string, previousBase64: string[] = []) {
    const parse = (k: string) => {
      const b = Buffer.from(k.trim(), "base64");
      if (b.length !== 32) throw new Error("DATA_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
      return b;
    };
    this.key = parse(keyBase64);
    this.keys = [this.key, ...previousBase64.filter((k) => k.trim()).map(parse)].map((base) => ({
      id: createHash("sha256").update(base).digest("hex").slice(0, 8),
      base,
      enc: Buffer.from(hkdfSync("sha256", base, Buffer.from("northeside"), Buffer.from("field-encryption v2"), 32)),
    }));
  }

  static fromEnv(env: Record<string, string | undefined> = process.env): FieldCrypto {
    const k = env.DATA_ENCRYPTION_KEY;
    if (!k) throw new Error("Missing env DATA_ENCRYPTION_KEY");
    return new FieldCrypto(k, (env.DATA_ENCRYPTION_KEY_PREVIOUS ?? "").split(","));
  }

  encrypt(plaintext: string, aad = ""): string {
    const current = this.keys[0]!;
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", current.enc, iv);
    if (aad) cipher.setAAD(Buffer.from(aad));
    const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ["v2", current.id, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
  }

  decrypt(token: string, aad = ""): string {
    const parts = token.split(".");
    if (parts[0] === "v2" && parts.length === 5) {
      const [, kid, iv, tag, ct] = parts as [string, string, string, string, string];
      const k = this.keys.find((x) => x.id === kid);
      if (!k) throw new Error(`No key ${kid} for this ciphertext (set DATA_ENCRYPTION_KEY_PREVIOUS)`);
      return open(k.enc, iv, tag, ct, aad);
    }
    if (parts[0] === "v1" && parts.length === 4) {
      const [, iv, tag, ct] = parts as [string, string, string, string];
      // v1 carries no key id: try the current base key, then the previous ones.
      let last: unknown;
      for (const k of this.keys) {
        try {
          return open(k.base, iv, tag, ct, aad);
        } catch (e) {
          last = e;
        }
      }
      throw last instanceof Error ? last : new Error("Could not decrypt");
    }
    throw new Error("Unrecognised ciphertext format");
  }

  /** Keyed hash for lookups (email uniqueness, device limits) without storing the value. */
  hmac(value: string): string {
    return createHmac("sha256", this.key).update(value).digest("hex");
  }
}

function open(key: Buffer, iv: string, tag: string, ct: string, aad: string): string {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  if (aad) decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
