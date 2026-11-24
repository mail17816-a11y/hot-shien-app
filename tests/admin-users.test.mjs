import { test } from "node:test";
import assert from "node:assert/strict";
import { createHandler } from "../supabase/functions/admin-users/handler.ts";
const actor = "00000000-0000-0000-0000-000000000001",
  target = "00000000-0000-0000-0000-000000000002";
const token = `e30.${Buffer.from(JSON.stringify({ iat: 2000000000 })).toString("base64url")}.signature`;
function fixture(options = {}) {
  const calls = [];
  const identifierChecks = [];
  const profiles = {
    [actor]: {
      id: actor,
      login_id: "admin",
      role: "admin",
      active: true,
      deleted_at: null,
      auth_valid_after: 0,
      ...options.actor,
    },
    [target]: {
      id: target,
      login_id: "customer",
      customer_number: "CUSTOMER",
      role: "customer",
      active: true,
      deleted_at: null,
      auth_valid_after: 0,
      ...options.target,
    },
  };
  const client = {
    auth: {
      getUser: async () =>
        options.invalidToken
          ? { error: {}, data: { user: null } }
          : { data: { user: { id: actor } } },
      admin: {
        createUser: async (body) => {
          calls.push(["create", body]);
          if (options.createError)
            return { data: { user: null }, error: options.createError };
          return { data: { user: { id: target } } };
        },
        updateUserById: async (id, body) => {
          calls.push(["auth-update", id, body]);
          return {
            data: { user: { id } },
            error: options.authFail ? {} : null,
          };
        },
        deleteUser: async (id) => {
          calls.push(["rollback", id]);
          return { error: null };
        },
      },
    },
    from: (table) => {
      let id;
      let filter;
      return {
        select() {
          return this;
        },
        eq(field, value) {
          if (field === "id") id = value;
          else filter = [table, field, value];
          return this;
        },
        single: async () => ({ data: profiles[id] }),
        maybeSingle: async () => {
          identifierChecks.push(filter);
          return (
            options.checkIdentifier?.(filter, identifierChecks.length) ?? {
              data: options.duplicate ? { id: target } : null,
            }
          );
        },
        order() {
          return this;
        },
        range: async () => ({ data: Object.values(profiles) }),
      };
    },
    rpc: async (name, args) => {
      calls.push(["rpc", name, args]);
      return options.rpcFail
        ? { error: { code: "42501", message: "管理者権限がありません" } }
        : {
            data: {
              ...profiles[target],
              role: args.p_role || profiles[target].role,
              active: args.p_delete ? false : (args.p_active ?? true),
              deleted_at: args.p_delete ? "2026-10-18T00:00:00Z" : null,
            },
          };
    },
  };
  const handle = createHandler(
    { url: "https://example.supabase.co", key: "server-only-secret" },
    () => client,
  );
  const request = (body, auth = true) =>
    handle(
      new Request("https://example.test/admin-users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(auth ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      }),
    );
  return { calls, identifierChecks, request };
}
test("未ログイン・不正JWT・作業者・停止済み・削除済み・失効JWTの管理操作を拒否する", async () => {
  const missing = fixture();
  assert.equal((await missing.request({ action: "list" }, false)).status, 401);
  for (const options of [
    { invalidToken: true },
    { actor: { role: "worker" } },
    { actor: { active: false } },
    { actor: { deleted_at: "2026-10-18" } },
    { actor: { auth_valid_after: 2000000000 } },
  ]) {
    const f = fixture(options);
    assert.ok(
      [401, 403].includes((await f.request({ action: "create" })).status),
    );
    assert.equal(f.calls.length, 0);
  }
});
test("確認済みの内部メールで作成し、初期処理完了までは認証を停止する", async () => {
  const f = fixture();
  const response = await f.request({
    action: "create",
    login_id: "C000001",
    password: "Long-Password-123",
    role: "worker",
  });
  assert.equal(response.status, 201);
  assert.equal(f.calls[0][1].email, "c000001@example.com");
  assert.equal(f.calls[0][1].email_confirm, true);
  assert.equal(f.calls[0][1].ban_duration, "876000h");
  assert.equal(f.calls[1][2].p_role, "worker");
  assert.equal(f.calls[2][2].ban_duration, "none");
  assert.ok(!(await response.text()).includes("Long-Password"));
});
test("使用済みの候補を引き直し、番号の種類に応じた列で照合する", async (t) => {
  const bytes = [0, 1, 2, 0, 8, 3, 25, 24, 23, 4, 7, 2];
  for (const [kind, table, column, first, next] of [
    ["user", "profiles", "login_id", "UABC083", "UZYX472"],
    ["property", "properties", "property_number", "PABC083", "PZYX472"],
  ]) {
    let index = 0;
    const mock = t.mock.method(crypto, "getRandomValues", (buffer) => {
      buffer[0] = bytes[index++];
      return buffer;
    });
    const f = fixture({
      checkIdentifier: (_filter, count) => ({
        data: count === 1 ? { id: target, deleted_at: "2026-10-18" } : null,
      }),
    });
    const response = await f.request({ action: "suggest_identifier", kind });
    mock.mock.restore();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { identifier: next });
    assert.deepEqual(
      f.identifierChecks,
      [first, next].map((number) => [
        table,
        column,
        kind === "user" ? number.toLowerCase() : number,
      ]),
    );
    assert.deepEqual(f.calls, []);
  }
});
test("管理者以外や照合に失敗した場合には候補を返さない", async () => {
  const operation = { action: "suggest_identifier", kind: "property" };
  const worker = fixture({ actor: { role: "worker" } });
  assert.equal((await worker.request(operation)).status, 403);
  assert.equal(worker.identifierChecks.length, 0);
  const unavailable = fixture({
    checkIdentifier: () => ({ data: null, error: { code: "offline" } }),
  });
  const response = await unavailable.request(operation);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).identifier, undefined);
});
test("照合後にログインIDが作成済みになった場合は重複として返す", async () => {
  const f = fixture({ createError: { code: "email_exists" } });
  const response = await f.request({
    action: "create",
    login_id: "UKMX472",
    password: "Long-Password-123",
    role: "customer",
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "duplicate_identifier");
  assert.deepEqual(f.identifierChecks, [["profiles", "login_id", "ukmx472"]]);
  assert.deepEqual(
    f.calls.map(([action]) => action),
    ["create"],
  );
});
test("氏名などの余分な項目、短いパスワード、重複IDを拒否する", async () => {
  const input = {
    action: "create",
    login_id: "customer",
    password: "Long-Password-123",
    role: "customer",
  };
  for (const extra of [
    { name: "保存しない氏名" },
    { password: "short" },
    { login_id: "someone@other.test" },
  ]) {
    const f = fixture();
    assert.equal((await f.request({ ...input, ...extra })).status, 400);
    assert.equal(f.calls.length, 0);
  }
  const duplicate = fixture({ duplicate: true });
  assert.equal((await duplicate.request(input)).status, 409);
  assert.equal(duplicate.calls.length, 0);
});
test("役割設定が失敗した作成途中アカウントをロールバックする", async () => {
  const f = fixture({ rpcFail: true });
  assert.equal(
    (
      await f.request({
        action: "create",
        login_id: "worker-b",
        password: "Long-Password-123",
        role: "worker",
      })
    ).status,
    403,
  );
  assert.equal(f.calls.at(-1)[0], "rollback");
});
test("自己変更と確認ID不一致の削除を拒否し、削除は履歴を残して認証を停止する", async () => {
  const f = fixture();
  assert.equal(
    (
      await f.request({
        action: "delete",
        user_id: actor,
        confirmation: "admin",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await f.request({
        action: "delete",
        user_id: target,
        confirmation: "wrong",
      })
    ).status,
    400,
  );
  assert.equal(f.calls.length, 0);
  assert.equal(
    (
      await f.request({
        action: "delete",
        user_id: target,
        confirmation: "customer",
      })
    ).status,
    200,
  );
  assert.equal(f.calls[0][2].p_delete, true);
  assert.equal(f.calls[1][2].ban_duration, "876000h");
  assert.ok(!f.calls.some((call) => call[0] === "rollback"));
});
test("パスワード変更前に旧JWTを無効化し、削除済みユーザーを復元しない", async () => {
  const f = fixture();
  assert.equal(
    (
      await f.request({
        action: "password",
        user_id: target,
        password: "New-Password-123",
      })
    ).status,
    200,
  );
  assert.equal(f.calls[0][2].p_reset, true);
  assert.equal(f.calls[1][2].password, "New-Password-123");
  const deleted = fixture({ target: { deleted_at: "2026-10-18" } });
  assert.equal(
    (
      await deleted.request({
        action: "update",
        user_id: target,
        role: "customer",
        active: true,
      })
    ).status,
    409,
  );
  assert.equal(deleted.calls.length, 0);
});
