import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTimeline } from "../src/feed.ts";
const row = (id, property_id, created_at) => ({ id, property_id, created_at });
test("報告・依頼・メッセージを登録日時順に並べ、最新を最後にする", () => {
  const reports = [
    { ...row("r", "a", "2026-10-06T04:00:00Z"), performed_on: "2026-09-01" },
  ];
  const requests = [row("q", "a", "2026-10-06T02:00:00Z")];
  const messages = [row("m", "a", "2026-10-06T03:00:00Z")];
  assert.deepEqual(
    buildTimeline(reports, requests, messages, "a").map((x) => x.type),
    ["request", "message", "report"],
  );
  assert.equal(reports[0].performed_on, "2026-09-01");
});
test("選択物件に絞り、全物件表示ではすべての種別を表示する", () => {
  const r = [row("r", "a", "2026-10-06T04:00:00Z")];
  const q = [row("q", "b", "2026-10-06T02:00:00Z")];
  const m = [row("m", "a", "2026-10-06T03:00:00Z")];
  assert.deepEqual(
    buildTimeline(r, q, m, "a").map((x) => x.data.id),
    ["m", "r"],
  );
  assert.equal(buildTimeline(r, q, m, "").length, 3);
});
test("同時刻でも入力の順序に依存せず安定して表示する", () => {
  const rows = [
    row("b", "a", "2026-10-06T04:00:00Z"),
    row("a", "a", "2026-10-06T04:00:00Z"),
  ];
  assert.deepEqual(
    buildTimeline([], [], rows, ""),
    buildTimeline([], [], [...rows].reverse(), ""),
  );
});
