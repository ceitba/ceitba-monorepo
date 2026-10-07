import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const sha256hex = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

// URL-safe random token with a readable prefix (so leaked tokens are easy to identify).
export const randomToken = (prefix: string, bytes = 32): string =>
  prefix + randomBytes(bytes).toString("base64url");

export const safeEqual = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

// AES-256-GCM for the CEITBA API keys held per grant. Format: v1.<iv>.<tag>.<ciphertext> (base64url).
export class SecretBox {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, "base64");
    if (this.key.length !== 32) throw new Error("encryption key must be 32 bytes");
  }

  seal(plain: string, aad = ""): string {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.key, iv);
    if (aad) c.setAAD(Buffer.from(aad));
    const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
    return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), enc.toString("base64url")].join(".");
  }

  open(sealed: string, aad = ""): string {
    const [v, iv, tag, data] = sealed.split(".");
    if (v !== "v1" || !iv || !tag || data === undefined) throw new Error("bad sealed value");
    const d = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url"));
    if (aad) d.setAAD(Buffer.from(aad));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
  }
}
