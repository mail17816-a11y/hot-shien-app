import { useEffect, useRef, useState, type FormEvent } from "react";
import { buildTimeline } from "./feed";
import { InvoiceDetails, yen, type Invoice, type InvoiceLine } from "./Billing";
import type { Expense } from "./Expenses";
import BillingNotice from "./BillingNotice";

export type Profile = {
  id: string;
  login_id: string;
  customer_number: string | null;
  role: "admin" | "worker" | "customer";
  active: boolean;
  deleted_at?: string | null;
  auth_valid_after?: number;
};
export type Property = {
  id: string;
  property_number: string;
  customer_id: string;
};
export type Report = {
  id: string;
  property_id: string;
  author_id: string;
  kind: string;
  body: string;
  performed_on: string;
  created_at: string;
  photo_paths: string[];
  urls?: string[];
};
export type WorkRequest = {
  id: string;
  property_id: string;
  customer_id: string;
  kind: string;
  body: string;
  status: string;
  created_at: string;
};
export type Message = {
  id: string;
  property_id: string;
  author_id: string;
  author_role: Profile["role"];
  kind: string;
  body: string;
  created_at: string;
};
export type Post = { kind: string; workKind: string; body: string };
const roles = { admin: "管理者", worker: "作業者", customer: "顧客" };
const displayTypes = [
  ["report", "作業報告"],
  ["invoice", "請求情報"],
  ["request", "作業依頼"],
  ["message", "メッセージ"],
] as const;
const dateTime = (value: string) =>
  new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

