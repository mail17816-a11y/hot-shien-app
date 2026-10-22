import { useState, type FormEvent } from "react";
import BillingNotice from "./BillingNotice";
import type { Profile, Property, Report } from "./Timeline";
import type { Expense } from "./Expenses";

export type Contract = {
  id: string;
  customer_id: string;
  property_id: string;
  item: string;
  amount_yen: number;
  billing_cycle: "monthly" | "annual" | "once" | "custom";
  payment_months?: string[];
  starts_on: string;
  ends_on: string | null;
  effective_from: string;
  status: "active" | "ended";
};
export type Invoice = {
  id: string;
  customer_id: string;
  period: string;
  status: "draft" | "published" | "cancelled";
  cancelled_at?: string | null;
  published_at: string | null;
  created_at: string;
};
export type InvoiceLine = {
  id: string;
  invoice_id: string;
  property_id: string;
  property_number: string;
  category: "subscription" | "expense";
  item: string;
  amount_yen: number;
  expense_id: string | null;
};
export type BillingAction = (
  action: string,
  data: Record<string, unknown>,
) => Promise<boolean>;
const presets = [
  ["システム利用料", 500],
  ["外周点検（定額）", 3000],
  ["郵便物画像報告（定額）", 300],
  ["郵便物転送手数料（定額）", 200],
  ["除草・清掃（定額）", 3000],
  ["個別の定額料金", 0],
] as const;
export const yen = (amount: number) => `${amount.toLocaleString("ja-JP")}円`;
export function InvoiceDetails({
  invoice,
  lines,
}: {
  invoice: Invoice;
  lines: InvoiceLine[];
}) {
  const rows = lines.filter((line) => line.invoice_id === invoice.id);
  const fixed = rows
    .filter((line) => line.category === "subscription")
    .reduce((sum, line) => sum + line.amount_yen, 0);
  const extra = rows
    .filter((line) => line.category === "expense")
    .reduce((sum, line) => sum + line.amount_yen, 0);
  return (
    <div className="invoice-details">
      <h3>{invoice.period.slice(0, 7)}分の料金案内</h3>
      <BillingNotice />
      <small>
        顧客ごとの合計です。複数物件の契約がある場合は、その内訳も表示します。
      </small>
      <div className="inbox-scroll">
        <table className="invoice-table">
          <caption className="sr-only">料金内訳</caption>
          <thead>
            <tr>
              <th scope="col">区分・物件</th>
              <th scope="col">項目</th>
              <th scope="col">金額</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((line) => (
              <tr key={line.id}>
                <td>
                  {line.category === "subscription" ? "定額料金" : "実費"}
                  <small>{line.property_number}</small>
                </td>
                <td>{line.item}</td>
                <td>{yen(line.amount_yen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        定額料金：{yen(fixed)} ／ 実費：{yen(extra)}
      </p>
      <p>
        <strong>合計 {yen(fixed + extra)}</strong>
      </p>
      <small>
        登録された合意済み金額の合計です。日割り・税額・季節割増の自動計算は行いません。
      </small>
    </div>
  );
}

function PaymentSchedule({ contract }: { contract: Contract | null }) {
  const [cycle, setCycle] = useState(contract?.billing_cycle || "monthly");
  const [months, setMonths] = useState<string[]>(
    contract?.payment_months || [],
  );
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(
    Number(contract?.payment_months?.[0]?.slice(0, 4)) || currentYear,
  );
  const years = [
    ...new Set([
      ...Array.from({ length: 21 }, (_, i) => currentYear - 10 + i),
      ...months.map((month) => Number(month.slice(0, 4))),
      year,
    ]),
  ].sort((a, b) => a - b);
  return (
    <div className="payment-schedule">
      <label>
        支払い周期
        <select
          name="billing_cycle"
          value={cycle}
          onChange={(e) =>
            setCycle(e.target.value as Contract["billing_cycle"])
          }
        >
          <option value="monthly">毎月</option>
          <option value="annual">年1回（適用開始月と同じ月）</option>
          <option value="once">一回のみ（適用開始月）</option>
          <option value="custom">カスタム</option>
        </select>
      </label>
      {cycle === "custom" && (
        <>
          <label>
            支払い年
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            >
              {years.map((value) => (
                <option key={value} value={value}>
                  {value}年
                </option>
              ))}
            </select>
          </label>
          <div
            className="payment-months"
            role="group"
            aria-label={`${year}年の支払い月`}
          >
            {Array.from({ length: 12 }, (_, i) => {
              const month = `${year}-${String(i + 1).padStart(2, "0")}-01`;
              const selected = months.includes(month);
              return (
                <button
                  key={month}
                  type="button"
                  className={selected ? "" : "quiet"}
                  aria-pressed={selected}
                  onClick={() =>
                    setMonths(
                      selected
                        ? months.filter((value) => value !== month)
                        : [...months, month].sort(),
                    )
                  }
                >
                  {i + 1}月
                </button>
              );
            })}
          </div>
          <small>
            選択した年月ごとに、合意済みの請求額を計上します。年を切り替えて複数年を選べます。
          </small>
          <p aria-live="polite">
            選択済み：
            {months.length
              ? months.map((month) => month.slice(0, 7)).join("、")
              : "なし（1か月以上選択してください）"}
          </p>
          {months.map((month) => (
            <input
              key={month}
              type="hidden"
              name="payment_months"
              value={month}
            />
          ))}
        </>
      )}
      {cycle === "once" && <small>料金の適用開始月に1回だけ計上します。</small>}
    </div>
  );
}

export default function Billing({
  users,
  properties,
  contracts,
  invoices,
  lines,
  expenses,
  reports,
  customerId,
  onCustomer,
  busy,
  onAction,
}: {
  users: Profile[];
  properties: Property[];
  contracts: Contract[];
  invoices: Invoice[];
  lines: InvoiceLine[];
  expenses: Expense[];
  reports: Report[];
  customerId: string;
  onCustomer: (id: string) => void;
  busy: boolean;
  onAction: BillingAction;
}) {
  const [editing, setEditing] = useState<Contract | null>(null);
  const [version, setVersion] = useState(0);
  const [period, setPeriod] = useState(
    new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" })
      .format(new Date())
      .slice(0, 7),
  );
  const [excluded, setExcluded] = useState<string[]>([]);
  const [confirmPublish, setConfirmPublish] = useState("");
  const [confirmCancel, setConfirmCancel] = useState("");
  const ownProperties = properties.filter(
    (property) => property.customer_id === customerId,
  );
  const ownContracts = contracts.filter(
    (contract) => contract.customer_id === customerId,
  );
  const ownInvoices = invoices.filter(
    (invoice) => invoice.customer_id === customerId,
  );
  const draft = ownInvoices.find(
    (invoice) =>
      invoice.period.slice(0, 7) === period && invoice.status === "draft",
  );
  const attached = new Set(
    lines
      .filter((line) => line.invoice_id === draft?.id)
      .map((line) => line.expense_id),
  );
  const eligible = expenses
    .map((expense) => ({
      expense,
      report: reports.find((report) => report.id === expense.report_id),
    }))
    .filter(
      ({ expense, report }) =>
        report &&
        ownProperties.some((property) => property.id === report.property_id) &&
        report.performed_on.slice(0, 7) <= period &&
        (!expense.billed_at || attached.has(expense.id)),
    );
  async function saveContract(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (
      data.get("billing_cycle") === "custom" &&
      !data.getAll("payment_months").length
    ) {
      window.alert("支払い月を1か月以上選択してください。");
      return;
    }
    const saved = await onAction("contract", {
      id: editing?.id || "",
      customer_id: customerId,
      property_id: data.get("property_id"),
      item: String(data.get("item")).trim(),
      amount_yen: Number(data.get("amount_yen")),
      billing_cycle: data.get("billing_cycle"),
      payment_months: data.getAll("payment_months"),
      starts_on: data.get("starts_on"),
      ends_on: data.get("ends_on"),
      effective_from: `${data.get("effective_from")}-01`,
      status: data.get("status"),
    });
    if (saved) {
      setEditing(null);
      setVersion(version + 1);
    }
  }
  return (
    <section>
      <label>
        契約者の顧客番号
        <select
          value={customerId}
          onChange={(e) => {
            onCustomer(e.target.value);
            setEditing(null);
            setExcluded([]);
            setConfirmPublish("");
            setConfirmCancel("");
            setVersion(version + 1);
          }}
        >
          <option value="">顧客を選択してください</option>
          {users
            .filter(
              (user) =>
                user.role === "customer" && user.active && !user.deleted_at,
            )
            .map((user) => (
              <option key={user.id} value={user.id}>
                {user.customer_number || user.login_id}
              </option>
            ))}
        </select>
      </label>
      {!customerId ? (
        <p className="empty">顧客を選ぶと契約と請求情報を管理できます。</p>
      ) : (
        <>
          <section className="panel">
            <h2>簡易契約・定額料金</h2>
            <p className="muted">
              料金表は初期値です。回数や割引を含め、契約で合意した実際の請求額を設定してください。システム利用料も対象物件を1つ指定して登録します。
            </p>
            <details
              className="property-registration panel"
              open={editing ? true : undefined}
              key={`${editing?.id || "new"}:${version}`}
            >
              <summary>
                {editing ? "契約項目を編集" : "契約の料金項目を追加"}
              </summary>
              <form onSubmit={saveContract}>
                <fieldset disabled={busy || !ownProperties.length}>
                  {!editing && (
                    <label>
                      料金表から初期値を入力
                      <select
                        defaultValue=""
                        onChange={(e) => {
                          const preset = presets[Number(e.target.value)];
                          if (!preset) return;
                          const form = e.currentTarget.form;
                          if (!form) return;
                          (
                            form.elements.namedItem("item") as HTMLInputElement
                          ).value = preset[0];
                          (
                            form.elements.namedItem(
                              "amount_yen",
                            ) as HTMLInputElement
                          ).value = String(preset[1]);
                        }}
                      >
                        <option value="" disabled>
                          料金メニューを選択
                        </option>
                        {presets.map(([label], index) => (
                          <option key={label} value={index}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label>
                    対象物件
                    <select
                      name="property_id"
                      defaultValue={
                        editing?.property_id || ownProperties[0]?.id
                      }
                      disabled={Boolean(editing)}
                    >
                      {ownProperties.map((property) => (
                        <option key={property.id} value={property.id}>
                          {property.property_number}
                        </option>
                      ))}
                    </select>
                  </label>
                  {editing && (
                    <input
                      type="hidden"
                      name="property_id"
                      value={editing.property_id}
                    />
                  )}
                  <label>
                    項目名
                    <input
                      name="item"
                      defaultValue={editing?.item}
                      maxLength={200}
                      required
                    />
                  </label>
                  <div className="row">
                    <label>
                      合意済みの請求額（円）
                      <input
                        type="number"
                        name="amount_yen"
                        min="0"
                        max="999999999"
                        step="1"
                        defaultValue={editing?.amount_yen}
                        required
                      />
                    </label>
                  </div>
                  <PaymentSchedule contract={editing} />
                  <div className="row">
                    <label>
                      契約開始日
                      <input
                        type="date"
                        name="starts_on"
                        defaultValue={editing?.starts_on}
                        required
                      />
                    </label>
                    <label>
                      契約終了日（任意）
                      <input
                        type="date"
                        name="ends_on"
                        defaultValue={editing?.ends_on || ""}
                      />
                    </label>
                  </div>
                  <div className="row">
                    <label>
                      料金の適用開始月
                      <input
                        type="month"
                        name="effective_from"
                        defaultValue={
                          editing?.effective_from.slice(0, 7) || period
                        }
                        required
                      />
                    </label>
                    <label>
                      契約状態
                      <select
                        name="status"
                        defaultValue={editing?.status || "active"}
                      >
                        <option value="active">契約中</option>
                        <option value="ended">終了（終了日を指定）</option>
                      </select>
                    </label>
                  </div>
                  <small>
                    月途中の開始・終了もその月の全額を計上します。年払いは指定月だけ計上します。既存の請求下書きは、自動では変わりません。
                  </small>
                  <div className="user-actions">
                    <button>契約項目を保存</button>
                    {editing && (
                      <button
                        type="button"
                        className="quiet"
                        onClick={() => setEditing(null)}
                      >
                        編集を終了
                      </button>
                    )}
                  </div>
                </fieldset>
              </form>
            </details>
            {!ownProperties.length && (
              <p>先に、この顧客の物件を登録してください。</p>
            )}
            <div className="inbox-scroll">
              <table className="inbox-table">
                <caption className="sr-only">契約料金一覧</caption>
                <thead>
                  <tr>
                    <th scope="col">物件番号</th>
                    <th scope="col">項目</th>
                    <th scope="col">金額・周期</th>
                    <th scope="col">期間・適用月</th>
                    <th scope="col">状態・操作</th>
                  </tr>
                </thead>
                <tbody>
                  {ownContracts.map((contract) => (
                    <tr key={contract.id}>
                      <td>
                        {
                          properties.find((p) => p.id === contract.property_id)
                            ?.property_number
                        }
                      </td>
                      <td>{contract.item}</td>
                      <td>
                        {yen(contract.amount_yen)} /{" "}
                        {
                          {
                            monthly: "毎月",
                            annual: "年1回",
                            once: "一回のみ",
                            custom: "カスタム",
                          }[contract.billing_cycle]
                        }
                        {contract.billing_cycle === "custom" && (
                          <small>
                            {contract.payment_months
                              ?.map((month) => month.slice(0, 7))
                              .join("、")}
                          </small>
                        )}
                      </td>
                      <td>
                        {contract.starts_on} ～ {contract.ends_on || "継続"}
                        <small>
                          料金適用：{contract.effective_from.slice(0, 7)}から
                        </small>
                      </td>
                      <td>
                        {contract.status === "active" ? "契約中" : "終了"}
                        <button
                          className="quiet"
                          disabled={busy}
                          onClick={() => setEditing(contract)}
                        >
                          編集
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!ownContracts.length && <p>契約項目は未登録です。</p>}
          </section>
          <section className="panel">
            <h2>請求情報を作成</h2>
            <label>
              対象月
              <input
                type="month"
                value={period}
                onChange={(e) => {
                  setPeriod(e.target.value);
                  setExcluded([]);
                }}
                required
              />
            </label>
            <p>
              対象月に適用される定額料金を自動で取り込みます。実費は対象月までの未請求分から選択します。
            </p>
            {eligible.length > 0 && <BillingNotice />}
            {eligible.map(({ expense, report }) => (
              <label className="checkbox-label" key={expense.id}>
                <input
                  type="checkbox"
                  checked={!excluded.includes(expense.id)}
                  onChange={(e) =>
                    setExcluded(
                      e.target.checked
                        ? excluded.filter((id) => id !== expense.id)
                        : [...excluded, expense.id],
                    )
                  }
                />
                {report?.performed_on} ·{" "}
                {
                  properties.find((p) => p.id === report?.property_id)
                    ?.property_number
                }{" "}
                · {expense.item} · {yen(expense.amount_yen)}
              </label>
            ))}
            {!eligible.length && (
              <p className="muted">取り込める実費はありません。</p>
            )}
            <button
              disabled={
                busy ||
                !period ||
                ownInvoices.some(
                  (invoice) =>
                    invoice.period.slice(0, 7) === period &&
                    invoice.status === "published",
                )
              }
              onClick={() =>
                onAction("invoice", {
                  customer_id: customerId,
                  period: `${period}-01`,
                  expense_ids: eligible
                    .filter(({ expense }) => !excluded.includes(expense.id))
                    .map(({ expense }) => expense.id),
                })
              }
            >
              {draft ? "下書きを再作成" : "請求情報の下書きを作成"}
            </button>
            <small>
              下書きに取り込んだ実費は修正できなくなります。外す場合はチェックを外して下書きを再作成してください。契約・実費を修正した後も再作成が必要です。
            </small>
          </section>
          <section>
            <h2>請求情報一覧</h2>
            {!ownInvoices.length && (
              <p className="empty">請求情報はまだありません。</p>
            )}
            {ownInvoices.map((invoice) => (
              <article className="panel" key={invoice.id}>
                <span className="tag">
                  {invoice.status === "draft"
                    ? "下書き・顧客には非表示"
                    : invoice.status === "cancelled"
                      ? "撤回済み・顧客には非表示"
                      : "公開済み"}
                </span>
                <InvoiceDetails invoice={invoice} lines={lines} />
                {invoice.status === "cancelled" && invoice.cancelled_at && (
                  <small>
                    撤回日時：
                    {new Date(invoice.cancelled_at).toLocaleString("ja-JP", {
                      timeZone: "Asia/Tokyo",
                    })}
                  </small>
                )}
                {invoice.status === "published" &&
                  (confirmCancel === invoice.id ? (
                    <div className="panel">
                      <p>
                        顧客番号「
                        {users.find((user) => user.id === customerId)
                          ?.customer_number || customerId}
                        」の{invoice.period.slice(0, 7)}
                        分の請求情報を撤回します。
                      </p>
                      <p>
                        顧客の画面から非表示になります。履歴は保持し、含まれる実費は未請求に戻します。同じ月の請求を作り直せます。外部決済の取消・返金は行いません。
                      </p>
                      <div className="user-actions">
                        <button
                          disabled={busy}
                          onClick={async () => {
                            if (
                              await onAction("cancel", {
                                id: invoice.id,
                                customer_id: customerId,
                              })
                            )
                              setConfirmCancel("");
                          }}
                        >
                          確認して公開を撤回
                        </button>
                        <button
                          className="quiet"
                          disabled={busy}
                          onClick={() => setConfirmCancel("")}
                        >
                          戻る
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      className="quiet"
                      disabled={busy}
                      onClick={() => setConfirmCancel(invoice.id)}
                    >
                      公開を撤回する
                    </button>
                  ))}
                {invoice.status === "draft" &&
                  (confirmPublish === invoice.id ? (
                    <div className="panel">
                      <p>
                        この内容を顧客のコミュニケーション画面に公開します。公開後は変更できません。
                      </p>
                      <div className="user-actions">
                        <button
                          disabled={busy}
                          onClick={async () => {
                            if (await onAction("publish", { id: invoice.id }))
                              setConfirmPublish("");
                          }}
                        >
                          確認して顧客に公開
                        </button>
                        <button
                          className="quiet"
                          disabled={busy}
                          onClick={() => setConfirmPublish("")}
                        >
                          戻る
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      disabled={busy}
                      onClick={() => setConfirmPublish(invoice.id)}
                    >
                      顧客に公開する
                    </button>
                  ))}
              </article>
            ))}
          </section>
        </>
      )}
    </section>
  );
}
