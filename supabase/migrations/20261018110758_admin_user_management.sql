begin;
alter table public.profiles add column deleted_at timestamptz;
alter table public.profiles add column auth_valid_after bigint not null default 0;
-- 権限変更・削除・パスワード再設定前のJWTを業務データへ使わせない。
create schema if not exists palette_private;
grant usage on schema palette_private to authenticated,service_role;
create function palette_private.current_role() returns text language sql stable security definer set search_path='' as $$
 select role from public.profiles where id=(select auth.uid()) and active and deleted_at is null
 and coalesce(((select auth.jwt())->>'iat')::bigint,0)>auth_valid_after;
$$;
revoke all on function palette_private.current_role() from public,anon;
grant execute on function palette_private.current_role() to authenticated,service_role;
create or replace function public.current_role() returns text language sql stable security invoker set search_path='' as $$
 select palette_private.current_role();
$$;
revoke update(active) on public.profiles from authenticated;
drop policy profiles_suspend on public.profiles;
-- service_roleだけが呼び出せる管理API用。権限は最新のDB状態と検証済みJWT発行時刻で確認。
create function public.admin_manage_user(p_actor_id uuid,p_issued_at bigint,p_target_id uuid,p_role text default null,p_active boolean default null,p_delete boolean default false,p_reset boolean default false)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor public.profiles; target public.profiles;
begin
 perform pg_advisory_xact_lock(783101821);
 select * into actor from public.profiles where id=p_actor_id for update;
 if not found or actor.role<>'admin' or not actor.active or actor.deleted_at is not null or p_issued_at<=actor.auth_valid_after then
  raise exception '管理者権限がありません' using errcode='42501';
 end if;
 if p_target_id=p_actor_id then raise exception '自分自身の変更・削除はできません' using errcode='22023'; end if;
 select * into target from public.profiles where id=p_target_id for update;
 if not found then raise exception 'ユーザーが見つかりません' using errcode='P0002'; end if;
 if target.deleted_at is not null and not p_delete then raise exception '削除済みユーザーは変更できません' using errcode='22023'; end if;
 if p_role is not null and p_role not in ('admin','worker','customer') then raise exception '役割が不正です' using errcode='22023'; end if;
 if p_role is not null and p_role<>'customer' and exists(select 1 from public.properties where customer_id=p_target_id) then
  raise exception '契約物件がある顧客の役割は変更できません' using errcode='22023';
 end if;
 update public.profiles set role=coalesce(p_role,role),
 customer_number=case when coalesce(p_role,role)='customer' then upper(login_id) else null end,
 active=case when p_delete then false else coalesce(p_active,active) end,
 deleted_at=case when p_delete then coalesce(deleted_at,clock_timestamp()) else deleted_at end,
 auth_valid_after=case when p_delete or p_reset or (p_role is not null and p_role<>role) or (p_active is not null and p_active<>active)
 then floor(extract(epoch from clock_timestamp()))::bigint else auth_valid_after end
 where id=p_target_id returning * into target;
 return to_jsonb(target);
end; $$;
revoke all on function public.admin_manage_user(uuid,bigint,uuid,text,boolean,boolean,boolean) from public,anon,authenticated;
grant execute on function public.admin_manage_user(uuid,bigint,uuid,text,boolean,boolean,boolean) to service_role;
notify pgrst,'reload schema';
commit;
