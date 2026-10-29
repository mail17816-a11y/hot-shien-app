import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

test("物件点検対象・下書き公開・未実施・報告訂正・写真履歴を検証する", async () => {
  const db = new PGlite();
  const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  const admin = id(1),
    worker = id(2),
    customer = id(3),
    other = id(4),
    property = id(10),
    second = id(11),
    foreign = id(12);
  async function as(user, fn) {
    await db.exec(
      `begin;set local role authenticated;set local request.jwt.claim.sub='${user}';set local request.jwt.claims='{"iat":2000000000}';`,
    );
    try {
      const result = await fn();
      await db.exec("commit");
      return result;
    } catch (e) {
      await db.exec("rollback");
      throw e;
    }
  }
  const call = async (action, data) =>
    (
      await db.query("select public.billing_action($1,$2) as id", [
        action,
        JSON.stringify(data),
      ])
    ).rows[0].id;
  const contract = (overrides = {}) => ({
    customer_id: customer,
    property_id: property,
    item: "システム利用料",
    amount_yen: 500,
    billing_cycle: "monthly",
    starts_on: "2026-10-01",
    ends_on: "",
    effective_from: "2026-10-01",
    status: "active",
    ...overrides,
  });
  const bill = (period, expense_ids = []) => ({
    customer_id: customer,
    period,
    expense_ids,
  });
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;grant usage on schema auth to authenticated;
      create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
      create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
      create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;`);
    for (const file of ["001_initial.sql", "002_property_messages.sql"])
      await db.exec(
        await readFile(
          new URL(`../supabase/migrations/${file}`, import.meta.url),
          "utf8",
        ),
      );
    for (const [uuid, email] of [
      [admin, "admin@example.com"],
      [worker, "worker@example.com"],
      [customer, "customer@example.com"],
      [other, "other@example.com"],
    ])
      await db.query("insert into auth.users(id,email) values($1,$2)", [
        uuid,
        email,
      ]);
    await db.query("update public.profiles set role='admin' where id=$1", [
      admin,
    ]);
    await db.query("update public.profiles set role='worker' where id=$1", [
      worker,
    ]);
    for (const file of [
      "003_identifier_only.sql",
      "20261018110758_admin_user_management.sql",
      "20261018230614_report_expenses.sql",
      "20261018232719_customer_contract_billing.sql",
      "20261019090103_withdraw_billing_invoice.sql",
      "20261020094003_flexible_billing_cycles.sql",
      "20261020100826_customer_report_expenses.sql",
      "20261028224011_expense_corrections.sql",
    ])
      await db.exec(
        await readFile(
          new URL(`../supabase/migrations/${file}`, import.meta.url),
          "utf8",
        ),
      );
    await db.query(
      "insert into public.properties(id,customer_id,property_number) values($1,$2,'P1'),($3,$2,'P2'),($4,$5,'OTHER')",
      [property, customer, second, foreign, other],
    );
    await as(worker, async () => {
      for (const [report, prop, date, cost] of [
        [id(20), property, "2026-10-19", 430],
        [id(21), foreign, "2026-10-19", 100],
        [id(22), property, "2026-12-01", 200],
      ])
        await db.query(
          "select public.create_report_with_expenses($1,$2,'定期巡回','報告',$3,$4)",
          [
            report,
            prop,
            date,
            JSON.stringify([{ item: "送料", amount_yen: cost }]),
          ],
        );
    });
    const expenses = (
      await db.query("select * from public.report_expenses order by amount_yen")
    ).rows;
    const expense = expenses.find((row) => row.amount_yen === 430).id,
      foreignExpense = expenses.find((row) => row.amount_yen === 100).id,
      future = expenses.find((row) => row.amount_yen === 200).id;
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/20261028225758_patrol_inspection_reports.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(
      "grant usage on schema storage to authenticated;alter table storage.objects enable row level security; grant select,insert,delete on storage.objects to authenticated",
    );
    const catalog = (
      await db.query(
        "select * from public.inspection_subjects where configurable order by sort_order",
      )
    ).rows;
    const settings = catalog.map((row) => ({
      subject_id: row.id,
      availability: row.id === "v1_balcony" ? "absent" : "present",
      inspect: row.id !== "v1_balcony",
      reason: "",
    }));
    const configure = (rows = settings) =>
      db.query("select public.save_inspection_targets($1,$2)", [
        property,
        JSON.stringify(rows),
      ]);
    await assert.rejects(
      as(worker, () => configure()),
      /管理者権限/,
    );
    await as(admin, () => configure());
    const ids = (
      await db.query(
        "select i.* from public.inspection_items i join public.inspection_subjects s on s.id=i.subject_id where not s.configurable or exists(select 1 from public.property_inspection_targets t where t.property_id=$1 and t.subject_id=s.id and t.inspect)",
        [property],
      )
    ).rows;
    assert.equal(
      (await db.query("select count(*)::int n from public.inspection_items"))
        .rows[0].n,
      40,
    );
    const draft = {
      id: id(30),
      property_id: property,
      kind: "定期巡回",
      body: "巡回報告",
      performed_on: "2026-10-20",
      started_at: "2026-10-20T09:00:00+09:00",
      finished_at: "2026-10-20T09:30:00+09:00",
      work_status: "completed",
      not_performed_reason: "",
      publication_status: "draft",
      photo_paths: [],
      results: ids.map((i) => ({
        item_id: i.id,
        status: "unconfirmed",
        result: null,
        reason: "",
        memo: "",
      })),
    };
    const save = async (data, costs = []) =>
      (
        await db.query("select public.save_patrol_report($1,$2) result", [
          JSON.stringify(data),
          JSON.stringify(costs),
        ])
      ).rows[0].result;
    const ready = {
      ...draft,
      publication_status: "published",
      results: ids.map((i) => ({
        item_id: i.id,
        status: "checked",
        result: i.result_kind === "yesno" ? "absent" : "none",
        reason: "",
        memo: "",
      })),
    };
    await assert.rejects(
      as(customer, () => save(draft)),
      /編集権限/,
    );
    await assert.rejects(
      as(worker, () => save({ ...draft, property_id: foreign })),
      /先に設定/,
    );
    const created = await as(worker, () =>
      save(draft, [{ item: "送料", amount_yen: 500 }]),
    );
    assert.equal(created.revision, 1);
    const originalCreated = (
      await db.query("select created_at from public.reports where id=$1", [
        draft.id,
      ])
    ).rows[0].created_at;
    await as(customer, async () => {
      assert.equal(
        (await db.query("select * from public.reports where id=$1", [draft.id]))
          .rows.length,
        0,
      );
      assert.equal(
        (
          await db.query(
            "select * from public.report_expenses where report_id=$1",
            [draft.id],
          )
        ).rows.length,
        0,
      );
      assert.equal(
        (
          await db.query(
            "select * from public.report_inspection_results where report_id=$1",
            [draft.id],
          )
        ).rows.length,
        0,
      );
    });
    const draftExpense = (
      await db.query(
        "select id from public.report_expenses where report_id=$1",
        [draft.id],
      )
    ).rows[0].id;
    await as(admin, () =>
      db.query("select public.correct_report_expense($1)", [
        JSON.stringify({
          id: draftExpense,
          original_item: "送料",
          original_amount_yen: 500,
          item: "送料",
          amount_yen: 550,
          reason: "下書き内の調整",
        }),
      ]),
    );
    await assert.rejects(
      as(worker, () =>
        db.query(
          "select public.create_report_with_expenses($1,$2,'定期巡回','旧API','2026-10-20','[]')",
          [id(99), property],
        ),
      ),
      /permission denied/,
    );
    await assert.rejects(
      as(admin, () => call("invoice", bill("2026-10-01", [draftExpense]))),
      /選択した実費/,
    );
    await assert.rejects(
      as(worker, () =>
        save({
          ...draft,
          revision: 1,
          publication_status: "published",
          reason: "公開",
        }),
      ),
      /未確認/,
    );
    await assert.rejects(
      as(worker, () =>
        save({
          ...ready,
          revision: 1,
          reason: "公開",
          started_at: null,
          finished_at: null,
        }),
      ),
      /開始・終了/,
    );
    await assert.rejects(
      as(worker, () =>
        save({
          ...ready,
          revision: 1,
          reason: "公開",
          results: ready.results.slice(1),
        }),
      ),
      /点検対象/,
    );
    await assert.rejects(
      as(worker, () =>
        save({
          ...ready,
          revision: 1,
          reason: "公開",
          results: [...ready.results, ready.results[0]],
        }),
      ),
      /点検対象/,
    );
    await assert.rejects(
      as(worker, () =>
        save({
          ...ready,
          revision: 1,
          reason: "公開",
          results: ready.results.map((r, i) =>
            i ? r : { ...r, result: "invalid" },
          ),
        }),
      ),
      /点検結果/,
    );
    const picture = `${draft.id}/sample-photo`;
    await as(worker, () =>
      db.query(
        "insert into storage.objects(bucket_id,name) values('report-photos',$1)",
        [picture],
      ),
    );
    await as(customer, async () =>
      assert.equal(
        (
          await db.query("select * from storage.objects where name=$1", [
            picture,
          ])
        ).rows.length,
        0,
      ),
    );
    const published = await as(worker, () =>
      save({
        ...ready,
        revision: 1,
        reason: "初回公開",
        photo_paths: [picture],
      }),
    );
    assert.equal(published.revision, 2);
    await as(customer, async () => {
      assert.equal(
        (await db.query("select * from public.reports where id=$1", [draft.id]))
          .rows.length,
        1,
      );
      assert.equal(
        (
          await db.query(
            "select * from public.report_inspection_results where report_id=$1",
            [draft.id],
          )
        ).rows.length,
        ids.length,
      );
      assert.equal(
        (
          await db.query(
            "select * from public.report_revisions where report_id=$1",
            [draft.id],
          )
        ).rows.length,
        0,
        "公開前の編集履歴は顧客に非表示",
      );
      assert.equal(
        (
          await db.query("select * from storage.objects where name=$1", [
            picture,
          ])
        ).rows.length,
        1,
      );
    });
    await as(customer, async () =>
      assert.equal(
        (
          await db.query(
            "select * from public.expense_corrections where report_id=$1",
            [draft.id],
          )
        ).rows.length,
        0,
        "公開前の実費訂正は顧客に通知・表示しない",
      ),
    );
    await as(other, async () =>
      assert.equal(
        (await db.query("select * from public.reports where id=$1", [draft.id]))
          .rows.length,
        0,
      ),
    );
    await as(admin, () =>
      configure(
        settings.map((r) =>
          r.subject_id === "v1_roof"
            ? { ...r, availability: "absent", inspect: false }
            : r,
        ),
      ),
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from public.report_inspection_results where report_id=$1",
          [draft.id],
        )
      ).rows[0].n,
      ids.length,
      "後の物件設定変更で報告対象は変わらない",
    );
    const corrected = {
      ...ready,
      revision: 2,
      reason: "電話で確認したため",
      body: "本文を訂正",
      photo_paths: [],
      results: ready.results.map((r, i) =>
        i ? r : { ...r, result: "present", memo: "破損を確認" },
      ),
    };
    await as(worker, () => save(corrected));
    const audit = (
      await db.query(
        "select * from public.report_revisions where report_id=$1 and customer_visible",
        [draft.id],
      )
    ).rows[0];
    assert.equal(audit.actor_id, worker);
    assert.equal(audit.reason, corrected.reason);
    assert.equal(audit.before_values.body, "巡回報告");
    assert.equal(audit.after_values.body, "本文を訂正");
    assert.ok(audit.after_values["check:" + ids[0].id]);
    assert.deepEqual(audit.before_values.photo_paths, [picture]);
    assert.equal(
      (
        await db.query("select created_at from public.reports where id=$1", [
          draft.id,
        ])
      ).rows[0].created_at.getTime(),
      originalCreated.getTime(),
    );
    await as(customer, async () => {
      assert.equal(
        (
          await db.query(
            "select * from public.report_revisions where report_id=$1",
            [draft.id],
          )
        ).rows.length,
        1,
      );
      assert.equal(
        (
          await db.query("select * from storage.objects where name=$1", [
            picture,
          ])
        ).rows.length,
        1,
        "訂正前の写真も履歴から参照できる",
      );
    });
    await as(worker, async () =>
      assert.equal(
        (
          await db.query(
            "delete from storage.objects where name=$1 returning id",
            [picture],
          )
        ).rows.length,
        0,
        "履歴写真は削除できない",
      ),
    );
    await assert.rejects(
      as(worker, () => save(corrected)),
      /更新されています/,
    );
    await assert.rejects(
      as(worker, () => save({ ...corrected, revision: 3, reason: "" })),
      /編集理由/,
    );
    await assert.rejects(
      as(worker, () =>
        save({ ...corrected, revision: 3, publication_status: "draft" }),
      ),
      /下書き/,
    );
    await assert.rejects(
      as(worker, () =>
        db.query("update public.reports set photo_paths='{}' where id=$1", [
          draft.id,
        ]),
      ),
      /permission denied/,
    );
    await assert.rejects(
      as(admin, () => db.exec("delete from public.report_revisions")),
      /permission denied/,
    );
    await db.exec(
      `create function public.fail_revision() returns trigger language plpgsql as $$begin raise exception 'rollback-revision';end;$$;create trigger fail_revision before insert on public.report_revisions for each row execute function public.fail_revision();`,
    );
    await assert.rejects(
      as(worker, () =>
        save({ ...corrected, revision: 3, body: "失敗する本文" }),
      ),
      /rollback-revision/,
    );
    assert.equal(
      (
        await db.query("select body,revision from public.reports where id=$1", [
          draft.id,
        ])
      ).rows[0].body,
      "本文を訂正",
    );
    await db.exec(
      "drop trigger fail_revision on public.report_revisions;drop function public.fail_revision()",
    );
    const currentIds = ready.results.filter(
      (r) => !r.item_id.startsWith("v1_roof_"),
    );
    const skipped = {
      ...ready,
      id: id(31),
      results: currentIds.map((r) => ({
        ...r,
        status: "not_performed",
        result: null,
        reason: "悪天候",
      })),
      work_status: "not_performed",
      not_performed_reason: "悪天候により現地へ到達できなかった",
      started_at: null,
      finished_at: null,
    };
    await as(worker, () => save(skipped));
    await assert.rejects(
      as(worker, () =>
        save({ ...skipped, id: id(32), not_performed_reason: "" }),
      ),
      /未実施の理由/,
    );
    await assert.rejects(
      as(worker, () => save({ ...skipped, id: id(32), results: currentIds })),
      /各項目も未実施/,
    );
    await assert.rejects(
      as(worker, () =>
        save({ ...skipped, id: id(32), photo_paths: [picture] }),
      ),
      /写真/,
    );
    await db.query(
      "insert into auth.users(id,email) values($1,'secondworker@example.com')",
      [id(5)],
    );
    await db.query(
      "update public.profiles set role='worker',customer_number=null where id=$1",
      [id(5)],
    );
    await assert.rejects(
      as(id(5), () => save({ ...corrected, revision: 3 })),
      /編集できません/,
    );
    await as(admin, () =>
      save({ ...corrected, revision: 3, body: "管理者が訂正" }),
    );
    await assert.rejects(
      db.exec(
        "begin;set local role anon;select public.save_patrol_report('{}','[]');commit",
      ),
      /permission denied/,
    );
    await db.exec("rollback");
    await db.query("update public.profiles set active=false where id=$1", [
      worker,
    ]);
    await assert.rejects(
      as(worker, () => save({ ...skipped, id: id(32) })),
      /編集権限/,
    );
  } finally {
    await db.close();
  }
});
