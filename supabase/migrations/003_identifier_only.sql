-- 001・002適用済み、旧版003は未適用のDBに一度だけ実行。
-- 認証メールの整備とローカル照合表の控えを先に行います。
-- 氏名・住所・投稿者名の列とAuthユーザーメタデータを削除します。
begin;
lock table public.profiles, public.properties, public.property_messages in access exclusive mode;
-- example.com以外の認証メールはAdmin APIで先に変更。Authテーブルのメールを直接書き換えません。
do $$ begin
 if exists(select 1 from auth.users where email is null or lower(email) !~ '^[a-z0-9][a-z0-9_-]{0,31}@example[.]com$') then
  raise exception '認証メールをログインID@example.com形式に整備してから実行してください';
 end if;
end; $$;
alter table public.profiles add column login_id text;
alter table public.profiles add column customer_number text;
update public.profiles p set login_id=lower(split_part(u.email,'@',1)),
 customer_number=case when p.role='customer' then upper(split_part(u.email,'@',1)) else null end
 from auth.users u where u.id=p.id;
alter table public.profiles alter column login_id set not null;
alter table public.profiles add constraint profiles_login_id_unique unique(login_id);
alter table public.profiles add constraint profiles_login_id_format check(login_id ~ '^[a-z0-9][a-z0-9_-]{0,31}$');
alter table public.profiles add constraint profiles_customer_number_unique unique(customer_number);
alter table public.profiles add constraint profiles_customer_number_match check(
 (role='customer' and customer_number is not null and customer_number=upper(login_id))
 or (role in ('admin','worker') and customer_number is null));
alter table public.properties add column property_number text;
-- 旧物件だけUUID由来の暫定識別番号を付与。新規登録は管理者が指定します。
update public.properties set property_number='LEGACY-' || upper(replace(id::text,'-',''));
alter table public.properties alter column property_number set not null;
alter table public.properties add constraint properties_property_number_unique unique(property_number);
alter table public.properties add constraint properties_property_number_format check(property_number ~ '^[A-Z0-9][A-Z0-9_-]{0,63}$');
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path='' as $$
declare account_id text;
begin
 account_id:=lower(split_part(new.email,'@',1));
 insert into public.profiles(id,login_id,customer_number) values(new.id,account_id,upper(account_id));
 return new;
end; $$;
-- 個人のメールや氏名をAuthに戻さない。既存IDの変更も禁止します。
create function public.guard_internal_auth_account() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.email is null or lower(new.email) !~ '^[a-z0-9][a-z0-9_-]{0,31}@example[.]com$' then
  raise exception '認証メールはログインID@example.com形式で指定してください';
 end if;
 if exists(select 1 from public.profiles p where p.id=new.id and p.login_id<>lower(split_part(new.email,'@',1))) then
  raise exception '発行済みのログインIDは変更できません';
 end if;
 new.raw_user_meta_data:='{}'::jsonb;
 return new;
end; $$;
revoke all on function public.guard_internal_auth_account() from public,anon,authenticated;
create trigger palette_internal_auth_guard before insert or update of email,raw_user_meta_data on auth.users
 for each row execute function public.guard_internal_auth_account();
update auth.users set raw_user_meta_data='{}'::jsonb where raw_user_meta_data is distinct from '{}'::jsonb;
drop trigger set_message_author_name on public.property_messages;
drop function public.set_message_author_name();
alter table public.property_messages drop column author_name;
alter table public.properties drop column name, drop column address;
alter table public.profiles drop column name;
revoke insert on public.properties from authenticated;
grant insert(customer_id,property_number) on public.properties to authenticated;
notify pgrst, 'reload schema';
commit;
