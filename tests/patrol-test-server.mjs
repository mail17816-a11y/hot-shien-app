// Local-only integration fixture: fake auth + real PGlite/RLS/RPCs. Never connects to Supabase.
import http from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const users = { admin: id(1), worker: id(2), customer: id(3), other: id(4) };
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;grant usage on schema auth to authenticated;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}')$$;
 create schema storage;grant usage on schema storage to authenticated;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
 create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;`);
const directory = new URL("../supabase/migrations/", import.meta.url);
const migrations = (await readdir(directory))
  .filter((f) => f.endsWith(".sql"))
  .sort();
for (const file of migrations) {
  if (file === "003_identifier_only.sql") {
    for (const [login, uuid] of Object.entries(users))
      await db.query("insert into auth.users(id,email) values($1,$2)", [
        uuid,
        `${login}@example.com`,
      ]);
    await db.query("update public.profiles set role='admin' where id=$1", [
      users.admin,
    ]);
    await db.query("update public.profiles set role='worker' where id=$1", [
      users.worker,
    ]);
  }
  await db.exec(await readFile(new URL(file, directory), "utf8"));
}
await db.exec(
  "alter table storage.objects enable row level security;grant select,insert,delete on storage.objects to authenticated",
);
await db.query(
  "insert into public.properties(id,property_number,customer_id) values($1,'SAMPLE-P1',$2),($3,'SAMPLE-OTHER',$4)",
  [id(10), users.customer, id(11), users.other],
);
const bytes = new Map();
let queue = Promise.resolve();
function transaction(user, fn) {
  const result = queue.then(async () => {
    await db.exec(
      `begin;set local role authenticated;set local request.jwt.claim.sub='${user}';set local request.jwt.claims='{"iat":2000000000}';`,
    );
    try {
      const value = await fn();
      await db.exec("commit");
      return value;
    } catch (e) {
      await db.exec("rollback");
      throw e;
    }
  });
  queue = result.catch(() => {});
  return result;
}
const token = (user) =>
  [
    Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url"),
    Buffer.from(
      JSON.stringify({
        sub: user,
        role: "authenticated",
        iat: 2000000000,
        exp: 2200000000,
        aud: "authenticated",
      }),
    ).toString("base64url"),
    "local-test-signature",
  ].join(".");
const userFrom = (req) => {
  try {
    const uuid = JSON.parse(
      Buffer.from(
        req.headers.authorization?.split(" ")[1]?.split(".")[1] || "",
        "base64url",
      ),
    ).sub;
    return Object.values(users).includes(uuid) ? uuid : null;
  } catch {
    return null;
  }
};
const authUser = (uuid) => ({
  id: uuid,
  email: `${Object.keys(users).find((k) => users[k] === uuid)}@example.com`,
  aud: "authenticated",
  role: "authenticated",
  app_metadata: { provider: "email" },
  user_metadata: {},
  created_at: "2026-10-01T00:00:00Z",
});
const columns = new Map();
const dateColumns = new Map();
for (const { table_name, column_name, data_type } of (
  await db.query(
    "select table_name,column_name,data_type from information_schema.columns where table_schema='public'",
  )
).rows) {
  if (!columns.has(table_name)) columns.set(table_name, new Set());
  columns.get(table_name).add(column_name);
  if (data_type === "date") {
    if (!dateColumns.has(table_name)) dateColumns.set(table_name, new Set());
    dateColumns.get(table_name).add(column_name);
  }
}
const identifier = (table, key) => {
  if (!columns.get(table)?.has(key))
    throw new Error(`unknown column ${table}.${key}`);
  return `"${key}"`;
};
const rpc = {
  save_inspection_targets: ["p_property_id", "p_targets"],
  save_patrol_report: ["p_data", "p_expenses"],
  correct_report_expense: ["p_data"],
  billing_action: ["p_action", "p_data"],
};
const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  const send = (status, value) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(value));
  };
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }
  let body = Buffer.alloc(0);
  for await (const part of req) body = Buffer.concat([body, part]);
  const url = new URL(req.url, "http://127.0.0.1:54321");
  const user = userFrom(req);
  try {
    if (url.pathname === "/health") return send(200, { ready: true, fixture: "patrol-pglite" });
    if (url.pathname === "/auth/v1/token") {
      const data = JSON.parse(body);
      const login = String(data.email || "").split("@")[0],
        uuid = users[login];
      if (!uuid)
        return send(400, { message: "架空アカウントのみ使用できます" });
      return send(200, {
        access_token: token(uuid),
        refresh_token: `test-refresh-${login}`,
        token_type: "bearer",
        expires_in: 864000,
        user: authUser(uuid),
      });
    }
    if (url.pathname === "/auth/v1/logout") {
      res.writeHead(204);
      return res.end();
    }
    if (url.pathname === "/auth/v1/user") return send(200, authUser(user));
    if (url.pathname.startsWith("/storage/v1/object/sign/report-photos/")) {
      const path = decodeURIComponent(
        url.pathname.slice("/storage/v1/object/sign/report-photos/".length),
      );
      const photo = bytes.get(path);
      if (!photo) return send(404, { message: "not found" });
      res.writeHead(200, { "Content-Type": photo.type });
      return res.end(photo.body);
    }
    if (!user) return send(401, { message: "fixture login required" });
    await transaction(user, async () => {
      if (url.pathname.startsWith("/rest/v1/rpc/")) {
        const name = url.pathname.split("/").pop();
        if (!rpc[name]) throw new Error("unknown RPC");
        const data = JSON.parse(body);
        const values = rpc[name].map((key) =>
          typeof data[key] === "object" ? JSON.stringify(data[key]) : data[key],
        );
        const result = await db.query(
          `select public.${name}(${values.map((_, i) => `$${i + 1}`).join(",")}) result`,
          values,
        );
        return send(200, result.rows[0].result ?? null);
      }
      if (url.pathname.startsWith("/rest/v1/") && req.method === "GET") {
        const table = url.pathname.split("/").pop();
        if (!columns.has(table)) throw new Error("unknown table");
        const params = [],
          filters = [];
        for (const [key, value] of url.searchParams) {
          if (value.startsWith("eq.")) {
            params.push(value.slice(3));
            filters.push(`${identifier(table, key)}=$${params.length}`);
          }
        }
        const order = (url.searchParams.get("order") || "")
          .split(",")
          .filter(Boolean)
          .map((value) => {
            const [key, direction] = value.split(".");
            return `${identifier(table, key)} ${direction === "desc" ? "desc" : "asc"}`;
          })
          .join(",");
        const limit = Math.min(
            Number(url.searchParams.get("limit") || 1000),
            1000,
          ),
          offset = Number(url.searchParams.get("offset") || 0);
        const result = await db.query(
          `select * from public."${table}" ${filters.length ? "where " + filters.join(" and ") : ""} ${order ? "order by " + order : ""} limit ${limit} offset ${offset}`,
          params,
        );
        for (const row of result.rows)
          for (const column of dateColumns.get(table) || [])
            if (row[column] instanceof Date)
              row[column] = row[column].toISOString().slice(0, 10);
        return send(
          200,
          req.headers.accept?.includes("vnd.pgrst.object")
            ? result.rows[0]
            : result.rows,
        );
      }
      const prefix = "/storage/v1/object/";
      if (url.pathname === prefix + "sign/report-photos") {
        const data = JSON.parse(body),
          result = [];
        for (const path of data.paths) {
          const allowed = (
            await db.query(
              "select id from storage.objects where bucket_id='report-photos' and name=$1",
              [path],
            )
          ).rows.length;
          result.push({
            path,
            signedURL: allowed
              ? `/object/sign/report-photos/${path}?token=fixture`
              : null,
            error: allowed ? null : "not allowed",
          });
        }
        return send(200, result);
      }
      if (
        url.pathname.startsWith(prefix + "report-photos/") &&
        req.method === "POST"
      ) {
        const path = decodeURIComponent(
          url.pathname.slice((prefix + "report-photos/").length),
        );
        await db.query(
          "insert into storage.objects(bucket_id,name) values('report-photos',$1)",
          [path],
        );
        let photoBody = body,
          type = req.headers["content-type"];
        if (type?.includes("multipart/form-data")) {
          const form = await new Response(body, {
            headers: { "Content-Type": type },
          }).formData();
          for (const value of form.values())
            if (value instanceof File) {
              photoBody = Buffer.from(await value.arrayBuffer());
              type = value.type;
              break;
            }
        }
        bytes.set(path, { type, body: photoBody });
        return send(200, { Key: "report-photos/" + path, Id: id(100) });
      }
      if (
        url.pathname === prefix + "report-photos" &&
        req.method === "DELETE"
      ) {
        for (const path of JSON.parse(body).prefixes) {
          const result = await db.query(
            "delete from storage.objects where bucket_id='report-photos' and name=$1 returning id",
            [path],
          );
          if (result.rows.length) bytes.delete(path);
        }
        return send(200, []);
      }
      return send(404, {
        message: `unsupported fixture route ${req.method} ${url.pathname}`,
      });
    });
  } catch (error) {
    console.error(req.method, url.pathname, error.message);
    send(400, {
      message: error.message,
      code: error.code || "fixture_error",
      details: null,
      hint: null,
    });
  }
});
server.listen(54321, "127.0.0.1", () =>
  console.log(
    "Patrol test backend ready (localhost only, PGlite, fake accounts).",
  ),
);
