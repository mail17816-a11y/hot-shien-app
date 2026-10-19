begin;
alter table public.billing_invoices add column cancelled_at timestamptz;
alter table public.billing_invoices add column cancelled_by uuid references public.profiles(id);
create index billing_invoices_cancelled_by_idx on public.billing_invoices(cancelled_by);
alter table public.billing_invoices drop constraint billing_invoices_status_check;
alter table public.billing_invoices drop constraint billing_invoices_check;
alter table public.billing_invoices add constraint billing_invoice_state_check check(
 (status='draft' and published_at is null and cancelled_at is null and cancelled_by is null) or
 (status='published' and published_at is not null and cancelled_at is null and cancelled_by is null) or
 (status='cancelled' and published_at is not null and cancelled_at is not null and cancelled_by is not null)
);
alter table public.billing_invoices drop constraint billing_invoices_customer_id_period_key;
create unique index billing_invoice_active_period_key on public.billing_invoices(customer_id,period) where status<>'cancelled';
alter table public.billing_lines add column released_at timestamptz;
alter table public.billing_lines drop constraint billing_lines_expense_id_key;
create unique index billing_lines_active_expense_key on public.billing_lines(expense_id) where released_at is null;
create or replace function palette_private.guard_billed_expense() returns trigger
 language plpgsql security invoker set search_path='' as $$
begin
 if old.billed_at is not null then
  if tg_op='UPDATE' and new.billed_at is null and
    new.id=old.id and new.report_id=old.report_id and new.item=old.item and
    new.amount_yen=old.amount_yen and new.created_at=old.created_at and
    not exists(select 1 from public.billing_lines where expense_id=old.id and released_at is null) then return new; end if;
  raise exception '請求情報作成済みの実費は変更・削除できません' using errcode='23514';
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end; $$;

create or replace function palette_private.billing_action(p_action text,p_data jsonb) returns uuid
 language plpgsql security definer set search_path='' as $$
declare
 result_id uuid; customer uuid; prop uuid; month date; month_end date;
 old_invoice public.billing_invoices; selected_expenses uuid[]; old_expenses uuid[];
 expense_count integer;
begin
 perform pg_advisory_xact_lock(783101822);
 perform 1 from public.profiles where id=auth.uid() for share;
 if auth.uid() is null or public.current_role() is distinct from 'admin' then
  raise exception '管理者権限がありません' using errcode='42501';
 end if;
 if p_action='contract' then
  customer:=(p_data->>'customer_id')::uuid; prop:=(p_data->>'property_id')::uuid;
  if not exists(select 1 from public.profiles where id=customer and role='customer' and active and deleted_at is null) or
     not exists(select 1 from public.properties where id=prop and customer_id=customer) then
   raise exception '対象顧客の物件を指定してください'; end if;
  result_id:=nullif(p_data->>'id','')::uuid;
  if result_id is null then
   insert into public.customer_contracts(customer_id,property_id,item,amount_yen,billing_cycle,starts_on,ends_on,effective_from,status)
   values(customer,prop,btrim(p_data->>'item'),(p_data->>'amount_yen')::integer,p_data->>'billing_cycle',
    (p_data->>'starts_on')::date,nullif(p_data->>'ends_on','')::date,(p_data->>'effective_from')::date,p_data->>'status') returning id into result_id;
  else
   update public.customer_contracts set item=btrim(p_data->>'item'),amount_yen=(p_data->>'amount_yen')::integer,
    billing_cycle=p_data->>'billing_cycle',starts_on=(p_data->>'starts_on')::date,ends_on=nullif(p_data->>'ends_on','')::date,
    effective_from=(p_data->>'effective_from')::date,status=p_data->>'status'
    where id=result_id and customer_id=customer and property_id=prop;
   if not found then raise exception '契約が見つかりません。顧客・物件は変更できません'; end if;
  end if;
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
  insert into public.billing_lines(invoice_id,property_id,property_number,category,item,amount_yen,contract_id)
   select result_id,c.property_id,p.property_number,'subscription',c.item,c.amount_yen,c.id
   from public.customer_contracts c join public.properties p on p.id=c.property_id
   where c.customer_id=customer and p.customer_id=customer and c.effective_from<=month
    and c.starts_on<=month_end and (c.ends_on is null or c.ends_on>=month)
    and (c.billing_cycle='monthly' or extract(month from c.effective_from)=extract(month from month));
  perform 1 from public.report_expenses where id=any(selected_expenses) order by id for update;
  select count(*) into expense_count from public.report_expenses e join public.reports r on r.id=e.report_id join public.properties p on p.id=r.property_id
   where e.id=any(selected_expenses) and e.billed_at is null and p.customer_id=customer and r.performed_on<=month_end;
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
