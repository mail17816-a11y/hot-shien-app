// 003適用前に実行。Node.js 24以上。秘密キーは環境変数で指定し、Gitに含めない。
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { loginEmail, normalizeLoginId } from "../src/login.ts";
const args = process.argv.slice(2),
  file = args.find((arg) => !arg.startsWith("--"));
if (!file)
  throw new Error(
    "Usage: node scripts/set-login-identifiers.mjs mapping.json [--apply]",
  );
const mapping = JSON.parse(await readFile(file, "utf8"));
if (!Array.isArray(mapping) || !mapping.length)
  throw new Error("UUIDとlogin_idの対応表が必要です");
const ids = new Set(),
  logins = new Set();
for (const row of mapping) {
  if (
    typeof row.user_id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      row.user_id,
    )
  )
    throw new Error("user_idには既存ユーザーのUUIDを指定してください");
  row.login_id = normalizeLoginId(row.login_id);
  if (ids.has(row.user_id) || logins.has(row.login_id))
    throw new Error("UUIDまたはログインIDが重複しています");
  ids.add(row.user_id);
  logins.add(row.login_id);
}
if (!args.includes("--apply")) {
  for (const row of mapping)
    console.log(`${row.user_id}: ${loginEmail(row.login_id)}`);
  console.log("確認のみ。変更する場合は --apply を指定します。");
} else {
  const url = process.env.SUPABASE_URL,
    key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key)
    throw new Error("SUPABASE_URLとSUPABASE_SECRET_KEYが必要です");
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  for (const row of mapping) {
    const { error } = await admin.auth.admin.updateUserById(row.user_id, {
      email: loginEmail(row.login_id),
      email_confirm: true,
    });
    if (error)
      throw new Error(`ユーザー ${row.user_id} の変更に失敗: ${error.message}`);
    console.log(`更新済み: ${row.user_id} / ${row.login_id}`);
  }
}
