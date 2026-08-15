import { randomUUID } from "node:crypto";

import { apiCredentials, isMockMode } from "./index";
import { encryptSession } from "./crypto";
import { toTelegramError } from "./errors";
import { TelegramError } from "./types";

/**
 * Interactive MTProto sign-in.
 *
 * Telegram's login is a conversation — the client stays connected while it
 * waits for the SMS code and then possibly a 2FA password. HTTP requests are
 * not, so the in-flight client is parked in this module between calls and
 * addressed by a `loginId`.
 *
 * Pending logins live in memory only: a server restart cancels them, which is
 * the correct outcome for a half-finished credential exchange.
 */

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: Error) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // A cancelled login rejects deferreds that nothing is awaiting yet; this
  // keeps that from surfacing as an unhandled rejection and killing the server.
  promise.catch(() => {});
  return { promise, resolve, reject };
}

export type LoginStage = "CODE_REQUIRED" | "PASSWORD_REQUIRED" | "COMPLETE";

type PendingLogin = {
  id: string;
  phone: string;
  label: string;
  createdAt: number;
  /** Resolved when the caller supplies the SMS code. */
  code: Deferred<string>;
  /** Resolved when the caller supplies the 2FA password. */
  password: Deferred<string>;
  /** Which input the flow is currently blocked on. */
  stage: LoginStage;
  /** Settles when sign-in finishes or fails. */
  done: Deferred<string>;
  client?: { disconnect(): Promise<void>; destroy(): Promise<void> };
};

const pending = new Map<string, PendingLogin>();
/** Abandoned logins hold an open connection; drop them after 10 minutes. */
const LOGIN_TTL_MS = 10 * 60_000;

function sweep(): void {
  const now = Date.now();
  for (const [id, login] of pending) {
    if (now - login.createdAt > LOGIN_TTL_MS) {
      void cancelLogin(id);
    }
  }
}

/**
 * Step 1 — send the code. Resolves once Telegram has asked for it, not once the
 * whole sign-in is finished.
 */
export async function startLogin(phone: string, label: string): Promise<{ loginId: string; stage: LoginStage }> {
  sweep();

  if (isMockMode()) {
    const login = mockLogin(phone, label);
    pending.set(login.id, login);
    return { loginId: login.id, stage: "CODE_REQUIRED" };
  }

  const { apiId, apiHash } = apiCredentials();
  const { TelegramClient, Logger, sessions } = await import("teleproto");

  const client = new TelegramClient(new sessions.StringSession(""), apiId, apiHash, {
    connectionRetries: 3,
    baseLogger: new Logger("error" as never),
  });

  const login: PendingLogin = {
    id: randomUUID(),
    phone,
    label,
    createdAt: Date.now(),
    code: deferred<string>(),
    password: deferred<string>(),
    stage: "CODE_REQUIRED",
    done: deferred<string>(),
    client,
  };
  pending.set(login.id, login);

  // `start` drives the whole conversation; each callback blocks until the
  // matching HTTP request supplies the value.
  void client
    .start({
      phoneNumber: async () => phone,
      phoneCode: async () => {
        login.stage = "CODE_REQUIRED";
        return login.code.promise;
      },
      password: async () => {
        login.stage = "PASSWORD_REQUIRED";
        return login.password.promise;
      },
      onError: async (err) => {
        login.done.reject(toTelegramError(err));
        // Returning true stops the library from retrying the prompt.
        return true;
      },
    })
    .then(() => {
      login.stage = "COMPLETE";
      login.done.resolve(client.session.save() as unknown as string);
    })
    .catch((err) => login.done.reject(toTelegramError(err)));

  // Give Telegram a moment to reject an obviously bad number.
  const failedEarly = await Promise.race([
    login.done.promise.then(() => null).catch((err: Error) => err),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
  ]);
  if (failedEarly instanceof Error) {
    await cancelLogin(login.id);
    throw failedEarly;
  }

  return { loginId: login.id, stage: login.stage };
}

/**
 * Step 2 — hand over the SMS code, and step 3 the 2FA password.
 *
 * Returns the encrypted session string once sign-in completes.
 */
export async function submitLoginValue(
  loginId: string,
  value: string,
  kind: "code" | "password",
): Promise<{ stage: LoginStage; sessionString?: string; phone: string; label: string }> {
  const login = pending.get(loginId);
  if (!login) throw new TelegramError("AUTH_INVALID", "로그인 세션이 만료되었습니다. 처음부터 다시 시도하세요.");

  if (kind === "code") login.code.resolve(value);
  else login.password.resolve(value);

  // Either sign-in completes, or the flow stops at the next prompt.
  const outcome = await Promise.race([
    login.done.promise.then((session) => ({ type: "done" as const, session })),
    waitForStage(login, kind === "code" ? "PASSWORD_REQUIRED" : "COMPLETE"),
  ]).catch(async (err) => {
    // A wrong code is recoverable: re-arm the deferred and ask again.
    const error = toTelegramError(err);
    if (/CODE_INVALID|CODE_EMPTY|PASSWORD_HASH_INVALID/i.test(error.message)) {
      if (kind === "code") login.code = deferred<string>();
      else login.password = deferred<string>();
      throw new TelegramError(
        "AUTH_INVALID",
        kind === "code" ? "인증 코드가 올바르지 않습니다." : "비밀번호가 올바르지 않습니다.",
      );
    }
    await cancelLogin(loginId);
    throw error;
  });

  if (outcome.type === "done") {
    pending.delete(loginId);
    await login.client?.disconnect().catch(() => {});
    return {
      stage: "COMPLETE",
      sessionString: encryptSession(outcome.session),
      phone: login.phone,
      label: login.label,
    };
  }

  return { stage: login.stage, phone: login.phone, label: login.label };
}

/** Poll until the flow reaches `target`, so the caller knows what to ask for. */
function waitForStage(login: PendingLogin, target: LoginStage): Promise<{ type: "stage" }> {
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (login.stage === target || Date.now() - started > 20_000) {
        clearInterval(timer);
        resolve({ type: "stage" });
      }
    }, 200);
  });
}

export async function cancelLogin(loginId: string): Promise<void> {
  const login = pending.get(loginId);
  if (!login) return;
  pending.delete(loginId);
  login.code.reject(new Error("cancelled"));
  login.password.reject(new Error("cancelled"));
  // The deferreds above may already be settled; rejecting again is a no-op.
  await login.client?.disconnect().catch(() => {});
  await login.client?.destroy().catch(() => {});
}

/** In MOCK_TELEGRAM mode any 5-digit code works and 2FA is skipped. */
function mockLogin(phone: string, label: string): PendingLogin {
  const login: PendingLogin = {
    id: randomUUID(),
    phone,
    label,
    createdAt: Date.now(),
    code: deferred<string>(),
    password: deferred<string>(),
    stage: "CODE_REQUIRED",
    done: deferred<string>(),
  };
  void login.code.promise
    .then(() => {
      login.stage = "COMPLETE";
      login.done.resolve(`mock-session:${phone}`);
    })
    .catch(() => {});
  return login;
}
