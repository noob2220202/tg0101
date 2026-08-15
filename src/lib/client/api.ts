"use client";

/** Thin fetch wrapper that unwraps the `{ ok, data | error }` envelope. */
export async function apiRequest<T>(
  url: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(url, {
    method: options.method ?? "POST",
    headers: { "Content-Type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  let payload: { ok?: boolean; data?: T; error?: string };
  try {
    payload = await response.json();
  } catch {
    throw new Error(`서버 응답을 읽지 못했습니다. (HTTP ${response.status})`);
  }

  if (!response.ok || !payload.ok) {
    throw new Error(payload.error ?? `요청이 실패했습니다. (HTTP ${response.status})`);
  }
  return payload.data as T;
}
