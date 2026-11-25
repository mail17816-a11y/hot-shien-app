begin;

-- 旧条件の変換は行わない。本番適用前に旧契約が空であることを確認する。
do $$
begin
 if exists(select 1 from public.customer_contracts) then
  raise exception '旧契約が残っています。内容を確認して整理してから適用してください';
 end if;
end;
$$;

alter table public.customer_contracts
 drop column amount_yen,
 drop column billing_cycle,
 drop column starts_on,
 drop column ends_on,
 drop column effective_from,
 drop column status,
 drop column payment_months,
 add column service_code text not null check (service_code in ('system','patrol','light_work','mail')),
 add column normal_months smallint[] not null default '{}'
  check (array_position(normal_months, null) is null
   and normal_months <@ array[1,2,3,4,5,6,7,8,9,10,11,12]::smallint[]),
 add unique (property_id, service_code);
create unique index customer_contracts_one_system_per_customer
 on public.customer_contracts(customer_id) where service_code='system';

create table public.service_schedule_months (
 contract_id uuid not null references public.customer_contracts(id),
 period date not null check (extract(day from period)=1),
 planned boolean not null,
 primary key (contract_id, period)
);
create index service_schedule_months_planned_idx
 on public.service_schedule_months(period, contract_id) where planned;

create table public.service_schedule_changes (
 id uuid primary key default gen_random_uuid(),
 contract_id uuid not null,
 period date not null,
 old_planned boolean not null,
 new_planned boolean not null,
 changed_by uuid not null references public.profiles(id),
 changed_at timestamptz not null default clock_timestamp(),
 foreign key (contract_id, period) references public.service_schedule_months(contract_id, period)
);
create index service_schedule_changes_month_idx
 on public.service_schedule_changes(contract_id, period, changed_at);
create index service_schedule_changes_actor_idx on public.service_schedule_changes(changed_by);

create table public.service_rates (
 id uuid primary key default gen_random_uuid(),
 service_code text not null check (service_code in ('system','patrol','light_work','mail')),
 effective_from date not null check (extract(day from effective_from)=1),
 amount_yen integer not null check (amount_yen between 0 and 999999999),
 unique (service_code, effective_from)
);

alter table public.service_schedule_months enable row level security;
alter table public.service_schedule_changes enable row level security;
alter table public.service_rates enable row level security;
revoke all on public.service_schedule_months, public.service_schedule_changes, public.service_rates
 from public, anon, authenticated;
grant select on public.service_schedule_months, public.service_schedule_changes, public.service_rates
 to authenticated;
grant all on public.service_schedule_months, public.service_schedule_changes, public.service_rates
 to service_role;
create policy service_schedule_months_read on public.service_schedule_months for select to authenticated
 using ((select public.current_role())='admin');
create policy service_schedule_changes_read on public.service_schedule_changes for select to authenticated
 using ((select public.current_role())='admin');
create policy service_rates_read on public.service_rates for select to authenticated
 using ((select public.current_role())='admin');

create function palette_private.record_service_schedule_change() returns trigger
 language plpgsql security invoker set search_path='' as $$
begin
 insert into public.service_schedule_changes(contract_id, period, old_planned, new_planned, changed_by)
 values (new.contract_id, new.period, old.planned, new.planned, auth.uid());
 return new;
end;
$$;
revoke all on function palette_private.record_service_schedule_change() from public, anon, authenticated;
create trigger service_schedule_changes_record after update of planned on public.service_schedule_months
 for each row when (old.planned is distinct from new.planned)
 execute function palette_private.record_service_schedule_change();

create index reports_completed_for_billing_idx on public.reports(property_id, kind, performed_on)
 where publication_status='published' and work_status='completed';

create or replace function palette_private.billing_action(p_action text,p_data jsonb) returns uuid
 language plpgsql security definer set search_path='' as $$
declare
 result_id uuid; customer uuid; prop uuid; month date; month_end date;
 old_invoice public.billing_invoices; selected_expenses uuid[]; old_expenses uuid[];
 expense_count integer;
 service text; schedule_year integer; price integer;
 selected_months smallint[]; saved_months smallint[]; expected_months smallint[];
 missing_rate text;
