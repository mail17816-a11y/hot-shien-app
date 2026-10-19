begin;
create table public.customer_contracts (
 id uuid primary key default gen_random_uuid(),
 customer_id uuid not null references public.profiles(id),
 property_id uuid not null references public.properties(id),
 item text not null check(length(btrim(item)) between 1 and 200),
 amount_yen integer not null check(amount_yen between 0 and 999999999),
 billing_cycle text not null check(billing_cycle in ('monthly','annual')),
 starts_on date not null, ends_on date,
 effective_from date not null check(extract(day from effective_from)=1),
 status text not null default 'active' check(status in ('active','ended')),
 created_at timestamptz not null default now(),
 check(ends_on is null or ends_on>=starts_on),
 check(status<>'ended' or ends_on is not null)
);
create index customer_contracts_customer_idx on public.customer_contracts(customer_id);
create index customer_contracts_property_idx on public.customer_contracts(property_id);
create table public.billing_invoices (
 id uuid primary key default gen_random_uuid(),
 customer_id uuid not null references public.profiles(id),
 period date not null check(extract(day from period)=1),
 status text not null default 'draft' check(status in ('draft','published')),
 created_at timestamptz not null default now(), published_at timestamptz,
 unique(customer_id,period),
 check((status='draft' and published_at is null) or (status='published' and published_at is not null))
);
create table public.billing_lines (
 id uuid primary key default gen_random_uuid(),
 invoice_id uuid not null references public.billing_invoices(id),
 property_id uuid not null references public.properties(id),
 property_number text not null,
 category text not null check(category in ('subscription','expense')),
 item text not null,
 amount_yen integer not null check(amount_yen between 0 and 999999999),
 contract_id uuid references public.customer_contracts(id),
 expense_id uuid unique references public.report_expenses(id),
 check((category='subscription' and contract_id is not null and expense_id is null) or
       (category='expense' and expense_id is not null and contract_id is null))
);
create index billing_lines_invoice_idx on public.billing_lines(invoice_id);
create index billing_lines_property_idx on public.billing_lines(property_id);
create index billing_lines_contract_idx on public.billing_lines(contract_id);
alter table public.customer_contracts enable row level security;
alter table public.billing_invoices enable row level security;
alter table public.billing_lines enable row level security;
revoke all on public.customer_contracts,public.billing_invoices,public.billing_lines from anon,authenticated;
grant select on public.customer_contracts,public.billing_invoices,public.billing_lines to authenticated;
grant all on public.customer_contracts,public.billing_invoices,public.billing_lines to service_role;
create policy contracts_read on public.customer_contracts for select to authenticated
 using(public.current_role()='admin' or (public.current_role()='customer' and customer_id=(select auth.uid())));
create policy invoices_read on public.billing_invoices for select to authenticated
 using(public.current_role()='admin' or (public.current_role()='customer' and customer_id=(select auth.uid()) and status='published'));
create policy billing_lines_read on public.billing_lines for select to authenticated
 using(exists(select 1 from public.billing_invoices i where i.id=invoice_id));
-- 下書き再作成時だけ、請求明細を外した実費を未請求へ戻す。
create or replace function palette_private.guard_billed_expense() returns trigger
 language plpgsql security invoker set search_path='' as $$
begin
 if old.billed_at is not null then
  if tg_op='UPDATE' and new.billed_at is null and
    new.id=old.id and new.report_id=old.report_id and new.item=old.item and
    new.amount_yen=old.amount_yen and new.created_at=old.created_at and
    not exists(select 1 from public.billing_lines where expense_id=old.id) then return new; end if;
  raise exception '請求情報作成済みの実費は変更・削除できません' using errcode='23514';
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end; $$;
-- 管理者の最新権限を照合する非公開の入口。クライアントにテーブル更新権限は与えない。
create function palette_private.billing_action(p_action text,p_data jsonb) returns uuid
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
  select * into old_invoice from public.billing_invoices where customer_id=customer and period=month for update;
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
 elsif p_action='publish' then
  result_id:=(p_data->>'id')::uuid;
  update public.billing_invoices set status='published',published_at=clock_timestamp() where id=result_id and status='draft';
  if not found then raise exception '公開可能な下書きがありません'; end if;
 else raise exception '操作が不正です';
 end if;
 return result_id;
end; $$;
revoke all on function palette_private.billing_action(text,jsonb) from public,anon;
grant execute on function palette_private.billing_action(text,jsonb) to authenticated;
create function public.billing_action(p_action text,p_data jsonb) returns uuid
 language sql security invoker set search_path='' as $$select palette_private.billing_action(p_action,p_data);$$;
revoke all on function public.billing_action(text,jsonb) from public,anon;
grant execute on function public.billing_action(text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
