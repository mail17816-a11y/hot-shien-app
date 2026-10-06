import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("メッセージの権限をPostgreSQLのRLSで検証する", async (t) => {
  const db = new PGlite();
  const migration = await readFile(
    new URL(
      "../supabase/migrations/002_property_messages.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const users = {
    admin: "00000000-0000-0000-0000-000000000001",
    worker: "00000000-0000-0000-0000-000000000002",
    a: "00000000-0000-0000-0000-000000000003",
    b: "00000000-0000-0000-0000-000000000004",
  };
  const propertyA = "10000000-0000-0000-0000-000000000001",
    propertyB = "10000000-0000-0000-0000-000000000002";
  async function asUser(id, task, role = "authenticated") {
    await db.exec(`begin; set local role ${role};`);
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [
      id || "",
    ]);
    try {
      return await task();
    } finally {
      await db.exec("rollback");
    }
  }
  const insert = (
    property,
    author,
    kind = "その他メッセージ",
    body = "テスト連絡",
  ) =>
    db.query(
      "insert into public.property_messages(property_id,author_id,kind,body) values($1,$2,$3,$4) returning *",
      [property, author, kind, body],
    );
  try {
    await db.exec(`create role anon; create role authenticated;
   create schema auth; grant usage on schema auth to authenticated,anon;
   create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create schema storage; grant usage on schema storage to authenticated;
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
   alter table storage.objects enable row level security;
   create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;`);
    await db.exec(
      await readFile(
        new URL("../supabase/migrations/001_initial.sql", import.meta.url),
        "utf8",
      ),
    );
    await db.exec(migration);
    for (const [name, id] of Object.entries(users))
      await db.query(
        "insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)",
        [id, `${name}@example.com`, { name }],
      );
    await db.query("update public.profiles set role='admin' where id=$1", [
      users.admin,
    ]);
    await db.query("update public.profiles set role='worker' where id=$1", [
      users.worker,
    ]);
    await db.query(
      "insert into public.properties(id,name,address,customer_id) values($1,$2,$3,$4),($5,$6,$7,$8)",
      [
        propertyA,
        "物件A",
        "住所A",
        users.a,
        propertyB,
        "物件B",
        "住所B",
        users.b,
      ],
    );
    // 保存済みの両顧客の連絡を作り、閲覧分離を確認。
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
      users.a,
    ]);
    await insert(propertyA, users.a, "お問い合わせ", "Aの質問");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
      users.b,
    ]);
    await insert(propertyB, users.b, "その他メッセージ", "Bの連絡");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
    await t.test("顧客は自分の物件のメッセージだけを読める", async () => {
      await asUser(users.a, async () => {
        const { rows } = await db.query(
          "select body from public.property_messages",
        );
        assert.deepEqual(
          rows.map((x) => x.body),
          ["Aの質問"],
        );
      });
      await asUser(users.b, async () => {
        const { rows } = await db.query(
          "select body from public.property_messages",
        );
        assert.deepEqual(
          rows.map((x) => x.body),
          ["Bの連絡"],
        );
      });
    });
    await t.test(
      "顧客はお問い合わせとその他メッセージを投稿できる",
      async () => {
        for (const kind of ["お問い合わせ", "その他メッセージ"])
          await asUser(users.a, async () => {
            const { rows } = await insert(propertyA, users.a, kind);
            assert.equal(rows[0].author_name, "a");
            assert.equal(rows[0].author_role, "customer");
          });
      },
    );
    await t.test("他人の物件への投稿・投稿者の偽装は拒否される", async () => {
      await assert.rejects(
        asUser(users.a, () => insert(propertyB, users.a)),
        /row-level security/,
      );
      await assert.rejects(
        asUser(users.a, () => insert(propertyA, users.worker)),
        /row-level security/,
      );
      await assert.rejects(
        asUser(users.a, () =>
          db.query(
            "insert into public.property_messages(property_id,author_id,author_role,kind,body) values($1,$2,'worker','その他メッセージ','偽装')",
            [propertyA, users.a],
          ),
        ),
        /permission denied/,
      );
    });
    await t.test(
      "作業者・管理者は両方の物件を読み、その他メッセージを投稿できる",
      async () => {
        for (const user of [users.worker, users.admin])
          await asUser(user, async () => {
            assert.equal(
              (await db.query("select * from public.property_messages")).rows
                .length,
              2,
            );
            await insert(propertyA, user);
            await insert(propertyB, user);
          });
        await assert.rejects(
          asUser(users.worker, () =>
            insert(propertyA, users.worker, "お問い合わせ"),
          ),
          /row-level security/,
        );
      },
    );
    await t.test("停止アカウントと未ログインからの操作を拒否する", async () => {
      await db.query("update public.profiles set active=false where id=$1", [
        users.a,
      ]);
      await asUser(users.a, async () =>
        assert.equal(
          (await db.query("select * from public.property_messages")).rows
            .length,
          0,
        ),
      );
      await assert.rejects(
        asUser(users.a, () => insert(propertyA, users.a)),
        /row-level security/,
      );
      await assert.rejects(
        asUser(
          null,
          () => db.query("select * from public.property_messages"),
          "anon",
        ),
        /permission denied/,
      );
    });
    await t.test(
      "本文が空白だけの投稿と既存メッセージの書換えを拒否する",
      async () => {
        await assert.rejects(
          asUser(users.worker, () =>
            insert(propertyA, users.worker, "その他メッセージ", "   "),
          ),
          /check constraint/,
        );
        await assert.rejects(
          asUser(users.worker, () =>
            db.query("update public.property_messages set body='書換え'"),
          ),
          /permission denied/,
        );
      },
    );
    await t.test(
      "追加SQLを再実行しても既存のメッセージを保持する",
      async () => {
        await db.exec(migration);
        assert.equal(
          (await db.query("select * from public.property_messages")).rows
            .length,
          2,
        );
      },
    );
  } finally {
    await db.close();
  }
});
