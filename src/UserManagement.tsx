import { useState, type FormEvent } from "react";
import type { Profile } from "./Timeline";
export type UserOperation =
  | {
      action: "create";
      login_id: string;
      password: string;
      role: Profile["role"];
    }
  | {
      action: "update";
      user_id: string;
      role: Profile["role"];
      active: boolean;
    }
  | { action: "password"; user_id: string; password: string }
  | { action: "delete"; user_id: string; confirmation: string };
const labels = { admin: "管理者", worker: "作業者", customer: "顧客" };
export default function UserManagement({
  users,
  currentUserId,
  busy,
  onSave,
  onContracts,
}: {
  users: Profile[];
  currentUserId: string;
  busy: boolean;
  onSave: (operation: UserOperation) => Promise<boolean>;
  onContracts?: (id: string) => void;
}) {
  const [selected, setSelected] = useState<Profile | null>(null),
    [mode, setMode] = useState<"edit" | "password" | "delete">("edit"),
    [showDeleted, setShowDeleted] = useState(true),
    [search, setSearch] = useState("");
  const visibleUsers = users.filter(
    (user) =>
      (showDeleted || !user.deleted_at) &&
      [
        user.login_id,
        user.customer_number,
        labels[user.role],
        user.deleted_at ? "削除済み" : user.active ? "利用中" : "停止中",
      ].some((value) =>
        value?.toLowerCase().includes(search.trim().toLowerCase()),
      ),
  );
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      data = new FormData(form);
    if (
      await onSave({
        action: "create",
        login_id: String(data.get("login_id")),
        password: String(data.get("password")),
        role: String(data.get("role")) as Profile["role"],
      })
    )
      form.reset();
  }
  async function edit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const data = new FormData(event.currentTarget);
    let operation: UserOperation;
    if (mode === "edit")
      operation = {
        action: "update",
        user_id: selected.id,
        role: String(data.get("role")) as Profile["role"],
        active: data.get("active") === "true",
      };
    else if (mode === "password")
      operation = {
        action: "password",
        user_id: selected.id,
        password: String(data.get("password")),
      };
    else
      operation = {
        action: "delete",
        user_id: selected.id,
        confirmation: String(data.get("confirmation")),
      };
    if (await onSave(operation)) setSelected(null);
  }
  return (
    <section className="user-management">
      <h2>ユーザー管理</h2>
      <p className="muted">
        氏名・住所は登録しません。ログインIDは変更・再利用できません。
      </p>
      <details className="panel">
        <summary>新しいユーザーを登録</summary>
        <form onSubmit={create}>
          <fieldset disabled={busy}>
            <div className="row">
              <label>
                ログインID
                <input
                  name="login_id"
                  maxLength={32}
                  pattern="[A-Za-z0-9][A-Za-z0-9_-]{0,31}"
                  autoCapitalize="none"
                  spellCheck={false}
                  autoComplete="off"
                  required
                />
              </label>
              <label>
                役割
                <select name="role" defaultValue="customer">
                  {Object.entries(labels).map(([role, label]) => (
                    <option value={role} key={role}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              初期パスワード
              <input
                name="password"
                type="password"
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                required
              />
            </label>
            <small>
              12～128文字。電話・書面で本人確認して案内してください。パスワードは一覧には表示しません。
            </small>
            <button>ユーザーを登録</button>
          </fieldset>
        </form>
      </details>
      <label>
        ユーザーを検索
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="ログインID・顧客番号・役割・状態"
        />
      </label>
      <p role="status">
        {visibleUsers.length}件 / 全{users.length}件
      </p>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={showDeleted}
          onChange={(event) => setShowDeleted(event.target.checked)}
        />
        削除済みも表示する
      </label>
      <div className="inbox-scroll">
        <table className="inbox-table">
          <caption className="sr-only">ユーザー一覧</caption>
          <thead>
            <tr>
              <th scope="col">ログインID</th>
              <th scope="col">顧客番号</th>
              <th scope="col">役割</th>
              <th scope="col">状態</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            {visibleUsers.map((user) => (
              <tr key={user.id}>
                <td>
                  {user.login_id}
                  {user.id === currentUserId && <small>ログイン中</small>}
                </td>
                <td>{user.customer_number || "—"}</td>
                <td>{labels[user.role]}</td>
                <td>
                  {user.deleted_at
                    ? "削除済み"
                    : user.active
                      ? "利用中"
                      : "停止中"}
                </td>
                <td>
                  <div className="user-actions">
                    {user.role === "customer" &&
                      user.active &&
                      !user.deleted_at &&
                      onContracts && (
                        <button
                          className="quiet"
                          type="button"
                          disabled={busy}
                          onClick={() => onContracts(user.id)}
                        >
                          契約・請求
                        </button>
                      )}
                    {(["edit", "password", "delete"] as const).map((action) => (
                      <button
                        type="button"
                        className="quiet"
                        key={action}
                        disabled={
                          busy ||
                          user.id === currentUserId ||
                          Boolean(user.deleted_at)
                        }
                        onClick={() => {
                          setSelected(user);
                          setMode(action);
                        }}
                      >
                        {action === "edit"
                          ? "編集"
                          : action === "password"
                            ? "パスワード再設定"
                            : "削除"}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!visibleUsers.length && (
        <p role="status">
          {search.trim()
            ? "該当するユーザーはいません。"
            : "表示するユーザーはいません。"}
        </p>
      )}
      {selected && (
        <section
          className="panel user-editor"
          key={`${selected.id}:${mode}`}
          aria-label={`${selected.login_id}の${mode === "edit" ? "編集" : mode === "password" ? "パスワード再設定" : "削除確認"}`}
        >
          <h3>
            {selected.login_id}：
            {mode === "edit"
              ? "ユーザー情報の編集"
              : mode === "password"
                ? "パスワード再設定"
                : "ユーザー削除"}
          </h3>
          <form onSubmit={edit}>
            <fieldset disabled={busy}>
              {mode === "edit" ? (
                <>
                  <label>
                    役割
                    <select name="role" defaultValue={selected.role}>
                      {Object.entries(labels).map(([role, label]) => (
                        <option value={role} key={role}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    利用状態
                    <select
                      name="active"
                      defaultValue={String(selected.active)}
                    >
                      <option value="true">利用中</option>
                      <option value="false">停止中</option>
                    </select>
                  </label>
                  <small>
                    契約物件が紐付いた顧客は、役割を変更できません。
                  </small>
                </>
              ) : mode === "password" ? (
                <>
                  <p>
                    電話・書面での本人確認後に設定してください。以前のログイン状態は無効になります。
                  </p>
                  <label>
                    新しいパスワード
                    <input
                      name="password"
                      type="password"
                      minLength={12}
                      maxLength={128}
                      autoComplete="new-password"
                      required
                    />
                  </label>
                </>
              ) : (
                <>
                  <p>
                    このユーザーをログイン不可にします。物件・作業報告・依頼などの履歴と登録IDは保持され、削除済みIDは再利用できません。この画面から復元はできません。
                  </p>
                  <label>
                    確認のためログインID「{selected.login_id}」を入力
                    <input name="confirmation" autoComplete="off" required />
                  </label>
                </>
              )}
              <div className="user-actions">
                <button>
                  {mode === "delete"
                    ? "削除してログインを停止"
                    : mode === "password"
                      ? "パスワードを再設定"
                      : "変更を保存"}
                </button>
                <button
                  type="button"
                  className="quiet"
                  onClick={() => setSelected(null)}
                >
                  キャンセル
                </button>
              </div>
            </fieldset>
          </form>
        </section>
      )}
    </section>
  );
}
