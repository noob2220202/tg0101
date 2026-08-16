import { getOwner } from "@/lib/owner";
import { fail } from "@/lib/apiResponse";
import { GATEWAY_HEADER, gatewayToken, gatewayUrl } from "@/gateway/protocol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-sent events, proxied from the gateway.
 *
 * The browser never talks to the gateway directly — the gateway is loopback
 * only, and this route is what bridges it to the page.
 */
export async function GET(request: Request) {
  const owner = await getOwner();

  let upstream: Response;
  try {
    upstream = await fetch(`${gatewayUrl()}/events?ownerId=${encodeURIComponent(owner.id)}`, {
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
