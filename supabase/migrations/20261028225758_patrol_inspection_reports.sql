begin;
create table public.inspection_subjects (
 id text primary key, template_version integer not null, label text not null, category text not null,
 configurable boolean not null, sort_order integer not null
);
create table public.inspection_items (
 id text primary key, subject_id text not null references public.inspection_subjects(id),
 label text not null, result_kind text not null check(result_kind in ('yesno','severity','mail')), sort_order integer not null
);
create index inspection_items_subject_idx on public.inspection_items(subject_id);
insert into public.inspection_subjects values
 ('v1_roof',1,'屋根','建物',true,0),
 ('v1_wall',1,'壁','建物',true,1),
 ('v1_pillar',1,'柱','建物',true,2),
 ('v1_window',1,'窓','建物',true,3),
 ('v1_balcony',1,'ベランダ','建物',true,4),
 ('v1_fence',1,'フェンス・塀','建物',true,5),
 ('v1_drainage',1,'排水路・浄化槽','建物',true,6),
 ('v1_trees',1,'庭木','庭木',true,7),
 ('v1_weeds',1,'雑草','外構',false,8),
 ('v1_garbage',1,'ゴミ','外構',false,9),
 ('v1_pests',1,'害虫','外構',false,10),
 ('v1_animals',1,'動物','外構',false,11),
 ('v1_intrusion',1,'侵入の形跡','危険事項',false,12),
 ('v1_burn',1,'焼け跡','危険事項',false,13),
 ('v1_mailbox',1,'郵便物','郵便物',false,14);
insert into public.inspection_items values
 ('v1_roof_deformation','v1_roof','変形・傾き','yesno',0),
 ('v1_roof_peeling','v1_roof','剝がれ・脱落','yesno',1),
 ('v1_roof_crack','v1_roof','割れ・欠け','yesno',2),
 ('v1_roof_water','v1_roof','浸水・腐り','yesno',3),
 ('v1_wall_deformation','v1_wall','変形・傾き','yesno',4),
 ('v1_wall_peeling','v1_wall','剝がれ・脱落','yesno',5),
 ('v1_wall_crack','v1_wall','割れ・欠け','yesno',6),
 ('v1_wall_water','v1_wall','浸水・腐り','yesno',7),
 ('v1_pillar_deformation','v1_pillar','変形・傾き','yesno',8),
 ('v1_pillar_peeling','v1_pillar','剝がれ・脱落','yesno',9),
 ('v1_pillar_crack','v1_pillar','割れ・欠け','yesno',10),
 ('v1_pillar_water','v1_pillar','浸水・腐り','yesno',11),
 ('v1_window_deformation','v1_window','変形・傾き','yesno',12),
 ('v1_window_peeling','v1_window','剝がれ・脱落','yesno',13),
 ('v1_window_crack','v1_window','割れ・欠け','yesno',14),
 ('v1_window_water','v1_window','浸水・腐り','yesno',15),
 ('v1_balcony_deformation','v1_balcony','変形・傾き','yesno',16),
 ('v1_balcony_peeling','v1_balcony','剝がれ・脱落','yesno',17),
 ('v1_balcony_crack','v1_balcony','割れ・欠け','yesno',18),
 ('v1_balcony_water','v1_balcony','浸水・腐り','yesno',19),
 ('v1_fence_deformation','v1_fence','変形・傾き','yesno',20),
 ('v1_fence_peeling','v1_fence','剝がれ・脱落','yesno',21),
 ('v1_fence_crack','v1_fence','割れ・欠け','yesno',22),
 ('v1_fence_water','v1_fence','浸水・腐り','yesno',23),
 ('v1_drainage_deformation','v1_drainage','変形・傾き','yesno',24),
 ('v1_drainage_peeling','v1_drainage','剝がれ・脱落','yesno',25),
 ('v1_drainage_crack','v1_drainage','割れ・欠け','yesno',26),
 ('v1_drainage_water','v1_drainage','浸水・腐り','yesno',27),
 ('v1_trees_protrusion','v1_trees','刺さり・突き出し','yesno',28),
 ('v1_trees_broken','v1_trees','折れ・落下','yesno',29),
 ('v1_trees_decay','v1_trees','枯れ・腐り','yesno',30),
 ('v1_trees_roots','v1_trees','根上がり','yesno',31),
 ('v1_trees_mushroom','v1_trees','キノコ','yesno',32),
 ('v1_weeds_state','v1_weeds','雑草','severity',33),
 ('v1_garbage_state','v1_garbage','ゴミ','severity',34),
 ('v1_pests_state','v1_pests','害虫','severity',35),
 ('v1_animals_state','v1_animals','動物','severity',36),
 ('v1_intrusion_state','v1_intrusion','侵入の形跡','yesno',37),
 ('v1_burn_state','v1_burn','焼け跡','yesno',38),
 ('v1_mailbox_state','v1_mailbox','郵便物','mail',39);
