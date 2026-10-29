import { useState, type FormEvent } from "react";
import type { InspectionSubject, InspectionTarget } from "./inspections";
export default function PropertyInspectionSettings({
  propertyNumber,
  subjects,
  targets,
  busy,
  onSave,
  onClose,
}: {
  propertyNumber: string;
  subjects: InspectionSubject[];
  targets: InspectionTarget[];
  busy: boolean;
  onSave: (targets: InspectionTarget[]) => Promise<boolean>;
  onClose: () => void;
}) {
  const settings = subjects.filter(
    (s) => s.configurable && s.template_version === 1,
  );
  const [rows, setRows] = useState<InspectionTarget[]>(
    settings.map(
      (s) =>
        targets.find((t) => t.subject_id === s.id) || {
          subject_id: s.id,
          availability: "unknown",
          inspect: false,
          reason: "",
        },
    ),
  );
  const change = (id: string, patch: Partial<InspectionTarget>) =>
    setRows((old) =>
      old.map((row) => (row.subject_id === id ? { ...row, ...patch } : row)),
    );
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await onSave(rows)) onClose();
  }
  return (
    <section className="panel inspection-settings">
      <h2>{propertyNumber} の設備・点検対象</h2>
      <p>
        設備の有無と、通常点検する対象を設定します。外構・危険事項・郵便物は毎回の点検に含めます。設定変更で過去の報告は変わりません。
      </p>
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          {settings.map((s) => {
            const row = rows.find((r) => r.subject_id === s.id)!;
            return (
              <div className="inspection-setting-row" key={s.id}>
                <h3>{s.label}</h3>
                <label>
                  設備の有無
                  <select
                    aria-label={`${s.label}の有無`}
                    value={row.availability}
                    onChange={(e) =>
                      change(s.id, {
                        availability: e.target
                          .value as InspectionTarget["availability"],
                        inspect: e.target.value === "present",
                      })
                    }
                  >
                    <option value="unknown">未設定</option>
                    <option value="present">あり</option>
                    <option value="absent">なし</option>
                  </select>
                </label>
                {row.availability === "present" && (
                  <>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={row.inspect}
                        onChange={(e) =>
                          change(s.id, { inspect: e.target.checked })
                        }
                      />
                      点検対象にする
                    </label>
                    {!row.inspect && (
                      <label>
                        対象外の理由
                        <textarea
                          maxLength={2000}
                          required
                          value={row.reason}
                          onChange={(e) =>
                            change(s.id, { reason: e.target.value })
                          }
                        />
                      </label>
                    )}
                  </>
                )}
              </div>
            );
          })}
          <div className="user-actions">
            <button disabled={settings.length !== 8}>点検対象を保存</button>
            <button className="quiet" type="button" onClick={onClose}>
              閉じる
            </button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}
