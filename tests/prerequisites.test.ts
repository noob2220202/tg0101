import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { detectPrerequisites } from "../src/lib/prerequisites";
import type { MessageLite } from "../src/lib/telegram/types";

function message(text: string, extra: Partial<MessageLite> = {}): MessageLite {
  return { id: 1, text, date: new Date("2026-01-01T00:00:00Z"), ...extra };
}

describe("detectPrerequisites", () => {
  it("recognises the common Korean phrasings", () => {
    for (const text of [
      "먼저 아래 채널에 가입하세요\nhttps://t.me/notice_room",
      "공지채널 구독 후 이용 가능합니다 @notice_room",
      "필수 가입: https://t.me/notice_room",
      "가입 후 채팅 가능합니다 https://t.me/notice_room",
    ]) {
      const found = detectPrerequisites([message(text)], "target_room");
      assert.ok(found, `not detected: ${text}`);
      assert.deepEqual(found.links.map((l) => l.key), ["notice_room"]);
    }
  });

  it("ignores ordinary cross-promotion with no requirement wording", () => {
    const messages = [message("우리 방 놀러오세요 https://t.me/other_room")];
    assert.equal(detectPrerequisites(messages, "target_room"), null);
  });

  it("does not treat a self-reference as a prerequisite", () => {
    const messages = [message("먼저 가입하세요 https://t.me/target_room")];
    assert.equal(detectPrerequisites(messages, "target_room"), null);
  });

  it("prefers a pinned notice over a later unpinned one", () => {
    const messages = [
      message("먼저 아래 채널에 가입하세요 https://t.me/from_plain", { id: 2 }),
      message("먼저 아래 채널에 가입하세요 https://t.me/from_pinned", { id: 3, pinned: true }),
    ];
    const found = detectPrerequisites(messages, "target_room");
    assert.deepEqual(found?.links.map((l) => l.key), ["from_pinned"]);
  });

  it("returns null when the notice names no room", () => {
    assert.equal(detectPrerequisites([message("먼저 가입하세요")], "target_room"), null);
  });
});
