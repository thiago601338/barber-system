-- Private financial inputs. Customer and barber clients cannot read costs.
create table public.financial_settings (
  barbershop_id uuid primary key references public.barbershops(id) on delete cascade,
  tax_pct numeric(6,3) not null default 0 check(tax_pct between 0 and 100),
  payment_fee_pct numeric(6,3) not null default 0 check(payment_fee_pct between 0 and 100),
  service_commission_pct numeric(6,3) not null default 0 check(service_commission_pct between 0 and 100),
  product_commission_pct numeric(6,3) not null default 0 check(product_commission_pct between 0 and 100),
  structure_in_expenses boolean not null default true,
  reviewed boolean not null default false,
  updated_at timestamptz not null default now()
);
create table public.item_financial_profiles (
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  item_kind text not null check(item_kind in ('service','product','subscription')),
  item_id uuid not null,
  direct_cost_cents integer check(direct_cost_cents >= 0),
  extra_cost_cents integer not null default 0 check(extra_cost_cents >= 0),
  tax_pct numeric(6,3) check(tax_pct between 0 and 100),
  fee_pct numeric(6,3) check(fee_pct between 0 and 100),
  commission_pct numeric(6,3) check(commission_pct between 0 and 100),
  extra_service boolean not null default false,
  primary key(barbershop_id,item_kind,item_id)
);
create table public.financial_item_snapshots (
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  record_key text not null,
  cost_cents integer not null check(cost_cents >= 0),
  extra_cost_cents integer not null check(extra_cost_cents >= 0),
  tax_pct numeric not null, fee_pct numeric not null, commission_pct numeric not null,
  estimated boolean not null,
  primary key(barbershop_id,record_key)
);
create table public.receivables (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  client_id uuid not null,
  description text not null check(length(description) between 1 and 300),
  amount_cents integer not null check(amount_cents > 0),
  due_on date not null,
  status text not null default 'open' check(status in ('open','paid','cancelled')),
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key(barbershop_id,client_id) references public.clients(barbershop_id,id)
);
create index receivables_shop_due_idx on public.receivables(barbershop_id,due_on) where status='open';
alter table public.expenses add column cost_kind text not null default 'operating'
  check(cost_kind in ('operating','structure','tax','fees','commission','inventory'));
