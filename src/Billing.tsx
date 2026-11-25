import { useState, type FormEvent } from "react";
import BillingNotice from "./BillingNotice";
import ExpenseCorrectionHistory, {
  type InvoiceLineCorrection,
} from "./ExpenseCorrectionHistory";
import type { Profile, Property, Report } from "./Timeline";
import type { Expense } from "./Expenses";

const services = {
  system: { label: "システム利用料", reportKind: null },
  patrol: { label: "巡回点検", reportKind: "定期巡回" },
  light_work: { label: "除草・清掃", reportKind: "除草・清掃" },
  mail: { label: "郵便物対応", reportKind: "郵便物対応" },
} as const;
type ServiceCode = keyof typeof services;
const monthsOfYear = Array.from({ length: 12 }, (_, index) => index + 1);

export type Contract = {
  id: string;
  customer_id: string;
  property_id: string;
  item: string;
  service_code: ServiceCode;
  normal_months: number[];
};
export type ServiceScheduleMonth = {
  contract_id: string;
  period: string;
  planned: boolean;
};
export type ServiceRate = {
  id: string;
  service_code: ServiceCode;
  effective_from: string;
  amount_yen: number;
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
export const yen = (amount: number) => `${amount.toLocaleString("ja-JP")}円`;
export function InvoiceDetails({
  invoice,
  lines,
  corrections = [],
}: {
  invoice: Invoice;
  lines: InvoiceLine[];
  corrections?: InvoiceLineCorrection[];
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
      <ExpenseCorrectionHistory
        corrections={corrections.filter((row) => row.invoice_id === invoice.id)}
      />
      <small>
        共通料金と選択した実費の合計です。正式な請求書の割引は台帳で反映します。
      </small>
    </div>
  );
}

function ScheduleMonths({
  initialMonths,
  year,
}: {
  initialMonths: number[];
  year: number;
}) {
  const [selected, setSelected] = useState(initialMonths);
  return (
    <>
      <button
        type="button"
        className="quiet"
        onClick={() => setSelected(selected.length === 12 ? [] : monthsOfYear)}
      >
        {selected.length === 12 ? "すべて解除" : "毎月を選択"}
      </button>
      <div
        className="payment-months"
        role="group"
        aria-label={`${year}年の提供予定月`}
      >
        {monthsOfYear.map((month) => (
          <button
            key={month}
            type="button"
            className={selected.includes(month) ? "" : "quiet"}
            aria-pressed={selected.includes(month)}
            onClick={() =>
              setSelected(
                selected.includes(month)
                  ? selected.filter((value) => value !== month)
                  : [...selected, month],
              )
            }
          >
            {month}月
          </button>
        ))}
      </div>
      {selected.map((month) => (
        <input key={month} type="hidden" name="months" value={month} />
      ))}
    </>
  );
}

export default function Billing({
  users,
  properties,
  contracts,
  scheduleMonths,
  rates,
  invoices,
  lines,
  expenses,
  reports,
  invoiceCorrections = [],
  customerId,
  onCustomer,
  busy,
  onAction,
}: {
  users: Profile[];
  properties: Property[];
  contracts: Contract[];
  scheduleMonths: ServiceScheduleMonth[];
  rates: ServiceRate[];
  invoices: Invoice[];
  lines: InvoiceLine[];
  expenses: Expense[];
  reports: Report[];
  invoiceCorrections?: InvoiceLineCorrection[];
  customerId: string;
  onCustomer: (id: string) => void;
  busy: boolean;
  onAction: BillingAction;
}) {
  const [editing, setEditing] = useState<Contract | null>(null);
  const [version, setVersion] = useState(0);
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" })
    .format(new Date())
    .slice(0, 7);
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [period, setPeriod] = useState(() => {
    const [currentYear, month] = today.split("-").map(Number);
    return new Date(Date.UTC(currentYear, month - 2, 1))
      .toISOString()
      .slice(0, 7);
  });
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
        report.publication_status !== "draft" &&
        ownProperties.some((property) => property.id === report.property_id) &&
        report.performed_on.slice(0, 7) <= period &&
        (!expense.billed_at || attached.has(expense.id)),
    );
  function scheduleForYear(contract: Contract) {
    return scheduleMonths.filter(
      (row) =>
        row.contract_id === contract.id && row.period.startsWith(`${year}-`),
    );
  }
  const savedSchedule = editing ? scheduleForYear(editing) : [];
  const savedMonths = savedSchedule.length
    ? savedSchedule
        .filter((row) => row.planned)
        .map((row) => Number(row.period.slice(5, 7)))
    : null;

  const scheduleIssues = period
    ? ownContracts.flatMap((contract) => {
        const schedule = scheduleMonths.find(
          (row) =>
            row.contract_id === contract.id && row.period === `${period}-01`,
        );
        if (!schedule) return [{ contract, message: "提供予定が未登録" }];
        const kind = services[contract.service_code].reportKind;
        if (!schedule.planned || !kind) return [];
        const reported = reports.some(
          (report) =>
            report.property_id === contract.property_id &&
            report.kind === kind &&
            report.performed_on.startsWith(`${period}-`) &&
            report.publication_status === "published",
        );
        return reported ? [] : [{ contract, message: "実施報告を要確認" }];
      })
    : [];

  async function saveContract(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const saved = await onAction("contract", {
      id: editing?.id || "",
      customer_id: customerId,
      property_id: editing?.property_id ?? data.get("property_id"),
      service_code: data.get("service_code"),
      year,
      months: data.getAll("months").map(Number),
      expected_months: savedMonths,
      update_normal: data.has("update_normal"),
    });
    if (saved) {
      setEditing(null);
      setVersion(version + 1);
    }
  }

  async function saveRate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (
      await onAction("rate", {
        service_code: data.get("service_code"),
        effective_from: `${data.get("effective_from")}-01`,
        amount_yen: Number(data.get("amount_yen")),
      })
    )
      form.reset();
  }
  return (
    <section>
      <details className="panel">
        <summary>共通料金表</summary>
        <form onSubmit={saveRate}>
          <fieldset disabled={busy}>
            <div className="row">
              <label>
                サービス
                <select name="service_code">
                  {Object.entries(services).map(([code, service]) => (
                    <option key={code} value={code}>
                      {service.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                適用開始月
                <input
                  type="month"
                  name="effective_from"
                  defaultValue={period}
                  required
                />
              </label>
              <label>
                金額（円）
                <input
                  type="number"
                  name="amount_yen"
                  min="0"
                  max="999999999"
                  step="1"
                  required
                />
              </label>
            </div>
            <button>共通料金を保存</button>
          </fieldset>
        </form>
        <ul>
          {rates.map((rate) => (
            <li key={rate.id}>
              {services[rate.service_code].label} ·{" "}
              {rate.effective_from.slice(0, 7)}分から · {yen(rate.amount_yen)}
            </li>
          ))}
        </ul>
      </details>
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
            <h2>契約・サービス提供予定</h2>
            <label>
              予定の対象年
              <input
                type="number"
                value={year || ""}
                onChange={(e) => setYear(Number(e.target.value))}
                min="1900"
                max="9999"
                step="1"
                required
              />
            </label>
            <details
              className="property-registration panel"
              open={editing ? true : undefined}
              key={`${editing?.id || "new"}:${version}`}
            >
              <summary>{editing ? "提供予定を編集" : "契約項目を追加"}</summary>
              <form onSubmit={saveContract}>
                <fieldset disabled={busy || !ownProperties.length}>
                  {editing ? (
                    <>
                      <p>
                        {
                          ownProperties.find(
                            (property) => property.id === editing.property_id,
                          )?.property_number
                        }{" "}
                        · {editing.item}
                      </p>
                      {savedMonths === null && (
                        <p>
                          この年の予定は未登録です。通常の提供月を初期値にしています。
                        </p>
                      )}
                    </>
                  ) : (
                    <div className="row">
                      <label>
                        対象物件
                        <select name="property_id" required>
                          {ownProperties.map((property) => (
                            <option key={property.id} value={property.id}>
                              {property.property_number}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        サービス
                        <select name="service_code">
                          {Object.entries(services).map(([code, service]) => (
                            <option key={code} value={code}>
                              {service.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  )}
                  <ScheduleMonths
                    key={year}
                    initialMonths={savedMonths ?? editing?.normal_months ?? []}
                    year={year}
                  />
                  {editing && (
                    <label className="checkbox-label">
                      <input type="checkbox" name="update_normal" key={year} />
                      この予定を今後の新しい年の初期値にする
                    </label>
                  )}
                  <div className="user-actions">
                    <button
                      disabled={
                        !Number.isInteger(year) || year < 1900 || year > 9999
                      }
                    >
                      提供予定を保存
                    </button>
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
                <caption className="sr-only">契約項目と提供予定</caption>
                <thead>
                  <tr>
                    <th scope="col">物件番号</th>
                    <th scope="col">サービス</th>
                    <th scope="col">提供予定月</th>
                    <th scope="col">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {ownContracts.map((contract) => {
                    const schedule = scheduleForYear(contract);
                    const planned = schedule.filter((row) => row.planned);
                    return (
                      <tr key={contract.id}>
                        <td>
                          {
                            ownProperties.find(
                              (property) =>
                                property.id === contract.property_id,
                            )?.property_number
                          }
                        </td>
                        <td>{contract.item}</td>
                        <td>
                          {schedule.length
                            ? planned
                                .map(
                                  (row) =>
                                    `${Number(row.period.slice(5, 7))}月`,
                                )
                                .join("、") || "予定なし"
                            : "未登録"}
                        </td>
                        <td>
                          <button
                            className="quiet"
                            disabled={busy}
                            onClick={() => setEditing(contract)}
                          >
                            編集
                          </button>
                        </td>
                      </tr>
                    );
                  })}
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
              対象月の提供予定と公開済みの実施報告をもとに、共通料金を計上します。実費は対象月までの未請求分から選択します。
            </p>
            {scheduleIssues.length > 0 && (
              <ul aria-label="請求前の確認事項">
                {scheduleIssues.map(({ contract, message }) => (
                  <li key={contract.id}>
                    {
                      ownProperties.find(
                        (property) => property.id === contract.property_id,
                      )?.property_number
                    }{" "}
                    · {contract.item} · {message}
                  </li>
                ))}
              </ul>
            )}
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
              実費は作成後・公開後も訂正でき、関連する請求情報へ反映されます。請求から実費を外す場合や契約を変更した場合は、下書きを再作成してください。
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
                <InvoiceDetails
                  invoice={invoice}
                  lines={lines}
                  corrections={invoiceCorrections}
                />
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
