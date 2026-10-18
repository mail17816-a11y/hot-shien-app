import { useState, type FormEvent } from "react";
import type { Property, Report } from "./Timeline";

export type Expense = {
  id: string;
  report_id: string;
  item: string;
  amount_yen: number;
  billed_at: string | null;
};
export function ExpenseInputs() {
  const [rows, setRows] = useState<number[]>([]);
  const [next, setNext] = useState(0);
  return (
    <fieldset>
      <legend>実費明細（任意）</legend>
      <p className="muted">
        実際に発生した金額を円単位で入力してください。請求情報を作成するまでは管理者が修正できます。
      </p>
      {rows.map((id) => (
        <div className="panel" key={id}>
          <div className="row">
            <label>
              項目名
              <input
                name="expense_item"
                maxLength={200}
                placeholder="郵送代・処分費など"
                required
              />
            </label>
            <label>
              金額（円）
              <input
                name="expense_amount"
                type="number"
                min="1"
                max="999999999"
                step="1"
                required
              />
            </label>
          </div>
          <button
            type="button"
            className="quiet"
            onClick={() => setRows(rows.filter((row) => row !== id))}
          >
            明細を取り除く
          </button>
        </div>
      ))}
      <button
        type="button"
        className="quiet"
        disabled={rows.length >= 50}
        onClick={() => {
          setRows([...rows, next]);
          setNext(next + 1);
        }}
      >
        実費明細を追加
      </button>
    </fieldset>
  );
}

export default function ExpenseManagement({
  expenses,
  reports,
  properties,
  busy,
  onSave,
}: {
  expenses: Expense[];
  reports: Report[];
  properties: Property[];
  busy: boolean;
  onSave: (expense: Expense, item: string, amount: number) => Promise<boolean>;
}) {
  const [selected, setSelected] = useState<Expense | null>(null);
  const [search, setSearch] = useState("");
  const rows = expenses
    .map((expense) => {
      const report = reports.find((row) => row.id === expense.report_id);
      return {
        expense,
        report,
        property: properties.find((row) => row.id === report?.property_id),
      };
    })
    .filter(({ expense, report, property }) =>
      [
        expense.item,
        report?.performed_on,
        property?.property_number,
        expense.billed_at ? "請求情報作成済み" : "未請求",
      ].some((value) =>
        value?.toLowerCase().includes(search.trim().toLowerCase()),
      ),
    );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const data = new FormData(event.currentTarget);
    if (
      await onSave(
        selected,
        String(data.get("item")).trim(),
        Number(data.get("amount")),
      )
    )
      setSelected(null);
  }
  return (
    <section className="panel">
      <h2>作業報告の実費一覧</h2>
      <p className="muted">
        請求情報の作成前に、項目と金額を確認・修正します。実費の記録だけでは顧客には表示されません。
      </p>
      <label>
        実費を検索
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="物件番号・作業日・項目名・状態"
        />
      </label>
      <p role="status">
        {rows.length}件 / 全{expenses.length}件
      </p>
      <div className="inbox-scroll">
        <table className="inbox-table">
          <caption className="sr-only">実費一覧</caption>
          <thead>
            <tr>
              <th scope="col">物件番号</th>
              <th scope="col">作業日</th>
              <th scope="col">項目名</th>
              <th scope="col">金額（円）</th>
              <th scope="col">状態・操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ expense, report, property }) => (
              <tr key={expense.id}>
                <td>{property?.property_number || "—"}</td>
                <td>{report?.performed_on || "—"}</td>
                <td>{expense.item}</td>
                <td>{expense.amount_yen.toLocaleString("ja-JP")}</td>
                <td>
                  {expense.billed_at ? (
                    "請求情報作成済み"
                  ) : (
                    <button
                      className="quiet"
                      disabled={busy}
                      onClick={() => setSelected(expense)}
                    >
                      未請求・修正
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && <p>該当する実費はありません。</p>}
      {selected && (
        <form className="panel user-editor" key={selected.id} onSubmit={submit}>
          <h3>実費明細を修正</h3>
          <fieldset disabled={busy}>
            <label>
              項目名
              <input
                name="item"
                defaultValue={selected.item}
                maxLength={200}
                required
              />
            </label>
            <label>
              金額（円）
              <input
                name="amount"
                type="number"
                min="1"
                max="999999999"
                step="1"
                defaultValue={selected.amount_yen}
                required
              />
            </label>
            <div className="user-actions">
              <button>変更を保存</button>
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
      )}
    </section>
  );
}