do $$ declare t text; begin
  foreach t in array array['financial_settings','item_financial_profiles','financial_item_snapshots','receivables'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('create policy financial_admin_select on public.%I for select to authenticated using(app_private.has_shop_role(barbershop_id,array[''admin'']::public.shop_role[]))',t);
    if t <> 'financial_item_snapshots' then
      execute format('create policy financial_admin_insert on public.%I for insert to authenticated with check(app_private.has_shop_role(barbershop_id,array[''admin'']::public.shop_role[]))',t);
      execute format('create policy financial_admin_update on public.%I for update to authenticated using(app_private.has_shop_role(barbershop_id,array[''admin'']::public.shop_role[])) with check(app_private.has_shop_role(barbershop_id,array[''admin'']::public.shop_role[]))',t);
      execute format('grant select,insert,update on public.%I to authenticated',t);
    else execute format('grant select on public.%I to authenticated',t); end if;
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;

create function app_private.validate_item_financial_profile() returns trigger
language plpgsql set search_path='' as $$
begin
  if (new.item_kind='product' and not exists(select 1 from public.products where id=new.item_id and barbershop_id=new.barbershop_id))
    or (new.item_kind='service' and not exists(select 1 from public.services where id=new.item_id and barbershop_id=new.barbershop_id))
    or (new.item_kind='subscription' and not exists(select 1 from public.subscription_plans where id=new.item_id and barbershop_id=new.barbershop_id)) then
    raise exception 'Item does not belong to this shop' using errcode='22023';
  end if;
  return new;
end $$;
create trigger validate_financial_item before insert or update on public.item_financial_profiles
for each row execute function app_private.validate_item_financial_profile();
revoke all on function app_private.validate_item_financial_profile() from public,anon,authenticated;

-- Trigger-only definer records private costs without exposing them to a barber selling an item.
create function app_private.snapshot_item_finances() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_kind text; v_item uuid; v_key text; v_cost integer; f public.financial_settings; p public.item_financial_profiles;
begin
  if tg_table_name='sale_items' then v_kind:='product'; v_item:=new.product_id; v_key:='sale:'||new.id;
    select cost_cents into v_cost from public.products where id=v_item and barbershop_id=new.barbershop_id;
  else v_kind:='service'; v_item:=new.service_id; v_key:='appointment:'||new.appointment_id||':'||new.service_id;
    select cost_cents into v_cost from public.services where id=v_item and barbershop_id=new.barbershop_id;
  end if;
  select * into f from public.financial_settings where barbershop_id=new.barbershop_id;
  select * into p from public.item_financial_profiles where barbershop_id=new.barbershop_id and item_kind=v_kind and item_id=v_item;
  insert into public.financial_item_snapshots values(new.barbershop_id,v_key,coalesce(p.direct_cost_cents,v_cost,0),coalesce(p.extra_cost_cents,0),
    coalesce(p.tax_pct,f.tax_pct,0),coalesce(p.fee_pct,f.payment_fee_pct,0),
    coalesce(p.commission_pct,case when v_kind='service' then f.service_commission_pct else f.product_commission_pct end,0),
    not coalesce(f.reviewed,false) or (p.direct_cost_cents is null and coalesce(v_cost,0)=0))
  on conflict do nothing;
  return new;
end $$;
revoke all on function app_private.snapshot_item_finances() from public,anon,authenticated;
create trigger capture_sale_cost after insert on public.sale_items for each row execute function app_private.snapshot_item_finances();
create trigger capture_appointment_cost after insert on public.appointment_services for each row execute function app_private.snapshot_item_finances();

create function app_private.profitability_data(p_barbershop_id uuid,p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_tz text; v_start timestamptz; v_end timestamptz; v_result jsonb;
begin
  if (select auth.uid()) is null or not app_private.has_shop_role(p_barbershop_id,array['admin']::public.shop_role[]) then
    raise exception 'Profit access denied' using errcode='42501'; end if;
  if p_from is null or p_to is null or p_to<p_from or p_to-p_from>370 then raise exception 'Invalid report period' using errcode='22023'; end if;
  select timezone into v_tz from public.barbershops where id=p_barbershop_id;
  v_start:=p_from::timestamp at time zone v_tz; v_end:=(p_to+1)::timestamp at time zone v_tz;
  with settings as (
    select coalesce(f.tax_pct,0) tax_pct,coalesce(f.payment_fee_pct,0) payment_fee_pct,
      coalesce(f.service_commission_pct,0) service_commission_pct,coalesce(f.product_commission_pct,0) product_commission_pct,
      coalesce(f.structure_in_expenses,true) structure_in_expenses,coalesce(f.reviewed,false) reviewed,
      b.structure_monthly_cost_cents,b.target_profit_pct
    from public.barbershops b left join public.financial_settings f on f.barbershop_id=b.id where b.id=p_barbershop_id
  ), raw_catalog as (
    select id,'service'::text kind,name,'service'::text category,price_cents,cost_cents from public.services where barbershop_id=p_barbershop_id
    union all select id,'product',name,category,price_cents,cost_cents from public.products where barbershop_id=p_barbershop_id
    union all select id,'subscription',name,'subscription',price_cents,0 from public.subscription_plans where barbershop_id=p_barbershop_id
  ), catalog as (
    select c.id,c.kind,c.name,c.category,c.price_cents,coalesce(p.direct_cost_cents,c.cost_cents) cost_cents,coalesce(p.extra_cost_cents,0) extra_cost_cents,
      p.direct_cost_cents is not null or c.cost_cents>0 or c.kind='subscription' cost_confirmed,
      coalesce(p.tax_pct,f.tax_pct) tax_pct,coalesce(p.fee_pct,f.payment_fee_pct) fee_pct,
      coalesce(p.commission_pct,case when c.kind in ('service','subscription') then f.service_commission_pct else f.product_commission_pct end) commission_pct,
      coalesce(p.extra_service,false) extra_service
    from raw_catalog c cross join settings f left join public.item_financial_profiles p on p.barbershop_id=p_barbershop_id and p.item_id=c.id and p.item_kind=c.kind
  ), paid as (
    select * from public.payments where barbershop_id=p_barbershop_id and status='paid' and paid_at>=v_start and paid_at<v_end
  ), sale_lines as (
    select p.id payment_id,p.amount_cents,si.id line_id,c.id item_id,c.kind,c.name,c.category,si.total_cents weight,si.quantity,
      round(coalesce(snap.cost_cents,c.cost_cents)*si.quantity*least(1,p.amount_cents::numeric/nullif(s.total_cents,0))) direct_cost_cents,
      round(coalesce(snap.extra_cost_cents,c.extra_cost_cents)*si.quantity*least(1,p.amount_cents::numeric/nullif(s.total_cents,0))) extra_cost_cents,
      coalesce(snap.tax_pct,c.tax_pct) tax_pct,coalesce(snap.fee_pct,c.fee_pct) fee_pct,coalesce(snap.commission_pct,c.commission_pct) commission_pct,
      coalesce(snap.estimated,true) estimated
    from paid p join public.sales s on s.id=p.sale_id and s.barbershop_id=p.barbershop_id
      join public.sale_items si on si.sale_id=s.id and si.barbershop_id=s.barbershop_id join catalog c on c.id=si.product_id and c.kind='product'
      left join public.financial_item_snapshots snap on snap.barbershop_id=si.barbershop_id and snap.record_key='sale:'||si.id
    where p.appointment_id is null
  ), service_lines as (
    select p.id,p.amount_cents,aps.service_id,c.id,c.kind,c.name,case when c.extra_service then 'extra_service' else c.category end,aps.price_cents,1,
      round(coalesce(snap.cost_cents,c.cost_cents)*least(1,p.amount_cents::numeric/nullif(a.total_price_cents,0))),
      round(coalesce(snap.extra_cost_cents,c.extra_cost_cents)*least(1,p.amount_cents::numeric/nullif(a.total_price_cents,0))),
      coalesce(snap.tax_pct,c.tax_pct),coalesce(snap.fee_pct,c.fee_pct),coalesce(snap.commission_pct,c.commission_pct),coalesce(snap.estimated,true)
    from paid p join public.appointments a on a.id=p.appointment_id and a.barbershop_id=p.barbershop_id
      join public.appointment_services aps on aps.appointment_id=a.id and aps.barbershop_id=a.barbershop_id join catalog c on c.id=aps.service_id and c.kind='service'
      left join public.financial_item_snapshots snap on snap.barbershop_id=aps.barbershop_id and snap.record_key='appointment:'||aps.appointment_id||':'||aps.service_id
    where aps.price_cents>0
  ), item_lines as (select * from sale_lines union all select * from service_lines),
  weighted as (
    select l.*,row_number() over(partition by payment_id order by line_id) rn,count(*) over(partition by payment_id) cnt,
      round(amount_cents::numeric*weight/nullif(sum(weight) over(partition by payment_id),0)) gross
    from item_lines l
  ), lines as (
    select item_id,kind,name,category,case when rn=cnt then amount_cents-(sum(gross) over(partition by payment_id)-gross) else gross end revenue_cents,
      quantity,coalesce(direct_cost_cents,0) direct_cost_cents,coalesce(extra_cost_cents,0) extra_cost_cents,tax_pct,fee_pct,commission_pct,estimated
    from weighted
    union all
    select c.id,coalesce(c.kind,'other'),coalesce(c.name,'Recebimento sem itens'),coalesce(c.category,'other'),p.amount_cents,1,
      coalesce(c.cost_cents,0),coalesce(c.extra_cost_cents,0),coalesce(c.tax_pct,f.tax_pct),coalesce(c.fee_pct,f.payment_fee_pct),coalesce(c.commission_pct,0),true
    from paid p cross join settings f left join public.subscriptions sub on sub.id=p.subscription_id and sub.barbershop_id=p.barbershop_id
      left join catalog c on c.id=sub.plan_id and c.kind='subscription'
    where not exists(select 1 from item_lines l where l.payment_id=p.id)
  ), subscription_costs as (
    select coalesce(snap.cost_cents,c.cost_cents)+coalesce(snap.extra_cost_cents,c.extra_cost_cents) cost_cents,coalesce(snap.estimated,true) estimated
    from public.appointments a join public.appointment_services aps on aps.appointment_id=a.id and aps.barbershop_id=a.barbershop_id
      join catalog c on c.id=aps.service_id and c.kind='service'
      left join public.financial_item_snapshots snap on snap.barbershop_id=aps.barbershop_id and snap.record_key='appointment:'||aps.appointment_id||':'||aps.service_id
    where a.barbershop_id=p_barbershop_id and a.subscription_id is not null and a.status='completed' and aps.price_cents=0 and a.starts_at>=v_start and a.starts_at<v_end
  ) select jsonb_build_object('settings',(select to_jsonb(settings) from settings),'catalog',(select coalesce(jsonb_agg(to_jsonb(catalog)),'[]') from catalog),
    'lines',(select coalesce(jsonb_agg(to_jsonb(lines)),'[]') from lines),'subscription_costs',(select coalesce(jsonb_agg(to_jsonb(subscription_costs)),'[]') from subscription_costs),
    'expenses',(select coalesce(jsonb_agg(jsonb_build_object('cost_kind',e.cost_kind,'amount_cents',e.amount_cents)),'[]') from public.expenses e where e.barbershop_id=p_barbershop_id and e.occurred_on between p_from and p_to),
    'structure_period_cents',(select round(sum(b.structure_monthly_cost_cents::numeric/extract(day from date_trunc('month',d)+interval '1 month - 1 day'))) from generate_series(p_from::timestamp,p_to::timestamp,'1 day') d cross join public.barbershops b where b.id=p_barbershop_id)) into v_result;
  return v_result;
end $$;
revoke all on function app_private.profitability_data(uuid,date,date) from public,anon,authenticated;
grant execute on function app_private.profitability_data(uuid,date,date) to authenticated;
create function public.profitability_data(p_barbershop_id uuid,p_from date,p_to date) returns jsonb
language sql stable security invoker set search_path='' as $$select app_private.profitability_data(p_barbershop_id,p_from,p_to)$$;
revoke all on function public.profitability_data(uuid,date,date) from public,anon,authenticated;
grant execute on function public.profitability_data(uuid,date,date) to authenticated;

create function app_private.management_dashboard(p_barbershop_id uuid,p_from date,p_to date) returns jsonb
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
    select count(*) into v_active from public.subscriptions s where s.barbershop_id=p_barbershop_id and s.status='authorized' and (s.current_period_end is null or s.current_period_end>now())
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
revoke all on function app_private.management_dashboard(uuid,date,date) from public,anon,authenticated;
grant execute on function app_private.management_dashboard(uuid,date,date) to authenticated;
create function public.management_dashboard(p_barbershop_id uuid,p_from date,p_to date) returns jsonb
language sql stable security invoker set search_path='' as $$select app_private.management_dashboard(p_barbershop_id,p_from,p_to)$$;
revoke all on function public.management_dashboard(uuid,date,date) from public,anon,authenticated;
grant execute on function public.management_dashboard(uuid,date,date) to authenticated;
