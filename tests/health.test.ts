import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { riskLabel, scoreHealth } from "../src/lib/health";
import { compileRule, matchRules } from "../src/lib/keywords";

const healthy = {
  joinIntervalSec: 30,
  joins24h: 5,
  failures24h: 0,
  floodWaits24h: 0,
  spamStatus: "OK",
  accountAgeDays: 120,
};

describe("scoreHealth", () => {
  it("gives a well-behaved account a low score", () => {
    const result = scoreHealth(healthy);
    assert.ok(result.score < 35, `expected a calm score, got ${result.score}`);
    assert.equal(riskLabel(result.score).tone, "ok");
  });

  it("treats an actual spam limit as maximal, whatever else is true", () => {
    const result = scoreHealth({ ...healthy, spamStatus: "LIMITED" });
    assert.equal(result.score, 100);
    assert.match(result.reason, /사용을 중지/);
  });

  it("escalates on the things that precede a limit", () => {
    const aggressive = scoreHealth({
      ...healthy,
      joinIntervalSec: 5,
      joins24h: 150,
      floodWaits24h: 4,
      accountAgeDays: 2,
      spamStatus: "OK",
    });
    assert.ok(aggressive.score >= 70, `expected a danger score, got ${aggressive.score}`);
    assert.equal(riskLabel(aggressive.score).tone, "bad");
    assert.match(aggressive.reason, /간격 5초/);
    assert.match(aggressive.reason, /신규 계정/);
  });

  it("never leaves the 0-100 range", () => {
    const extreme = scoreHealth({
      joinIntervalSec: 1,
      joins24h: 99999,
      failures24h: 9999,
      floodWaits24h: 999,
      spamStatus: "UNKNOWN",
      accountAgeDays: 0,
    });
    assert.ok(extreme.score <= 100 && extreme.score >= 0);
  });

  it("says so when there is nothing to report", () => {
    assert.equal(scoreHealth(healthy).reason, "위험 신호 없음");
  });
});

describe("matchRules", () => {
  const rules = [
    compileRule({ id: "1", name: "구인", terms: "구인, 구직", accountId: null }),
    compileRule({ id: "2", name: "총판", terms: "총판", accountId: "acc-1" }),
  ];

  it("matches inside a Korean compound, where word boundaries do not apply", () => {
    const hits = matchRules("구인구직 안내드립니다", "acc-2", rules);
    assert.deepEqual(hits.map((r) => r.name), ["구인"]);
  });

  it("honours an account-scoped rule", () => {
    assert.equal(matchRules("총판 문의", "acc-2", rules).length, 0);
    assert.deepEqual(
      matchRules("총판 문의", "acc-1", rules).map((r) => r.name),
      ["총판"],
    );
  });

  it("is case-insensitive for latin terms", () => {
    const latin = [compileRule({ id: "3", name: "otc", terms: "OTC", accountId: null })];
    assert.equal(matchRules("otc 거래 하실 분", "acc-1", latin).length, 1);
  });

  it("returns nothing for empty text or no match", () => {
    assert.deepEqual(matchRules("", "acc-1", rules), []);
    assert.deepEqual(matchRules("오늘 날씨 좋네요", "acc-1", rules), []);
  });
});
