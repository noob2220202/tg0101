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
      "https://t.me/+821012345678", // phone contact link, not an invite
      "https://t.me/addlist/AbCdEf123456", // folder invite, not one room
      "",
    ]) {
      assert.equal(parseLink(input), null, `expected null for ${JSON.stringify(input)}`);
    }
  });

  it("understands the app's own link forms", () => {
    assert.deepEqual(parseLink("tg://resolve?domain=SomeGroup"), {
      key: "somegroup",
      url: "https://t.me/somegroup",
      kind: "PUBLIC",
    });
    assert.deepEqual(parseLink("tg://join?invite=AbCdEf123456"), {
      key: "+AbCdEf123456",
      url: "https://t.me/+AbCdEf123456",
      kind: "PRIVATE",
    });
  });

  it("unwraps the web-preview form and percent-encoded invites", () => {
    assert.equal(parseLink("https://t.me/s/somegroup")?.key, "somegroup");
    assert.equal(parseLink("https://t.me/%2BAbCdEf123456")?.key, "+AbCdEf123456");
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

  it("reads the addresses a message hides outside its text", () => {
    const links = extractLinks("여기 눌러서 입장하세요 👇", [
      "https://t.me/hidden_room",
      "https://t.me/+ButtonHash123",
    ]);
    assert.deepEqual(
      links.map((link) => link.key),
      ["hidden_room", "+ButtonHash123"],
    );
  });

  it("digs a room out of a wrapper url and keeps text hits first", () => {
    const links = extractLinks("공지 @notice_room 참고", [
      "https://redirect.example.com/go?to=https%3A%2F%2Ft.me%2Fwrapped_room",
    ]);
    assert.deepEqual(
      links.map((link) => link.key),
      ["notice_room", "wrapped_room"],
    );
  });

  it("does not read an e-mail address as a room", () => {
    assert.deepEqual(extractLinks("문의는 admin@gmail.com 으로 주세요"), []);
  });

  it("still reads a mention that ends a sentence", () => {
    assert.deepEqual(
      extractLinks("입장은 @promo_room.").map((link) => link.key),
      ["promo_room"],
    );
  });

  it("deduplicates a room that appears both in the text and behind a button", () => {
    const links = extractLinks("https://t.me/same_room 입장", ["https://t.me/same_room"]);
    assert.deepEqual(
      links.map((link) => link.key),
      ["same_room"],
    );
  });
});
