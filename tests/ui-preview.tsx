// 開発サーバー専用の表示確認。認証・DB・Storageには接続しません。
import { createRoot } from "react-dom/client";
import { useState } from "react";
import Timeline, {
  type Message,
  type WorkRequest,
  type Profile,
} from "../src/Timeline";
import "../src/style.css";
const property = {
  id: "a",
  property_number: "P000001",
  customer_id: "customer",
};
function Preview() {
  const [role, setRole] = useState<Profile["role"]>("customer");
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "m1",
      property_id: "a",
      author_id: "customer",
      author_role: "customer",

      kind: "お問い合わせ",
      body: "玄関前の雑草の様子を教えていただけますか？",
      created_at: "2026-10-06T02:00:00Z",
    },
    {
      id: "m2",
      property_id: "a",
      author_id: "worker",
      author_role: "worker",

      kind: "その他メッセージ",
      body: "次回の巡回時に確認して、写真でご報告します。",
      created_at: "2026-10-06T03:00:00Z",
    },
  ]);
  const [requests, setRequests] = useState<WorkRequest[]>([
    {
      id: "q1",
      property_id: "a",
      customer_id: "customer",
      kind: "除草・清掃",
      body: "玄関前の除草をお願いします。",
      status: "受付済み",
      created_at: "2026-10-06T04:00:00Z",
    },
  ]);
  const profile: Profile = {
    id: role,
    login_id: role,
    customer_number: role === "customer" ? "C000001" : null,
    role,
    active: true,
  };
  return (
    <main className="content">
      <p>表示確認用のサンプル（実データは保存しません）</p>
      <label>
        表示する役割
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as Profile["role"])}
        >
          <option value="customer">顧客</option>
          <option value="worker">作業者</option>
        </select>
      </label>
      <Timeline
        key={role}
        reports={[
          {
            id: "r1",
            property_id: "a",
            author_id: "worker",
            kind: "定期巡回",
            body: "外構と郵便受けを確認しました。異常はありません。",
            performed_on: "2026-10-05",
            created_at: "2026-10-06T01:00:00Z",
            photo_paths: [],
          },
        ]}
        requests={requests}
        messages={messages}
        properties={[property]}
        selected="a"
        profile={profile}
        busy={false}
        messagesReady={true}
        onPost={async (post) => {
          if (!post.body) return false;
          const id = crypto.randomUUID();
          if (post.kind === "作業依頼")
            setRequests((old) => [
              ...old,
              {
                id,
                property_id: "a",
                customer_id: "customer",
                kind: post.workKind,
                body: post.body,
                status: "受付待ち",
                created_at: new Date().toISOString(),
              },
            ]);
          else
            setMessages((old) => [
              ...old,
              {
                id,
                property_id: "a",
                author_id: role,

                author_role: role,
                kind: post.kind,
                body: post.body,
                created_at: new Date().toISOString(),
              },
            ]);
          return true;
        }}
        onStatus={async (id, status) =>
          setRequests((old) =>
            old.map((r) => (r.id === id ? { ...r, status } : r)),
          )
        }
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