export default function Timeline({
  reports,
  requests,
  messages,
  properties,
  selected,
  profile,
  busy,
  messagesReady,
  onPost,
  onStatus,
  invoices = [],
  invoiceLines = [],
  expenses = [],
}: {
  reports: Report[];
  requests: WorkRequest[];
  messages: Message[];
  properties: Property[];
  selected: string;
  profile: Profile;
  busy: boolean;
  messagesReady: boolean;
  onPost: (post: Post) => Promise<boolean>;
  onStatus: (id: string, status: string) => Promise<void>;
  invoices?: Invoice[];
  invoiceLines?: InvoiceLine[];
  expenses?: Expense[];
}) {
  const [visibleTypes, setVisibleTypes] = useState({
    report: true,
    invoice: true,
    request: true,
    message: true,
  });
  const expensesByReport = new Map<string, Expense[]>();
  for (const expense of expenses) {
    const rows = expensesByReport.get(expense.report_id) || [];
    rows.push(expense);
    expensesByReport.set(expense.report_id, rows);
  }
  const entries = [
    ...buildTimeline(reports, requests, messages, selected),
    ...invoices
      .filter(
        (invoice) =>
          invoice.status === "published" &&
          invoiceLines.some(
            (line) =>
              line.invoice_id === invoice.id && line.property_id === selected,
          ),
      )
      .map((invoice) => ({
        type: "invoice" as const,
        invoice,
        data: {
          id: invoice.id,
          property_id: selected,
          created_at: invoice.published_at!,
          kind: "請求情報",
          body: "",
          author_id: "",
        },
      })),
  ].sort(
    (a, b) =>
      Date.parse(a.data.created_at) - Date.parse(b.data.created_at) ||
      `${a.type}:${a.data.id}`.localeCompare(`${b.type}:${b.data.id}`),
  );
  const visibleEntries = entries.filter((entry) => visibleTypes[entry.type]);
  const [postKind, setPostKind] = useState(
    profile.role === "customer" ? "お問い合わせ" : "その他メッセージ",
  );
  const effectiveKind =
    !messagesReady && profile.role === "customer" ? "作業依頼" : postKind;
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [selected, entries.length]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const saved = await onPost({
      kind: String(data.get("kind")),
      workKind: String(data.get("workKind") || ""),
      body: String(data.get("body")).trim(),
    });
    if (saved) {
      const body = form.elements.namedItem("body");
      if (body instanceof HTMLTextAreaElement) body.value = "";
    }
  }
  return (
    <section className="conversation">
      <div className="section-title">
        <div>
          <h2>物件のコミュニケーション</h2>
          <small>
            報告・ご依頼・メッセージ・料金案内を古い順に表示します。
          </small>
        </div>
        <button
          className="quiet"
          onClick={() =>
            bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" })
          }
        >
          最新へ ↓
        </button>
      </div>
      <fieldset className="timeline-filters">
        <legend>表示する種類</legend>
        <div className="timeline-filter-options">
          {displayTypes.map(([type, label]) => (
            <label className="checkbox-label" key={type}>
              <input
                type="checkbox"
                checked={visibleTypes[type]}
                onChange={(event) =>
                  setVisibleTypes((previous) => ({
                    ...previous,
                    [type]: event.target.checked,
                  }))
                }
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      {!visibleEntries.length && (
        <div className="empty" role="status">
          {!Object.values(visibleTypes).some(Boolean)
            ? "表示する種類を選択してください。"
            : entries.length
              ? "選択した種類の投稿はありません。"
              : "まだ投稿がありません。"}
        </div>
      )}
      <div className="chat-tree" aria-label="物件の投稿一覧">
        {visibleEntries.map((entry) => {
          const r = entry.data;
          const reportExpenses =
            entry.type === "report" ? expensesByReport.get(r.id) || [] : [];
          const own =
            entry.type === "request"
              ? entry.data.customer_id === profile.id
              : entry.data.author_id === profile.id;
          const sender =
            entry.type === "message"
              ? `${roles[entry.data.author_role]}`
              : own
                ? "あなた"
                : entry.type === "request"
                  ? "顧客"
                  : entry.type === "invoice"
                    ? "TOIRO · 料金案内"
                    : "TOIRO · 作業報告";
          return (
            <article
              className={`chat-entry ${own ? "own" : ""}`}
              key={`${entry.type}:${r.id}`}
            >
              <div className="chat-sender">
                {own
                  ? `あなた${entry.type === "message" ? ` · ${roles[profile.role]}` : ""}`
                  : sender}
              </div>
              <div className="chat-bubble">
                <div className="report-top">
                  <span className="tag">
                    {entry.type === "request" ? `作業依頼 · ${r.kind}` : r.kind}
                  </span>
                </div>
                {!selected && (
                  <h3>
                    {properties.find((p) => p.id === r.property_id)
                      ?.property_number || "物件"}
                  </h3>
                )}
                {entry.type === "report" && (
                  <small className="performed-date">
                    作業日：{entry.data.performed_on}
                  </small>
                )}
                {entry.type === "invoice" ? (
                  <InvoiceDetails
                    invoice={entry.invoice}
                    lines={invoiceLines}
                  />
                ) : (
                  <p className="body">{r.body}</p>
                )}
                {reportExpenses.length > 0 && (
                  <section
                    className="report-expenses"
                    aria-label="作業報告の実費請求"
                  >
                    <h3>実費請求</h3>
                    <ul>
                      {reportExpenses.map((expense) => (
                        <li key={expense.id}>
                          {expense.item}：{yen(expense.amount_yen)}
                        </li>
                      ))}
                    </ul>
                    <p>
                      実費合計：
                      {yen(
                        reportExpenses.reduce(
                          (sum, expense) => sum + expense.amount_yen,
                          0,
                        ),
                      )}
                    </p>
                    <BillingNotice />
                  </section>
                )}
                {entry.type === "report" && !!entry.data.urls?.length && (
                  <div className="photos">
                    {entry.data.urls.map((url, index) => (
                      <a href={url} target="_blank" rel="noreferrer" key={url}>
                        <img
                          src={url}
                          alt={`${r.kind}の報告写真 ${index + 1}`}
                          loading="lazy"
                        />
                      </a>
                    ))}
                  </div>
                )}
                {entry.type === "request" &&
                  (profile.role === "customer" ? (
                    <span className="request-status">
                      対応状況：{entry.data.status}
                    </span>
                  ) : (
                    <label>
                      対応状況
                      <select
                        value={entry.data.status}
                        disabled={busy}
                        onChange={(event) => onStatus(r.id, event.target.value)}
                      >
                        {["受付待ち", "受付済み", "作業中", "完了"].map(
                          (status) => (
                            <option key={status}>{status}</option>
                          ),
                        )}
                      </select>
                    </label>
                  ))}
              </div>
              <time dateTime={r.created_at}>{dateTime(r.created_at)}</time>
            </article>
          );
        })}
      </div>
      <div ref={bottom} />
      <section className="panel composer">
        <h2>投稿する</h2>
        <p className="muted">
          {selected
            ? `${properties.find((p) => p.id === selected)?.property_number || "選択中の物件"}について投稿します。`
            : "上の一覧から投稿先の物件を選択してください。"}
        </p>
        {!messagesReady && (
          <p className="muted">
            お問い合わせ・メッセージ機能は準備中です。作業依頼と報告はこれまでどおり利用できます。
          </p>
        )}
        <form onSubmit={submit}>
          <fieldset disabled={busy || !selected}>
            <label>
              投稿の種類
              <select
                name="kind"
                value={effectiveKind}
                onChange={(event) => setPostKind(event.target.value)}
              >
                {profile.role === "customer" && (
                  <>
                    <option disabled={!messagesReady}>お問い合わせ</option>
                    <option>作業依頼</option>
                  </>
                )}
                <option disabled={!messagesReady}>その他メッセージ</option>
              </select>
            </label>
            {effectiveKind === "作業依頼" && (
              <label>
                作業種別
                <select name="workKind">
                  <option>除草・清掃</option>
                  <option>郵便物転送</option>
                  <option>その他</option>
                </select>
              </label>
            )}
            <label>
              本文
              <textarea
                name="body"
                rows={3}
                maxLength={5000}
                required
                placeholder="ご質問や連絡事項を入力してください"
              />
            </label>
            <button
              disabled={
                busy ||
                !selected ||
                (!messagesReady && profile.role !== "customer")
              }
            >
              {busy ? "送信中…" : "送信"}
            </button>
          </fieldset>
        </form>
      </section>
    </section>
  );
}
