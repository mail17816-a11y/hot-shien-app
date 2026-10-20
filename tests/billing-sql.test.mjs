import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

test("契約・請求の保存、顧客分離、年払い、実費ロック、公開を実DBで検証する", async () => {
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
    await assert.rejects(
      as(worker, () => call("contract", contract())),
      /管理者権限/,
    );
    await assert.rejects(
      as(customer, () => call("invoice", bill("2026-11-01"))),
      /管理者権限/,
    );
    await assert.rejects(
      as(admin, () => call("contract", contract({ property_id: foreign }))),
      /対象顧客/,
    );
    const monthly = await as(admin, () => call("contract", contract()));
    await as(admin, () =>
      call(
        "contract",
        contract({
          property_id: second,
          item: "年払い",
          billing_cycle: "annual",
          effective_from: "2026-11-01",
          amount_yen: 6000,
        }),
      ),
    );
    await assert.rejects(
      as(admin, () => call("invoice", bill("2026-11-01", [foreignExpense]))),
      /選択した実費/,
    );
    await assert.rejects(
      as(admin, () => call("invoice", bill("2026-11-01", [future]))),
      /選択した実費/,
    );
    assert.equal(
      (await db.query("select count(*)::int n from public.billing_invoices"))
        .rows[0].n,
      0,
    );
    const invoice = await as(admin, () =>
      call("invoice", bill("2026-11-01", [expense])),
    );
    const total = async (uuid) =>
      (
        await db.query(
          "select sum(amount_yen)::int n from public.billing_lines where invoice_id=$1",
          [uuid],
        )
      ).rows[0].n;
    assert.equal(await total(invoice), 6930);
    await as(customer, async () => {
      assert.equal(
        (await db.query("select * from public.billing_invoices")).rows.length,
        0,
      );
      assert.equal(
        (await db.query("select * from public.billing_lines")).rows.length,
        0,
      );
      assert.equal(
        (await db.query("select * from public.customer_contracts")).rows.length,
        2,
      );
    });
    await as(admin, () =>
      call("contract", contract({ id: monthly, amount_yen: 700 })),
    );
    assert.equal(
      await total(invoice),
      6930,
      "契約変更だけでは既存の下書き金額は変わらない",
    );
    await as(admin, async () =>
      assert.equal(
        (
          await db.query(
            "update public.report_expenses set amount_yen=550 where id=$1 returning id",
            [expense],
          )
        ).rows.length,
        0,
      ),
    );
    await as(admin, () => call("invoice", bill("2026-11-01")));
    assert.equal(
      (
        await db.query(
          "select billed_at from public.report_expenses where id=$1",
          [expense],
        )
      ).rows[0].billed_at,
      null,
    );
    await as(admin, () =>
      db.query("update public.report_expenses set amount_yen=550 where id=$1", [
        expense,
      ]),
    );
    await as(admin, () => call("invoice", bill("2026-11-01", [expense])));
    assert.equal(await total(invoice), 7250);
    await as(admin, () => call("publish", { id: invoice }));
    await as(customer, async () => {
      assert.equal(
        (await db.query("select * from public.billing_invoices")).rows.length,
        1,
      );
      assert.equal(
        (await db.query("select * from public.billing_lines")).rows.length,
        3,
      );
    });
    await as(other, async () => {
      assert.equal(
        (await db.query("select * from public.billing_invoices")).rows.length,
        0,
      );
      assert.equal(
        (await db.query("select * from public.billing_lines")).rows.length,
        0,
      );
      assert.equal(
        (await db.query("select * from public.customer_contracts")).rows.length,
        0,
      );
    });
    await as(worker, async () =>
      assert.equal(
        (await db.query("select * from public.billing_invoices")).rows.length,
        0,
      ),
    );
    await assert.rejects(
      as(admin, () => db.exec("update public.billing_lines set amount_yen=1")),
      /permission denied/,
    );
    await assert.rejects(
      as(admin, () => call("invoice", bill("2026-11-01"))),
      /公開済み/,
    );
    await assert.rejects(
      as(admin, () => call("invoice", bill("2026-12-01", [expense]))),
      /選択した実費/,
    );
    const december = await as(admin, () => call("invoice", bill("2026-12-01")));
    assert.equal(await total(december), 700, "年払いは指定月だけ取り込む");
    await assert.rejects(
      db.query("update public.report_expenses set amount_yen=1 where id=$1", [
        expense,
      ]),
      /変更・削除できません/,
    );
    await as(admin, () =>
      call(
        "contract",
        contract({
          customer_id: other,
          property_id: foreign,
          item: "別顧客の定額",
          amount_yen: 1000,
        }),
      ),
    );
    const otherInvoice = await as(admin, () =>
      call("invoice", {
        customer_id: other,
        period: "2026-11-01",
        expense_ids: [foreignExpense],
      }),
    );
    await as(admin, () => call("publish", { id: otherInvoice }));
    await assert.rejects(
      as(worker, () => call("cancel", { id: invoice, customer_id: customer })),
      /管理者権限/,
    );
    await assert.rejects(
      as(customer, () =>
        call("cancel", { id: invoice, customer_id: customer }),
      ),
      /管理者権限/,
    );
    await assert.rejects(
      as(admin, () => call("cancel", { id: invoice, customer_id: other })),
      /選択した顧客/,
    );
    await as(admin, () =>
      call("cancel", { id: invoice, customer_id: customer }),
    );
    assert.equal(
      (
        await db.query(
          "select status from public.billing_invoices where id=$1",
          [invoice],
        )
      ).rows[0].status,
      "cancelled",
    );
    assert.equal(
      await total(invoice),
      7250,
      "撤回後も請求金額の履歴を保持する",
    );
    await as(other, async () =>
      assert.equal(
        (await db.query("select * from public.billing_invoices")).rows.length,
        1,
        "他顧客の公開状態には影響しない",
      ),
    );
    await as(customer, async () => {
      assert.equal(
        (await db.query("select * from public.billing_invoices")).rows.length,
        0,
      );
      assert.equal(
        (await db.query("select * from public.billing_lines")).rows.length,
        0,
      );
    });
    assert.equal(
      (
        await db.query(
          "select billed_at from public.report_expenses where id=$1",
          [expense],
        )
      ).rows[0].billed_at,
      null,
    );
    await as(admin, () =>
      db.query("update public.report_expenses set amount_yen=600 where id=$1", [
        expense,
      ]),
    );
    const replacement = await as(admin, () =>
      call("invoice", bill("2026-11-01", [expense])),
    );
    assert.notEqual(replacement, invoice);
    assert.equal(await total(replacement), 7300);
    assert.equal(
      await total(invoice),
      7250,
      "再請求でも撤回前の明細を維持する",
    );
    await as(admin, () => call("publish", { id: replacement }));
    await assert.rejects(
      as(admin, () => call("cancel", { id: invoice, customer_id: customer })),
      /選択した顧客/,
    );
    await as(customer, async () =>
      assert.equal(
        (await db.query("select * from public.billing_invoices")).rows.length,
        1,
      ),
    );
    await assert.rejects(
      as(admin, () => call("invoice", bill("2026-12-01", [expense]))),
      /選択した実費/,
    );
    // Separate future periods keep existing publication/cancellation checks intact.
    const once = await as(admin, () =>
      call(
        "contract",
        contract({
          billing_cycle: "once",
          effective_from: "2028-02-01",
          item: "単発",
          amount_yen: 123,
        }),
      ),
    );
    const customData = contract({
      billing_cycle: "custom",
      effective_from: "2028-01-01",
      item: "指定月",
      amount_yen: 234,
      payment_months: ["2028-02-01", "2029-03-01", "2028-02-01"],
    });
    const custom = await as(admin, () => call("contract", customData));
    for (const invalid of [[], ["2028-02-02"], ["2027-12-01"], [null]]) {
      await assert.rejects(
        as(admin, () =>
          call("contract", { ...customData, payment_months: invalid }),
        ),
        /支払い月/,
      );
    }
    for (const [month, expected] of [
      ["2028-02-01", 1057],
      ["2028-03-01", 700],
      ["2029-02-01", 700],
      ["2029-03-01", 934],
    ]) {
      const draft = await as(admin, () => call("invoice", bill(month)));
      assert.equal(await total(draft), expected, month);
      await as(admin, () => call("invoice", bill(month)));
      assert.equal(await total(draft), expected, "再作成でも重複しない");
    }
    await as(admin, () =>
      call("contract", {
        ...customData,
        id: custom,
        payment_months: ["2029-04-01"],
      }),
    );
    const changed = await as(admin, () => call("invoice", bill("2029-03-01")));
    assert.equal(await total(changed), 700, "選択解除した月は請求されない");
    await as(admin, () =>
      call("contract", { ...customData, id: custom, billing_cycle: "monthly" }),
    );
    assert.equal(
      (
        await db.query(
          "select cardinality(payment_months) n from public.customer_contracts where id=$1",
          [custom],
        )
      ).rows[0].n,
      0,
    );
    const onceDraft = await as(admin, () =>
      call("invoice", bill("2028-02-01")),
    );
    await as(admin, () => call("publish", { id: onceDraft }));
    await as(admin, () =>
      call("cancel", { id: onceDraft, customer_id: customer }),
    );
    const onceReplacement = await as(admin, () =>
      call("invoice", bill("2028-02-01")),
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from public.billing_lines where invoice_id=$1 and contract_id=$2",
          [onceReplacement, once],
        )
      ).rows[0].n,
      1,
    );
    await db.query("update public.profiles set active=false where id=$1", [
      admin,
    ]);
    await assert.rejects(
      as(admin, () => call("publish", { id: december })),
      /管理者権限/,
    );
    await assert.rejects(
      as(admin, () =>
        call("cancel", { id: replacement, customer_id: customer }),
      ),
      /管理者権限/,
    );
  } finally {
    await db.close();
  }
});
