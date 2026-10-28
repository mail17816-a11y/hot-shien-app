const yen = (amount: number) => `${amount.toLocaleString("ja-JP")}円`;

export type Correction = {
  id: string;
  created_at: string;
  reason: string;
  old_item: string;
  new_item: string;
  old_amount_yen: number;
  new_amount_yen: number;
};
export type ExpenseCorrection = Correction & {
  expense_id: string;
  report_id: string;
  property_id: string;
  actor_id: string;
};
export type InvoiceLineCorrection = Correction & {
  invoice_id: string;
  expense_correction_id: string;
};
export const correctionDate = (value: string) =>
  new Date(value).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
export default function ExpenseCorrectionHistory({
  corrections,
}: {
  corrections: Correction[];
}) {
  if (!corrections.length) return null;
  return (
    <details className="correction-history">
      <summary>実費の編集履歴（{corrections.length}件）</summary>
      {[...corrections]
        .sort(
          (a, b) =>
            b.created_at.localeCompare(a.created_at) ||
            b.id.localeCompare(a.id),
        )
        .map((correction) => (
          <article key={correction.id}>
            <time dateTime={correction.created_at}>
              {correctionDate(correction.created_at)}
            </time>
            {correction.old_item !== correction.new_item && (
              <p>
                項目：{correction.old_item} → {correction.new_item}
              </p>
            )}
            {correction.old_amount_yen !== correction.new_amount_yen && (
              <p>
                金額：{yen(correction.old_amount_yen)} →{" "}
                {yen(correction.new_amount_yen)}
              </p>
            )}
            <p className="body">訂正理由：{correction.reason}</p>
          </article>
        ))}
    </details>
  );
}
