import { createHash, randomBytes } from "node:crypto";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function newDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function newPairingCode(): string {
  const bytes = randomBytes(8);
  let result = "";
  for (const byte of bytes) result += CROCKFORD[byte % CROCKFORD.length];
  return result;
}

export function bearerToken(header: string | string[] | undefined): string | null {
  if (typeof header !== "string") return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}
