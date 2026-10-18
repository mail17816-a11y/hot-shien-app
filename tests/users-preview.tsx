import { createRoot } from "react-dom/client";
import { useState } from "react";
import UserManagement, { type UserOperation } from "../src/UserManagement";
import type { Profile } from "../src/Timeline";
import "../src/style.css";
function Preview() {
  const [users, setUsers] = useState<Profile[]>([
    {
      id: "admin",
      login_id: "admin",
      customer_number: null,
      role: "admin",
      active: true,
    },
    {
      id: "worker",
      login_id: "worker-a",
      customer_number: null,
      role: "worker",
      active: true,
    },
    {
      id: "customer",
      login_id: "customer-a",
      customer_number: "CUSTOMER-A",
      role: "customer",
      active: true,
    },
  ]);
  const [message, setMessage] = useState("");
  async function save(operation: UserOperation) {
    if (operation.action === "create") {
      setUsers((old) => [
        ...old,
        {
          id: crypto.randomUUID(),
          login_id: operation.login_id.toLowerCase(),
          customer_number:
            operation.role === "customer"
              ? operation.login_id.toUpperCase()
              : null,
          role: operation.role,
          active: true,
        },
      ]);
    } else if (operation.action === "update")
      setUsers((old) =>
        old.map((user) =>
          user.id === operation.user_id
            ? {
                ...user,
                role: operation.role,
                active: operation.active,
                customer_number:
                  operation.role === "customer"
                    ? user.login_id.toUpperCase()
                    : null,
              }
            : user,
        ),
      );
    else if (operation.action === "delete") {
      if (
        users.find((user) => user.id === operation.user_id)?.login_id !==
        operation.confirmation
      ) {
        setMessage("確認のログインIDが一致しません。");
        return false;
      }
      setUsers((old) =>
        old.map((user) =>
          user.id === operation.user_id
            ? { ...user, active: false, deleted_at: new Date().toISOString() }
            : user,
        ),
      );
    }
    setMessage(
      operation.action === "password"
        ? "パスワードを再設定しました。"
        : "保存しました。",
    );
    return true;
  }
  return (
    <main className="content">
      <small>
        表示確認用サンプル（Supabaseには接続せず、実データは保存しません）
      </small>
      <h1>物件・ユーザー管理</h1>
      {message && <p role="status">{message}</p>}
      <UserManagement
        users={users}
        currentUserId="admin"
        busy={false}
        onSave={save}
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