begin
 perform pg_advisory_xact_lock(783101822);
 perform 1 from public.profiles where id=auth.uid() for share;
 if auth.uid() is null or public.current_role() is distinct from 'admin' then
  raise exception '管理者権限がありません' using errcode='42501';
 end if;
 if p_action='rate' then
  service := p_data->>'service_code';
  month := (p_data->>'effective_from')::date;
  price := (p_data->>'amount_yen')::integer;
  if service is null or month is null or extract(day from month) <> 1 or price is null then
   raise exception 'サービス・料金適用月・金額を指定してください';
  end if;
  insert into public.service_rates(service_code, effective_from, amount_yen)
  values (service, month, price)
  on conflict (service_code, effective_from) do update set amount_yen=excluded.amount_yen
  returning id into result_id;

 elsif p_action='contract' then
  customer := (p_data->>'customer_id')::uuid;
  prop := (p_data->>'property_id')::uuid;
  schedule_year := (p_data->>'year')::integer;
  if schedule_year is null or schedule_year not between 1900 and 9999 then
   raise exception '対象年を指定してください';
  end if;
  if not exists(select 1 from public.profiles where id=customer and role='customer' and active and deleted_at is null) or
     not exists(select 1 from public.properties where id=prop and customer_id=customer) then
   raise exception '対象顧客の物件を指定してください';
  end if;
  if jsonb_typeof(p_data->'months') is distinct from 'array' then
   raise exception '提供予定月の指定が不正です';
  end if;
  select coalesce(array_agg(distinct value::smallint order by value::smallint), '{}'::smallint[])
  into selected_months from jsonb_array_elements_text(p_data->'months');
  if array_position(selected_months, null) is not null
     or not selected_months <@ array[1,2,3,4,5,6,7,8,9,10,11,12]::smallint[] then
   raise exception '提供予定月は1〜12月から指定してください';
  end if;

  result_id := nullif(p_data->>'id','')::uuid;
  if result_id is null then
   service := p_data->>'service_code';
   insert into public.customer_contracts(customer_id, property_id, service_code, item, normal_months)
   values (customer, prop, service, case service
    when 'system' then 'システム利用料'
    when 'patrol' then '巡回点検'
    when 'light_work' then '除草・清掃'
    when 'mail' then '郵便物対応'
   end, selected_months)
   returning id into result_id;
  else
   if not exists(select 1 from public.customer_contracts where id=result_id and customer_id=customer and property_id=prop) then
    raise exception '契約が見つかりません。顧客・物件は変更できません';
   end if;
   if jsonb_typeof(p_data->'expected_months') = 'array' then
    select coalesce(array_agg(distinct value::smallint order by value::smallint), '{}'::smallint[])
    into expected_months from jsonb_array_elements_text(p_data->'expected_months');
   end if;
   select case when count(*) > 0 then coalesce(
    array_agg(extract(month from period)::smallint order by period) filter (where planned),
    '{}'::smallint[]
   ) end into saved_months
   from public.service_schedule_months
   where contract_id=result_id and period between make_date(schedule_year,1,1) and make_date(schedule_year,12,1);
   if saved_months is distinct from expected_months then
    raise exception '提供予定が変更されています。再読み込みしてください';
   end if;
   if p_data->>'update_normal' = 'true' then
    update public.customer_contracts set normal_months=selected_months where id=result_id;
   end if;
  end if;

  insert into public.service_schedule_months(contract_id, period, planned)
  select result_id, make_date(schedule_year, m, 1), m::smallint=any(selected_months)
  from generate_series(1,12) as m
  on conflict (contract_id, period) do update set planned=excluded.planned
  where service_schedule_months.planned is distinct from excluded.planned;
 elsif p_action='invoice' then
  customer:=(p_data->>'customer_id')::uuid;
  month:=(p_data->>'period')::date;
  if month is null or extract(day from month)<>1 then raise exception '請求対象月が不正です'; end if;
  month_end:=(month+interval '1 month - 1 day')::date;
  if not exists(select 1 from public.profiles where id=customer and role='customer' and active and deleted_at is null) then raise exception '有効な顧客を指定してください'; end if;
  if jsonb_typeof(p_data->'expense_ids') is distinct from 'array' then raise exception '実費の選択が不正です'; end if;
  select coalesce(array_agg(distinct value::uuid),'{}'::uuid[]) into selected_expenses from jsonb_array_elements_text(p_data->'expense_ids');
  select * into old_invoice from public.billing_invoices where customer_id=customer and period=month and status<>'cancelled' for update;
  if found then
   if old_invoice.status='published' then raise exception 'この月の請求情報は公開済みです'; end if;
   result_id:=old_invoice.id;
   select coalesce(array_agg(expense_id) filter(where expense_id is not null),'{}'::uuid[]) into old_expenses from public.billing_lines where invoice_id=result_id;
   perform 1 from public.report_expenses where id=any(old_expenses) for update;
   delete from public.billing_lines where invoice_id=result_id;
   update public.report_expenses set billed_at=null where id=any(old_expenses);
  else
   insert into public.billing_invoices(customer_id,period) values(customer,month) returning id into result_id;
  end if;
  with billable as (
   select c.id, c.property_id, p.property_number, c.item, rate.amount_yen
   from public.service_schedule_months schedule
   join public.customer_contracts c on c.id=schedule.contract_id
   join public.properties p on p.id=c.property_id and p.customer_id=c.customer_id
   left join lateral (
    select amount_yen from public.service_rates
    where service_code=c.service_code and effective_from<=month
    order by effective_from desc limit 1
   ) rate on true
   where schedule.period=month and schedule.planned and c.customer_id=customer
    and (c.service_code='system' or exists (
     select 1 from public.reports r
     where r.property_id=c.property_id
      and r.kind=case c.service_code
       when 'patrol' then '定期巡回'
       when 'light_work' then '除草・清掃'
       when 'mail' then '郵便物対応'
      end
      and r.performed_on between month and month_end
      and r.publication_status='published' and r.work_status='completed'
    ))
  ), inserted as (
   insert into public.billing_lines(invoice_id,property_id,property_number,category,item,amount_yen,contract_id)
   select result_id,property_id,property_number,'subscription',item,amount_yen,id
   from billable where amount_yen is not null
  )
  select min(item) into missing_rate from billable where amount_yen is null;
  if missing_rate is not null then
   raise exception '対象月の共通料金が未登録です（%）', missing_rate;
  end if;
  perform 1 from public.report_expenses where id=any(selected_expenses) order by id for update;
  select count(*) into expense_count from public.report_expenses e join public.reports r on r.id=e.report_id join public.properties p on p.id=r.property_id
   where e.id=any(selected_expenses) and e.billed_at is null and p.customer_id=customer and r.publication_status='published' and r.performed_on<=month_end;
  if expense_count<>cardinality(selected_expenses) then raise exception '選択した実費は請求済み、対象月より後、または別の顧客の明細です'; end if;
  insert into public.billing_lines(invoice_id,property_id,property_number,category,item,amount_yen,expense_id)
   select result_id,p.id,p.property_number,'expense',e.item,e.amount_yen,e.id
   from public.report_expenses e join public.reports r on r.id=e.report_id join public.properties p on p.id=r.property_id where e.id=any(selected_expenses);
  if not exists(select 1 from public.billing_lines where invoice_id=result_id) then raise exception '請求対象の契約・実費がありません'; end if;
  update public.report_expenses set billed_at=clock_timestamp() where id=any(selected_expenses);
 elsif p_action='cancel' then
  result_id:=(p_data->>'id')::uuid;
  customer:=(p_data->>'customer_id')::uuid;
  select * into old_invoice from public.billing_invoices where id=result_id and customer_id=customer for update;
  if not found or old_invoice.status<>'published' then raise exception '選択した顧客の公開済み請求情報だけを撤回できます'; end if;
  select coalesce(array_agg(expense_id) filter(where expense_id is not null),'{}'::uuid[]) into old_expenses from public.billing_lines where invoice_id=result_id;
  perform 1 from public.report_expenses where id=any(old_expenses) order by id for update;
  update public.billing_invoices set status='cancelled',cancelled_at=clock_timestamp(),cancelled_by=auth.uid() where id=result_id;
  update public.billing_lines set released_at=clock_timestamp() where invoice_id=result_id;
  update public.report_expenses set billed_at=null where id=any(old_expenses) and not exists(select 1 from public.billing_lines l where l.expense_id=public.report_expenses.id and l.released_at is null);
 elsif p_action='publish' then
  result_id:=(p_data->>'id')::uuid;
  update public.billing_invoices set status='published',published_at=clock_timestamp() where id=result_id and status='draft';
  if not found then raise exception '公開可能な下書きがありません'; end if;
 else raise exception '操作が不正です';
 end if;
 return result_id;
end; $$;

notify pgrst,'reload schema';
commit;
