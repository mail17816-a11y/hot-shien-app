import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("番号管理への移行で個人情報列を除去し、既存データと権限を維持する", async (t) => {
  const db = new PGlite();
  const users = {
    admin: "00000000-0000-0000-0000-000000000001",
    worker: "00000000-0000-0000-0000-000000000002",
    a: "00000000-0000-0000-0000-000000000003",
    b: "00000000-0000-0000-0000-000000000004",
  };
  const a = "10000000-0000-0000-0000-000000000001",
    b = "10000000-0000-0000-0000-000000000002",
    report = "20000000-0000-0000-0000-000000000001";
  async function asUser(id, fn) {
    await db.exec("begin; set local role authenticated;");
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
    try {
      return await fn();
    } finally {
      await db.exec("rollback");
    }
  }
  try {
    await db.exec(`create role anon; create role authenticated;
   create schema auth; grant usage on schema auth to authenticated,anon;
   create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create schema storage; grant usage on schema storage to authenticated;
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
   alter table storage.objects enable row level security;
   grant select on storage.objects to authenticated;
   create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;`);
    for (const file of ["001_initial.sql", "002_property_messages.sql"])
      await db.exec(
        await readFile(
          new URL(`../supabase/migrations/${file}`, import.meta.url),
          "utf8",
        ),
      );
    for (const [label, id] of Object.entries(users))
      await db.query(
        "insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)",
        [id, `${label}@example.com`, { name: `TEST_${label}` }],
      );
    await db.query("update public.profiles set role='admin' where id=$1", [
      users.admin,
    ]);
    await db.query("update public.profiles set role='worker' where id=$1", [
      users.worker,
    ]);
    await db.query(
      "insert into public.properties(id,name,address,customer_id) values($1,'TEST_PROPERTY_A','TEST_ADDRESS_A',$2),($3,'TEST_PROPERTY_B','TEST_ADDRESS_B',$4)",
      [a, users.a, b, users.b],
    );
    await db.query(
      "insert into public.reports(id,property_id,author_id,kind,body,performed_on,photo_paths) values($1,$2,$3,'定期巡回','保存する報告','2026-10-07',$4)",
      [report, a, users.worker, [`${report}/photo`]],
    );
    await db.query(
      "insert into storage.objects(bucket_id,name) values('report-photos',$1)",
      [`${report}/photo`],
    );
    await db.query(
      "insert into public.work_requests(property_id,customer_id,kind,body) values($1,$2,'除草・清掃','保存する依頼')",
      [a, users.a],
    );
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      users.a,
    ]);
    await db.query(
      "insert into public.property_messages(property_id,author_id,kind,body) values($1,$2,'お問い合わせ','保存する質問')",
      [a, users.a],
    );
    await db.query("select set_config('request.jwt.claim.sub','',false)");
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/003_identifier_only.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await t.test("氏名・住所・投稿者名の列が存在しない", async () => {
      const { rows } = await db.query(
        "select table_name,column_name from information_schema.columns where table_schema='public' and ((table_name='profiles' and column_name='name') or (table_name='properties' and column_name in ('name','address')) or (table_name='property_messages' and column_name='author_name'))",
      );
      assert.equal(rows.length, 0);
      assert.deepEqual(
        (
          await db.query(
            "select customer_number from public.profiles where role='customer' order by id",
          )
        ).rows.map((r) => r.customer_number),
        ["C000001", "C000002"],
      );
      assert.deepEqual(
        (
          await db.query(
            "select property_number from public.properties order by id",
          )
        ).rows.map((r) => r.property_number),
        ["P000001", "P000002"],
      );
    });
    await t.test(
      "既存の報告・依頼・メッセージ・写真の紐付けを保持する",
      async () => {
        const r = (
          await db.query("select * from public.reports where id=$1", [report])
        ).rows[0];
        assert.equal(r.property_id, a);
        assert.deepEqual(r.photo_paths, [`${report}/photo`]);
        assert.equal(r.body, "保存する報告");
        assert.equal(
          (await db.query("select body from public.work_requests")).rows[0]
            .body,
          "保存する依頼",
        );
        assert.equal(
          (await db.query("select body from public.property_messages")).rows[0]
            .body,
          "保存する質問",
        );
      },
    );
    await t.test(
      "番号移行後も顧客別に物件・報告・依頼・メッセージ・写真を分離する",
      async () => {
        await asUser(users.a, async () => {
          assert.deepEqual(
            (
              await db.query("select property_number from public.properties")
            ).rows.map((r) => r.property_number),
            ["P000001"],
          );
          for (const table of ["reports", "work_requests", "property_messages"])
            assert.equal(
              (await db.query(`select * from public.${table}`)).rows.length,
              1,
            );
          assert.equal(
            (await db.query("select * from storage.objects")).rows.length,
            1,
          );
        });
        await asUser(users.b, async () => {
          assert.deepEqual(
            (
              await db.query("select property_number from public.properties")
            ).rows.map((r) => r.property_number),
            ["P000002"],
          );
          for (const table of ["reports", "work_requests", "property_messages"])
            assert.equal(
              (await db.query(`select * from public.${table}`)).rows.length,
              0,
            );
          assert.equal(
            (await db.query("select * from storage.objects")).rows.length,
            0,
          );
        });
      },
    );
    await t.test("新しい顧客を名前の転記なしで採番する", async () => {
      const id = "00000000-0000-0000-0000-000000000005";
      await db.query(
        "insert into auth.users(id,email,raw_user_meta_data) values($1,'new@example.com',$2)",
        [id, { name: "転記しないテスト名" }],
      );
      const p = (
        await db.query("select * from public.profiles where id=$1", [id])
      ).rows[0];
      assert.equal(p.customer_number, "C000003");
      assert.ok(!("name" in p));
    });
    await t.test(
      "管理者は物件番号を自動発行して登録でき、顧客は登録できない",
      async () => {
        await asUser(users.admin, async () => {
          const row = (
            await db.query(
              "insert into public.properties(customer_id) values($1) returning *",
              [users.a],
            )
          ).rows[0];
          assert.equal(row.property_number, "P000003");
          assert.ok(!("address" in row));
        });
        await assert.rejects(
          asUser(users.a, () =>
            db.query("insert into public.properties(customer_id) values($1)", [
              users.a,
            ]),
          ),
          /row-level security/,
        );
        await assert.rejects(
          asUser(users.admin, () =>
            db.query(
              "insert into public.properties(customer_id,property_number) values($1,'P999999')",
              [users.a],
            ),
          ),
          /permission denied/,
        );
      },
    );
    await t.test(
      "投稿者名なしでメッセージを投稿し、偽装・顧客番号の変更を拒否する",
      async () => {
        await asUser(users.worker, async () => {
          const m = (
            await db.query(
              "insert into public.property_messages(property_id,author_id,kind,body) values($1,$2,'その他メッセージ','新しい連絡') returning *",
              [a, users.worker],
            )
          ).rows[0];
          assert.equal(m.author_role, "worker");
          assert.ok(!("author_name" in m));
        });
        await assert.rejects(
          asUser(users.a, () =>
            db.query(
              "update public.profiles set customer_number='C999999' where id=$1",
              [users.a],
            ),
          ),
          /permission denied/,
        );
        await assert.rejects(
          asUser(users.b, () =>
            db.query(
              "insert into public.property_messages(property_id,author_id,kind,body) values($1,$2,'お問い合わせ','他人の物件')",
              [a, users.b],
            ),
          ),
          /row-level security/,
        );
      },
    );
    await t.test("採番が6桁を超えても番号を切り詰めない", async () => {
      await db.exec(
        "select setval('public.customer_number_seq',999999,false); select setval('public.property_number_seq',999999,false);",
      );
      for (const [id, expected] of [
        ["00000000-0000-0000-0000-000000000006", "C999999"],
        ["00000000-0000-0000-0000-000000000007", "C1000000"],
      ]) {
        await db.query("insert into auth.users(id,email) values($1,$2)", [
          id,
          `${expected}@example.com`,
        ]);
        assert.equal(
          (
            await db.query(
              "select customer_number from public.profiles where id=$1",
              [id],
            )
          ).rows[0].customer_number,
          expected,
        );
      }
      for (const expected of ["P999999", "P1000000"])
        assert.equal(
          (
            await db.query(
              "insert into public.properties(customer_id) values($1) returning property_number",
              [users.a],
            )
          ).rows[0].property_number,
          expected,
        );
    });
  } finally {
    await db.close();
  }
});