create table public.property_inspection_profiles (
 property_id uuid primary key references public.properties(id), template_version integer not null default 1,
 updated_at timestamptz not null default clock_timestamp(), updated_by uuid not null references public.profiles(id)
);
create index property_inspection_profiles_actor_idx on public.property_inspection_profiles(updated_by);
create table public.property_inspection_targets (
 property_id uuid not null references public.property_inspection_profiles(property_id),
 subject_id text not null references public.inspection_subjects(id),
 availability text not null check(availability in ('present','absent','unknown')),
 inspect boolean not null, reason text not null default '' check(length(reason)<=2000),
 primary key(property_id,subject_id), check(not inspect or availability='present'),
 check(availability<>'present' or inspect or length(btrim(reason))>0)
);
create index property_inspection_targets_subject_idx on public.property_inspection_targets(subject_id);
alter table public.reports add column publication_status text not null default 'published' check(publication_status in ('draft','published'));
alter table public.reports add column published_at timestamptz;
update public.reports set published_at=created_at;
alter table public.reports add column revision integer not null default 1;
alter table public.reports add column inspection_version integer;
alter table public.reports add column work_status text not null default 'completed' check(work_status in ('completed','not_performed'));
alter table public.reports add column not_performed_reason text not null default '';
alter table public.reports add column started_at timestamptz;
alter table public.reports add column finished_at timestamptz;
create table public.report_inspection_results (
 report_id uuid not null references public.reports(id) on delete cascade,
 item_id text not null references public.inspection_items(id),
 status text not null check(status in ('unconfirmed','checked','not_performed')),
 result text, reason text not null default '' check(length(reason)<=2000), memo text not null default '' check(length(memo)<=2000),
 primary key(report_id,item_id)
);
create index report_inspection_results_item_idx on public.report_inspection_results(item_id);
create table public.report_revisions (
 id uuid primary key default gen_random_uuid(), report_id uuid not null references public.reports(id),
 revision integer not null, actor_id uuid not null references public.profiles(id), actor_role text not null,
 created_at timestamptz not null default clock_timestamp(), reason text not null check(length(btrim(reason)) between 1 and 2000),
 before_values jsonb not null, after_values jsonb not null, customer_visible boolean not null,
 unique(report_id,revision)
);
create index report_revisions_actor_idx on public.report_revisions(actor_id);
alter table public.inspection_subjects enable row level security;
revoke all on public.inspection_subjects from public,anon,authenticated;
grant select on public.inspection_subjects to authenticated,service_role;
alter table public.inspection_items enable row level security;
revoke all on public.inspection_items from public,anon,authenticated;
grant select on public.inspection_items to authenticated,service_role;
alter table public.property_inspection_profiles enable row level security;
revoke all on public.property_inspection_profiles from public,anon,authenticated;
grant select on public.property_inspection_profiles to authenticated,service_role;
alter table public.property_inspection_targets enable row level security;
revoke all on public.property_inspection_targets from public,anon,authenticated;
grant select on public.property_inspection_targets to authenticated,service_role;
alter table public.report_inspection_results enable row level security;
revoke all on public.report_inspection_results from public,anon,authenticated;
grant select on public.report_inspection_results to authenticated,service_role;
alter table public.report_revisions enable row level security;
revoke all on public.report_revisions from public,anon,authenticated;
grant select on public.report_revisions to authenticated,service_role;
create policy subjects_read on public.inspection_subjects for select to authenticated using(public.current_role() is not null);
create policy items_read on public.inspection_items for select to authenticated using(public.current_role() is not null);
create policy inspection_profiles_read on public.property_inspection_profiles for select to authenticated using(exists(select 1 from public.properties p where p.id=property_id));
create policy inspection_targets_read on public.property_inspection_targets for select to authenticated using(exists(select 1 from public.properties p where p.id=property_id));
drop policy reports_read on public.reports;
create policy reports_read on public.reports for select to authenticated using(
 public.current_role() is not null and exists(select 1 from public.properties p where p.id=property_id) and
 (publication_status='published' or public.current_role()='admin' or (public.current_role()='worker' and author_id=(select auth.uid())))
);
create policy inspection_results_read on public.report_inspection_results for select to authenticated using(exists(select 1 from public.reports r where r.id=report_id));
create policy report_revisions_read on public.report_revisions for select to authenticated using(
 exists(select 1 from public.reports r where r.id=report_id) and
 (public.current_role() in ('admin','worker') or (public.current_role()='customer' and customer_visible))
);
alter table public.expense_corrections add column customer_visible boolean not null default true;
drop policy expense_corrections_read on public.expense_corrections;
create policy expense_corrections_read on public.expense_corrections for select to authenticated using(exists(select 1 from public.reports r where r.id=report_id) and (public.current_role() in ('admin','worker') or customer_visible));
revoke insert,delete on public.reports from authenticated;
revoke update(photo_paths) on public.reports from authenticated;
revoke insert(report_id,item,amount_yen) on public.report_expenses from authenticated;
-- Draft reports and unreviewed photos cannot be exposed via the old write path.
revoke execute on function public.create_report_with_expenses(uuid,uuid,text,text,date,jsonb) from authenticated;
create function palette_private.save_inspection_targets(p_property_id uuid,p_targets jsonb) returns void
 language plpgsql security definer set search_path='' as $$
