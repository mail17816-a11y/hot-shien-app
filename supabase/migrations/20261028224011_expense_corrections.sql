begin;
-- Corrections are communication records; cancelled invoices keep their historical values.
create table public.expense_corrections (
 id uuid primary key default gen_random_uuid(),
 expense_id uuid not null references public.report_expenses(id),
 report_id uuid not null references public.reports(id),
 property_id uuid not null references public.properties(id),
 actor_id uuid not null references public.profiles(id),
 created_at timestamptz not null default clock_timestamp(),
 reason text not null check(length(btrim(reason)) between 1 and 2000),
 old_item text not null, new_item text not null,
 old_amount_yen integer not null, new_amount_yen integer not null
);
create index expense_corrections_report_idx on public.expense_corrections(report_id,created_at);
create index expense_corrections_expense_idx on public.expense_corrections(expense_id);
create index expense_corrections_property_idx on public.expense_corrections(property_id);
create index expense_corrections_actor_idx on public.expense_corrections(actor_id);
create table public.invoice_line_corrections (
 id uuid primary key default gen_random_uuid(),
 invoice_id uuid not null references public.billing_invoices(id),
 line_id uuid references public.billing_lines(id) on delete set null,
 expense_correction_id uuid not null references public.expense_corrections(id),
 created_at timestamptz not null,
 reason text not null,
 old_item text not null, new_item text not null,
 old_amount_yen integer not null, new_amount_yen integer not null
);
create index invoice_line_corrections_invoice_idx on public.invoice_line_corrections(invoice_id,created_at);
create index invoice_line_corrections_line_idx on public.invoice_line_corrections(line_id);
create index invoice_line_corrections_expense_idx on public.invoice_line_corrections(expense_correction_id);
alter table public.expense_corrections enable row level security;
alter table public.invoice_line_corrections enable row level security;
revoke all on public.expense_corrections,public.invoice_line_corrections from public,anon,authenticated;
grant select on public.expense_corrections,public.invoice_line_corrections to authenticated,service_role;
create policy expense_corrections_read on public.expense_corrections for select to authenticated
 using(public.current_role() in ('admin','worker') or (public.current_role()='customer' and
 exists(select 1 from public.properties p where p.id=property_id and p.customer_id=(select auth.uid()))));
create policy invoice_line_corrections_read on public.invoice_line_corrections for select to authenticated
 using(exists(select 1 from public.billing_invoices i where i.id=invoice_id));
-- Client updates must use the reason-bearing RPC, including previously unbilled expenses.
revoke update(item,amount_yen) on public.report_expenses from authenticated;
drop policy expenses_edit on public.report_expenses;
create or replace function palette_private.guard_billed_expense() returns trigger
 language plpgsql security invoker set search_path='' as $$
begin
 if old.billed_at is not null then
  if tg_op='DELETE' then
   raise exception '請求情報に含まれる実費は削除できません。項目・金額は理由を付けて訂正できます' using errcode='23514';
  end if;
  if new.id=old.id and new.report_id=old.report_id and new.created_at=old.created_at then
   if new.billed_at is not distinct from old.billed_at then return new; end if;
   if new.billed_at is null and new.item=old.item and new.amount_yen=old.amount_yen and
     not exists(select 1 from public.billing_lines where expense_id=old.id and released_at is null) then return new; end if;
  end if;
  raise exception '実費の請求紐付けは直接変更できません' using errcode='23514';
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end; $$;
create function palette_private.correct_report_expense(p_data jsonb) returns uuid
 language plpgsql security definer set search_path='' as $$
declare
 old_expense public.report_expenses;
 property uuid; correction_id uuid; corrected_at timestamptz;
 new_item text:=btrim(p_data->>'item'); new_amount integer:=(p_data->>'amount_yen')::integer;
 reason text:=btrim(p_data->>'reason');
begin
 -- Match the billing RPC lock order: serialize invoice generation/publication/cancellation and corrections.
 perform pg_advisory_xact_lock(783101822);
 perform 1 from public.profiles where id=auth.uid() for share;
 if auth.uid() is null or public.current_role() is distinct from 'admin' then
  raise exception '管理者権限がありません' using errcode='42501';
 end if;
 if reason is null or length(reason) not between 1 and 2000 then raise exception '訂正理由を1〜2000文字で入力してください'; end if;
 if new_item is null or length(new_item) not between 1 and 200 or new_amount is null or new_amount not between 1 and 999999999 then
  raise exception '項目と金額を確認してください';
 end if;
 select * into old_expense from public.report_expenses where id=(p_data->>'id')::uuid for update;
 if not found then raise exception '実費が見つかりません'; end if;
 if old_expense.item is distinct from p_data->>'original_item' or
    old_expense.amount_yen is distinct from (p_data->>'original_amount_yen')::integer then
  raise exception '実費は他の操作で更新されています。一覧を更新してから訂正してください' using errcode='40001';
 end if;
 if old_expense.item=new_item and old_expense.amount_yen=new_amount then raise exception '変更する項目または金額を入力してください'; end if;
 select property_id into strict property from public.reports where id=old_expense.report_id;
 corrected_at:=clock_timestamp();
 insert into public.expense_corrections(expense_id,report_id,property_id,actor_id,created_at,reason,old_item,new_item,old_amount_yen,new_amount_yen)
 values(old_expense.id,old_expense.report_id,property,auth.uid(),corrected_at,reason,old_expense.item,new_item,old_expense.amount_yen,new_amount)
 returning id into correction_id;
 perform 1 from public.billing_invoices i where i.status in ('draft','published') and exists(
  select 1 from public.billing_lines l where l.invoice_id=i.id and l.expense_id=old_expense.id and l.released_at is null
 ) order by i.id for update;
 insert into public.invoice_line_corrections(invoice_id,line_id,expense_correction_id,created_at,reason,old_item,new_item,old_amount_yen,new_amount_yen)
 select l.invoice_id,l.id,correction_id,corrected_at,reason,l.item,new_item,l.amount_yen,new_amount
 from public.billing_lines l join public.billing_invoices i on i.id=l.invoice_id
 where l.expense_id=old_expense.id and l.released_at is null and i.status in ('draft','published');
 update public.billing_lines l set item=new_item,amount_yen=new_amount
 from public.billing_invoices i where i.id=l.invoice_id and l.expense_id=old_expense.id
 and l.released_at is null and i.status in ('draft','published');
 update public.report_expenses set item=new_item,amount_yen=new_amount where id=old_expense.id;
 return correction_id;
end; $$;
revoke all on function palette_private.correct_report_expense(jsonb) from public,anon;
grant execute on function palette_private.correct_report_expense(jsonb) to authenticated;
create function public.correct_report_expense(p_data jsonb) returns uuid
 language sql security invoker set search_path='' as $$select palette_private.correct_report_expense(p_data);$$;
revoke all on function public.correct_report_expense(jsonb) from public,anon;
grant execute on function public.correct_report_expense(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
