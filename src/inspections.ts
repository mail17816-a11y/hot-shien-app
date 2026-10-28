export type InspectionSubject = {
  id: string;
  template_version: number;
  label: string;
  category: string;
  configurable: boolean;
  sort_order: number;
};
export type InspectionItem = {
  id: string;
  subject_id: string;
  label: string;
  result_kind: "yesno" | "severity" | "mail";
  sort_order: number;
};
export type InspectionProfile = {
  property_id: string;
  template_version: number;
  updated_at: string;
};
export type InspectionTarget = {
  property_id?: string;
  subject_id: string;
  availability: "present" | "absent" | "unknown";
  inspect: boolean;
  reason: string;
};
export type InspectionResult = {
  report_id?: string;
  item_id: string;
  status: "unconfirmed" | "checked" | "not_performed";
  result: string | null;
  reason: string;
  memo: string;
};
export type ReportRevision = {
  id: string;
  report_id: string;
  revision: number;
  actor_id: string;
  actor_role: "admin" | "worker";
  created_at: string;
  reason: string;
  before_values: Record<string, unknown>;
  after_values: Record<string, unknown>;
  customer_visible: boolean;
  photo_urls?: Record<string, string>;
};
export type ReportSave = {
  id?: string;
  revision?: number;
  property_id: string;
  kind: string;
  body: string;
  performed_on: string;
  publication_status: "draft" | "published";
  work_status: "completed" | "not_performed";
  not_performed_reason: string;
  started_at: string | null;
  finished_at: string | null;
  results: InspectionResult[];
  photo_paths: string[];
  reason: string;
};
export const resultOptions = {
  yesno: [
    ["absent", "無し"],
    ["present", "有り"],
  ],
  severity: [
    ["none", "無し"],
    ["little", "少しある"],
    ["many", "多い"],
    ["very_many", "かなり多い"],
  ],
  mail: [
    ["none", "無し"],
    ["report", "有り（報告のみ）"],
    ["collected", "有り（回収実施）"],
  ],
} as const;
export function resultLabel(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  const labels: Record<string, string> = {
    unconfirmed: "未確認",
    checked: "実施済み",
    not_performed: "未実施",
    completed: "実施済み",
    draft: "下書き",
    published: "公開済み",
    ...Object.fromEntries(
      Object.values(resultOptions)
        .flat()
        .map(([key, label]) => [key, label]),
    ),
  };
  return labels[String(value)] || String(value);
}
export function targetItems(
  items: InspectionItem[],
  subjects: InspectionSubject[],
  targets: InspectionTarget[],
  version: number,
) {
  const ids = new Set(
    subjects
      .filter(
        (s) =>
          s.template_version === version &&
          (!s.configurable ||
            targets.some((t) => t.subject_id === s.id && t.inspect)),
      )
      .map((s) => s.id),
  );
  return items.filter((i) => ids.has(i.subject_id));
}
