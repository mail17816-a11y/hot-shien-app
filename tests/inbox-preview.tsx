import { createRoot } from "react-dom/client";
import { useState } from "react";
import RequestInbox from "../src/RequestInbox";
import type { WorkRequest, Message, Profile } from "../src/Timeline";
import "../src/style.css";
function Preview() {
  const [opened, setOpened] = useState("");
  const [requests, setRequests] = useState<WorkRequest[]>([
    {
      id: "q",
      property_id: "a",
      customer_id: "a",
      kind: "除草・清掃",
      body: "玄関前の除草をお願いします。",
      status: "受付待ち",
      created_at: "2026-10-06T03:00:00Z",
    },
  ]);
  const messages: Message[] = [
    {
      id: "m1",
      property_id: "b",
      author_id: "b",

      author_role: "customer",
      kind: "お問い合わせ",
      body: "次回の巡回予定を教えていただけますか？",
      created_at: "2026-10-06T04:00:00Z",
    },
    {
      id: "m2",
      property_id: "a",
      author_id: "a",

      author_role: "customer",
      kind: "その他メッセージ",
      body: "今週末に現地へ伺う予定です。",
      created_at: "2026-10-06T02:00:00Z",
    },
    {
      id: "m3",
      property_id: "b",
      author_id: "w",

      author_role: "worker",
      kind: "その他メッセージ",
      body: "スタッフの返信（受付一覧には表示しません）",
      created_at: "2026-10-06T05:00:00Z",
    },
  ];
  const people: Profile[] = [
    {
      id: "a",
      login_id: "c000001",
      customer_number: "C000001",
      role: "customer",
      active: true,
    },
    {
      id: "b",
      login_id: "c000002",
      customer_number: "C000002",
      role: "customer",
      active: true,
    },
  ];
  return (
    <main className="content">
      <small>表示確認用のサンプル・実データは保存しません</small>
      <h1>作業・問い合わせ受付</h1>
      {opened && (
        <p role="status">
          物件{opened.toUpperCase()}のコミュニケーションを開きました。
        </p>
      )}
      <RequestInbox
        requests={requests}
        messages={messages}
        properties={[
          { id: "a", property_number: "P000001", customer_id: "a" },
          { id: "b", property_number: "P000002", customer_id: "b" },
        ]}
        people={people}
        busy={false}
        messagesReady={true}
        onStatus={async (id, status) =>
          setRequests((old) =>
            old.map((row) => (row.id === id ? { ...row, status } : row)),
          )
        }
        onOpen={setOpened}
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
