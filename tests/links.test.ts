import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { extractLinks, parseLink } from "../src/lib/links";

describe("parseLink", () => {
  it("normalises the many ways a public room gets written", () => {
    for (const input of [
      "https://t.me/SomeGroup",
      "http://t.me/SomeGroup",
      "t.me/SomeGroup",
      "@SomeGroup",
      "SomeGroup",
      "https://telegram.me/SomeGroup",
      "https://t.me/SomeGroup/",
      "https://t.me/SomeGroup?start=1",
    ]) {
      assert.deepEqual(parseLink(input), {
        key: "somegroup",
        url: "https://t.me/somegroup",
        kind: "PUBLIC",
      });
    }
  });

  it("keeps invite hashes case-sensitive and accepts both invite forms", () => {
    const expected = { key: "+AbCdEf123456", url: "https://t.me/+AbCdEf123456", kind: "PRIVATE" };
    assert.deepEqual(parseLink("https://t.me/+AbCdEf123456"), expected);
    assert.deepEqual(parseLink("https://t.me/joinchat/AbCdEf123456"), expected);
  });

  it("rejects things that are not joinable rooms", () => {
    for (const input of [
      "https://t.me/somegroup/1234", // message permalink
      "https://t.me/joinchat", // no hash
      "https://example.com/somegroup", // wrong host
      "@ab", // too short for a username
      "https://t.me/addstickers/pack", // reserved path
      "https://t.me/c/123/456", // private message permalink
      "",
    ]) {
      assert.equal(parseLink(input), null, `expected null for ${JSON.stringify(input)}`);
    }
  });
});

describe("extractLinks", () => {
  it("pulls every distinct room out of a promo message, deduplicated", () => {
    const text = `홍보방 안내
      https://t.me/first_room 과 @second_room 을 확인하세요.
      https://t.me/first_room (중복)
      비공개: https://t.me/+SecretHash12`;

    assert.deepEqual(
      extractLinks(text).map((link) => link.key),
      ["first_room", "second_room", "+SecretHash12"],
    );
  });

  it("does not mistake a message permalink for a room", () => {
    assert.deepEqual(extractLinks("https://t.me/announcements/42 를 보세요"), []);
  });

  it("returns nothing for text with no links", () => {
    assert.deepEqual(extractLinks("안녕하세요 반갑습니다"), []);
  });
});
