import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInbox } from "../src/feed.ts";
const row = (id, property_id, created_at) => ({ id, property_id, created_at });
test("全物件の依頼と顧客投稿を新着順でまとめ、作業者の返信は除く", () => {
  const requests = [
    row("request-a", "a", "2026-10-06T02:00:00Z"),
    row("request-b", "b", "2026-10-06T04:00:00Z"),
  ];
  const messages = [
    {
      ...row("inquiry", "a", "2026-10-06T03:00:00Z"),
      author_role: "customer",
      kind: "お問い合わせ",
    },
    {
      ...row("message", "b", "2026-10-06T05:00:00Z"),
      author_role: "customer",
      kind: "その他メッセージ",
    },
    { ...row("reply", "b", "2026-10-06T06:00:00Z"), author_role: "worker" },
    { ...row("admin", "a", "2026-10-06T07:00:00Z"), author_role: "admin" },
  ];
  assert.deepEqual(
    buildInbox(requests, messages).map((entry) => entry.data.id),
    ["message", "request-b", "inquiry", "request-a"],
  );
  assert.equal(requests[0].id, "request-a");
});
