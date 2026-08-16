import { NextResponse } from "next/server";
import { ZodError } from "zod";

/** Uniform JSON shape for every route handler. */

export function ok<T>(data: T, init?: number) {
  return NextResponse.json({ ok: true, data }, { status: init ?? 200 });
}

export function fail(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

/**
 * Turns thrown errors into a Korean message the UI can show verbatim.
 * Validation errors are reported against the first offending field.
 */
export function handleError(err: unknown) {
  if (err instanceof ZodError) {
    const first = err.issues[0];
    const path = first?.path.join(".") ?? "입력";
    return fail(`${path}: ${first?.message ?? "값이 올바르지 않습니다."}`, 422);
  }
  const message = err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.";
  return fail(message, 400);
}
