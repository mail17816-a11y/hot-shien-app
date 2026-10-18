import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
test("管理RPCの権限と削除・失効処理をPostgreSQLで検証する", async (t) => {
  const db = new PGlite();
  const a = "00000000-0000-0000-0000-000000000001",
    b = "00000000-0000-0000-0000-000000000002",
    c = "00000000-0000-0000-0000-000000000003";
  async function asRole(role, fn) {
    await db.exec(`begin;set local role ${role};`);
    try {
      return await fn();
    } finally {
      await db.exec("rollback");
    }
  }
  const rpc = (
    actor,
    target,
    role = null,
    active = null,
    remove = false,
    reset = false,
    iat = 2000000000,
  ) =>
    db.query("select public.admin_manage_user($1,$2,$3,$4,$5,$6,$7) as user", [
      actor,
      iat,
      target,
      role,
      active,
      remove,
      reset,
    ]);
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create schema auth;grant usage on schema auth to authenticated;
   create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
   create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
   create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;`);
    for (const file of ["001_initial.sql", "002_property_messages.sql"])
      await db.exec(
        await readFile(
          new URL(`../supabase/migrations/${file}`, import.meta.url),
          "utf8",
        ),
      );
    for (const [id, email] of [
      [a, "admin@example.com"],
      [b, "worker@example.com"],
      [c, "customer@example.com"],
    ])
      await db.query("insert into auth.users(id,email) values($1,$2)", [
        id,
        email,
      ]);
    await db.query("update public.profiles set role='admin' where id=$1", [a]);
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/003_identifier_only.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/20261018110758_admin_user_management.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(
      "grant all on public.profiles,public.properties to service_role;",
    );
    await t.test(
      "ブラウザ用ロールからのRPCとプロフィール更新を拒否する",
      async () => {
        await assert.rejects(
          asRole("authenticated", () => rpc(a, b)),
          /permission denied/,
        );
        await assert.rejects(
          asRole("anon", () => rpc(a, b)),
          /permission denied/,
        );
        await assert.rejects(
          asRole("authenticated", () =>
            db.query("update public.profiles set active=false where id=$1", [
              b,
            ]),
          ),
          /permission denied/,
        );
      },
    );
    await t.test(
      "管理者だけが役割を変更でき、自分自身と失効JWTを拒否する",
      async () => {
        const result = await asRole("service_role", () =>
          rpc(a, b, "worker", true),
        );
        assert.equal(result.rows[0].user.role, "worker");
        assert.equal(result.rows[0].user.customer_number, null);
        await assert.rejects(
          asRole("service_role", () => rpc(c, b)),
          /管理者権限/,
        );
        await assert.rejects(
          asRole("service_role", () => rpc(a, a)),
          /自分自身/,
        );
        await db.query(
          "update public.profiles set auth_valid_after=100 where id=$1",
          [a],
        );
        await assert.rejects(
          asRole("service_role", () => rpc(a, b, null, null, false, false, 99)),
          /管理者権限/,
        );
        await db.query(
          "update public.profiles set auth_valid_after=0 where id=$1",
          [a],
        );
      },
    );
    await t.test(
      "物件所有顧客の役割変更を拒否し、削除でも物件を保持する",
      async () => {
        await db.query(
          "insert into public.properties(property_number,customer_id) values('PROPERTY1',$1)",
          [c],
        );
        await assert.rejects(
          asRole("service_role", () => rpc(a, c, "worker")),
          /契約物件/,
        );
        const result = await asRole("service_role", () =>
          rpc(a, c, null, null, true),
        );
        assert.equal(result.rows[0].user.active, false);
        assert.ok(result.rows[0].user.deleted_at);
        assert.equal(
          (await db.query("select * from public.properties")).rows.length,
          1,
        );
      },
    );
    await t.test(
      "削除済みユーザーは復元不可で、古いJWTは業務データへアクセス不可",
      async () => {
        await rpc(a, c, null, null, true);
        await assert.rejects(
          asRole("service_role", () => rpc(a, c, "customer", true)),
          /削除済み/,
        );
        await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
          c,
        ]);
        await db.exec(
          `select set_config('request.jwt.claims','{"iat":2000000000}',false);`,
        );
        assert.equal(
          (await db.query("select public.current_role() as role")).rows[0].role,
          null,
        );
        await rpc(a, b, null, null, false, true);
        await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
          b,
        ]);
        await db.exec(
          `select set_config('request.jwt.claims','{"iat":1}',false);`,
        );
        assert.equal(
          (await db.query("select public.current_role() as role")).rows[0].role,
          null,
        );
      },
    );
  } finally {
    await db.close();
  }
});
