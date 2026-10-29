import { useEffect, useState, useRef, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase as db } from "./supabase";
import { loginEmail, normalizePropertyNumber, jwtIssuedAt } from "./login";
import ScreenNavigation from "./ScreenNavigation";
import ReportEditor from "./ReportEditor";
import PropertyInspectionSettings from "./PropertyInspectionSettings";
import type {
  InspectionSubject,
  InspectionItem,
  InspectionProfile,
  InspectionTarget,
  InspectionResult,
  ReportRevision,
  ReportSave,
} from "./inspections";
import type {
  ExpenseCorrection,
  InvoiceLineCorrection,
} from "./ExpenseCorrectionHistory";
import UserManagement, { type UserOperation } from "./UserManagement";
import RequestInbox from "./RequestInbox";
import ExpenseManagement, { type Expense } from "./Expenses";
import Billing, {
  type Contract,
  type Invoice,
  type InvoiceLine,
} from "./Billing";
import Timeline, {
  type Profile,
  type Property,
  type Report,
  type WorkRequest as Request,
  type Message,
  type Post,
} from "./Timeline";
const roles = { admin: "管理者", worker: "作業者", customer: "顧客" };
async function allRows<T>(
  table: string,
  order = "id",
  ascending = true,
  tieBreakers: string[] = ["id"],
) {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 500) {
    let query = db!.from(table).select("*").order(order, { ascending });
    for (const field of tieBreakers)
      if (field !== order) query = query.order(field);
    const result = await query.range(offset, offset + 499);
    if (result.error) throw result.error;
    rows.push(...(result.data as T[]));
    if (result.data.length < 500) return rows;
  }
}
const errorText = (e: unknown) =>
  e instanceof Error
    ? e.message
    : typeof e === "object" && e && "message" in e
      ? String(e.message)
      : "処理に失敗しました。再度お試しください。";
