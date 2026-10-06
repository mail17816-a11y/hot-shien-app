import { buildInbox } from "./feed";
import type { Profile, Property, WorkRequest, Message } from "./Timeline";

export default function RequestInbox({
  requests,
  messages,
  properties,
  people,
  busy,
  messagesReady,
  onStatus,
  onOpen,
}: {
  requests: WorkRequest[];
  messages: Message[];
  properties: Property[];
  people: Profile[];
  busy: boolean;
  messagesReady: boolean;
  onStatus: (id: string, status: string) => Promise<void>;
  onOpen: (propertyId: string) => void;
}) {
  const entries = buildInbox(requests, messages);
  const formatDate = (date: string) =>
    new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(date));
  return (
    <section className="reception">
      <div className="section-title">
        <div>
          <h2>顧客からの受付一覧</h2>
          <small>
            全物件の作業依頼・お問い合わせ・メッセージを新しい順に表示します。
          </small>
        </div>
        <span>{entries.length}件</span>
      </div>
      {!messagesReady && (
        <p className="muted">
          メッセージ機能は準備中です。現在は作業依頼を表示しています。
        </p>
      )}
      {!entries.length ? (
        <div className="empty">
          顧客からの作業依頼・お問い合わせ・メッセージはありません。
        </div>
      ) : (
        <div className="inbox-scroll">
          <table className="inbox-table">
            <caption className="sr-only">
              全物件の顧客からの作業・問い合わせ受付
            </caption>
            <thead>
              <tr>
                <th scope="col">日時</th>
                <th scope="col">顧客番号</th>
                <th scope="col">物件番号</th>
                <th scope="col">種類</th>
                <th scope="col">内容</th>
                <th scope="col">対応状況</th>
                <th scope="col">確認・返信</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const row = entry.data;
                const customerId =
                  entry.type === "request"
                    ? entry.data.customer_id
                    : entry.data.author_id;
                const customerName =
                  people.find((person) => person.id === customerId)
                    ?.customer_number || "顧客";
                const property = properties.find(
                  (property) => property.id === row.property_id,
                );
                return (
                  <tr key={`${entry.type}:${row.id}`}>
                    <td>
                      <time dateTime={row.created_at}>
                        {formatDate(row.created_at)}
                      </time>
                    </td>
                    <td>{customerName}</td>
                    <td>{property?.property_number || "物件"}</td>
                    <td>
                      {entry.type === "request"
                        ? `作業依頼 · ${row.kind}`
                        : row.kind}
                    </td>
                    <td>
                      <p className="inbox-body" title={row.body}>
                        {row.body}
                      </p>
                    </td>
                    <td>
                      {entry.type === "request" ? (
                        <select
                          aria-label={`${customerName}・${property?.property_number || "物件"}・${formatDate(row.created_at)}の対応状況`}
                          value={entry.data.status}
                          disabled={busy}
                          onChange={(event) =>
                            onStatus(row.id, event.target.value)
                          }
                        >
                          {["受付待ち", "受付済み", "作業中", "完了"].map(
                            (status) => (
                              <option key={status}>{status}</option>
                            ),
                          )}
                        </select>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <button
                        className="quiet"
                        onClick={() => onOpen(row.property_id)}
                        aria-label={`${customerName}・${property?.property_number || "物件"}のコミュニケーションを開く`}
                      >
                        開く
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
