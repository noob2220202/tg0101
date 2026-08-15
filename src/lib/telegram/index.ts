import { prisma } from "../db";
import { decryptSession } from "./crypto";
import { MockTelegramSession } from "./mock";
import { TelegramError, TelegramSession } from "./types";

export * from "./types";
export { encryptSession, decryptSession } from "./crypto";
export { toTelegramError } from "./errors";

export function isMockMode(): boolean {
  return process.env.MOCK_TELEGRAM === "1";
}

export function apiCredentials(): { apiId: number; apiHash: string } {
  const apiId = Number(process.env.TELEGRAM_API_ID ?? 0);
  const apiHash = process.env.TELEGRAM_API_HASH ?? "";
  if (!apiId || !apiHash) {
    throw new TelegramError(
      "AUTH_INVALID",
      "TELEGRAM_API_ID / TELEGRAM_API_HASH 가 설정되지 않았습니다. .env 를 확인하세요.",
      { permanent: true },
    );
  }
  return { apiId, apiHash };
}

/**
 * Sessions are expensive to establish, so the worker keeps one per account for
 * the lifetime of the process.
 */
const pool = new Map<string, TelegramSession>();

export async function getSession(accountId: string): Promise<TelegramSession> {
  const existing = pool.get(accountId);
  if (existing) return existing;

  if (isMockMode()) {
    const mock = new MockTelegramSession(accountId);
    pool.set(accountId, mock);
    return mock;
  }

  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) throw new TelegramError("AUTH_INVALID", "계정을 찾을 수 없습니다.", { permanent: true });

  const sessionString = decryptSession(account.sessionString);
  if (!sessionString) {
    throw new TelegramError("AUTH_INVALID", "저장된 세션이 없습니다. 계정을 다시 연결해 주세요.", {
      permanent: true,
    });
  }

  // Imported lazily: teleproto pulls in Node-only modules, and the mock path
  // must work in environments where that is undesirable.
  const { RealTelegramSession } = await import("./real");
  const { apiId, apiHash } = apiCredentials();
  const session = new RealTelegramSession({ accountId, sessionString, apiId, apiHash });
  await session.connect();

  pool.set(accountId, session);
  return session;
}

export async function dropSession(accountId: string): Promise<void> {
  const session = pool.get(accountId);
  pool.delete(accountId);
  if (session) await session.disconnect().catch(() => {});
}

export async function dropAllSessions(): Promise<void> {
  await Promise.all([...pool.keys()].map((id) => dropSession(id)));
}
