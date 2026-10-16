-- Record a manual receipt atomically. Retrying cannot create a second payment.
create function app_private.settle_receivable(p_barbershop_id uuid,p_receivable_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare r public.receivables; v_payment uuid;
begin
  if (select auth.uid()) is null or not app_private.has_shop_role(p_barbershop_id,array['admin']::public.shop_role[]) then raise exception 'Receipt access denied' using errcode='42501'; end if;
  select * into r from public.receivables where barbershop_id=p_barbershop_id and id=p_receivable_id for update;
  if r.id is null then raise exception 'Receivable not found' using errcode='22023'; end if;
  select id into v_payment from public.payments where barbershop_id=p_barbershop_id and provider='manual' and provider_payment_id='receivable:'||r.id;
  if r.status='paid' and v_payment is not null then return v_payment; end if;
  if r.status<>'open' then raise exception 'Receivable is not open' using errcode='22023'; end if;
  insert into public.payments(barbershop_id,client_id,amount_cents,status,method,provider,provider_payment_id,paid_at)
    values(p_barbershop_id,r.client_id,r.amount_cents,'paid','other','manual','receivable:'||r.id,now()) returning id into v_payment;
  update public.receivables set status='paid',settled_at=now() where id=r.id;
  return v_payment;
end $$;
revoke all on function app_private.settle_receivable(uuid,uuid) from public,anon,authenticated;
grant execute on function app_private.settle_receivable(uuid,uuid) to authenticated;
create function public.settle_receivable(p_barbershop_id uuid,p_receivable_id uuid) returns uuid
language sql security invoker set search_path='' as $$ select app_private.settle_receivable(p_barbershop_id,p_receivable_id) $$;
revoke all on function public.settle_receivable(uuid,uuid) from public,anon,authenticated;
grant execute on function public.settle_receivable(uuid,uuid) to authenticated;

-- Imported professionals keep their historical IDs without creating an Auth account.
alter table public.memberships alter column user_id drop not null;
do $$ declare t text; begin
  foreach t in array array['memberships','clients','services','products','appointments'] loop
    execute format('alter table public.%I add column import_source text, add column source_id text',t);
    execute format('create unique index %I on public.%I(barbershop_id,import_source,source_id) where import_source is not null',t||'_import_identity_uq',t);
  end loop;
end $$;
alter table public.memberships add constraint archived_staff_has_no_access check(user_id is not null or (import_source='cashbarber' and source_id is not null and not active));
alter table public.appointments add column import_price_known boolean not null default true;

create table app_private.cashbarber_import_records (
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  dataset text not null,source_id text not null,payload jsonb not null,
  projected_id uuid,issue text,imported_at timestamptz not null default now(),
  primary key(barbershop_id,dataset,source_id)
);
alter table app_private.cashbarber_import_records enable row level security;
revoke all on app_private.cashbarber_import_records from public,anon,authenticated;
grant all on app_private.cashbarber_import_records to service_role;
grant usage on schema app_private to service_role;

-- Ordinary app writes can edit the record but cannot forge import provenance.
create function app_private.protect_import_identity() returns trigger language plpgsql set search_path='' as $$
begin
  if current_user not in ('postgres','supabase_admin','service_role') then
    if tg_op='INSERT' and (new.import_source is not null or new.source_id is not null) then raise exception 'Import identity is reserved for migration' using errcode='42501'; end if;
    if tg_op='UPDATE' and (new.import_source is distinct from old.import_source or new.source_id is distinct from old.source_id) then raise exception 'Import identity cannot be changed' using errcode='42501'; end if;
    if tg_table_name='appointments' then
      if tg_op='INSERT' and not new.import_price_known then raise exception 'Import price flag is reserved for migration' using errcode='42501'; end if;
      if tg_op='UPDATE' and new.import_price_known is distinct from old.import_price_known then raise exception 'Import price flag cannot be changed' using errcode='42501'; end if;
    end if;
  end if;
  return new;
end $$;
revoke all on function app_private.protect_import_identity() from public,anon,authenticated;
do $$ declare t text; begin
  foreach t in array array['memberships','clients','services','products','appointments'] loop
    execute format('create trigger protect_import_identity before insert or update on public.%I for each row execute function app_private.protect_import_identity()',t);
  end loop;
end $$;

create or replace function app_private.require_barber_membership() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_import boolean:=false;
begin
  if tg_table_name='appointments' then v_import:=new.import_source='cashbarber' and new.source_id is not null; end if;
  if not exists(select 1 from public.memberships m where m.id=new.barber_membership_id and m.barbershop_id=new.barbershop_id and m.role='barber'
    and (m.active or (v_import and m.import_source='cashbarber'))) then
    raise exception 'Barber membership is not active in this barbershop' using errcode='23514';
  end if;
  return new;
end $$;

-- Server-only import entry point. Source IDs, not names, make every batch idempotent.
create function app_private.import_cashbarber_batch(p_shop uuid,p_dataset text,p_rows jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r jsonb; v_id uuid; v_client uuid; v_staff uuid; v_issue text; v_ok integer:=0; v_skip integer:=0; v_bad integer:=0;
begin
  if p_dataset not in ('clients','memberships','services','products','appointments') or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>1000 then raise exception 'Invalid import batch' using errcode='22023'; end if;
  if not exists(select 1 from public.barbershops where id=p_shop) then raise exception 'Shop not found' using errcode='22023'; end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    if nullif(r->>'id','') is null then raise exception 'Missing source ID' using errcode='22023'; end if;
    v_id:=null; v_issue:=null;
    select projected_id into v_id from app_private.cashbarber_import_records where barbershop_id=p_shop and dataset=p_dataset and source_id=r->>'id';
    if v_id is not null then v_skip:=v_skip+1; continue; end if;
    insert into app_private.cashbarber_import_records(barbershop_id,dataset,source_id,payload) values(p_shop,p_dataset,r->>'id',r)
      on conflict(barbershop_id,dataset,source_id) do update set payload=excluded.payload,issue=null;
    begin
      if p_dataset='clients' then
        insert into public.clients(barbershop_id,full_name,email,phone,notes,created_at,import_source,source_id)
          values(p_shop,r->>'name',nullif(r->>'email',''),nullif(r->>'phone',''),nullif(r->>'notes',''),coalesce(nullif(r->>'created','')::timestamptz,now()),'cashbarber',r->>'id') returning id into v_id;
      elsif p_dataset='memberships' then
        insert into public.memberships(barbershop_id,user_id,role,display_name,active,created_at,import_source,source_id)
          values(p_shop,null,(r->>'role')::public.shop_role,r->>'name',false,coalesce(nullif(r->>'created','')::timestamptz,now()),'cashbarber',r->>'id') returning id into v_id;
      elsif p_dataset='services' then
        insert into public.services(barbershop_id,name,description,duration_minutes,price_cents,active,created_at,import_source,source_id)
          values(p_shop,r->>'name',r->>'description',greatest(5,(r->>'duration')::integer),(r->>'price')::integer,(r->>'active')::boolean and (r->>'duration')::integer>=5,coalesce(nullif(r->>'created','')::timestamptz,now()),'cashbarber',r->>'id') returning id into v_id;
        if (r->>'duration')::integer<5 then v_issue:='Duração original inferior a 5 minutos. Serviço mantido inativo para revisão.'; end if;
      elsif p_dataset='products' then
        insert into public.products(barbershop_id,name,sku,description,category,price_cents,stock_quantity,active,created_at,import_source,source_id)
          values(p_shop,r->>'name',nullif(r->>'sku',''),r->>'description',r->>'category',(r->>'price')::integer,(r->>'stock')::integer,(r->>'active')::boolean,coalesce(nullif(r->>'created','')::timestamptz,now()),'cashbarber',r->>'id') returning id into v_id;
      else
        select id into v_client from public.clients where barbershop_id=p_shop and import_source='cashbarber' and source_id=r->>'client';
        select id into v_staff from public.memberships where barbershop_id=p_shop and import_source='cashbarber' and source_id=r->>'barber' and role='barber';
        if v_client is null or v_staff is null then raise exception 'Cliente ou profissional de origem não encontrado' using errcode='23503'; end if;
        insert into public.appointments(barbershop_id,client_id,barber_membership_id,starts_at,ends_at,status,source,total_price_cents,notes,created_at,import_source,source_id,import_price_known)
          values(p_shop,v_client,v_staff,(r->>'start')::timestamp at time zone 'America/Sao_Paulo',(r->>'end')::timestamp at time zone 'America/Sao_Paulo',(r->>'status')::public.appointment_status,'admin',0,nullif(r->>'notes',''),coalesce(nullif(r->>'created','')::timestamptz,now()),'cashbarber',r->>'id',false) returning id into v_id;
        insert into public.client_barbers(barbershop_id,client_id,barber_membership_id) values(p_shop,v_client,v_staff) on conflict do nothing;
      end if;
      update app_private.cashbarber_import_records set projected_id=v_id,issue=v_issue where barbershop_id=p_shop and dataset=p_dataset and source_id=r->>'id';
      v_ok:=v_ok+1;
    exception when check_violation or foreign_key_violation or unique_violation or exclusion_violation or invalid_text_representation then
      update app_private.cashbarber_import_records set issue=sqlerrm where barbershop_id=p_shop and dataset=p_dataset and source_id=r->>'id';
      v_bad:=v_bad+1;
    end;
  end loop;
  return jsonb_build_object('imported',v_ok,'skipped',v_skip,'review',v_bad);
end $$;
revoke all on function app_private.import_cashbarber_batch(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function app_private.import_cashbarber_batch(uuid,text,jsonb) to service_role;

create function app_private.cashbarber_import_summary(p_barbershop_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if (select auth.uid()) is null or not app_private.has_shop_role(p_barbershop_id,array['admin']::public.shop_role[]) then raise exception 'Import report access denied' using errcode='42501'; end if;
  return jsonb_build_object('datasets',(select coalesce(jsonb_agg(d),'[]') from (select dataset,count(*) as extracted,count(projected_id) as imported,count(*) filter(where issue is not null) as review from app_private.cashbarber_import_records where barbershop_id=p_barbershop_id group by dataset order by dataset)d),
    'issues',(select coalesce(jsonb_agg(d),'[]') from (select dataset,source_id,issue from app_private.cashbarber_import_records where barbershop_id=p_barbershop_id and issue is not null order by dataset,source_id limit 100)d),
    'last_import',(select max(imported_at) from app_private.cashbarber_import_records where barbershop_id=p_barbershop_id));
end $$;
revoke all on function app_private.cashbarber_import_summary(uuid) from public,anon,authenticated;
grant execute on function app_private.cashbarber_import_summary(uuid) to authenticated;
create function public.cashbarber_import_summary(p_barbershop_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$select app_private.cashbarber_import_summary(p_barbershop_id)$$;
revoke all on function public.cashbarber_import_summary(uuid) from public,anon,authenticated;
grant execute on function public.cashbarber_import_summary(uuid) to authenticated;

-- Server can retrieve the invitation address without exposing it in team lists.
create function app_private.imported_member_contacts(p_barbershop_id uuid) returns table(membership_id uuid,email text)
language sql stable security definer set search_path='' as $$
  select projected_id,payload->>'email' from app_private.cashbarber_import_records where barbershop_id=p_barbershop_id and dataset='memberships' and projected_id is not null;
$$;
revoke all on function app_private.imported_member_contacts(uuid) from public,anon,authenticated;
grant execute on function app_private.imported_member_contacts(uuid) to service_role;
create function public.imported_member_contacts(p_barbershop_id uuid) returns table(membership_id uuid,email text)
language sql stable security invoker set search_path='' as $$select * from app_private.imported_member_contacts(p_barbershop_id)$$;
revoke all on function public.imported_member_contacts(uuid) from public,anon,authenticated;
grant execute on function public.imported_member_contacts(uuid) to service_role;

create or replace function app_private.management_dashboard(p_barbershop_id uuid,p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_tz text; v_admin boolean; v_barber uuid; v_revenue bigint; v_count bigint; v_days jsonb; v_active bigint;
  v_available numeric; v_occupied numeric; v_debts jsonb;
begin
  if (select auth.uid()) is null or not app_private.has_shop_role(p_barbershop_id,array['admin','barber']::public.shop_role[]) then raise exception 'Dashboard access denied' using errcode='42501'; end if;
  if p_from is null or p_to is null or p_to<p_from or p_to-p_from>370 then raise exception 'Invalid report period' using errcode='22023'; end if;
  select timezone into v_tz from public.barbershops where id=p_barbershop_id;
  v_admin:=app_private.has_shop_role(p_barbershop_id,array['admin']::public.shop_role[]);
  if not v_admin then select id into v_barber from public.memberships where barbershop_id=p_barbershop_id and user_id=(select auth.uid()) and active and role='barber'; end if;
  if app_private.has_module(p_barbershop_id,'reports') then
    select coalesce(sum(p.amount_cents),0),count(*) into v_revenue,v_count from public.payments p left join public.appointments a on a.id=p.appointment_id and a.barbershop_id=p.barbershop_id
    where p.barbershop_id=p_barbershop_id and p.status='paid' and p.paid_at>=p_from::timestamp at time zone v_tz and p.paid_at<(p_to+1)::timestamp at time zone v_tz and (v_admin or a.barber_membership_id=v_barber);
    select coalesce(jsonb_agg(jsonb_build_object('day',d.day,'value',d.value) order by d.day),'[]') into v_days from (
      select (p.paid_at at time zone v_tz)::date as day,sum(p.amount_cents) as value from public.payments p left join public.appointments a on a.id=p.appointment_id and a.barbershop_id=p.barbershop_id
      where p.barbershop_id=p_barbershop_id and p.status='paid' and p.paid_at>=(p_to-6)::timestamp at time zone v_tz and p.paid_at<(p_to+1)::timestamp at time zone v_tz and (v_admin or a.barber_membership_id=v_barber) group by 1
    ) d;
  end if;
  if app_private.has_module(p_barbershop_id,'subscriptions') then
    select count(*) into v_active from public.subscriptions s where s.barbershop_id=p_barbershop_id and s.status in ('authorized','active') and (s.current_period_end is null or s.current_period_end>now())
      and (v_admin or exists(select 1 from public.client_barbers cb where cb.barbershop_id=s.barbershop_id and cb.client_id=s.client_id and cb.barber_membership_id=v_barber));
  end if;
  if app_private.has_module(p_barbershop_id,'appointments') then
    with dates as (select d::date as day from generate_series(p_from::timestamp,p_to::timestamp,'1 day') d),
    staff as (select id from public.memberships where barbershop_id=p_barbershop_id and role='barber' and active and (v_admin or id=v_barber)),
    windows as (
      select m.id barber_id,d.day,tsrange(d.day+coalesce(e.start_time,r.start_time),d.day+coalesce(e.end_time,r.end_time),'[)') slot
      from dates d cross join staff m left join public.availability_exceptions e on e.barbershop_id=p_barbershop_id and e.barber_membership_id=m.id and e.day=d.day
      left join public.availability_rules r on r.barbershop_id=p_barbershop_id and r.barber_membership_id=m.id and r.weekday=extract(dow from d.day) and r.active
      where not coalesce(e.unavailable,false) and coalesce(e.start_time,r.start_time) is not null and coalesce(e.end_time,r.end_time)>coalesce(e.start_time,r.start_time)
    ), merged as (select barber_id,unnest(range_agg(slot)) slot from windows group by barber_id),
    intersections as (
      select w.barber_id, w.slot * tsrange(a.starts_at at time zone v_tz,a.ends_at at time zone v_tz,'[)') slot
      from merged w join public.appointments a on a.barbershop_id=p_barbershop_id and a.barber_membership_id=w.barber_id and a.status in ('pending','confirmed','in_progress','completed')
      and w.slot && tsrange(a.starts_at at time zone v_tz,a.ends_at at time zone v_tz,'[)')
    ), occupied as (select barber_id,unnest(range_agg(slot)) slot from intersections group by barber_id)
    select (select sum(extract(epoch from upper(slot)-lower(slot))/60) from merged),
      (select sum(extract(epoch from upper(slot)-lower(slot))/60) from occupied) into v_available,v_occupied;
  end if;
  if v_admin then
    select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'client_name',c.full_name,'phone',c.phone,'description',r.description,'amount_cents',r.amount_cents,'due_on',r.due_on) order by r.due_on),'[]') into v_debts
    from public.receivables r join public.clients c on c.id=r.client_id and c.barbershop_id=r.barbershop_id where r.barbershop_id=p_barbershop_id and r.status='open' and r.due_on<(now() at time zone v_tz)::date;
  end if;
  return jsonb_build_object('revenue_cents',v_revenue,'paid_transactions',v_count,'ticket_average_cents',case when v_count>0 then round(v_revenue::numeric/v_count) else 0 end,
    'days',v_days,'active_plans',v_active,'available_minutes',v_available,'occupied_minutes',coalesce(v_occupied,0),
    'occupancy_pct',case when v_available>0 then round(100*coalesce(v_occupied,0)/v_available,1) end,'debts',v_debts);
end $$;
