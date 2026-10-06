-- 001適用済みのプロジェクトに追加で実行。既存の報告・依頼は変更しません。
begin;
create table if not exists public.property_messages (
 id uuid primary key default gen_random_uuid(),
 property_id uuid not null references public.properties(id),
 author_id uuid not null references public.profiles(id),
 author_role text not null default public.current_role() check(author_role in ('admin','worker','customer')),
 author_name text not null default '',
 kind text not null check(kind in ('お問い合わせ','その他メッセージ')),
 body text not null check(length(btrim(body)) between 1 and 5000),
 created_at timestamptz not null default now()
);
create index if not exists property_messages_property_created_idx on public.property_messages(property_id,created_at);
-- 投稿者名は認証中の本人のプロフィールから記録。クライアントからは指定不可。
create or replace function public.set_message_author_name() returns trigger
language plpgsql set search_path='' as $$
begin
 select name into new.author_name from public.profiles where id=(select auth.uid());
 return new;
end; $$;
revoke all on function public.set_message_author_name() from public,anon,authenticated;
drop trigger if exists set_message_author_name on public.property_messages;
create trigger set_message_author_name before insert on public.property_messages
 for each row execute function public.set_message_author_name();
alter table public.property_messages enable row level security;
revoke all on public.property_messages from public,anon,authenticated;
grant select on public.property_messages to authenticated;
grant insert(property_id,author_id,kind,body) on public.property_messages to authenticated;
drop policy if exists messages_read on public.property_messages;
create policy messages_read on public.property_messages for select to authenticated
 using(public.current_role() is not null and exists(select 1 from public.properties p where p.id=property_id));
drop policy if exists messages_create on public.property_messages;
create policy messages_create on public.property_messages for insert to authenticated
 with check(author_id=(select auth.uid()) and author_role=public.current_role()
 and exists(select 1 from public.properties p where p.id=property_id)
 and ((public.current_role()='customer' and kind in ('お問い合わせ','その他メッセージ'))
 or (public.current_role() in ('admin','worker') and kind='その他メッセージ')));
notify pgrst, 'reload schema';
commit;
