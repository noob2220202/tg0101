import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizePeerId } from "../src/lib/peers";
import { hiddenUrlsOf } from "../src/lib/telegram/realChat";

describe("normalizePeerId", () => {
  it("matches the marked update form against a stored chat id", () => {
    assert.equal(normalizePeerId("-1001234567890"), "1234567890");
    assert.equal(normalizePeerId("1234567890"), "1234567890");
    // A legacy group is marked with a plain minus.
    assert.equal(normalizePeerId("-987654321"), "987654321");
  });

  it("returns null for anything that is not a peer", () => {
    for (const value of [null, undefined, "", "  ", "abc", "0"]) {
      assert.equal(normalizePeerId(value), null, `expected null for ${JSON.stringify(value)}`);
    }
  });
});

describe("hiddenUrlsOf", () => {
  it("collects hyperlinks, buttons and the link preview, without duplicates", () => {
    const message = {
      message: "여기 눌러서 입장",
      entities: [
        { className: "MessageEntityTextUrl", offset: 0, length: 2, url: "https://t.me/anchor_room" },
        { className: "MessageEntityBold", offset: 3, length: 2 },
      ],
      replyMarkup: {
        rows: [{ buttons: [{ url: "https://t.me/+ButtonHash1" }, { text: "취소" }] }],
      },
      media: { webpage: { url: "https://t.me/preview_room", displayUrl: "t.me/preview_room" } },
    };

    assert.deepEqual(hiddenUrlsOf(message), [
      "https://t.me/anchor_room",
      "https://t.me/+ButtonHash1",
      "https://t.me/preview_room",
      "t.me/preview_room",
    ]);
  });

  it("is empty for a plain message", () => {
    assert.deepEqual(hiddenUrlsOf({ message: "안녕하세요" }), []);
  });
});