declare row jsonb;
begin
 perform pg_advisory_xact_lock(783101829);
 perform 1 from public.profiles where id=auth.uid() for share;
 if public.current_role() is distinct from 'admin' then raise exception '管理者権限がありません' using errcode='42501'; end if;
 perform 1 from public.properties where id=p_property_id for update;
 if not found then raise exception '物件が見つかりません'; end if;
 if jsonb_typeof(p_targets) is distinct from 'array' then raise exception '点検対象の形式が不正です'; end if;
 if jsonb_array_length(p_targets)<>8 or
 (select count(distinct x->>'subject_id') from jsonb_array_elements(p_targets) x)<>8 or exists(
 select 1 from jsonb_array_elements(p_targets) x where not exists(select 1 from public.inspection_subjects s where s.id=x->>'subject_id' and s.template_version=1 and s.configurable)
 ) then raise exception '設備8項目の設定を指定してください'; end if;
 insert into public.property_inspection_profiles(property_id,updated_by) values(p_property_id,auth.uid())
 on conflict(property_id) do update set updated_at=clock_timestamp(),updated_by=auth.uid();
 delete from public.property_inspection_targets where property_id=p_property_id;
 for row in select value from jsonb_array_elements(p_targets) loop
  insert into public.property_inspection_targets(property_id,subject_id,availability,inspect,reason)
  values(p_property_id,row->>'subject_id',row->>'availability',(row->>'inspect')::boolean,coalesce(row->>'reason',''));
 end loop;
