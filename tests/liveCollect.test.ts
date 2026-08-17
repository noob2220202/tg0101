import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { peerIdCandidates } from "../src/lib/services/liveCollect";

describe("peerIdCandidates", () => {
  it("strips the channel marker so a peer id matches Membership.chatId", () => {
    assert.deepEqual(peerIdCandidates("-1001234567890"), ["1234567890", "1001234567890"]);
  });

  it("strips the legacy group marker", () => {
    assert.deepEqual(peerIdCandidates("-987654321"), ["987654321"]);
  });

  it("leaves a user id alone", () => {
    assert.deepEqual(peerIdCandidates("1234567890"), ["1234567890"]);
  });

  it("keeps both readings of a group id that starts with 100", () => {
    // Could be channel 200300, or legacy group 100200300 — try each.
    assert.deepEqual(peerIdCandidates("-100200300"), ["200300", "100200300"]);
  });
});
