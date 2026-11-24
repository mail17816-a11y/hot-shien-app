import type { FormEvent } from "react";
import IdentifierField, {
  useIdentifierSuggestion,
  type RegistrationResult,
} from "./IdentifierField";
import type { Profile } from "./Timeline";

export default function PropertyRegistration({
  people,
  busy,
  onSuggest,
  onSave,
}: {
  people: Profile[];
  busy: boolean;
  onSuggest: () => Promise<string>;
  onSave: (customerId: string, number: string) => Promise<RegistrationResult>;
}) {
  const number = useIdentifierSuggestion(onSuggest);

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || number.pending) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const result = await onSave(
      String(fields.get("customer")),
      String(fields.get("property_number")),
    );
    if (result === "duplicate") await number.handleDuplicate();
    else if (result) {
      form.reset();
      number.clear();
    }
  }

  return (
    <details className="panel property-registration">
      <summary>新しい物件を登録</summary>
      <form onSubmit={register}>
        <p className="muted">
          氏名・住所はローカル台帳で管理します。台帳に対応する物件番号を指定してください。
        </p>
        <IdentifierField kind="property" busy={busy} suggestion={number} />
        <label>
          契約者の顧客番号
          <select name="customer" required>
            <option value="">顧客を選択</option>
            {people
              .filter((p) => p.role === "customer" && p.active && !p.deleted_at)
              .map((p) => (
                <option value={p.id} key={p.id}>
                  {p.customer_number || p.login_id}
                </option>
              ))}
          </select>
        </label>
        <button disabled={busy || number.pending}>物件を登録</button>
      </form>
    </details>
  );
}