export default function App() {
  const generation = useRef(0);
  const renderGeneration = generation.current;
  const [session, setSession] = useState<Session | null>(null),
    [ready, setReady] = useState(false),
    [profile, setProfile] = useState<Profile | null>(null);
  const [properties, setProperties] = useState<Property[]>([]),
    [reports, setReports] = useState<Report[]>([]),
    [requests, setRequests] = useState<Request[]>([]),
    [people, setPeople] = useState<Profile[]>([]);
  const [messages, setMessages] = useState<Message[]>([]),
    [messagesReady, setMessagesReady] = useState(false);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [expenseCorrections, setExpenseCorrections] = useState<
    ExpenseCorrection[]
  >([]);
  const [invoiceCorrections, setInvoiceCorrections] = useState<
    InvoiceLineCorrection[]
  >([]);
  const [focusedReportId, setFocusedReportId] = useState("");
  const lastReportHash = useRef("");
  const [inspectionSubjects, setInspectionSubjects] = useState<
    InspectionSubject[]
  >([]);
  const [inspectionItems, setInspectionItems] = useState<InspectionItem[]>([]);
  const [inspectionProfiles, setInspectionProfiles] = useState<
    InspectionProfile[]
  >([]);
  const [inspectionTargets, setInspectionTargets] = useState<
    InspectionTarget[]
  >([]);
  const [inspectionResults, setInspectionResults] = useState<
    InspectionResult[]
  >([]);
  const [reportRevisions, setReportRevisions] = useState<ReportRevision[]>([]);
  const [editingReportId, setEditingReportId] = useState("");
  const [reportEditorOpen, setReportEditorOpen] = useState(true);
  const [configuringProperty, setConfiguringProperty] = useState("");
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invoiceLines, setInvoiceLines] = useState<InvoiceLine[]>([]);
  const [billingCustomer, setBillingCustomer] = useState("");
  const [reportFormVersion, setReportFormVersion] = useState(0);
  const [selected, setSelected] = useState(""),
    [propertySearch, setPropertySearch] = useState(""),
    [tab, setTab] = useState("timeline"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!db) {
      setReady(true);
      return;
    }
    let live = true;
    db.auth.getSession().then(({ data, error }) => {
      if (live) {
        setSession(data.session);
        setReady(true);
        if (error) setError(error.message);
      }
    });
    const { data } = db.auth.onAuthStateChange((_event, s) => {
      generation.current++;
      setBusy(false);
      setError("");
      setNotice("");
      setSession(s);
      setProfile(null);
      setProperties([]);
      setReports([]);
      setRequests([]);
      setPeople([]);
      setMessages([]);
      setExpenses([]);
      setInspectionSubjects([]);
      setInspectionItems([]);
      setInspectionProfiles([]);
      setInspectionTargets([]);
      setInspectionResults([]);
      setReportRevisions([]);
      setEditingReportId("");
      setReportEditorOpen(true);
      setConfiguringProperty("");
      setExpenseCorrections([]);
      setInvoiceCorrections([]);
      setFocusedReportId("");
      lastReportHash.current = "";
      setContracts([]);
      setInvoices([]);
      setInvoiceLines([]);
      setBillingCustomer("");
      setMessagesReady(false);
      setTab("timeline");
      setSelected("");
    });
    return () => {
      live = false;
      data.subscription.unsubscribe();
    };
  }, []);
  function clearReportFocus() {
    setFocusedReportId("");
    if (window.location.hash.startsWith("#report-")) {
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    }
    lastReportHash.current = "";
  }
  function openReport(id: string) {
    const report = reports.find((row) => row.id === id);
    if (!report) return;
    setTab("timeline");
    setSelected(report.property_id);
    setFocusedReportId(id);
    window.history.replaceState(null, "", `#report-${id}`);
    lastReportHash.current = window.location.hash;
  }
  useEffect(() => {
    function followReportLink() {
      const hash = window.location.hash;
      if (!hash.startsWith("#report-") || hash === lastReportHash.current)
        return;
      const id = hash.slice(8);
      const report = reports.find((row) => row.id === id);
      if (!report) return;
      setTab("timeline");
      setSelected(report.property_id);
      setFocusedReportId(id);
      lastReportHash.current = hash;
    }
    followReportLink();
    window.addEventListener("hashchange", followReportLink);
    return () => window.removeEventListener("hashchange", followReportLink);
  }, [reports]);
  async function load() {
    if (!db || !session || renderGeneration !== generation.current) return;
    const version = generation.current;
    const p = await db
      .from("profiles")
      .select("*")
      .eq("id", session.user.id)
      .single();
    if (version !== generation.current) return;
    if (p.error) throw p.error;
    if (
      p.data.auth_valid_after &&
      jwtIssuedAt(session.access_token) <= p.data.auth_valid_after
    ) {
      setError("アカウント情報が更新されました。ログインし直してください。");
      await db.auth.signOut({ scope: "local" });
      return;
    }
    if (!p.data.active)
      throw new Error(
        "このアカウントは停止されています。管理者にお問い合わせください。",
      );
    setProfile(p.data);
    const [a, reportRows, c, m] = await Promise.all([
      db.from("properties").select("*").order("property_number"),
      allRows<Report>("reports", "created_at", false),
      db
        .from("work_requests")
        .select("*")
        .order("created_at", { ascending: false }),
      db
        .from("property_messages")
        .select("*")
        .order("created_at", { ascending: true }),
    ]);
    if (version !== generation.current) return;
    if (a.error) throw a.error;
    if (c.error) throw c.error;
    setProperties(a.data);
    setRequests(c.data);
    if (m.error) {
      setMessages([]);
      setMessagesReady(false);
      if (!["PGRST205", "42P01"].includes(m.error.code)) throw m.error;
    } else {
      setMessages(m.data);
      setMessagesReady(true);
    }
    const hydrated = await Promise.all(
      reportRows.map(async (r: Report) => {
        if (!r.photo_paths.length) return { ...r, urls: [] };
        const result = await db!.storage
          .from("report-photos")
          .createSignedUrls(r.photo_paths, 3600);
        if (result.error) throw result.error;
        return {
          ...r,
          urls: result.data.map((x) => x.signedUrl || ""),
        };
      }),
    );
    if (version !== generation.current) return;
    setReports(hydrated);
    const [
      contractRows,
      invoiceRows,
      lineRows,
      expenseRows,
      correctionRows,
      invoiceCorrectionRows,
      subjects,
      items,
      profiles,
      targets,
      results,
      revisions,
    ] = await Promise.all([
      allRows<Contract>("customer_contracts", "created_at"),
      allRows<Invoice>("billing_invoices", "period", false),
      allRows<InvoiceLine>("billing_lines", "category", false),
      allRows<Expense>("report_expenses", "created_at", false),
      allRows<ExpenseCorrection>("expense_corrections", "created_at", false),
      allRows<InvoiceLineCorrection>(
        "invoice_line_corrections",
        "created_at",
        false,
      ),
      allRows<InspectionSubject>("inspection_subjects", "sort_order"),
      allRows<InspectionItem>("inspection_items", "sort_order"),
      allRows<InspectionProfile>(
        "property_inspection_profiles",
        "property_id",
        true,
        [],
      ),
      allRows<InspectionTarget>(
        "property_inspection_targets",
        "subject_id",
        true,
        ["property_id"],
      ),
      allRows<InspectionResult>("report_inspection_results", "item_id", true, [
        "report_id",
      ]),
      allRows<ReportRevision>("report_revisions", "created_at", false),
    ]);
    if (version !== generation.current) return;
    setContracts(contractRows);
    setInvoices(invoiceRows);
    setInvoiceLines(lineRows);
    setExpenses(expenseRows);
    setExpenseCorrections(correctionRows);
    setInvoiceCorrections(invoiceCorrectionRows);
    setInspectionSubjects(subjects);
    setInspectionItems(items);
    setInspectionProfiles(profiles);
    setInspectionTargets(targets);
    setInspectionResults(results);
    const historicalPaths = [
      ...new Set(
        revisions.flatMap((row) => [
          ...((row.before_values.photo_paths as string[]) || []),
          ...((row.after_values.photo_paths as string[]) || []),
        ]),
      ),
    ];
    const historicalUrls: Record<string, string> = {};
    for (let offset = 0; offset < historicalPaths.length; offset += 100) {
      const signed = await db.storage
        .from("report-photos")
        .createSignedUrls(historicalPaths.slice(offset, offset + 100), 3600);
      for (const entry of signed.data || [])
        if (entry.path && entry.signedUrl)
          historicalUrls[entry.path] = entry.signedUrl;
    }
    if (version !== generation.current) return;
    setReportRevisions(
      revisions.map((row) => ({ ...row, photo_urls: historicalUrls })),
    );
    if (p.data.role !== "customer") {
      const all = await db
        .from("profiles")
        .select("*")
        .order("customer_number");
      if (version !== generation.current) return;
      if (all.error) throw all.error;
      setPeople(all.data);
    }
  }
  useEffect(() => {
    let cancelled = false;
    if (session)
      load().catch((e) => {
        if (!cancelled) setError(errorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [session]);
  async function action(task: () => Promise<void>) {
    const operationGeneration = generation.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
      if (operationGeneration !== generation.current) return false;
      await load();
      if (operationGeneration !== generation.current) return false;
      setNotice("保存しました。");
      return true;
    } catch (e) {
      if (operationGeneration === generation.current) setError(errorText(e));
      return false;
    } finally {
      if (operationGeneration === generation.current) setBusy(false);
    }
  }
  async function saveUser(operation: UserOperation) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const {
        data: { session: current },
        error: sessionError,
      } = await db!.auth.getSession();
      if (sessionError || !current)
        throw new Error("ログインし直してください。");
      const response = await db!.functions.invoke("admin-users", {
        body: operation,
        headers: { Authorization: `Bearer ${current.access_token}` },
      });
      if (response.error) {
        let detail =
          "管理サーバーに接続できません。関数の公開と追加SQLの適用を確認してください。";
        if (response.error.context instanceof Response) {
          try {
            const payload = await response.error.context.json();
            detail = payload.error || detail;
          } catch {}
        }
        throw new Error(detail);
      }
      if (response.data?.error) throw new Error(response.data.error);
      const updated = response.data?.user as Profile | undefined;
      if (updated)
        setPeople((old) =>
          (old.some((person) => person.id === updated.id)
            ? old.map((person) => (person.id === updated.id ? updated : person))
            : [...old, updated]
          ).sort((a, b) => a.login_id.localeCompare(b.login_id)),
        );
      setNotice(
        operation.action === "delete"
          ? "ユーザーを削除済みにしました。履歴は保持しています。"
          : operation.action === "password"
            ? "パスワードを再設定しました。"
            : "ユーザー情報を保存しました。",
      );
      return true;
    } catch (error) {
      setError(errorText(error));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await action(async () => {
      const r = await db!.auth.signInWithPassword({
        email: loginEmail(String(f.get("login_id"))),
        password: String(f.get("password")),
      });
      if (r.error) throw r.error;
    });
  }
  function editReport(report: Report) {
    clearReportFocus();
    setSelected(report.property_id);
    setEditingReportId(report.id);
    setReportEditorOpen(true);
    setTab("report");
  }
  async function saveStructuredReport(
    data: ReportSave,
    files: File[],
    expenses: { item: string; amount_yen: number }[],
  ) {
    return action(async () => {
      const operationGeneration = generation.current;
      function requireSameSession() {
        if (operationGeneration !== generation.current)
          throw new Error("ログイン状態が変わったため操作を中断しました。");
      }
      if (data.photo_paths.length + files.length > 10)
        throw new Error("写真は合計10枚までです。");
      if (
        files.some(
          (file) =>
            file.size > 10 * 1024 * 1024 ||
            !["image/jpeg", "image/png", "image/webp"].includes(file.type),
        )
      )
        throw new Error("写真は10MB以下のJPEG・PNG・WebPを選んでください。");
      const creating = !data.id;
      let id = data.id || crypto.randomUUID(),
        revision = data.revision;
      const uploaded: string[] = [];
      if (creating) {
        const initial = await db!.rpc("save_patrol_report", {
          p_data: { ...data, id, publication_status: "draft", photo_paths: [] },
          p_expenses: expenses,
        });
        if (initial.error) throw initial.error;
        requireSameSession();
        revision = initial.data.revision;
        setReports((old) => [
          ...old.filter((row) => row.id !== id),
          initial.data as Report,
        ]);
        setInspectionResults((old) => [
          ...old.filter((row) => row.report_id !== id),
          ...data.results.map((row) => ({ ...row, report_id: id })),
        ]);
        setEditingReportId(id);
        setReportEditorOpen(true);
      }
      try {
        for (const file of files) {
          requireSameSession();
          const path = `${id}/${crypto.randomUUID()}`;
          const result = await db!.storage
            .from("report-photos")
            .upload(path, file, { contentType: file.type });
          if (result.error) throw result.error;
          uploaded.push(path);
        }
        requireSameSession();
        const saved = await db!.rpc("save_patrol_report", {
          p_data: {
            ...data,
            id,
            revision,
            photo_paths: [...data.photo_paths, ...uploaded],
            reason: creating
              ? data.publication_status === "published"
                ? "初回公開"
                : "写真を追加"
              : data.reason,
          },
          p_expenses: [],
        });
        if (saved.error) throw saved.error;
        requireSameSession();
        setReports((old) => [
          ...old.filter((row) => row.id !== id),
          saved.data as Report,
        ]);
        setInspectionResults((old) => [
          ...old.filter((row) => row.report_id !== id),
          ...data.results.map((row) => ({ ...row, report_id: id })),
        ]);
      } catch (error) {
        if (uploaded.length)
          await db!.storage.from("report-photos").remove(uploaded);
        await load().catch(() => {});
        throw error;
      }
      await load();
      requireSameSession();
      setEditingReportId("");
      setReportEditorOpen(false);
      setReportFormVersion((old) => old + 1);
      if (data.publication_status === "published") {
        setTab("timeline");
        setSelected(data.property_id);
        setFocusedReportId(id);
        window.history.replaceState(null, "", `#report-${id}`);
        lastReportHash.current = window.location.hash;
      }
    });
  }
  async function postMessage(post: Post) {
    if (!selected || !profile) {
      setError("投稿先の物件を選択してください。");
      return false;
    }
    if (!post.body) {
      setError("本文を入力してください。");
      return false;
    }
    if (post.kind !== "作業依頼" && !messagesReady) {
      setError("メッセージ機能の初期設定が必要です。");
      return false;
    }
    return action(async () => {
      const result =
        post.kind === "作業依頼"
          ? await db!.from("work_requests").insert({
              property_id: selected,
              customer_id: profile.id,
              kind: post.workKind,
              body: post.body,
            })
          : await db!.from("property_messages").insert({
              property_id: selected,
              author_id: profile.id,
              kind: post.kind,
              body: post.body,
            });
      if (result.error) throw result.error;
    });
  }
  async function changeStatus(id: string, status: string) {
    await action(async () => {
      const result = await db!
        .from("work_requests")
        .update({ status })
        .eq("id", id);
      if (result.error) throw result.error;
    });
  }
  const propertyRows = properties
    .map((property) => ({
      property,
      owner: people.find((person) => person.id === property.customer_id),
    }))
    .filter(({ property, owner }) =>
      [property.property_number, owner?.customer_number, owner?.login_id].some(
        (value) =>
          value?.toLowerCase().includes(propertySearch.trim().toLowerCase()),
      ),
    );
  const filteredRequests = requests.filter((r) => r.property_id === selected);
  if (!ready)
    return (
      <main className="login">
        <p role="status">読み込み中…</p>
      </main>
    );
  if (!session)
    return (
      <main className="login">
        <div className="intro">
          <span className="eyebrow">TOIRO · PROPERTY CARE</span>
          <h1>
            大切な物件に、
            <br />
            いつもの安心を。
          </h1>
          <p>
            巡回の記録も、日々のお手入れも。
            <br />
            物件の「いま」を、ひとつにつなぐ。
          </p>
          <span className="brand">
            Palette <b>Link</b>
            <i>●</i>
          </span>
        </div>
        <section className="login-card">
          <h2>ログイン</h2>
          <p className="muted">登録済みのアカウントでご利用ください。</p>
          {!db ? (
            <p role="alert">
              接続設定がありません。管理者が環境変数を設定してください。
            </p>
          ) : (
            <form onSubmit={login}>
              <label>
                ログインID
                <input
                  name="login_id"
                  type="text"
                  maxLength={32}
                  autoCapitalize="none"
                  spellCheck={false}
                  autoComplete="username"
                  required
                />
              </label>
              <label>
                パスワード
                <input
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </label>
              <button disabled={busy}>{busy ? "確認中…" : "ログイン"}</button>
            </form>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <small>アカウントについてはTOIROにお問い合わせください。</small>
        </section>
      </main>
    );
  return (
    <div className="app">
      <aside>
        <div className="brand">
          Palette <b>Link</b>
          <i>●</i>
        </div>
        <span className="eyebrow">物件定期巡回管理</span>
        <ScreenNavigation screen={tab}>
          {[
            ["timeline", "コミュニケーション"],
            [
              "requests",
              profile?.role === "customer"
                ? "追加作業の依頼"
                : "作業・問い合わせ受付",
            ],
            ...(profile?.role !== "customer"
              ? [["report", "作業報告を登録"]]
              : []),
            ...(profile?.role === "admin"
              ? [
                  ["properties", "物件管理"],
                  ["users", "ユーザー管理"],
                  ["expenses", "実費管理"],
                  ["billing", "契約・請求管理"],
                ]
              : []),
          ].map(([key, label]) => (
            <button
              className={tab === key ? "active" : ""}
              aria-current={tab === key ? "page" : undefined}
              onClick={() => {
                clearReportFocus();
                setTab(key);
              }}
              key={key}
            >
              {label}
            </button>
          ))}
        </ScreenNavigation>
        <div className="account">
          <b>
            {profile
              ? profile.customer_number || profile.login_id
              : "アカウント"}
          </b>
          <small>{profile && roles[profile.role]}</small>
          <button
            className="quiet"
            onClick={async () => {
              const r = await db!.auth.signOut();
              if (r.error) setError(r.error.message);
            }}
          >
            ログアウト
          </button>
        </div>
      </aside>
      <main className="content">
        <header>
          <div>
            <span className="eyebrow">YOUR PROPERTY, CONNECTED</span>
            <h1>
              {tab === "timeline"
                ? "物件のコミュニケーション"
                : tab === "requests"
                  ? profile?.role === "customer"
                    ? "追加作業の依頼"
                    : "作業・問い合わせ受付"
                  : tab === "report"
                    ? "作業報告を登録"
                    : tab === "properties"
                      ? "物件管理"
                      : tab === "expenses"
                        ? "実費管理"
                        : tab === "billing"
                          ? "契約・請求管理"
                          : "ユーザー管理"}
            </h1>
          </div>
          <button
            className="quiet"
            disabled={busy}
            onClick={() => action(async () => {})}
          >
            更新
          </button>
        </header>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="success" role="status">
            {notice}
          </p>
        )}
        {profile && (
          <>
            <section className="summary">
              <div>
                <small>管理物件</small>
                <strong>
                  {properties.length}
                  <em>件</em>
                </strong>
              </div>
              <div>
                <small>作業報告</small>
                <strong>
                  {reports.length}
                  <em>件</em>
                </strong>
              </div>
              <div>
                <small>未完了の依頼</small>
                <strong>
                  {requests.filter((r) => r.status !== "完了").length}
                  <em>件</em>
                </strong>
              </div>
            </section>
            {(tab === "timeline" ||
              tab === "report" ||
              (tab === "requests" && profile.role === "customer")) && (
              <label className="selector">
                対象の物件
                <select
                  value={selected}
                  onChange={(e) => {
                    clearReportFocus();
                    setSelected(e.target.value);
                    if (tab === "report") {
                      setEditingReportId("");
                      setReportEditorOpen(true);
                      setReportFormVersion((old) => old + 1);
                    }
                  }}
                >
                  <option value="" disabled>
                    物件を選択してください
                  </option>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.property_number}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {tab === "timeline" && !selected && (
              <div className="empty">
                物件を選択すると、報告・ご依頼・メッセージが表示されます。
              </div>
            )}
            {tab === "timeline" && selected && (
              <Timeline
                reports={reports}
                requests={requests}
                messages={messages}
                invoices={invoices}
                invoiceLines={invoiceLines}
                expenseCorrections={expenseCorrections}
                invoiceCorrections={invoiceCorrections}
                focusedReportId={focusedReportId}
                onOpenReport={openReport}
                onEditReport={editReport}
                inspectionSubjects={inspectionSubjects}
                inspectionItems={inspectionItems}
                inspectionResults={inspectionResults}
                reportRevisions={reportRevisions}
                expenses={expenses}
                properties={properties}
                selected={selected}
                profile={profile}
                busy={busy}
                messagesReady={messagesReady}
                onPost={postMessage}
                onStatus={changeStatus}
              />
            )}
            {tab === "report" && profile.role !== "customer" && (
              <>
                <div className="user-actions">
                  <button
                    disabled={busy}
                    onClick={() => {
                      setEditingReportId("");
                      setReportFormVersion((old) => old + 1);
                      setReportEditorOpen(true);
                    }}
                  >
                    新しい報告を作成
                  </button>
                </div>
                {reportEditorOpen && (
                  <ReportEditor
                    key={`${editingReportId || "new"}:${selected}:${reports.find((r) => r.id === editingReportId)?.revision || 0}:${inspectionProfiles.find((p) => p.property_id === selected)?.updated_at || ""}:${reportFormVersion}`}
                    report={reports.find((r) => r.id === editingReportId)}
                    property={properties.find((p) => p.id === selected)}
                    subjects={inspectionSubjects}
                    items={inspectionItems}
                    profile={inspectionProfiles.find(
                      (p) => p.property_id === selected,
                    )}
                    targets={inspectionTargets.filter(
                      (t) => t.property_id === selected,
                    )}
                    results={inspectionResults.filter(
                      (r) => r.report_id === editingReportId,
                    )}
                    busy={busy}
                    onSave={saveStructuredReport}
                    onClose={() => {
                      setReportEditorOpen(false);
                      setEditingReportId("");
                    }}
                  />
                )}
                <section className="panel">
                  <h2>報告一覧・下書き</h2>
                  {reports
                    .filter(
                      (r) =>
                        (!selected || r.property_id === selected) &&
                        (profile.role === "admin" ||
                          r.author_id === profile.id),
                    )
                    .map((report) => (
                      <article className="report-list-row" key={report.id}>
                        <span>
                          {report.performed_on} ／{" "}
                          {
                            properties.find((p) => p.id === report.property_id)
                              ?.property_number
                          }{" "}
                          ／ {report.kind} ／{" "}
                          {report.publication_status === "draft"
                            ? "下書き"
                            : "公開済み"}
                        </span>
                        <button
                          className="quiet"
                          disabled={busy}
                          onClick={() => editReport(report)}
                        >
                          報告を編集
                        </button>
                      </article>
                    ))}
                </section>
              </>
            )}
            {tab === "requests" && profile.role !== "customer" && (
              <RequestInbox
                requests={requests}
                messages={messages}
                properties={properties}
                people={people}
                busy={busy}
                messagesReady={messagesReady}
                onStatus={changeStatus}
                onOpen={(propertyId) => {
                  clearReportFocus();
                  setSelected(propertyId);
                  setTab("timeline");
                }}
              />
            )}
            {tab === "requests" && profile.role === "customer" && (
              <section>
                {profile.role === "customer" && (
                  <div className="panel">
                    <h2>作業を依頼する</h2>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const form = e.currentTarget,
                          f = new FormData(form);
                        action(async () => {
                          const r = await db!.from("work_requests").insert({
                            property_id: selected,
                            customer_id: profile.id,
                            kind: f.get("kind"),
                            body: f.get("body"),
                          });
                          if (r.error) throw r.error;
                          form.reset();
                        });
                      }}
                    >
                      <p className="muted">
                        対象の物件を選び、ご希望の作業をお知らせください。
                      </p>
                      <label>
                        作業種別
                        <select name="kind">
                          <option>除草・清掃</option>
                          <option>郵便物転送</option>
                          <option>その他</option>
                        </select>
                      </label>
                      <label>
                        ご依頼内容
                        <textarea
                          name="body"
                          rows={3}
                          maxLength={5000}
                          required
                        />
                      </label>
                      <button disabled={busy || !selected}>依頼を送信</button>
                    </form>
                  </div>
                )}
                <h2>依頼一覧</h2>
                {!filteredRequests.length && (
                  <div className="empty">追加作業の依頼はありません。</div>
                )}
                {filteredRequests.map((r) => (
                  <article className="panel" key={r.id}>
                    <div className="report-top">
                      <span className="tag">{r.status}</span>
                      <time>
                        {new Date(r.created_at).toLocaleDateString("ja-JP")}
                      </time>
                    </div>
                    <h3>
                      {r.kind} ·{" "}
                      {
                        properties.find((p) => p.id === r.property_id)
                          ?.property_number
                      }
                    </h3>
                    <p className="body">{r.body}</p>
                  </article>
                ))}
              </section>
            )}
            {tab === "properties" && profile.role === "admin" && (
              <section className="panel">
                <h2>物件一覧</h2>
                <details className="panel property-registration">
                  <summary>新しい物件を登録</summary>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const form = e.currentTarget,
                        f = new FormData(form);
                      action(async () => {
                        const r = await db!.from("properties").insert({
                          customer_id: f.get("customer"),
                          property_number: normalizePropertyNumber(
                            String(f.get("property_number")),
                          ),
                        });
                        if (r.error) throw r.error;
                        form.reset();
                      });
                    }}
                  >
                    <p className="muted">
                      氏名・住所はローカル台帳で管理します。台帳に対応する物件番号を指定してください。
                    </p>
                    <label>
                      物件番号
                      <input name="property_number" maxLength={64} required />
                    </label>
                    <label>
                      契約者の顧客番号
                      <select name="customer" required>
                        <option value="">顧客を選択</option>
                        {people
                          .filter(
                            (p) =>
                              p.role === "customer" &&
                              p.active &&
                              !p.deleted_at,
                          )
                          .map((p) => (
                            <option value={p.id} key={p.id}>
                              {p.customer_number || p.login_id}
                            </option>
                          ))}
                      </select>
                    </label>
                    <button disabled={busy}>物件を登録</button>
                  </form>
                </details>
                <label>
                  物件を検索
                  <input
                    type="search"
                    value={propertySearch}
                    onChange={(e) => setPropertySearch(e.target.value)}
                    placeholder="物件番号・顧客番号・ログインID"
                  />
                </label>
                <div className="inbox-scroll">
                  <table className="inbox-table">
                    <caption className="sr-only">物件一覧</caption>
                    <thead>
                      <tr>
                        <th scope="col">物件番号</th>
                        <th scope="col">顧客番号</th>
                        <th scope="col">ログインID</th>
                        <th scope="col">設備・点検対象</th>
                      </tr>
                    </thead>
                    <tbody>
                      {propertyRows.map(({ property, owner }) => (
                        <tr key={property.id}>
                          <td>{property.property_number}</td>
                          <td>{owner?.customer_number || "—"}</td>
                          <td>{owner?.login_id || "—"}</td>
                          <td>
                            <button
                              className="quiet"
                              disabled={busy}
                              onClick={() =>
                                setConfiguringProperty(property.id)
                              }
                            >
                              点検対象を設定
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {configuringProperty && (
                  <PropertyInspectionSettings
                    key={`${configuringProperty}:${inspectionProfiles.find((p) => p.property_id === configuringProperty)?.updated_at || ""}`}
                    propertyNumber={
                      properties.find((p) => p.id === configuringProperty)
                        ?.property_number || ""
                    }
                    subjects={inspectionSubjects}
                    targets={inspectionTargets.filter(
                      (t) => t.property_id === configuringProperty,
                    )}
                    busy={busy}
                    onClose={() => setConfiguringProperty("")}
                    onSave={(targets) =>
                      action(async () => {
                        const result = await db!.rpc(
                          "save_inspection_targets",
                          {
                            p_property_id: configuringProperty,
                            p_targets: targets,
                          },
                        );
                        if (result.error) throw result.error;
                      })
                    }
                  />
                )}
                <p role="status">
                  {propertyRows.length}件 / 全{properties.length}件
                </p>
                {!propertyRows.length && (
                  <p role="status">
                    {propertySearch.trim()
                      ? "該当する物件はありません。"
                      : "登録されている物件はありません。"}
                  </p>
                )}
              </section>
            )}
            {tab === "expenses" && profile.role === "admin" && (
              <ExpenseManagement
                expenses={expenses}
                reports={reports}
                properties={properties}
                busy={busy}
                onSave={async (expense, item, amount, reason) =>
                  action(async () => {
                    if (
                      !item ||
                      item.length > 200 ||
                      !Number.isInteger(amount) ||
                      amount < 1 ||
                      amount > 999999999
                    )
                      throw new Error("項目と金額を確認してください。");
                    if (!reason || reason.length > 2000)
                      throw new Error(
                        "訂正理由を1〜2000文字で入力してください。",
                      );
                    const result = await db!.rpc("correct_report_expense", {
                      p_data: {
                        id: expense.id,
                        item,
                        amount_yen: amount,
                        reason,
                        original_item: expense.item,
                        original_amount_yen: expense.amount_yen,
                      },
                    });
                    if (result.error) throw result.error;
                  })
                }
              />
            )}
            {tab === "billing" && profile.role === "admin" && (
              <Billing
                users={people}
                properties={properties}
                contracts={contracts}
                invoices={invoices}
                lines={invoiceLines}
                invoiceCorrections={invoiceCorrections}
                expenses={expenses}
                reports={reports}
                customerId={billingCustomer}
                onCustomer={setBillingCustomer}
                busy={busy}
                onAction={(kind, data) =>
                  action(async () => {
                    const result = await db!.rpc("billing_action", {
                      p_action: kind,
                      p_data: data,
                    });
                    if (result.error) throw result.error;
                  })
                }
              />
            )}
            {tab === "users" && profile.role === "admin" && (
              <section className="panel">
                <UserManagement
                  users={people}
                  currentUserId={profile.id}
                  busy={busy}
                  onSave={saveUser}
                  onContracts={(id) => {
                    setBillingCustomer(id);
                    setTab("billing");
                  }}
                />
              </section>
            )}
          </>
        )}
        <footer>Palette Link · TOIRO</footer>
      </main>
    </div>
  );
}
