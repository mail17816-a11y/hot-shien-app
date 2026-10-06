-- 001・002適用済みのDBに一度だけ実行。
-- 実行前に docs/identifier-migration.md のローカル照合手順を確認してください。
-- 氏名・住所・投稿者名の列を削除します。報告本文・写真・認証メールは変更しません。
begin;
lock table public.profiles, public.properties, public.property_messages in access exclusive mode;
create sequence public.customer_number_seq maxvalue 999999999999;
create sequence public.property_number_seq maxvalue 999999999999;
alter table public.profiles add column customer_number text;
-- 同じ番号を事前確認SQLでも算出します。スタッフには顧客番号を割り当てません。
with numbered as (
 select id, 'C' || lpad(row_number() over(order by id)::text, 6, '0') as number
 from public.profiles where role='customer'
)
update public.profiles p set customer_number=n.number from numbered n where p.id=n.id;
select setval('public.customer_number_seq', greatest((select count(*) from public.profiles where role='customer') + 1, 1), false);
alter table public.profiles add constraint profiles_customer_number_unique unique(customer_number);
alter table public.profiles add constraint profiles_customer_number_format check(customer_number is null or customer_number ~ '^C[0-9]{6,12}$');
alter table public.profiles add constraint profiles_customer_number_required check(role<>'customer' or customer_number is not null);
alter table public.properties add column property_number text;
with numbered as (
 select id, 'P' || lpad(row_number() over(order by id)::text, 6, '0') as number from public.properties
)
update public.properties p set property_number=n.number from numbered n where p.id=n.id;
select setval('public.property_number_seq', greatest((select count(*) from public.properties) + 1, 1), false);
alter table public.properties alter column property_number set not null;
alter table public.properties add constraint properties_property_number_unique unique(property_number);
alter table public.properties add constraint properties_property_number_format check(property_number ~ '^P[0-9]{6,12}$');
-- 自動採番の権限をブラウザには渡さず、DB内のトリガーで採番します。
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path='' as $$
declare number_text text;
begin
 number_text := nextval('public.customer_number_seq')::text;
 insert into public.profiles(id,customer_number)
 values(new.id,'C' || lpad(number_text,greatest(6,length(number_text)),'0'));
 return new;
end; $$;
create function public.assign_property_number() returns trigger language plpgsql security definer set search_path='' as $$
declare number_text text;
begin
 if new.property_number is null then
  number_text := nextval('public.property_number_seq')::text;
  new.property_number := 'P' || lpad(number_text,greatest(6,length(number_text)),'0');
 end if;
 return new;
end; $$;
revoke all on function public.assign_property_number() from public,anon,authenticated;
create trigger assign_property_number before insert on public.properties for each row execute function public.assign_property_number();
-- 番号の繰上げ・顧客番号の再割当はSQL Editorで管理。一般ユーザーには許可しません。
revoke all on sequence public.customer_number_seq,public.property_number_seq from public,anon,authenticated;
drop trigger set_message_author_name on public.property_messages;
drop function public.set_message_author_name();
alter table public.property_messages drop column author_name;
alter table public.properties drop column name, drop column address;
alter table public.profiles drop column name;
-- 顧客番号と物件番号は参照専用。プロファイルへのクライアント更新は停止状態のみ。
revoke insert on public.properties from authenticated;
grant insert(customer_id) on public.properties to authenticated;
-- 顧客名を入力するメタデータを新規プロフィールへ転記する処理は廃止しました。
notify pgrst, 'reload schema';
commit;
