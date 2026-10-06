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
        ["A", "B"],
      );
      assert.deepEqual(
        (
          await db.query(
            "select property_number from public.properties order by id",
          )
        ).rows.map((r) => r.property_number),
        [
          "LEGACY-" + a.replaceAll("-", "").toUpperCase(),
          "LEGACY-" + b.replaceAll("-", "").toUpperCase(),
        ],
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
            ["LEGACY-" + a.replaceAll("-", "").toUpperCase()],
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
            ["LEGACY-" + b.replaceAll("-", "").toUpperCase()],
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
    await t.test(
      "管理者が指定したログインIDから顧客番号を登録する",
      async () => {
        const id = "00000000-0000-0000-0000-000000000005";
        await db.query(
          "insert into auth.users(id,email,raw_user_meta_data) values($1,'new@example.com',$2)",
          [id, { name: "転記しないテスト名" }],
        );
        const p = (
          await db.query("select * from public.profiles where id=$1", [id])
        ).rows[0];
        assert.equal(p.customer_number, "NEW");
        assert.equal(p.login_id, "new");
        assert.deepEqual(
          (
            await db.query(
              "select raw_user_meta_data from auth.users where id=$1",
              [id],
            )
          ).rows[0].raw_user_meta_data,
          {},
        );
        assert.ok(!("name" in p));
      },
    );
    await t.test(
      "管理者が自由な物件番号を指定でき、顧客の登録や重複は拒否する",
      async () => {
        await asUser(users.admin, async () => {
          const row = (
            await db.query(
              "insert into public.properties(customer_id,property_number) values($1,'HOUSE_42') returning *",
              [users.a],
            )
          ).rows[0];
          assert.equal(row.property_number, "HOUSE_42");
          assert.ok(!("address" in row));
        });
        await assert.rejects(
          asUser(users.a, () =>
            db.query(
              "insert into public.properties(customer_id,property_number) values($1,'HOUSE_43')",
              [users.a],
            ),
          ),
          /row-level security/,
        );
        await assert.rejects(
          asUser(users.admin, async () => {
            await db.query(
              "insert into public.properties(customer_id,property_number) values($1,'DUPLICATE')",
              [users.a],
            );
            await db.query(
              "insert into public.properties(customer_id,property_number) values($1,'DUPLICATE')",
              [users.a],
            );
          }),
          /unique constraint/,
        );
        await assert.rejects(
          asUser(users.admin, () =>
            db.query("insert into public.properties(customer_id) values($1)", [
              users.a,
            ]),
          ),
          /not-null constraint/,
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
    await t.test(
      "Authはexample.com専用に制限し、既存ログインIDの変更と名前メタデータの保存を防ぐ",
      async () => {
        assert.ok(
          (
            await db.query("select raw_user_meta_data from auth.users")
          ).rows.every(
            (row) => Object.keys(row.raw_user_meta_data).length === 0,
          ),
        );
        await assert.rejects(
          db.query(
            "insert into auth.users(id,email) values('00000000-0000-0000-0000-000000000006','person@other.test')",
          ),
          /認証メール/,
        );
        await assert.rejects(
          db.query(
            "update auth.users set email='changed@example.com' where id=$1",
            [users.a],
          ),
          /発行済み/,
        );
        await db.query(
          "update auth.users set raw_user_meta_data=$1 where id=$2",
          [{ name: "保存しない名前" }, users.a],
        );
        assert.deepEqual(
          (
            await db.query(
              "select raw_user_meta_data from auth.users where id=$1",
              [users.a],
            )
          ).rows[0].raw_user_meta_data,
          {},
        );
      },
    );
  } finally {
    await db.close();
  }
});
