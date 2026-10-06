import { test } from "node:test";
import assert from "node:assert/strict";
import { loginEmail, normalizePropertyNumber } from "../src/login.ts";
test("ログインIDを正規化し内部メールをexample.comに限定する", () => {
  assert.equal(loginEmail(" C000001 "), "c000001@example.com");
  assert.equal(loginEmail("WORKER-a_1"), "worker-a_1@example.com");
  for (const id of [
    "person@gmail.com",
    "a+b",
    "顧客001",
    "-worker",
    "a b",
    "",
    "a".repeat(33),
  ])
    assert.throws(() => loginEmail(id));
});
test("物件番号を固定の採番形式にせず半角の識別子として扱う", () => {
  assert.equal(normalizePropertyNumber(" house_42 "), "HOUSE_42");
  assert.equal(normalizePropertyNumber("42-AB"), "42-AB");
  for (const value of ["", "住所付き 001", "a@b", "a".repeat(65)])
    assert.throws(() => normalizePropertyNumber(value));
});
