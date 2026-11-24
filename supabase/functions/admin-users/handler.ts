import { createClient, type SupabaseClient } from "@supabase/supabase-js";
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
  "Content-Type": "application/json",
};
const roles = ["customer", "worker", "admin"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fields =
  "id,login_id,customer_number,role,active,deleted_at,auth_valid_after";
const actionFields = new Map<string, string[]>([
  ["list", ["action"]],
  ["create", ["action", "login_id", "password", "role"]],
  ["update", ["action", "user_id", "role", "active"]],
  ["password", ["action", "user_id", "password"]],
  ["delete", ["action", "user_id", "confirmation"]],
  ["suggest_identifier", ["action", "kind"]],
]);
class HttpError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
function duplicateLoginId() {
  return new HttpError(
    409,
    "使用済みのログインIDです。削除済みIDも再利用できません。",
    "duplicate_identifier",
  );
}
function randomCharacters(alphabet: string) {
  const byte = new Uint8Array(1);
  const limit = 256 - (256 % alphabet.length);
  let result = "";
  while (result.length < 3) {
    crypto.getRandomValues(byte);
    if (byte[0] < limit) result += alphabet[byte[0] % alphabet.length];
  }
  return result;
}
async function identifierExists(
  admin: SupabaseClient,
  kind: "user" | "property",
  identifier: string,
) {
  const result = await (
    kind === "user"
      ? admin
          .from("profiles")
          .select("id")
          .eq("login_id", identifier.toLowerCase())
      : admin.from("properties").select("id").eq("property_number", identifier)
  ).maybeSingle();
  if (result.error)
    throw new HttpError(
      503,
      kind === "user"
        ? "ログインIDを確認できません。"
        : "物件番号を確認できません。",
    );
  return result.data !== null;
}
function reply(status: number, data: unknown) {
  return new Response(JSON.stringify(data), { status, headers });
}
function password(value: unknown) {
  if (typeof value !== "string" || value.length < 12 || value.length > 128)
    throw new HttpError(400, "パスワードは12～128文字で指定してください。");
  return value;
}
export function issuedAt(token: string) {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const data = JSON.parse(
      atob(part.padEnd(Math.ceil(part.length / 4) * 4, "=")),
    );
    if (!Number.isSafeInteger(data.iat) || data.iat < 1) throw new Error();
    return data.iat as number;
  } catch {
    throw new HttpError(401, "ログインし直してください。");
  }
}
export function createHandler(
  env: { url: string; key: string },
  factory: () => SupabaseClient = () =>
    createClient(env.url, env.key, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
) {
  return async (req: Request) => {
    if (req.method === "OPTIONS")
      return new Response(null, { status: 204, headers });
    if (req.method !== "POST")
      return reply(405, { error: "POSTを使用してください。" });
    try {
      const token = req.headers
        .get("authorization")
        ?.match(/^Bearer (\S+)$/i)?.[1];
      if (!token) throw new HttpError(401, "ログインしてください。");
      if (!env.url || !env.key)
        throw new HttpError(503, "管理機能のサーバー設定がありません。");
      const admin = factory();
      // getUserが署名とユーザーの有効性を検証した後だけ、JWTの発行時刻を参照する。
      const user = await admin.auth.getUser(token);
      if (user.error || !user.data.user)
        throw new HttpError(401, "ログインし直してください。");
      const iat = issuedAt(token),
        actorId = user.data.user.id;
      const actor = await admin
        .from("profiles")
        .select(fields)
        .eq("id", actorId)
        .single();
      if (actor.error)
        throw new HttpError(
          503,
          "管理機能の追加SQLが未適用か、接続に失敗しています。",
        );
      if (
        actor.data.role !== "admin" ||
        !actor.data.active ||
        actor.data.deleted_at ||
        iat <= actor.data.auth_valid_after
      )
        throw new HttpError(
          403,
          "有効な管理者アカウントでログインしてください。",
        );
      const raw = await req.text();
      if (raw.length > 8192)
        throw new HttpError(413, "リクエストが大きすぎます。");
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(raw);
        if (!body || Array.isArray(body) || typeof body !== "object")
          throw new Error();
      } catch {
        throw new HttpError(400, "入力形式が不正です。");
      }
      const action = body.action;
      const allowed = typeof action === "string" && actionFields.get(action);
      if (!allowed) throw new HttpError(400, "操作が不正です。");
      if (Object.keys(body).some((key) => !allowed.includes(key)))
        throw new HttpError(400, "許可されていない項目があります。");
      if (action === "suggest_identifier") {
        const kind = body.kind;
        if (kind !== "user" && kind !== "property")
          throw new HttpError(400, "番号の種類を指定してください。");
        const prefix = kind === "user" ? "U" : "P";
        for (let attempt = 0; attempt < 16; attempt++) {
          const identifier =
            prefix +
            randomCharacters("ABCDEFGHIJKLMNOPQRSTUVWXYZ") +
            randomCharacters("0123456789");
          if (!(await identifierExists(admin, kind, identifier)))
            return reply(200, { identifier });
        }
        throw new HttpError(
          503,
          "空いている番号を提案できませんでした。再度お試しください。",
        );
      }
      async function manage(
        targetId: string,
        options: Record<string, unknown> = {},
      ) {
        const result = await admin.rpc("admin_manage_user", {
          p_actor_id: actorId,
          p_issued_at: iat,
          p_target_id: targetId,
          ...options,
        });
        if (result.error)
          throw new HttpError(
            result.error.code === "42501" ? 403 : 409,
            result.error.message,
          );
        return result.data;
      }
      if (action === "list") {
        // PostgRESTの1ページ上限に依存せず、全アカウントを取得。
        const rows: unknown[] = [];
        for (let offset = 0; ; offset += 500) {
          const result = await admin
            .from("profiles")
            .select(fields)
            .order("id")
            .range(offset, offset + 499);
          if (result.error)
            throw new HttpError(503, "ユーザー一覧を取得できません。");
          rows.push(...result.data);
          if (result.data.length < 500) break;
        }
        return reply(200, { users: rows });
      }
      if (action === "create") {
        if (typeof body.login_id !== "string")
          throw new HttpError(400, "ログインIDを入力してください。");
        const id = body.login_id.trim().toLowerCase();
        if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(id))
          throw new HttpError(
            400,
            "ログインIDは32文字以内の半角英数字・ハイフン・アンダースコアです。",
          );
        if (!roles.includes(String(body.role)))
          throw new HttpError(400, "役割を選択してください。");
        const secret = password(body.password);
        if (await identifierExists(admin, "user", id)) throw duplicateLoginId();
        const created = await admin.auth.admin.createUser({
          email: `${id}@example.com`,
          password: secret,
          email_confirm: true,
          ban_duration: "876000h",
        });
        if (created.error || !created.data.user) {
          if (
            created.error?.code === "email_exists" ||
            created.error?.code === "user_already_exists" ||
            (await identifierExists(admin, "user", id))
          )
            throw duplicateLoginId();
          throw new HttpError(
            409,
            "ユーザーを作成できません。ログインIDの重複やパスワード条件を確認してください。",
          );
        }
        const targetId = created.data.user.id;
        try {
          const profile = await manage(targetId, {
            p_role: body.role,
            p_active: true,
          });
          const enabled = await admin.auth.admin.updateUserById(targetId, {
            ban_duration: "none",
          });
          if (enabled.error)
            throw new HttpError(502, "認証の有効化に失敗しました。");
          return reply(201, { user: profile });
        } catch (error) {
          const cleanup = await admin.auth.admin.deleteUser(targetId);
          if (cleanup.error)
            console.error("admin-users: create rollback failed", targetId);
          throw error;
        }
      }
      if (typeof body.user_id !== "string" || !uuid.test(body.user_id))
        throw new HttpError(400, "ユーザーIDが不正です。");
      if (body.user_id === actorId)
        throw new HttpError(409, "自分自身の変更・削除はできません。");
      const target = await admin
        .from("profiles")
        .select(fields)
        .eq("id", body.user_id)
        .single();
      if (target.error) throw new HttpError(404, "ユーザーが見つかりません。");
      if (target.data.deleted_at && action !== "delete")
        throw new HttpError(409, "削除済みのユーザーは変更できません。");
      if (action === "password") {
        const secret = password(body.password);
        await manage(body.user_id, { p_reset: true });
        const result = await admin.auth.admin.updateUserById(body.user_id, {
          password: secret,
        });
        if (result.error)
          throw new HttpError(
            502,
            "パスワードを変更できませんでした。条件を確認して再実行してください。",
          );
        return reply(200, { ok: true });
      }
      let updated;
      if (action === "delete") {
        if (body.confirmation !== target.data.login_id)
          throw new HttpError(400, "削除確認のログインIDが一致しません。");
        updated = await manage(body.user_id, { p_delete: true });
      } else {
        if (
          !roles.includes(String(body.role)) ||
          typeof body.active !== "boolean"
        )
          throw new HttpError(400, "役割と利用状態を指定してください。");
        updated = await manage(body.user_id, {
          p_role: body.role,
          p_active: body.active,
        });
      }
      const ban = await admin.auth.admin.updateUserById(body.user_id, {
        ban_duration:
          updated.active && !updated.deleted_at ? "none" : "876000h",
      });
      if (ban.error)
        throw new HttpError(
          502,
          "DBの状態は保存しましたが、認証側への反映に失敗しました。同じ操作を再実行してください。",
        );
      return reply(200, { user: updated });
    } catch (error) {
      if (error instanceof HttpError)
        return reply(error.status, { error: error.message, code: error.code });
      console.error("admin-users: unexpected failure");
      return reply(500, { error: "管理操作に失敗しました。" });
    }
  };
}
