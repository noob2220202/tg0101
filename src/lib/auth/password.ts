import crypto from "node:crypto";
import { promisify } from "node:util";

/**
 * Password hashing with scrypt from Node's standard library — no dependency,
 * and memory-hard enough that a stolen database is not a password list.
 */

const scrypt = promisify(crypto.scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;
const PREFIX = "scrypt$";

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return `${PREFIX}${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!stored.startsWith(PREFIX)) return false;

  const [saltB64, hashB64] = stored.slice(PREFIX.length).split("$");
  if (!saltB64 || !hashB64) return false;

  const expected = Buffer.from(hashB64, "base64url");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64url"), KEY_LENGTH);

  // Constant-time: a length mismatch alone must not short-circuit.
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

/** Minimum bar for an operator password. */
export function validatePasswordStrength(password: string): string | null {
  if (password.length < 8) return "비밀번호는 8자 이상이어야 합니다.";
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return "비밀번호에 영문자와 숫자를 모두 포함하세요.";
  }
  return null;
}
