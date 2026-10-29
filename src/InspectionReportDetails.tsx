import type { Report } from "./Timeline";
import { correctionDate } from "./ExpenseCorrectionHistory";
import {
  resultLabel,
  type InspectionItem,
  type InspectionSubject,
  type InspectionResult,
  type ReportRevision,
} from "./inspections";
export function InspectionReportDetails({
  report,
  subjects,
  items,
  results,
}: {
  report: Report;
  subjects: InspectionSubject[];
  items: InspectionItem[];
  results: InspectionResult[];
}) {
  return (
    <div className="inspection-report">
      {report.publication_status === "draft" && (
        <p className="tag">下書き・顧客には非表示</p>
      )}
      {report.started_at && report.finished_at && (
        <small>
          点検日時：{correctionDate(report.started_at)} ～{" "}
          {correctionDate(report.finished_at)}
        </small>
      )}
      {report.work_status === "not_performed" && (
        <p>
          <strong>作業未実施</strong>：{report.not_performed_reason}
        </p>
      )}
      {report.inspection_version != null && (
        <details>
          <summary>点検結果（{results.length}項目）</summary>
          {subjects
            .filter((s) =>
              items.some(
                (i) =>
                  i.subject_id === s.id &&
                  results.some((r) => r.item_id === i.id),
              ),
            )
            .map((subject) => (
              <section key={subject.id}>
                <h3>
                  {subject.category}：{subject.label}
                </h3>
                <dl>
                  {items
                    .filter((i) => i.subject_id === subject.id)
                    .map((item) => {
                      const row = results.find((r) => r.item_id === item.id);
                      return (
                        row && (
                          <div className="inspection-result" key={item.id}>
                            <dt>{item.label}</dt>
                            <dd>
                              {resultLabel(
                                row.status === "checked"
                                  ? row.result
                                  : row.status,
                              )}
                              {row.reason && (
                                <p className="body">理由：{row.reason}</p>
                              )}
                              {row.memo && (
                                <p className="body">メモ：{row.memo}</p>
                              )}
                            </dd>
                          </div>
                        )
                      );
                    })}
                </dl>
              </section>
            ))}
        </details>
      )}
    </div>
  );
}
const labels: Record<string, string> = {
  kind: "作業種別",
  body: "報告内容",
  performed_on: "作業日",
  photo_paths: "写真",
  publication_status: "公開状態",
  work_status: "実施状態",
  not_performed_reason: "作業未実施の理由",
  started_at: "開始日時",
  finished_at: "終了日時",
};
function RevisionValue({
  field,
  value,
  urls,
}: {
  field: string;
  value: unknown;
  urls?: Record<string, string>;
}) {
  if (field === "photo_paths")
    return (
      <div className="photos">
        {Array.isArray(value) && value.length
          ? value.map((path, index) =>
              urls?.[String(path)] ? (
                <a
                  key={String(path)}
                  href={urls[String(path)]}
                  target="_blank"
                  rel="noreferrer"
                >
                  <img
                    src={urls[String(path)]}
                    alt={`履歴の写真 ${index + 1}`}
                    loading="lazy"
                  />
                </a>
              ) : (
                <span key={String(path)}>
                  写真{index + 1}（取得できません）
                </span>
              ),
            )
          : "なし"}
      </div>
    );
  if (field.startsWith("check:") && value && typeof value === "object") {
    const row = value as InspectionResult;
    return (
      <p className="body">
        {resultLabel(row.status === "checked" ? row.result : row.status)}
        {row.reason ? `／理由：${row.reason}` : ""}
        {row.memo ? `／メモ：${row.memo}` : ""}
      </p>
    );
  }
  if (
    (field === "started_at" || field === "finished_at") &&
    typeof value === "string"
  )
    return <p>{correctionDate(value)}</p>;
  return <p className="body">{resultLabel(value)}</p>;
}
export function ReportRevisionHistory({
  revisions,
  subjects,
  items,
}: {
  revisions: ReportRevision[];
  subjects: InspectionSubject[];
  items: InspectionItem[];
}) {
  if (!revisions.length) return null;
  return (
    <details className="correction-history report-revisions">
      <summary>報告の編集履歴（{revisions.length}件）</summary>
      {[...revisions]
        .sort((a, b) => b.revision - a.revision)
        .map((row) => (
          <article key={row.id}>
            <time dateTime={row.created_at}>
              {correctionDate(row.created_at)}
            </time>
            <small>
              {row.actor_role === "admin" ? "管理者" : "作業者"}による編集
            </small>
            <p className="body">編集理由：{row.reason}</p>
            {Object.keys(row.after_values).map((field) => {
              const item = items.find((i) => i.id === field.slice(6));
              const subject = subjects.find((s) => s.id === item?.subject_id);
              return (
                <details className="revision-field" key={field}>
                  <summary>
                    {labels[field] ||
                      (item
                        ? `${subject?.label || ""}・${item.label}`
                        : "点検項目")}
                  </summary>
                  <strong>変更前</strong>
                  <RevisionValue
                    field={field}
                    value={row.before_values[field]}
                    urls={row.photo_urls}
                  />
                  <strong>変更後</strong>
                  <RevisionValue
                    field={field}
                    value={row.after_values[field]}
                    urls={row.photo_urls}
                  />
                </details>
              );
            })}
          </article>
        ))}
    </details>
  );
}
