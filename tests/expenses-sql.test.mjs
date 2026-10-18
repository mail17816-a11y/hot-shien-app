import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";

test("作業報告の実費の権限・原子性・請求後の保護", async () => {
  const db = new PGlite();
  const worker = "00000000-0000-0000-0000-000000000001";
  const report = "00000000-0000-0000-0000-000000000002";
  const property = "00000000-0000-0000-0000-000000000003";
  async function as(role, task) {
    await db.exec(
      `begin; set local role authenticated; set local request.jwt.claim.sub='${worker}'; set local request.test.role='${role}';`,
    );
    try {
      await task();
      await db.exec("commit");
    } catch (e) {
      await db.exec("rollback");
      throw e;
    }
  }
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema palette_private; grant usage on schema auth,palette_private to authenticated;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function public.current_role() returns text language sql stable as $$select nullif(current_setting('request.test.role',true),'')$$;
      create table public.reports(id uuid primary key, property_id uuid not null, author_id uuid not null, kind text, body text, performed_on date);
      alter table public.reports enable row level security;
      grant select,insert,delete on public.reports to authenticated;
      create policy rread on public.reports for select to authenticated using(true);
      create policy rcreate on public.reports for insert to authenticated with check(public.current_role() in ('admin','worker') and author_id=auth.uid());
      create policy rdelete on public.reports for delete to authenticated using(author_id=auth.uid());`);
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/20261018230614_report_expenses.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const create = (id, costs) =>
      db.query("select public.create_report_with_expenses($1,$2,$3,$4,$5,$6)", [
        id,
        property,
        "定期巡回",
        "記録",
        "2026-10-19",
        JSON.stringify(costs),
      ]);
    await as("worker", () =>
      create(report, [
        { item: "郵送代", amount_yen: 430 },
        { item: "処分費", amount_yen: 1200 },
      ]),
    );
    assert.equal(
      (await db.query("select count(*)::int as n from public.report_expenses"))
        .rows[0].n,
      2,
    );
    await as("customer", async () =>
      assert.equal(
        (await db.query("select * from public.report_expenses")).rows.length,
        0,
      ),
    );
    await as("worker", async () =>
      assert.equal(
        (
          await db.query(
            "update public.report_expenses set amount_yen=999 returning id",
          )
        ).rows.length,
        0,
      ),
    );
    await as("admin", async () =>
      assert.equal(
        (
          await db.query(
            "update public.report_expenses set amount_yen=500 where item='郵送代' returning id",
          )
        ).rows.length,
        1,
      ),
    );
    const failed = "00000000-0000-0000-0000-000000000004";
    await assert.rejects(
      as("worker", () =>
        create(failed, [
          { item: "正常", amount_yen: 10 },
          { item: "不正", amount_yen: -1 },
        ]),
      ),
    );
    assert.equal(
      (await db.query("select * from public.reports where id=$1", [failed]))
        .rows.length,
      0,
    );
    await assert.rejects(
      as("worker", () =>
        db.query("update public.report_expenses set billed_at=now()"),
      ),
      /permission denied/,
    );
    await db.exec(
      "update public.report_expenses set billed_at=now() where item='郵送代'",
    );
    await as("admin", async () =>
      assert.equal(
        (
          await db.query(
            "update public.report_expenses set item='書換' where billed_at is not null returning id",
          )
        ).rows.length,
        0,
      ),
    );
    await assert.rejects(
      db.exec(
        "update public.report_expenses set amount_yen=1 where billed_at is not null",
      ),
      /変更・削除できません/,
    );
    await assert.rejects(
      db.exec(`delete from public.reports where id='${report}'`),
      /変更・削除できません/,
    );
    assert.equal(
      (await db.query("select count(*)::int as n from public.report_expenses"))
        .rows[0].n,
      2,
    );
  } finally {
    await db.close();
  }
});
