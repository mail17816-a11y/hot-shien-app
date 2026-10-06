export type TimelineSource = {
  id: string;
  property_id: string;
  created_at: string;
};

export function buildTimeline<
  R extends TimelineSource,
  W extends TimelineSource,
  M extends TimelineSource,
>(reports: R[], requests: W[], messages: M[], propertyId: string) {
  const entries = [
    ...reports.map((data) => ({ type: "report" as const, data })),
    ...requests.map((data) => ({ type: "request" as const, data })),
    ...messages.map((data) => ({ type: "message" as const, data })),
  ];
  return entries
    .filter((entry) => !propertyId || entry.data.property_id === propertyId)
    .sort(
      (a, b) =>
        Date.parse(a.data.created_at) - Date.parse(b.data.created_at) ||
        `${a.type}:${a.data.id}`.localeCompare(`${b.type}:${b.data.id}`),
    );
}
