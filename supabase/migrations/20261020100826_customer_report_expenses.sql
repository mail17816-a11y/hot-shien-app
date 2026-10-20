begin;
-- Keep staff access and write policies unchanged; customers only read their own reports' expenses.
create policy expenses_customer_read on public.report_expenses for select to authenticated
 using (public.current_role()='customer' and exists (
   select 1 from public.reports r
   join public.properties p on p.id=r.property_id
   where r.id=report_expenses.report_id and p.customer_id=(select auth.uid())
 ));
notify pgrst,'reload schema';
commit;
