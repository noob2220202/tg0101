import crypto from "node:crypto";

/**
 * MTProto session strings are full account credentials — anyone holding one can
 * act as the user. They are encrypted at rest with AES-256-GCM.
 */

const ALGO = "aes-256-gcm";
const PREFIX = "enc.v1.";

function key(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "SESSION_SECRET is missing or too short. Set a random 32+ character value in .env before storing accounts.",
    );
  }
  // Stretch whatever the operator supplied into a fixed 32-byte key.
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptSession(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + [iv, tag, enc].map((b) => b.toString("base64url")).join(".");
}

export function decryptSession(stored: string | null | undefined): string | null {
  if (!stored) return null;
  // Sessions written before encryption was enabled are returned as-is.
  if (!stored.startsWith(PREFIX)) return stored;

  const [ivB64, tagB64, dataB64] = stored.slice(PREFIX.length).split(".");
  if (!ivB64 || !tagB64 || !dataB64) return null;

  try {
    const decipher = crypto.createDecipheriv(ALGO, key(), Buffer.from(ivB64, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    // Wrong SESSION_SECRET, or the row was tampered with.
    return null;
  }
}
