-- 初回のみ、Supabase SQL Editorで実行してください。
begin;
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 name text not null default '',
 role text not null default 'customer' check (role in ('admin','worker','customer')),
 active boolean not null default true
);
create table public.properties (
 id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 200),
 address text not null check(length(address) between 1 and 500),
 customer_id uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
create table public.reports (
 id uuid primary key default gen_random_uuid(), property_id uuid not null references public.properties(id),
 author_id uuid not null references public.profiles(id),
 kind text not null check(kind in ('定期巡回','除草・清掃','郵便物対応')),
 body text not null check(length(body) between 1 and 5000), performed_on date not null,
 photo_paths text[] not null default '{}', created_at timestamptz not null default now(),
 check(cardinality(photo_paths)<=10)
);
create table public.work_requests (
 id uuid primary key default gen_random_uuid(), property_id uuid not null references public.properties(id),
 customer_id uuid not null references public.profiles(id),
 kind text not null check(kind in ('除草・清掃','郵便物転送','その他')),
 body text not null check(length(body) between 1 and 5000),
 status text not null default '受付待ち' check(status in ('受付待ち','受付済み','作業中','完了')),
 created_at timestamptz not null default now()
);
create index on public.properties(customer_id);
create index on public.reports(property_id,performed_on desc);
create index on public.work_requests(property_id,created_at desc);
create function public.current_role() returns text language sql stable security definer set search_path='' as $$
 select role from public.profiles where id=(select auth.uid()) and active=true;
$$;
revoke all on function public.current_role() from public,anon;
grant execute on function public.current_role() to authenticated;
create function public.handle_new_user() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.profiles(id,name) values(new.id,coalesce(new.raw_user_meta_data->>'name',split_part(new.email,'@',1)));
 return new;
end; $$;
revoke all on function public.handle_new_user() from public,anon,authenticated;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();
-- 既存アカウントも安全な顧客権限で追加。
insert into public.profiles(id,name) select id,coalesce(raw_user_meta_data->>'name',split_part(email,'@',1)) from auth.users on conflict(id) do nothing;
alter table public.profiles enable row level security;
alter table public.properties enable row level security;
alter table public.reports enable row level security;
alter table public.work_requests enable row level security;
revoke all on public.profiles,public.properties,public.reports,public.work_requests from anon,authenticated;
grant select on public.profiles,public.properties,public.reports,public.work_requests to authenticated;
grant update(active) on public.profiles to authenticated;
grant insert on public.properties,public.reports to authenticated;
grant update(photo_paths) on public.reports to authenticated;
grant delete on public.reports to authenticated;
grant insert(property_id,customer_id,kind,body) on public.work_requests to authenticated;
grant update(status) on public.work_requests to authenticated;
create policy profiles_read on public.profiles for select to authenticated using(id=(select auth.uid()) or public.current_role() in ('admin','worker'));
create policy profiles_suspend on public.profiles for update to authenticated using(public.current_role()='admin' and id<>(select auth.uid())) with check(public.current_role()='admin' and id<>(select auth.uid()));
create policy properties_read on public.properties for select to authenticated using(public.current_role() in ('admin','worker') or (public.current_role()='customer' and customer_id=(select auth.uid())));
create policy properties_create on public.properties for insert to authenticated with check(public.current_role()='admin' and exists(select 1 from public.profiles p where p.id=customer_id and p.role='customer' and p.active));
create policy reports_read on public.reports for select to authenticated using(public.current_role() is not null and exists(select 1 from public.properties p where p.id=property_id));
create policy reports_create on public.reports for insert to authenticated with check(public.current_role() in ('admin','worker') and author_id=(select auth.uid()) and cardinality(photo_paths)=0);
create policy reports_photos on public.reports for update to authenticated using(public.current_role() in ('admin','worker') and author_id=(select auth.uid())) with check(public.current_role() in ('admin','worker') and author_id=(select auth.uid()));
create policy reports_cleanup on public.reports for delete to authenticated using(public.current_role() in ('admin','worker') and author_id=(select auth.uid()));
create policy requests_read on public.work_requests for select to authenticated using(public.current_role() in ('admin','worker') or (public.current_role()='customer' and customer_id=(select auth.uid()) and exists(select 1 from public.properties p where p.id=property_id and p.customer_id=(select auth.uid()))));
create policy requests_create on public.work_requests for insert to authenticated with check(public.current_role()='customer' and customer_id=(select auth.uid()) and status='受付待ち' and exists(select 1 from public.properties p where p.id=property_id and p.customer_id=(select auth.uid())));
create policy requests_status on public.work_requests for update to authenticated using(public.current_role() in ('admin','worker')) with check(public.current_role() in ('admin','worker'));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('report-photos','report-photos',false,10485760,array['image/jpeg','image/png','image/webp']);
create policy photos_read on storage.objects for select to authenticated using(bucket_id='report-photos' and exists(select 1 from public.reports r where r.id::text=(storage.foldername(name))[1]));
create policy photos_upload on storage.objects for insert to authenticated with check(bucket_id='report-photos' and public.current_role() in ('admin','worker') and exists(select 1 from public.reports r where r.id::text=(storage.foldername(name))[1] and r.author_id=(select auth.uid())));
create policy photos_cleanup on storage.objects for delete to authenticated using(bucket_id='report-photos' and public.current_role() in ('admin','worker') and exists(select 1 from public.reports r where r.id::text=(storage.foldername(name))[1] and r.author_id=(select auth.uid())));
commit;
