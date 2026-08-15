import { prisma } from "../db";
import { GATEWAY_HEADER, GatewayMethod, gatewayToken, gatewayUrl } from "@/gateway/protocol";

/**
 * Server-side client for the gateway.
 *
 * Every call goes through `callGateway`, which refuses to act on an account the
 * signed-in operator does not own — the gateway itself is unauthenticated
 * beyond a shared secret, so this is where tenancy is enforced.
 */

export class GatewayUnavailableError extends Error {
  constructor() {
    super("워커(게이트웨이)가 실행 중이 아닙니다. `npm run worker` 를 먼저 실행하세요.");
    this.name = "GatewayUnavailableError";
  }
}

export async function assertAccountOwner(ownerId: string, accountId: string): Promise<void> {
  const account = await prisma.account.findFirst({
    where: { id: accountId, ownerId },
    select: { id: true },
  });
  if (!account) throw new Error("계정을 찾을 수 없습니다.");
}

export async function callGateway<T>(
  ownerId: string,
  accountId: string,
  method: GatewayMethod,
  params: Record<string, unknown> = {},
): Promise<T> {
  await assertAccountOwner(ownerId, accountId);

  let response: Response;
  try {
    response = await fetch(`${gatewayUrl()}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json", [GATEWAY_HEADER]: gatewayToken() },
      body: JSON.stringify({ accountId, method, params }),
      // Telegram calls are slow; the default fetch timeout is not.
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new GatewayUnavailableError();
  }

  if (!response.ok) {
    throw new Error(`게이트웨이 오류 (HTTP ${response.status})`);
  }

  const payload = (await response.json()) as { ok: boolean; data?: T; error?: string };
  if (!payload.ok) throw new Error(payload.error ?? "게이트웨이 요청이 실패했습니다.");
  return payload.data as T;
}

/** Is the worker up? Used to show an inline warning instead of failing hard. */
export async function gatewayHealthy(): Promise<boolean> {
  try {
    const response = await fetch(`${gatewayUrl()}/health`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}