end; $$;
revoke all on function palette_private.save_inspection_targets(uuid,jsonb) from public,anon;
grant execute on function palette_private.save_inspection_targets(uuid,jsonb) to authenticated;
create function public.save_inspection_targets(p_property_id uuid,p_targets jsonb) returns void
 language sql security invoker set search_path='' as $$select palette_private.save_inspection_targets(p_property_id,p_targets);$$;
revoke all on function public.save_inspection_targets(uuid,jsonb) from public,anon;
grant execute on function public.save_inspection_targets(uuid,jsonb) to authenticated;

-- Snapshot keys reference immutable versioned master IDs. History stores only changed keys.
create function palette_private.report_state(p_id uuid) returns jsonb
 language sql stable security invoker set search_path='' as $$
 select (to_jsonb(r)-array['id','property_id','author_id','created_at','revision','published_at']) ||
 coalesce((select jsonb_object_agg('check:'||item_id,to_jsonb(x)-array['report_id','item_id']) from public.report_inspection_results x where x.report_id=r.id),'{}'::jsonb)
 from public.reports r where r.id=p_id;
$$;
revoke all on function palette_private.report_state(uuid) from public,anon,authenticated;
create function palette_private.save_patrol_report(p_data jsonb,p_expenses jsonb) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare
 old_report public.reports; rid uuid:=(p_data->>'id')::uuid; prop uuid:=(p_data->>'property_id')::uuid;
 creating boolean; old_state jsonb; new_state jsonb; before_diff jsonb; after_diff jsonb;
 targets text[]; supplied text[]; paths text[]; entry jsonb; result_kind text;
 new_status text:=p_data->>'publication_status'; new_work text:=p_data->>'work_status'; reason text:=btrim(p_data->>'reason');
 started timestamptz:=nullif(p_data->>'started_at','')::timestamptz;
 finished timestamptz:=nullif(p_data->>'finished_at','')::timestamptz;
 inspection integer;
