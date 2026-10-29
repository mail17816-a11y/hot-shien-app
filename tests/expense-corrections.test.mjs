import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

test("実費訂正の理由・履歴・請求同期・顧客分離・撤回履歴を検証する", async () => {
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
    const revise = (
      uuid,
      originalItem,
      originalAmount,
      item,
      amount,
      reason = "電話で調整",
    ) =>
      db.query("select public.correct_report_expense($1) id", [
        JSON.stringify({
          id: uuid,
          original_item: originalItem,
          original_amount_yen: originalAmount,
          item,
          amount_yen: amount,
          reason,
        }),
      ]);
    const value = async (uuid) =>
      (
        await db.query(
          "select item,amount_yen from public.report_expenses where id=$1",
          [uuid],
        )
      ).rows[0];
    const count = async (table) =>
      (await db.query(`select count(*)::int n from public.${table}`)).rows[0].n;
    const total = async (uuid) =>
      (
        await db.query(
          "select sum(amount_yen)::int n from public.billing_lines where invoice_id=$1",
          [uuid],
        )
      ).rows[0].n;
    for (const who of [worker, customer, other])
      await assert.rejects(
        as(who, () => revise(expense, "送料", 430, "送料", 500)),
        /管理者権限/,
      );
    for (const reason of ["", "  ", "x".repeat(2001)])
      await assert.rejects(
        as(admin, () => revise(expense, "送料", 430, "送料", 500, reason)),
        /訂正理由/,
      );
    await assert.rejects(
      as(admin, () => revise(expense, "送料", 430, "送料", 0)),
      /項目と金額/,
    );
    await assert.rejects(
      as(admin, () => revise(expense, "送料", 430, "送料", 430)),
      /変更する/,
    );
    assert.equal(await count("expense_corrections"), 0);
    await assert.rejects(
      as(admin, () =>
        db.query(
          "update public.report_expenses set amount_yen=500 where id=$1",
          [expense],
        ),
      ),
      /permission denied/,
    );
    await as(admin, () => revise(expense, "送料", 430, "郵送代", 500));
    assert.deepEqual(await value(expense), { item: "郵送代", amount_yen: 500 });
    let history = (
      await db.query(
        "select * from public.expense_corrections where expense_id=$1",
        [expense],
      )
    ).rows;
    assert.equal(history[0].old_amount_yen, 430);
    assert.equal(history[0].new_amount_yen, 500);
    assert.equal(history[0].actor_id, admin);
    assert.equal(history[0].reason, "電話で調整");
    assert.ok(history[0].created_at);
    await assert.rejects(
      as(admin, () => revise(expense, "送料", 430, "送料", 999)),
      /更新されています/,
    );
    await as(admin, () => call("contract", contract()));
    const invoice = await as(admin, () =>
      call("invoice", bill("2026-11-01", [expense])),
    );
    assert.equal(await total(invoice), 1000);
    await as(admin, () => revise(expense, "郵送代", 500, "送料調整", 600));
    assert.equal(await total(invoice), 1100, "下書きにも実費訂正を反映する");
    await as(customer, async () => {
      assert.equal(
        await count("invoice_line_corrections"),
        0,
        "下書きの請求訂正は顧客に非公開",
      );
      assert.equal(
        await count("expense_corrections"),
        2,
        "報告の実費訂正は顧客が読める",
      );
    });
    await as(admin, () => call("invoice", bill("2026-11-01", [expense])));
    assert.equal(await total(invoice), 1100);
    assert.equal(
      (await db.query("select line_id from public.invoice_line_corrections"))
        .rows[0].line_id,
      null,
      "下書き再作成後も訂正履歴を保持する",
    );
    await as(admin, () => call("publish", { id: invoice }));
    await as(admin, () => revise(expense, "送料調整", 600, "送料調整", 650));
    assert.equal(await total(invoice), 1150, "公開後も訂正を反映する");
    await as(customer, async () =>
      assert.equal(await count("invoice_line_corrections"), 2),
    );
    const before = await count("expense_corrections");
    await db.exec(`create function public.fail_correction() returns trigger language plpgsql as $$begin raise exception 'rollback-check'; end;$$;
      create trigger fail_correction before insert on public.invoice_line_corrections for each row execute function public.fail_correction();`);
    await assert.rejects(
      as(admin, () => revise(expense, "送料調整", 650, "失敗", 999)),
      /rollback-check/,
    );
    assert.equal(
      await count("expense_corrections"),
      before,
      "履歴も一括でロールバックする",
    );
    assert.equal((await value(expense)).amount_yen, 650);
    assert.equal(await total(invoice), 1150);
    await db.exec(
      "drop trigger fail_correction on public.invoice_line_corrections;drop function public.fail_correction()",
    );
    for (const table of ["expense_corrections", "invoice_line_corrections"]) {
      await assert.rejects(
        as(admin, () => db.exec(`delete from public.${table}`)),
        /permission denied/,
      );
      await assert.rejects(
        as(admin, () => db.exec(`update public.${table} set reason='tamper'`)),
        /permission denied/,
      );
    }
    await as(admin, () =>
      revise(foreignExpense, "送料", 100, "別顧客の実費", 150),
    );
    await as(customer, async () =>
      assert.equal(await count("expense_corrections"), 3),
    );
    await as(other, async () => {
      assert.equal(await count("expense_corrections"), 1);
      assert.equal(await count("invoice_line_corrections"), 0);
    });
    await as(worker, async () => {
      assert.equal(await count("expense_corrections"), 4);
      assert.equal(await count("invoice_line_corrections"), 0);
    });
    await assert.rejects(
      db.exec(
        `begin;set local role anon; select * from public.expense_corrections;commit`,
      ),
      /permission denied/,
    );
    await db.exec("rollback");
    await as(admin, () =>
      call("cancel", { id: invoice, customer_id: customer }),
    );
    await as(admin, () => revise(expense, "送料調整", 650, "電話調整後", 700));
    assert.equal(await total(invoice), 1150, "撤回済み請求の金額は保持する");
    const replacement = await as(admin, () =>
      call("invoice", bill("2026-11-01", [expense])),
    );
    assert.equal(await total(replacement), 1200);
    await as(admin, () => call("publish", { id: replacement }));
    await as(admin, () =>
      revise(expense, "電話調整後", 700, "電話調整後", 750),
    );
    assert.equal(await total(replacement), 1250);
    assert.equal(await total(invoice), 1150);
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from public.billing_lines where invoice_id=$1",
          [replacement],
        )
      ).rows[0].n,
      2,
      "訂正で請求明細を重複作成しない",
    );
    await assert.rejects(
      db.query("delete from public.report_expenses where id=$1", [expense]),
      /削除できません/,
    );
    await db.query("update public.profiles set active=false where id=$1", [
      customer,
    ]);
    await as(customer, async () =>
      assert.equal(await count("expense_corrections"), 0),
    );
    await db.query("update public.profiles set active=false where id=$1", [
      admin,
    ]);
    await assert.rejects(
      as(admin, () => revise(expense, "電話調整後", 750, "不正", 999)),
      /管理者権限/,
    );
  } finally {
    await db.close();
  }
});
