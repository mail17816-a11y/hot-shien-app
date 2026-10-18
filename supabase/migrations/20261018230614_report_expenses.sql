begin;
create table public.report_expenses (
 id uuid primary key default gen_random_uuid(),
 report_id uuid not null references public.reports(id) on delete cascade,
 item text not null check(length(btrim(item)) between 1 and 200),
 amount_yen integer not null check(amount_yen between 1 and 999999999),
 billed_at timestamptz,
 created_at timestamptz not null default now()
);
create index report_expenses_report_idx on public.report_expenses(report_id);
alter table public.report_expenses enable row level security;
revoke all on public.report_expenses from anon,authenticated;
grant select on public.report_expenses to authenticated;
grant insert(report_id,item,amount_yen) on public.report_expenses to authenticated;
grant update(item,amount_yen) on public.report_expenses to authenticated;
grant all on public.report_expenses to service_role;
create policy expenses_read on public.report_expenses for select to authenticated
 using(public.current_role() in ('admin','worker'));
create policy expenses_create on public.report_expenses for insert to authenticated
 with check(public.current_role() in ('admin','worker') and billed_at is null and
 exists(select 1 from public.reports r where r.id=report_id and r.author_id=(select auth.uid())));
create policy expenses_edit on public.report_expenses for update to authenticated
 using(public.current_role()='admin' and billed_at is null)
 with check(public.current_role()='admin' and billed_at is null);
-- 将来の請求作成処理は、明細をロックしてスナップショット保存後にbilled_atを設定する。
-- 作成済み明細は元の報告の削除（CASCADE）からも保護する。
create function palette_private.guard_billed_expense() returns trigger
 language plpgsql security invoker set search_path='' as $$
begin
 if old.billed_at is not null then
  raise exception '請求情報作成済みの実費は変更・削除できません' using errcode='23514';
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end; $$;
revoke all on function palette_private.guard_billed_expense() from public,anon,authenticated;
create trigger guard_billed_expense before update or delete on public.report_expenses
 for each row execute function palette_private.guard_billed_expense();
-- 報告と実費を同じトランザクションで作成し、実費だけ未保存になることを防ぐ。
create function public.create_report_with_expenses(p_id uuid,p_property_id uuid,p_kind text,p_body text,p_performed_on date,p_expenses jsonb default '[]')
 returns uuid language plpgsql security invoker set search_path='' as $$
begin
 if jsonb_typeof(p_expenses) is distinct from 'array' then raise exception '実費の形式が不正です'; end if;
 if jsonb_array_length(p_expenses)>50 then raise exception '実費明細は50件までです'; end if;
 insert into public.reports(id,property_id,author_id,kind,body,performed_on)
 values(p_id,p_property_id,auth.uid(),p_kind,p_body,p_performed_on);
 insert into public.report_expenses(report_id,item,amount_yen)
 select p_id,btrim(x->>'item'),(x->>'amount_yen')::integer from jsonb_array_elements(p_expenses) x;
 return p_id;
end; $$;
revoke all on function public.create_report_with_expenses(uuid,uuid,text,text,date,jsonb) from public,anon;
grant execute on function public.create_report_with_expenses(uuid,uuid,text,text,date,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