begin
 -- Serialize with billing/expense corrections first, then property configuration and report edits.
 perform pg_advisory_xact_lock(783101822);
 perform pg_advisory_xact_lock(783101829);
 perform 1 from public.profiles where id=auth.uid() for share;
 if public.current_role() is null or public.current_role() not in ('admin','worker') then raise exception '報告の編集権限がありません' using errcode='42501'; end if;
 select * into old_report from public.reports where id=rid for update;
 creating:=not found;
 if creating then
  if not exists(select 1 from public.properties where id=prop) then raise exception '物件を指定してください'; end if;
  if p_data->>'kind'='定期巡回' then
   select template_version into inspection from public.property_inspection_profiles where property_id=prop;
   if inspection is null or exists(select 1 from public.property_inspection_targets where property_id=prop and availability='unknown') then raise exception '物件の設備・点検対象を先に設定してください'; end if;
   select array_agg(i.id order by i.id) into targets from public.inspection_items i join public.inspection_subjects s on s.id=i.subject_id
   where s.template_version=inspection and (not s.configurable or exists(select 1 from public.property_inspection_targets t where t.property_id=prop and t.subject_id=s.id and t.inspect));
  else targets:='{}'; end if;
 else
  if old_report.property_id is distinct from prop or (public.current_role()<>'admin' and old_report.author_id<>auth.uid()) then raise exception 'この報告は編集できません' using errcode='42501'; end if;
  if old_report.revision is distinct from (p_data->>'revision')::integer then raise exception '報告は更新されています。開き直して訂正してください' using errcode='40001'; end if;
  inspection:=old_report.inspection_version;
  select coalesce(array_agg(item_id order by item_id),'{}') into targets from public.report_inspection_results where report_id=rid;
  if reason is null or length(reason) not between 1 and 2000 then raise exception '編集理由を入力してください'; end if;
  if old_report.publication_status='published' and new_status is distinct from 'published' then raise exception '公開済み報告を下書きには戻せません'; end if;
  old_state:=palette_private.report_state(rid);
 end if;
 if new_status is null or new_status not in ('draft','published') or new_work is null or new_work not in ('completed','not_performed') then raise exception '報告の状態が不正です'; end if;
 if p_data->>'kind' is null or p_data->>'kind' not in ('定期巡回','除草・清掃','郵便物対応') then raise exception '作業種別が不正です'; end if;
 if inspection is not null and p_data->>'kind'<>'定期巡回' then raise exception '点検報告の種別は変更できません'; end if;
 if nullif(btrim(p_data->>'body'),'') is null or length(p_data->>'body')>5000 then raise exception '報告内容を1〜5000文字で入力してください'; end if;
 if (started is null)<>(finished is null) or (started is not null and (finished<started or (started at time zone 'Asia/Tokyo')::date is distinct from (p_data->>'performed_on')::date)) then raise exception '点検開始・終了日時を確認してください'; end if;
 if inspection is not null and new_status='published' and new_work<>'not_performed' and (started is null or finished is null) then raise exception '点検開始・終了日時を入力してください'; end if;
 if new_work='not_performed' and nullif(btrim(p_data->>'not_performed_reason'),'') is null then raise exception '作業未実施の理由を入力してください'; end if;
 if length(coalesce(p_data->>'not_performed_reason',''))>2000 then raise exception '作業未実施の理由は2000文字までです'; end if;
 if jsonb_typeof(p_data->'results') is distinct from 'array' then raise exception '点検結果の形式が不正です'; end if;
 select coalesce(array_agg(x->>'item_id' order by x->>'item_id'),'{}') into supplied from jsonb_array_elements(p_data->'results') x;
 targets:=coalesce(targets,'{}');
 if supplied is distinct from targets then raise exception '点検対象が物件設定または報告作成時の対象と一致しません'; end if;
 for entry in select value from jsonb_array_elements(p_data->'results') loop
  select i.result_kind into result_kind from public.inspection_items i where i.id=entry->>'item_id';
  if entry->>'status' is null or entry->>'status' not in ('unconfirmed','checked','not_performed') then raise exception '点検の実施状態が不正です'; end if;
  if entry->>'status'='checked' then
   if entry->>'result' is null or not ((result_kind='yesno' and entry->>'result' in ('absent','present')) or
    (result_kind='severity' and entry->>'result' in ('none','little','many','very_many')) or
    (result_kind='mail' and entry->>'result' in ('none','report','collected'))) then raise exception '点検結果を選択してください'; end if;
  elsif nullif(entry->>'result','') is not null then raise exception '未確認・未実施の項目に点検結果は指定できません'; end if;
  if entry->>'status'='not_performed' and new_work<>'not_performed' and nullif(btrim(entry->>'reason'),'') is null then raise exception '項目の未実施理由を入力してください'; end if;
  if new_work='not_performed' and entry->>'status'<>'not_performed' then raise exception '作業全体が未実施の場合は各項目も未実施にしてください'; end if;
  if new_status='published' and entry->>'status'='unconfirmed' then raise exception '未確認の項目が残っています'; end if;
 end loop;
 if jsonb_typeof(p_data->'photo_paths') is distinct from 'array' then raise exception '写真の形式が不正です'; end if;
 select coalesce(array_agg(value),'{}') into paths from jsonb_array_elements_text(p_data->'photo_paths');
 if cardinality(paths)>10 or (select count(distinct x) from unnest(paths) x)<>cardinality(paths) or exists(
  select 1 from unnest(paths) x where x is null or x !~ ('^'||rid::text||'/[A-Za-z0-9_-]+$') or not exists(select 1 from storage.objects o where o.bucket_id='report-photos' and o.name=x)
 ) then raise exception '写真はこの報告へアップロード済みの10枚までを指定してください'; end if;
 if creating then
  insert into public.reports(id,property_id,author_id,kind,body,performed_on,photo_paths,publication_status,published_at,inspection_version,work_status,not_performed_reason,started_at,finished_at)
  values(rid,prop,auth.uid(),p_data->>'kind',p_data->>'body',(p_data->>'performed_on')::date,paths,new_status,case when new_status='published' then clock_timestamp() end,inspection,new_work,coalesce(p_data->>'not_performed_reason',''),started,finished);
  if jsonb_typeof(p_expenses) is distinct from 'array' or jsonb_array_length(p_expenses)>50 then raise exception '実費は50件までです'; end if;
  insert into public.report_expenses(report_id,item,amount_yen) select rid,btrim(x->>'item'),(x->>'amount_yen')::integer from jsonb_array_elements(p_expenses) x;
 else
  if p_expenses is distinct from '[]'::jsonb then raise exception '実費の訂正は実費管理から行ってください'; end if;
  update public.reports set kind=p_data->>'kind',body=p_data->>'body',performed_on=(p_data->>'performed_on')::date,
   photo_paths=paths,publication_status=new_status,published_at=coalesce(published_at,case when new_status='published' then clock_timestamp() end),
   work_status=new_work,not_performed_reason=coalesce(p_data->>'not_performed_reason',''),started_at=started,finished_at=finished
   where id=rid;
 end if;
 delete from public.report_inspection_results where report_id=rid;
 insert into public.report_inspection_results(report_id,item_id,status,result,reason,memo)
 select rid,x->>'item_id',x->>'status',nullif(x->>'result',''),coalesce(x->>'reason',''),coalesce(x->>'memo','') from jsonb_array_elements(p_data->'results') x;
 if not creating then
  new_state:=palette_private.report_state(rid);
  select coalesce(jsonb_object_agg(k,old_state->k),'{}'),coalesce(jsonb_object_agg(k,new_state->k),'{}') into before_diff,after_diff
  from jsonb_object_keys(old_state||new_state) k where old_state->k is distinct from new_state->k;
  if before_diff<>'{}'::jsonb then
   update public.reports set revision=revision+1 where id=rid;
   insert into public.report_revisions(report_id,revision,actor_id,actor_role,reason,before_values,after_values,customer_visible)
   select rid,revision,auth.uid(),public.current_role(),reason,before_diff,after_diff,old_report.publication_status='published' from public.reports where id=rid;
  end if;
 end if;
 return (select to_jsonb(r) from public.reports r where r.id=rid);
