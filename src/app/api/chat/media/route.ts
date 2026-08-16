import { getOwner } from "@/lib/owner";
import { fail } from "@/lib/apiResponse";
import { assertAccountOwner } from "@/lib/gateway/client";
import { GATEWAY_HEADER, gatewayToken, gatewayUrl } from "@/gateway/protocol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streams one message's photo or file.
 *
 * The gateway holds the session and the download cache, so this is a proxy —
 * but an authenticating one: the ownership check happens before the fetch.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const accountId = url.searchParams.get("accountId") ?? "";
  const peerId = url.searchParams.get("peerId") ?? "";
  const messageId = url.searchParams.get("messageId") ?? "";
  if (!accountId || !peerId || !messageId) return fail("잘못된 요청입니다.", 400);

  // Authentication and ownership are checked before anything is fetched, and
  // are reported distinctly from a genuine download failure.
  try {
    const owner = await getOwner();
    await assertAccountOwner(owner.id, accountId);
  } catch {
    return fail("미디어를 찾을 수 없습니다.", 404);
  }

  try {
    const upstream = await fetch(
      `${gatewayUrl()}/media?accountId=${encodeURIComponent(accountId)}` +
        `&peerId=${encodeURIComponent(peerId)}&messageId=${encodeURIComponent(messageId)}`,
      { headers: { [GATEWAY_HEADER]: gatewayToken() }, signal: AbortSignal.timeout(60_000) },
    );

    if (!upstream.ok || !upstream.body) return fail("미디어를 가져오지 못했습니다.", 404);

    return new Response(upstream.body, {
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
        "content-disposition": upstream.headers.get("content-disposition") ?? "inline",
        "cache-control": "private, max-age=86400",
      },
    });
  } catch {
    return fail("미디어를 가져오지 못했습니다.", 500);
  }
}
