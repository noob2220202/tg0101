import { requireUser } from "@/lib/auth/session";
import { fail } from "@/lib/apiResponse";
import { GATEWAY_HEADER, gatewayToken, gatewayUrl } from "@/gateway/protocol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-sent events, proxied from the gateway.
 *
 * The browser never talks to the gateway directly: this route authenticates the
 * operator first and then asks the gateway for that operator's stream only, so
 * one tenant's messages cannot reach another's browser.
 */
export async function GET(request: Request) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return fail("로그인이 필요합니다.", 401);
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${gatewayUrl()}/events?ownerId=${encodeURIComponent(user.id)}`, {
      headers: { [GATEWAY_HEADER]: gatewayToken() },
      signal: request.signal,
    });
  } catch {
    return fail("워커(게이트웨이)가 실행 중이 아닙니다.", 503);
  }

  if (!upstream.ok || !upstream.body) {
    return fail("이벤트 스트림을 열지 못했습니다.", 502);
  }

  return new Response(upstream.body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Nginx buffers SSE into uselessness without this.
      "x-accel-buffering": "no",
    },
  });
}