end; $$;
revoke all on function palette_private.save_patrol_report(jsonb,jsonb) from public,anon;
grant execute on function palette_private.save_patrol_report(jsonb,jsonb) to authenticated;
create function public.save_patrol_report(p_data jsonb,p_expenses jsonb default '[]') returns jsonb
 language sql security invoker set search_path='' as $$select palette_private.save_patrol_report(p_data,p_expenses);$$;
revoke all on function public.save_patrol_report(jsonb,jsonb) from public,anon;
grant execute on function public.save_patrol_report(jsonb,jsonb) to authenticated;

-- Photos are retained while referenced by current content or revision history.
drop policy photos_upload on storage.objects;
create policy photos_upload on storage.objects for insert to authenticated with check(bucket_id='report-photos' and exists(
 select 1 from public.reports r where r.id::text=(storage.foldername(name))[1] and
 (public.current_role()='admin' or (public.current_role()='worker' and r.author_id=(select auth.uid())))
));
drop policy photos_read on storage.objects;
create policy photos_read on storage.objects for select to authenticated using(bucket_id='report-photos' and exists(
 select 1 from public.reports r where r.id::text=(storage.foldername(name))[1] and
 (public.current_role()='admin' or (public.current_role()='worker' and r.author_id=(select auth.uid())) or
 name=any(r.photo_paths) or exists(select 1 from public.report_revisions h where h.report_id=r.id and
 (coalesce(h.before_values->'photo_paths','[]') ? name or coalesce(h.after_values->'photo_paths','[]') ? name)))
));
drop policy photos_cleanup on storage.objects;
create policy photos_cleanup on storage.objects for delete to authenticated using(bucket_id='report-photos' and exists(
 select 1 from public.reports r where r.id::text=(storage.foldername(name))[1] and
 (public.current_role()='admin' or (public.current_role()='worker' and r.author_id=(select auth.uid()))) and
 not name=any(r.photo_paths) and not exists(select 1 from public.report_revisions h where h.report_id=r.id and
 (coalesce(h.before_values->'photo_paths','[]') ? name or coalesce(h.after_values->'photo_paths','[]') ? name))
));
create or replace function palette_private.billing_action(p_action text,p_data jsonb) returns uuid
 language plpgsql security definer set search_path='' as $$
