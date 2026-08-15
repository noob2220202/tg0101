import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseKeywords, scoreLink, ScorePolicy } from "../src/lib/scoring";
import { estimateMinimumSeconds } from "../src/lib/jobOptions";
import { humanDuration, relativeTime } from "../src/lib/format";

const policy: ScorePolicy = {
  requiredKeywords: ["자유홍보방", "광고"],
  excludedKeywords: ["도박"],
  minMembers: 0,
  collectGroups: true,
  collectChannels: false,
  collectBots: false,
  collectUsers: false,
};

const base = {
  key: "someroom",
  entityType: "GROUP" as const,
  roomCount: 1,
  seenCount: 1,
  memberCount: 500,
  title: "테스트방",
  description: null,
  resolved: true,
};

describe("scoreLink", () => {
  it("excludes on a banned keyword regardless of other signals", () => {
    const result = scoreLink({ ...base, title: "도박 홍보방", roomCount: 50, seenCount: 900 }, policy);
    assert.equal(result.excluded, true);
    assert.equal(result.score, 0);
    assert.match(result.reason, /도박/);
  });

  it("excludes a resolved type the policy does not collect", () => {
    const result = scoreLink({ ...base, entityType: "CHANNEL" }, policy);
    assert.equal(result.excluded, true);
  });

  it("keeps unresolved links for review instead of dropping them", () => {
    const result = scoreLink({ ...base, entityType: "UNKNOWN", resolved: false }, policy);
    assert.equal(result.excluded, false);
    assert.match(result.reason, /미확인/);
  });

  it("excludes rooms under the member floor", () => {
    const result = scoreLink({ ...base, memberCount: 10 }, { ...policy, minMembers: 100 });
    assert.equal(result.excluded, true);
    assert.match(result.reason, /최소 100명/);
  });

  it("scores a widely advertised keyword match above a bare sighting", () => {
    const bare = scoreLink(base, policy);
    const promoted = scoreLink(
      { ...base, title: "자유홍보방 광고", roomCount: 6, seenCount: 40, memberCount: 4000 },
      policy,
    );
    assert.ok(promoted.score > bare.score, `${promoted.score} should exceed ${bare.score}`);
    assert.ok(promoted.score >= 70, `expected an auto-registerable score, got ${promoted.score}`);
  });

  it("never leaves the 0-100 range", () => {
    const huge = scoreLink({ ...base, title: "자유홍보방 광고", roomCount: 999, seenCount: 999999, memberCount: 99999 }, policy);
    assert.ok(huge.score <= 100 && huge.score >= 0);
  });

  it("reports exposure counts in the reason", () => {
    const result = scoreLink({ ...base, roomCount: 3, seenCount: 5 }, policy);
    assert.match(result.reason, /3개 방에서 발견/);
    assert.match(result.reason, /5회 노출/);
  });
});

describe("parseKeywords", () => {
  it("splits, trims and drops blanks", () => {
    assert.deepEqual(parseKeywords(" 광고 , 총판 ,, 토토 "), ["광고", "총판", "토토"]);
    assert.deepEqual(parseKeywords(""), []);
    assert.deepEqual(parseKeywords(null), []);
  });
});

describe("estimateMinimumSeconds", () => {
  it("rounds up to a whole minute", () => {
    // 50 rooms at 20s apart is 1000s, which the dialog reports as 17분.
    assert.equal(estimateMinimumSeconds(50, 20), 1020);
    assert.equal(humanDuration(estimateMinimumSeconds(50, 20)), "17분");
  });

  it("is zero for an empty selection", () => {
    assert.equal(estimateMinimumSeconds(0, 20), 0);
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-08-15T03:00:00Z");

  it("labels past and future on the same scale", () => {
    assert.equal(relativeTime(new Date("2026-08-15T02:55:00Z"), now), "5분 전");
    assert.equal(relativeTime(new Date("2026-08-15T10:00:00Z"), now), "7시간 후");
    assert.equal(relativeTime(new Date("2026-08-14T03:00:00Z"), now), "1일 전");
  });

  it("collapses near-now to 곧", () => {
    assert.equal(relativeTime(new Date("2026-08-15T03:00:10Z"), now), "곧");
  });

  it("handles missing values", () => {
    assert.equal(relativeTime(null, now), "-");
  });
});
