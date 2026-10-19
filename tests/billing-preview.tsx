import { createRoot } from "react-dom/client";
import { useState } from "react";
import Billing, { type Invoice, type Contract } from "../src/Billing";
import Timeline from "../src/Timeline";
import "../src/style.css";
const customer = {
  id: "sample-customer",
  login_id: "sample-customer",
  customer_number: "SAMPLE-CUSTOMER",
  role: "customer" as const,
  active: true,
};
const properties = [
  {
    id: "sample-property",
    property_number: "SAMPLE-P1",
    customer_id: customer.id,
  },
];
const sampleContract: Contract = {
  id: "sample-contract",
  customer_id: customer.id,
  property_id: properties[0].id,
  item: "システム利用料",
  amount_yen: 500,
  billing_cycle: "monthly",
  starts_on: "2026-10-01",
  ends_on: null,
  effective_from: "2026-10-01",
  status: "active",
};
const lines = [
  {
    id: "sample-fixed",
    invoice_id: "sample-invoice",
    property_id: properties[0].id,
    property_number: "SAMPLE-P1",
    category: "subscription" as const,
    item: "システム利用料",
    amount_yen: 500,
    expense_id: null,
  },
  {
    id: "sample-cost",
    invoice_id: "sample-invoice",
    property_id: properties[0].id,
    property_number: "SAMPLE-P1",
    category: "expense" as const,
    item: "郵送代",
    amount_yen: 430,
    expense_id: "sample-expense",
  },
];
function Preview() {
  const [mode, setMode] = useState("admin");
  const [contracts, setContracts] = useState([sampleContract]);
  const [invoices, setInvoices] = useState<Invoice[]>([
    {
      id: "sample-invoice",
      customer_id: customer.id,
      period: "2026-10-01",
      status: "draft",
      published_at: null,
      created_at: "2026-10-19T00:00:00Z",
    },
  ]);
  const [message, setMessage] = useState("");
  return (
    <main className="content">
      <p>サンプル画面：Supabaseには接続せず、実データを保存しません。</p>
      <div className="user-actions">
        <button onClick={() => setMode("admin")}>管理者の確認画面</button>
        <button onClick={() => setMode("customer")}>顧客の確認画面</button>
      </div>
      <p role="status">{message}</p>
      {mode === "admin" ? (
        <Billing
          users={[customer]}
          properties={properties}
          contracts={contracts}
          invoices={invoices}
          lines={lines}
          expenses={[]}
          reports={[]}
          customerId={customer.id}
          onCustomer={() => {}}
          busy={false}
          onAction={async (action, data) => {
            setMessage(`${action}の入力を受け取りました`);
            if (action === "publish")
              setInvoices(
                invoices.map((invoice) => ({
                  ...invoice,
                  status: "published",
                  published_at: new Date().toISOString(),
                })),
              );
            if (action === "contract")
              setContracts([
                ...contracts,
                { ...data, id: "new-sample" } as Contract,
              ]);
            return true;
          }}
        />
      ) : (
        <Timeline
          properties={properties}
          profile={customer}
          selected={properties[0].id}
          reports={[]}
          requests={[]}
          messages={[]}
          busy={false}
          messagesReady={true}
          invoices={invoices}
          invoiceLines={lines}
          onPost={async () => false}
          onStatus={async () => {}}
        />
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