declare
 result_id uuid; customer uuid; prop uuid; month date; month_end date;
 old_invoice public.billing_invoices; selected_expenses uuid[]; old_expenses uuid[];
 expense_count integer; selected_months date[];
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
  if p_data->>'billing_cycle'='custom' then
   if jsonb_typeof(p_data->'payment_months') is distinct from 'array' then
    raise exception '支払い月を1か月以上選択してください';
   end if;
   select coalesce(array_agg(distinct value::date order by value::date),'{}'::date[])
    into selected_months from jsonb_array_elements_text(p_data->'payment_months');
   if cardinality(selected_months)=0 or exists(
    select 1 from unnest(selected_months) m where m is null or extract(day from m)<>1
     or m<(p_data->>'effective_from')::date
     or m<date_trunc('month',(p_data->>'starts_on')::date)::date
     or (nullif(p_data->>'ends_on','') is not null and m>date_trunc('month',(p_data->>'ends_on')::date)::date)
   ) then raise exception '支払い月は適用開始月以降かつ契約期間内の月初日を指定してください'; end if;
  else selected_months:='{}'::date[];
  end if;
  result_id:=nullif(p_data->>'id','')::uuid;
  if result_id is null then
   insert into public.customer_contracts(customer_id,property_id,item,amount_yen,billing_cycle,starts_on,ends_on,effective_from,status,payment_months)
   values(customer,prop,btrim(p_data->>'item'),(p_data->>'amount_yen')::integer,p_data->>'billing_cycle',
    (p_data->>'starts_on')::date,nullif(p_data->>'ends_on','')::date,(p_data->>'effective_from')::date,p_data->>'status',selected_months) returning id into result_id;
  else
   update public.customer_contracts set item=btrim(p_data->>'item'),amount_yen=(p_data->>'amount_yen')::integer,
    billing_cycle=p_data->>'billing_cycle',starts_on=(p_data->>'starts_on')::date,ends_on=nullif(p_data->>'ends_on','')::date,
    effective_from=(p_data->>'effective_from')::date,status=p_data->>'status',payment_months=selected_months
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
    and (c.billing_cycle='monthly'
     or (c.billing_cycle='annual' and extract(month from c.effective_from)=extract(month from month))
     or (c.billing_cycle='once' and c.effective_from=month)
     or (c.billing_cycle='custom' and month=any(c.payment_months)));
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

create or replace function palette_private.correct_report_expense(p_data jsonb) returns uuid
 language plpgsql security definer set search_path='' as $$
declare
 old_expense public.report_expenses;
 property uuid; visible boolean; correction_id uuid; corrected_at timestamptz;
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
 select property_id,publication_status='published' into strict property,visible from public.reports where id=old_expense.report_id;
 corrected_at:=clock_timestamp();
 insert into public.expense_corrections(expense_id,report_id,property_id,actor_id,created_at,reason,old_item,new_item,old_amount_yen,new_amount_yen,customer_visible)
 values(old_expense.id,old_expense.report_id,property,auth.uid(),corrected_at,reason,old_expense.item,new_item,old_expense.amount_yen,new_amount,visible)
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

notify pgrst,'reload schema';
commit;
