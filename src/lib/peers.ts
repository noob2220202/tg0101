/**
 * Telegram writes the same chat id several ways.
 *
 * `getEntity` hands back a bare id (`1234567890`), while updates and dialogs
 * use the "marked" form that encodes the peer type (`-1001234567890` for a
 * channel or supergroup, `-1234567890` for a legacy group). Membership rows
 * hold whichever form the join returned, so anything that matches a live
 * update against a stored room has to compare them on equal footing.
 */
export function normalizePeerId(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const bare = trimmed.replace(/^-100/, "").replace(/^-/, "");
  return /^\d+$/.test(bare) && bare !== "0" ? bare : null;
}
