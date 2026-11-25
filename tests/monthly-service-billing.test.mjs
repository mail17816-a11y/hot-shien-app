import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("保存済みの月別予定・公開済み実施報告・共通料金で請求する", async () => {
  const db = new PGlite();
  const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  const admin = id(1),
    customer = id(2),
    property = id(3),
    other = id(4),
    otherProperty = id(5);
  const directory = new URL("../supabase/migrations/", import.meta.url);
  async function as(user, fn) {
    await db.exec(`begin; set local role authenticated;
      set local request.jwt.claim.sub='${user}';
      set local request.jwt.claims='{"iat":2000000000}';`);
    try {
      const result = await fn();
      await db.exec("commit");
      return result;
    } catch (error) {
      await db.exec("rollback");
      throw error;
    }
  }
  const action = async (user, kind, data) =>
    as(
      user,
      async () =>
        (
          await db.query("select public.billing_action($1,$2) as id", [
            kind,
            JSON.stringify(data),
          ])
        ).rows[0].id,
    );
  const fullYear = Array.from({ length: 12 }, (_, index) => index + 1);
  const octoberOff = fullYear.filter((month) => month !== 10);
  const schedule = (service_code, months = fullYear) => ({
    customer_id: customer,
    property_id: property,
    service_code,
    year: 2026,
    months,
  });
  const rate = (service_code, amount_yen, effective_from = "2026-01-01") =>
    action(admin, "rate", { service_code, amount_yen, effective_from });
  const invoice = (period) =>
    action(admin, "invoice", {
      customer_id: customer,
      period,
      expense_ids: [],
    });
  const lines = async (invoiceId) =>
    (
      await db.query(
        "select item, amount_yen from public.billing_lines where invoice_id=$1 order by item",
        [invoiceId],
      )
    ).rows;

  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; grant usage on schema auth to authenticated;
      create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}')$$;
      create schema storage;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
      create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;`);
    for (const file of (await readdir(directory))
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      if (file === "003_identifier_only.sql") {
        await db.query(
          "insert into auth.users(id,email) values ($1,'admin@example.com'),($2,'customer@example.com'),($3,'other@example.com')",
          [admin, customer, other],
        );
        await db.query("update public.profiles set role='admin' where id=$1", [
          admin,
        ]);
      }
      await db.exec(await readFile(new URL(file, directory), "utf8"));
    }
    await db.query(
      "insert into public.properties(id,customer_id,property_number) values($1,$2,'P1'),($3,$4,'P2')",
      [property, customer, otherProperty, other],
    );

    await assert.rejects(
      action(customer, "contract", schedule("system")),
      /管理者権限/,
    );
    await assert.rejects(
      action(customer, "rate", { service_code: "system" }),
      /管理者権限/,
    );
    await assert.rejects(
      action(admin, "contract", schedule("system", [13])),
      /1〜12月/,
    );
    await action(admin, "contract", schedule("system"));
    const work = await action(admin, "contract", schedule("light_work"));
    await action(admin, "contract", schedule("patrol"));
    await action(admin, "contract", schedule("mail"));
    await assert.rejects(invoice("2026-10-01"), /共通料金が未登録/);
    assert.equal(
      (await db.query("select count(*)::int n from public.billing_invoices"))
        .rows[0].n,
      0,
    );

    await rate("system", 500);
    await rate("system", 600, "2026-11-01");
    await rate("light_work", 3000);
    await rate("patrol", 3000);
    await rate("mail", 200);
    await as(customer, async () => {
      for (const table of [
        "service_schedule_months",
        "service_schedule_changes",
        "service_rates",
      ]) {
        assert.equal(
          (await db.query(`select * from public.${table}`)).rows.length,
          0,
        );
      }
    });

    await action(admin, "contract", {
      ...schedule("light_work", octoberOff),
      id: work,
      expected_months: fullYear,
    });
    await assert.rejects(
      action(admin, "contract", {
        ...schedule("light_work"),
        id: work,
        expected_months: fullYear,
      }),
      /再読み込み/,
    );
    const changes = (
      await db.query(
        "select period::text, old_planned, new_planned, changed_by from public.service_schedule_changes",
      )
    ).rows;
    assert.deepEqual(changes, [
      {
        period: "2026-10-01",
        old_planned: true,
        new_planned: false,
        changed_by: admin,
      },
    ]);
    assert.deepEqual(
      (
        await db.query(
          "select normal_months from public.customer_contracts where id=$1",
          [work],
        )
      ).rows[0].normal_months,
      fullYear,
    );

    for (const [prop, kind, day, state, status] of [
      [property, "除草・清掃", "2026-10-03", "completed", "published"],
      [property, "定期巡回", "2026-10-03", "completed", "draft"],
      [property, "郵便物対応", "2026-10-04", "not_performed", "published"],
      [otherProperty, "定期巡回", "2026-10-04", "completed", "published"],
      [property, "除草・清掃", "2026-11-05", "completed", "published"],
      [property, "除草・清掃", "2026-11-10", "completed", "published"],
      [property, "定期巡回", "2026-11-10", "completed", "published"],
    ]) {
      await db.query(
        `insert into public.reports(property_id,author_id,kind,body,performed_on,work_status,publication_status,published_at,not_performed_reason)
          values($1,$2,$3,'報告',$4,$5,$6,case when $6='published' then now() end,case when $5='not_performed' then '雨天' else '' end)`,
        [prop, admin, kind, day, state, status],
      );
    }

    const october = await invoice("2026-10-01");
    assert.deepEqual(await lines(october), [
      { item: "システム利用料", amount_yen: 500 },
    ]);
    const november = await invoice("2026-11-01");
    assert.deepEqual(
      (await lines(november))
        .map((line) => line.amount_yen)
        .sort((a, b) => a - b),
      [600, 3000, 3000],
    );
    await action(admin, "publish", { id: october });
    await rate("system", 800);
    assert.deepEqual(await lines(october), [
      { item: "システム利用料", amount_yen: 500 },
    ]);
    assert.equal(await invoice("2026-11-01"), november);
  } finally {
    await db.close();
  }
});
