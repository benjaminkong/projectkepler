// Signed-in session kept in an encrypted cookie (AES-256-GCM), so any API instance can read it
// without a shared session store. Swap for a database-backed session once the database lands.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export interface SessionUser {
  name: string;
  email: string;
  /** SAML NameID and SessionIndex, sent back to Entra on sign-out. */
  nameID: string;
  nameIDFormat: string;
  sessionIndex?: string;
}

const keyFrom = (secret: string) => createHash("sha256").update(secret).digest();

/** Encrypts `data` with an expiry, for a cookie value. */
export function seal(data: object, secret: string, ttlMs: number): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify({ data, exp: Date.now() + ttlMs })), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}

/** What `seal` encrypted, or null if the value is missing, tampered with or expired. */
export function unseal<T>(value: string | undefined, secret: string): T | null {
  const [iv, tag, body] = (value ?? "").split(".").map((p) => Buffer.from(p, "base64url"));
  if (!iv?.length || !tag?.length || !body?.length) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", keyFrom(secret), iv);
    decipher.setAuthTag(tag);
    const { data, exp } = JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8")) as { data: T; exp: number };
    return exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

export const sealSession = (user: SessionUser, secret: string, ttlMs: number) => seal(user, secret, ttlMs);
export const openSession = (value: string | undefined, secret: string) => unseal<SessionUser>(value, secret);
