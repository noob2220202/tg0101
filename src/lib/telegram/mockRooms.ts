/**
 * Shared room bookkeeping for MOCK_TELEGRAM=1.
 *
 * The join fake and the chat fake both need to agree on which rooms an account
 * is in and what chat id each one has — otherwise a mock "live" message could
 * never be matched back to a target, and the real-time collector would look
 * broken in mock mode when it is not.
 */

export const ROOM_TITLES = [
  "자유홍보방",
  "구인구직 소통방",
  "총판 광고방",
  "먹튀검증 공유",
  "코인 정보방",
  "부업 정보공유",
  "이벤트 알림방",
  "본사 공지채널",
  "맛집 추천방",
  "중고거래 소통방",
];

/** Deterministic hash so a given key always produces the same room. */
export function hash(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function pick<T>(arr: T[], seed: number): T {
  return arr[seed % arr.length];
}

/** The bare chat id of a room, matching what `resolve()` reports. */
export function mockChatId(key: string): string {
  return String(1000000 + (hash(key) % 900000));
}

/** The marked peer id a live update would carry for that room. */
export function mockPeerId(key: string): string {
  return `-100${mockChatId(key)}`;
}

export function mockRoomTitle(key: string): string {
  const seed = hash(key);
  return `${pick(ROOM_TITLES, seed)} ${(seed % 90) + 10}`;
}

/** Rooms the mock account has joined, keyed by account id. */
const joinedByAccount = new Map<string, Set<string>>();

export function joinedKeys(accountId: string): string[] {
  return [...(joinedByAccount.get(accountId) ?? [])];
}

export function isJoined(accountId: string, key: string): boolean {
  return joinedByAccount.get(accountId)?.has(key) ?? false;
}

export function markJoined(accountId: string, key: string): void {
  const set = joinedByAccount.get(accountId) ?? new Set<string>();
  set.add(key);
  joinedByAccount.set(accountId, set);
}
