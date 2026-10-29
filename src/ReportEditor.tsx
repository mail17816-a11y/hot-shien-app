import { useState, type FormEvent } from "react";
import type { Report, Property } from "./Timeline";
import { ExpenseInputs } from "./Expenses";
import {
  targetItems,
  resultOptions,
  type InspectionItem,
  type InspectionSubject,
  type InspectionProfile,
  type InspectionTarget,
  type InspectionResult,
  type ReportSave,
} from "./inspections";
const localTime = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Asia/Tokyo",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(value))
    : "";
export default function ReportEditor({
  report,
  property,
  subjects,
  items,
  profile,
  targets,
  results,
  busy,
  onSave,
  onClose,
}: {
  report?: Report;
  property?: Property;
  subjects: InspectionSubject[];
  items: InspectionItem[];
  profile?: InspectionProfile;
  targets: InspectionTarget[];
  results: InspectionResult[];
  busy: boolean;
  onSave: (
    data: ReportSave,
    files: File[],
    expenses: { item: string; amount_yen: number }[],
  ) => Promise<boolean>;
  onClose: () => void;
}) {
  const [kind, setKind] = useState(report?.kind || "定期巡回");
  const [work, setWork] = useState(report?.work_status || "completed");
  const inspection = report
    ? report.inspection_version != null
    : kind === "定期巡回";
  const assigned = report
    ? items.filter((i) => results.some((r) => r.item_id === i.id))
    : targetItems(items, subjects, targets, profile?.template_version || 1);
  const [checks, setChecks] = useState<InspectionResult[]>(
    assigned.map(
      (i) =>
        results.find((r) => r.item_id === i.id) || {
          item_id: i.id,
          status: "unconfirmed",
          result: null,
          reason: "",
          memo: "",
        },
    ),
  );
  const [kept, setKept] = useState(report?.photo_paths || []);
  const canInspect =
    Boolean(profile) &&
    !targets.some((t) => t.availability === "unknown") &&
    targets.length === 8;
  const change = (id: string, patch: Partial<InspectionResult>) =>
    setChecks((old) =>
      old.map((row) => (row.item_id === id ? { ...row, ...patch } : row)),
    );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      data = new FormData(form),
      day = String(data.get("date"));
    const publication = (
      event.nativeEvent as SubmitEvent
    ).submitter?.getAttribute("value") as "draft" | "published";
    const reason = String(data.get("reason") || "").trim();
    const unperformed = String(data.get("not_performed_reason") || "").trim();
    const selectedResults = inspection
      ? assigned
          .map((i) => checks.find((c) => c.item_id === i.id)!)
          .map((row) =>
            work === "not_performed"
              ? {
                  ...row,
                  status: "not_performed" as const,
                  result: null,
                  reason: "",
                }
              : row,
          )
      : [];
    const files = data
      .getAll("photos")
      .filter((v): v is File => v instanceof File && v.size > 0);
    const costs = data.getAll("expense_item").map((item, i) => ({
      item: String(item).trim(),
      amount_yen: Number(data.getAll("expense_amount")[i]),
    }));
    const saved = await onSave(
      {
        id: report?.id,
        revision: report?.revision,
        property_id: property?.id || "",
        kind,
        body: String(data.get("body")).trim(),
        performed_on: day,
        publication_status: publication || "draft",
        work_status: work,
        not_performed_reason: unperformed,
        started_at: data.get("start_time")
          ? `${day}T${data.get("start_time")}:00+09:00`
          : null,
        finished_at: data.get("end_time")
          ? `${day}T${data.get("end_time")}:00+09:00`
          : null,
        results: selectedResults,
        photo_paths: kept,
        reason,
      },
      files,
      costs,
    );
    if (saved) onClose();
  }
  return (
    <section className="panel report-editor">
      <h2>{report ? "報告を編集" : "新しい作業記録"}</h2>
      <p>
        {property?.property_number || "物件を選択してください"}
        {report?.publication_status === "published"
          ? "：公開済み報告の訂正は顧客にも通知されます。"
          : "：下書きは顧客には表示されません。"}
      </p>
      <form onSubmit={submit}>
        <fieldset disabled={busy || !property}>
          <div className="row">
            <label>
              作業種別
              <select
                name="kind"
                value={kind}
                disabled={Boolean(report)}
                onChange={(e) => setKind(e.target.value)}
              >
                {["定期巡回", "除草・清掃", "郵便物対応"].map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
            <label>
              作業日
              <input
                name="date"
                type="date"
                defaultValue={
                  report?.performed_on ||
                  new Intl.DateTimeFormat("sv-SE", {
                    timeZone: "Asia/Tokyo",
                  }).format(new Date())
                }
                required
              />
            </label>
          </div>
          <div className="row">
            <label>
              開始時刻（日本時間）
              <input
                type="time"
                name="start_time"
                defaultValue={localTime(report?.started_at)}
              />
            </label>
            <label>
              終了時刻（日本時間）
              <input
                type="time"
                name="end_time"
                defaultValue={localTime(report?.finished_at)}
              />
            </label>
          </div>
          <label>
            今回の作業
            <select
              value={work}
              onChange={(e) => setWork(e.target.value as typeof work)}
            >
              <option value="completed">
                実施済み（一部未実施も記録できます）
              </option>
              <option value="not_performed">作業全体を未実施</option>
            </select>
          </label>
          {work === "not_performed" && (
            <label>
              作業未実施の理由
              <textarea
                name="not_performed_reason"
                required
                maxLength={2000}
                defaultValue={report?.not_performed_reason}
              />
            </label>
          )}
          <label>
            報告内容・その他特記事項
            <textarea
              aria-label="報告内容・その他特記事項"
              name="body"
              rows={4}
              maxLength={5000}
              required
              defaultValue={report?.body}
            />
          </label>
          {inspection && !report && !canInspect && (
            <p className="error">
              物件管理で設備8項目の有無・点検対象を先に設定してください。
            </p>
          )}
          {inspection &&
            work === "completed" &&
            subjects
              .filter((s) => assigned.some((i) => i.subject_id === s.id))
              .map((subject) => (
                <details className="inspection-group" key={subject.id} open>
                  <summary>
                    {subject.category}：{subject.label}
                  </summary>
                  {assigned
                    .filter((i) => i.subject_id === subject.id)
                    .map((item) => {
                      const row = checks.find((c) => c.item_id === item.id)!;
                      return (
                        <div className="inspection-check" key={item.id}>
                          <fieldset
                            className="inspection-options"
                            aria-label={`${subject.label}・${item.label}`}
                          >
                            <legend>{item.label}</legend>
                            <div className="inspection-option-list">
                              {[
                                ["unconfirmed", "未確認"],
                                ...resultOptions[item.result_kind],
                                ["not_performed", "今回未実施"],
                              ].map(([value, label]) => (
                                <label
                                  className="inspection-option"
                                  key={value}
                                >
                                  <input
                                    type="radio"
                                    name={`inspection-${item.id}`}
                                    value={value}
                                    checked={
                                      (row.status === "checked"
                                        ? row.result
                                        : row.status) === value
                                    }
                                    onChange={() =>
                                      change(
                                        item.id,
                                        value === "unconfirmed" ||
                                          value === "not_performed"
                                          ? {
                                              status: value,
                                              result: null,
                                              reason:
                                                value === "not_performed"
                                                  ? row.reason
                                                  : "",
                                            }
                                          : {
                                              status: "checked",
                                              result: value,
                                              reason: "",
                                            },
                                      )
                                    }
                                  />
                                  <span>{label}</span>
                                </label>
                              ))}
                            </div>
                          </fieldset>
                          {row.status === "not_performed" && (
                            <label>
                              この項目の未実施理由
                              <textarea
                                required
                                maxLength={2000}
                                value={row.reason}
                                onChange={(e) =>
                                  change(item.id, { reason: e.target.value })
                                }
                              />
                            </label>
                          )}
                          <label>
                            メモ
                            <textarea
                              rows={1}
                              maxLength={2000}
                              value={row.memo}
                              onChange={(e) =>
                                change(item.id, { memo: e.target.value })
                              }
                            />
                          </label>
                        </div>
                      );
                    })}
                </details>
              ))}
          {report && report.photo_paths.length > 0 && (
            <div>
              <h3>登録済み写真</h3>
              <p>チェックを外した写真も編集履歴には残ります。</p>
              {report.photo_paths.map((path, i) => (
                <label className="checkbox-label" key={path}>
                  <input
                    type="checkbox"
                    checked={kept.includes(path)}
                    onChange={(e) =>
                      setKept((old) =>
                        e.target.checked
                          ? [...old, path]
                          : old.filter((v) => v !== path),
                      )
                    }
                  />
                  {report.urls?.[i] && (
                    <img
                      className="photo-thumbnail"
                      src={report.urls[i]}
                      alt={`登録済み写真 ${i + 1}`}
                    />
                  )}
                  写真{i + 1}を残す
                </label>
              ))}
            </div>
          )}
          <label>
            写真を追加（合計10枚まで・1枚10MB以下）
            <input
              type="file"
              name="photos"
              accept="image/jpeg,image/png,image/webp"
              multiple
            />
          </label>
          {!report ? (
            <ExpenseInputs />
          ) : (
            <p className="muted">実費の訂正は管理者の実費管理から行います。</p>
          )}
          {report && (
            <label>
              編集理由（顧客にも表示されます）
              <textarea name="reason" rows={2} required maxLength={2000} />
            </label>
          )}
          <div className="user-actions">
            {report?.publication_status !== "published" && (
              <button
                name="publication_status"
                value="draft"
                disabled={busy || (!report && inspection && !canInspect)}
              >
                下書きを保存
              </button>
            )}
            <button
              name="publication_status"
              value="published"
              disabled={busy || (!report && inspection && !canInspect)}
            >
              {report?.publication_status === "published"
                ? "訂正を保存"
                : "確認して顧客に公開"}
            </button>
            <button type="button" className="quiet" onClick={onClose}>
              編集を閉じる
            </button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}
