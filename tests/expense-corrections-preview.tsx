// 架空データだけの画面確認。Supabaseには接続しません。
import { useState } from "react";
import { createRoot } from "react-dom/client";
import ExpenseManagement, { type Expense } from "../src/Expenses";
import Timeline, { type Profile, type Report } from "../src/Timeline";
import { InvoiceDetails, type InvoiceLine } from "../src/Billing";
import type {
  ExpenseCorrection,
  InvoiceLineCorrection,
} from "../src/ExpenseCorrectionHistory";
import "../src/style.css";
const customer: Profile = {
  id: "sample-customer",
  login_id: "sample-customer",
  customer_number: "SAMPLE-C1",
  role: "customer",
  active: true,
};
const properties = [
  {
    id: "sample-property",
    property_number: "SAMPLE-P1",
    customer_id: customer.id,
  },
];
const reports: Report[] = [
  {
    id: "sample-report",
    property_id: properties[0].id,
    author_id: "sample-worker",
    kind: "定期巡回",
    body: "外周の点検を実施しました。",
    performed_on: "2026-10-20",
    created_at: "2026-10-20T01:00:00Z",
    photo_paths: [],
  },
];
const invoice = {
  id: "sample-invoice",
  customer_id: customer.id,
  period: "2026-10-01",
  status: "published" as const,
  published_at: "2026-10-20T02:00:00Z",
  created_at: "2026-10-20T02:00:00Z",
};
function Preview() {
  const [mode, setMode] = useState("admin");
  const [expenses, setExpenses] = useState<Expense[]>([
    {
      id: "sample-expense",
      report_id: reports[0].id,
      item: "郵送代",
      amount_yen: 430,
      billed_at: invoice.created_at,
      created_at: reports[0].created_at,
    },
  ]);
  const [lines, setLines] = useState<InvoiceLine[]>([
    {
      id: "sample-line",
      invoice_id: invoice.id,
      property_id: properties[0].id,
      property_number: properties[0].property_number,
      category: "expense",
      item: "郵送代",
      amount_yen: 430,
      expense_id: "sample-expense",
    },
  ]);
  const [corrections, setCorrections] = useState<ExpenseCorrection[]>([]);
  const [invoiceCorrections, setInvoiceCorrections] = useState<
    InvoiceLineCorrection[]
  >([]);
  const [focus, setFocus] = useState("");
  return (
    <main className="content">
      <p>表示確認用：架空データのみ。Supabaseには接続しません。</p>
      <div className="user-actions">
        <button onClick={() => setMode("admin")}>管理者の確認画面</button>
        <button onClick={() => setMode("customer")}>顧客の確認画面</button>
      </div>
      {mode === "admin" ? (
        <>
          <ExpenseManagement
            expenses={expenses}
            reports={reports}
            properties={properties}
            busy={false}
            onSave={async (expense, item, amount, reason) => {
              const row: ExpenseCorrection = {
                id: `sample-correction-${corrections.length}`,
                created_at: new Date().toISOString(),
                expense_id: expense.id,
                report_id: expense.report_id,
                property_id: properties[0].id,
                actor_id: "sample-admin",
                reason,
                old_item: expense.item,
                new_item: item,
                old_amount_yen: expense.amount_yen,
                new_amount_yen: amount,
              };
              setCorrections((previous) => [...previous, row]);
              setInvoiceCorrections((previous) => [
                ...previous,
                {
                  ...row,
                  invoice_id: invoice.id,
                  expense_correction_id: row.id,
                },
              ]);
              setExpenses((previous) =>
                previous.map((old) =>
                  old.id === expense.id
                    ? { ...old, item, amount_yen: amount }
                    : old,
                ),
              );
              setLines((previous) =>
                previous.map((old) =>
                  old.expense_id === expense.id
                    ? { ...old, item, amount_yen: amount }
                    : old,
                ),
              );
              return true;
            }}
          />
          <InvoiceDetails
            invoice={invoice}
            lines={lines}
            corrections={invoiceCorrections}
          />
        </>
      ) : (
        <Timeline
          profile={customer}
          properties={properties}
          selected={properties[0].id}
          reports={reports}
          requests={[]}
          messages={[]}
          invoices={[invoice]}
          invoiceLines={lines}
          expenses={expenses}
          expenseCorrections={corrections}
          invoiceCorrections={invoiceCorrections}
          focusedReportId={focus}
          onOpenReport={(id) => {
            setFocus(id);
            window.history.replaceState(null, "", `#report-${id}`);
          }}
          busy={false}
          messagesReady={true}
          onPost={async () => false}
          onStatus={async () => {}}
        />
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
