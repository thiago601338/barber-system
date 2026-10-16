-- Apply after appointment_schedule_resources and operations_cash_inventory_commissions.
-- Never infer historical commercial terms from a plan that may have changed.
alter table public.services add column requires_subscription boolean not null default false;
grant select (requires_subscription) on public.services to anon, authenticated;
update public.services s set requires_subscription=true
from public.barbershops sh where sh.id=s.barbershop_id and sh.slug='kingsman'
  and s.id='908d2916-d6c6-4d42-b570-2213b7721472'::uuid and s.price_cents=0;

alter table public.subscriptions add column contract_snapshot jsonb;
alter table public.subscriptions add column contract_review_required boolean not null default true;

create function app_private.capture_subscription_contract() returns trigger
language plpgsql security definer set search_path='' as $$
declare p public.subscription_plans%rowtype; v_services jsonb;
begin
  if tg_op='UPDATE' then
    if new.contract_snapshot is distinct from old.contract_snapshot
      or new.contract_review_required is distinct from old.contract_review_required
      or new.barbershop_id<>old.barbershop_id or new.client_id<>old.client_id or new.plan_id<>old.plan_id then
      raise exception 'As condições do contrato são imutáveis. Crie um novo contrato para uma nova condição.' using errcode='22023';
    end if;
    return new;
  end if;
  -- The plan coverage RPC obtains FOR UPDATE on the same row.
  select * into p from public.subscription_plans
    where id=new.plan_id and barbershop_id=new.barbershop_id and active for share;
  if not found then raise exception 'Plano indisponível' using errcode='22023'; end if;
  select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'price_cents',s.price_cents,
    'duration_minutes',s.duration_minutes) order by s.id) into v_services
    from public.subscription_plan_services ps join public.services s
      on s.barbershop_id=ps.barbershop_id and s.id=ps.service_id and s.active
    where ps.barbershop_id=new.barbershop_id and ps.plan_id=new.plan_id;
  if v_services is null then raise exception 'Defina os serviços cobertos antes de contratar o plano' using errcode='22023'; end if;
  new.contract_snapshot:=jsonb_build_object('version',1,'captured_at',clock_timestamp(),'plan_id',p.id,
    'plan_name',p.name,'description',p.description,'price_cents',p.price_cents,
    'frequency_months',p.frequency_months,'visits_per_cycle',p.visits_per_cycle,'services',v_services);
  new.contract_review_required:=false;
  return new;
end $$;
revoke all on function app_private.capture_subscription_contract() from public,anon,authenticated;
create trigger capture_subscription_contract before insert or update on public.subscriptions
for each row execute function app_private.capture_subscription_contract();

create table public.subscription_observation_windows (
  barbershop_id uuid primary key references public.barbershops(id) on delete cascade,
  started_at timestamptz not null default now()
);
create table public.subscription_status_events (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null,
  subscription_id uuid not null,
  from_status text,
  to_status text not null,
  occurred_at timestamptz not null default clock_timestamp(),
  actor_user_id uuid,
  baseline boolean not null default false,
  foreign key(barbershop_id,subscription_id) references public.subscriptions(barbershop_id,id) on delete cascade
);
create index subscription_status_events_contract_time_idx
on public.subscription_status_events(barbershop_id,subscription_id,occurred_at desc);
create index subscription_status_events_shop_time_idx on public.subscription_status_events(barbershop_id,occurred_at);
insert into public.subscription_observation_windows(barbershop_id) select id from public.barbershops;
insert into public.subscription_status_events(barbershop_id,subscription_id,to_status,baseline)
select barbershop_id,id,status,true from public.subscriptions;

alter table public.payments add constraint payments_shop_id_unique unique(barbershop_id,id);
create table public.subscription_payment_financial_snapshots (
  barbershop_id uuid not null,
  payment_id uuid primary key,
  tax_pct numeric not null check(tax_pct between 0 and 100),
  fee_pct numeric not null check(fee_pct between 0 and 100),
  reviewed boolean not null,
  captured_at timestamptz not null default now(),
  foreign key(barbershop_id,payment_id) references public.payments(barbershop_id,id) on delete cascade
);
do $$ declare t text; begin
  foreach t in array array['subscription_observation_windows','subscription_status_events','subscription_payment_financial_snapshots'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('grant all on public.%I to service_role',t);
    execute format('create policy subscription_health_admin_select on public.%I for select to authenticated using(app_private.has_shop_role(barbershop_id,array[''admin'']::public.shop_role[]))',t);
  end loop;
end $$;

create function app_private.record_subscription_status() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into public.subscription_observation_windows(barbershop_id) values(new.barbershop_id) on conflict do nothing;
  if tg_op='INSERT' then
    insert into public.subscription_status_events(barbershop_id,subscription_id,to_status,actor_user_id)
      values(new.barbershop_id,new.id,new.status,(select auth.uid()));
  elsif new.status is distinct from old.status then
    insert into public.subscription_status_events(barbershop_id,subscription_id,from_status,to_status,actor_user_id)
      values(new.barbershop_id,new.id,old.status,new.status,(select auth.uid()));
  end if;
  return new;
end $$;
revoke all on function app_private.record_subscription_status() from public,anon,authenticated;
create trigger record_subscription_status after insert or update on public.subscriptions
for each row execute function app_private.record_subscription_status();

create function app_private.capture_subscription_payment_finances() returns trigger
language plpgsql security definer set search_path='' as $$
declare f public.financial_settings%rowtype; p public.item_financial_profiles%rowtype; v_plan uuid;
begin
  if new.subscription_id is null or new.status<>'paid' then return new; end if;
  select plan_id into v_plan from public.subscriptions where id=new.subscription_id and barbershop_id=new.barbershop_id;
  select * into f from public.financial_settings where barbershop_id=new.barbershop_id;
  select * into p from public.item_financial_profiles where barbershop_id=new.barbershop_id and item_kind='subscription' and item_id=v_plan;
  insert into public.subscription_payment_financial_snapshots(barbershop_id,payment_id,tax_pct,fee_pct,reviewed)
    values(new.barbershop_id,new.id,coalesce(p.tax_pct,f.tax_pct,0),coalesce(p.fee_pct,f.payment_fee_pct,0),coalesce(f.reviewed,false))
    on conflict do nothing;
  return new;
end $$;
revoke all on function app_private.capture_subscription_payment_finances() from public,anon,authenticated;
create trigger capture_subscription_payment_finances after insert or update on public.payments
for each row execute function app_private.capture_subscription_payment_finances();

-- An existing active contract retains its status while its historical terms are reviewed.
-- Once a snapshot exists, only an exact payment of those terms supports visits.
create or replace function public.reconcile_subscription_entitlement(p_subscription_id uuid)
returns text language plpgsql security invoker set search_path='' as $$
declare s public.subscriptions%rowtype;
begin
  select * into s from public.subscriptions where id=p_subscription_id for update;
  if not found then raise exception 'Subscription not found' using errcode='P0002'; end if;
  if s.status='active' and s.current_period_start is not null and s.current_period_end is not null
    and not exists(select 1 from public.payments p where p.barbershop_id=s.barbershop_id and p.subscription_id=s.id
      and p.provider='mercadopago' and p.status='paid' and p.paid_at>=s.current_period_start and p.paid_at<s.current_period_end
      and (s.contract_review_required or p.amount_cents=(s.contract_snapshot->>'price_cents')::integer)) then
    update public.subscriptions set status='past_due' where id=s.id;
    return 'past_due';
  end if;
  return s.status;
end $$;

create function app_private.subscription_eligibility_for_booking(
 p_barbershop_id uuid,p_client_id uuid,p_service_ids uuid[],p_starts_at timestamptz,p_ignore_appointment_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_required boolean; v_subscriptions jsonb;
begin
  if p_service_ids is null or cardinality(p_service_ids)<1 or cardinality(p_service_ids)>30
    or (select count(*) from public.services where barbershop_id=p_barbershop_id and active and id=any(p_service_ids))<>cardinality(p_service_ids) then
    raise exception 'Selecione serviços válidos desta barbearia' using errcode='22023';
  end if;
  select bool_or(requires_subscription) into v_required from public.services where barbershop_id=p_barbershop_id and id=any(p_service_ids);
  select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'plan_name',q.contract_snapshot->>'plan_name',
      'remaining_visits',q.remaining,'period_start',q.current_period_start,'period_end',q.current_period_end) order by q.current_period_end),'[]'::jsonb)
  into v_subscriptions from (
    select s.*, (s.contract_snapshot->>'visits_per_cycle')::integer-(select count(*)::integer
      from public.subscription_usages u join public.appointments a on a.barbershop_id=u.barbershop_id and a.id=u.appointment_id
      where u.barbershop_id=s.barbershop_id and u.subscription_id=s.id and u.status in ('reserved','used')
      and a.starts_at>=s.current_period_start and a.starts_at<s.current_period_end
      and a.id is distinct from p_ignore_appointment_id) as remaining
    from public.subscriptions s where s.barbershop_id=p_barbershop_id and s.client_id=p_client_id
      and s.status='active' and not s.contract_review_required and s.contract_snapshot is not null
      and p_starts_at>=s.current_period_start and p_starts_at<s.current_period_end
      and not exists(select 1 from unnest(p_service_ids) service_id where not exists(
        select 1 from jsonb_array_elements(s.contract_snapshot->'services') item where (item->>'id')::uuid=service_id))
      and exists(select 1 from public.payments pay where pay.barbershop_id=s.barbershop_id and pay.subscription_id=s.id
        and pay.provider='mercadopago' and pay.status='paid' and pay.amount_cents=(s.contract_snapshot->>'price_cents')::integer
        and pay.paid_at>=s.current_period_start and pay.paid_at<s.current_period_end)
  ) q where q.remaining>0;
  return jsonb_build_object('requires_subscription',coalesce(v_required,false),
    'eligible',not coalesce(v_required,false) or jsonb_array_length(v_subscriptions)>0,'subscriptions',v_subscriptions,
    'reason',case when v_required and jsonb_array_length(v_subscriptions)=0 then 'Este serviço é exclusivo para assinantes com pagamento confirmado, cobertura e visitas disponíveis no ciclo.' else null end);
end $$;
revoke all on function app_private.subscription_eligibility_for_booking(uuid,uuid,uuid[],timestamptz,uuid) from public,anon,authenticated;

create function app_private.booking_subscription_eligibility(
 p_barbershop_id uuid,p_client_id uuid,p_service_ids uuid[],p_starts_at timestamptz,p_ignore_appointment_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if (select auth.uid()) is null or not (app_private.is_own_client(p_barbershop_id,p_client_id)
    or app_private.has_shop_role(p_barbershop_id,array['admin']::public.shop_role[])
    or (app_private.has_module(p_barbershop_id,'appointments') and app_private.is_assigned_client(p_barbershop_id,p_client_id))) then
    raise exception 'Acesso não permitido a este cliente' using errcode='42501';
  end if;
  if not exists(select 1 from public.clients where id=p_client_id and barbershop_id=p_barbershop_id) then
    raise exception 'Cliente não pertence a esta barbearia' using errcode='22023';
  end if;
  if p_ignore_appointment_id is not null and not exists(select 1 from public.appointments a
    where a.barbershop_id=p_barbershop_id and a.client_id=p_client_id and a.id=p_ignore_appointment_id
    and (app_private.is_own_client(p_barbershop_id,p_client_id) or app_private.has_shop_role(p_barbershop_id,array['admin']::public.shop_role[])
      or app_private.is_own_barber(p_barbershop_id,a.barber_membership_id))) then
    raise exception 'Agendamento não pertence a este cliente ou profissional' using errcode='42501';
  end if;
  return app_private.subscription_eligibility_for_booking(p_barbershop_id,p_client_id,p_service_ids,p_starts_at,p_ignore_appointment_id);
end $$;
revoke all on function app_private.booking_subscription_eligibility(uuid,uuid,uuid[],timestamptz,uuid) from public,anon,authenticated;
grant execute on function app_private.booking_subscription_eligibility(uuid,uuid,uuid[],timestamptz,uuid) to authenticated;
create function public.booking_subscription_eligibility(p_barbershop_id uuid,p_client_id uuid,p_service_ids uuid[],p_starts_at timestamptz,p_ignore_appointment_id uuid default null)
returns jsonb language sql stable security invoker set search_path='' as $$
select app_private.booking_subscription_eligibility(p_barbershop_id,p_client_id,p_service_ids,p_starts_at,p_ignore_appointment_id) $$;
revoke all on function public.booking_subscription_eligibility(uuid,uuid,uuid[],timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.booking_subscription_eligibility(uuid,uuid,uuid[],timestamptz,uuid) to authenticated;

create or replace function app_private.book_appointment(
 p_barbershop_id uuid,p_client_id uuid,p_barber_membership_id uuid,p_service_ids uuid[],p_starts_at timestamptz,p_subscription_id uuid default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_timezone text; v_source text; v_schedule jsonb; v_eligibility jsonb; v_price integer; v_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'Entre para agendar' using errcode='42501'; end if;
  select timezone into v_timezone from public.barbershops where id=p_barbershop_id and active;
  if not found then raise exception 'Barbearia indisponível' using errcode='22023'; end if;
  if app_private.is_own_client(p_barbershop_id,p_client_id) then v_source:='client';
  elsif app_private.has_shop_role(p_barbershop_id,array['admin']::public.shop_role[]) then v_source:='admin';
  elsif app_private.is_own_barber(p_barbershop_id,p_barber_membership_id)
    and app_private.is_assigned_client(p_barbershop_id,p_client_id) and app_private.has_module(p_barbershop_id,'appointments') then v_source:='barber';
  else raise exception 'Agendamento não permitido para este cliente' using errcode='42501'; end if;
  if not exists(select 1 from public.clients where id=p_client_id and barbershop_id=p_barbershop_id) then
    raise exception 'Cliente não pertence a esta barbearia' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtext(p_barbershop_id::text),hashtext('appointment_schedule'));
  perform 1 from public.memberships where id=p_barber_membership_id and barbershop_id=p_barbershop_id and role='barber' and active for update;
  if not found then raise exception 'Profissional indisponível' using errcode='22023'; end if;
  -- Serialize concurrent reservations of the same subscription even across barbers.
  if p_subscription_id is not null then
    perform 1 from public.subscriptions where id=p_subscription_id and barbershop_id=p_barbershop_id and client_id=p_client_id for update;
    if not found then raise exception 'Assinatura não pertence a este cliente' using errcode='22023'; end if;
  end if;
  v_eligibility:=app_private.subscription_eligibility_for_booking(p_barbershop_id,p_client_id,p_service_ids,p_starts_at);
  if p_subscription_id is null and (v_eligibility->>'requires_subscription')::boolean then
    raise exception 'Este serviço é exclusivo de assinatura. Selecione um contrato elegível.' using errcode='22023';
  elsif p_subscription_id is not null and not exists(select 1 from jsonb_array_elements(v_eligibility->'subscriptions') item
    where (item->>'id')::uuid=p_subscription_id) then
    raise exception 'Assinatura sem cobertura, pagamento confirmado ou visitas disponíveis para este horário' using errcode='22023';
  end if;
  v_schedule:=app_private.appointment_schedule_details(p_barbershop_id,p_barber_membership_id,p_service_ids,p_starts_at);
  if not coalesce((v_schedule->>'available')::boolean,false) or not exists(
    select 1 from app_private.available_slots(p_barbershop_id,p_barber_membership_id,p_service_ids,(p_starts_at at time zone v_timezone)::date) slot
    where slot.starts_at=p_starts_at) then
    raise exception 'Horário solicitado indisponível' using errcode='22023'; end if;
  select sum(price_cents)::integer into v_price from public.services where barbershop_id=p_barbershop_id and id=any(p_service_ids);
  insert into public.appointments(barbershop_id,client_id,barber_membership_id,subscription_id,starts_at,ends_at,status,source,total_price_cents)
  values(p_barbershop_id,p_client_id,p_barber_membership_id,p_subscription_id,p_starts_at,(v_schedule->>'ends_at')::timestamptz,'confirmed',v_source,
    case when p_subscription_id is null then v_price else 0 end) returning id into v_id;
  insert into public.appointment_services(barbershop_id,appointment_id,service_id,price_cents,duration_minutes)
  select p_barbershop_id,v_id,s.id,s.price_cents,app_private.appointment_duration_minutes(p_barbershop_id,p_barber_membership_id,array[s.id])
  from public.services s where s.barbershop_id=p_barbershop_id and s.id=any(p_service_ids);
  perform app_private.commit_appointment_schedule(p_barbershop_id,v_id,p_service_ids);
  insert into public.client_barbers(barbershop_id,client_id,barber_membership_id)
  values(p_barbershop_id,p_client_id,p_barber_membership_id) on conflict do nothing;
  if p_subscription_id is not null then
    insert into public.subscription_usages(barbershop_id,subscription_id,appointment_id,status) values(p_barbershop_id,p_subscription_id,v_id,'reserved');
  end if;
  return v_id;
end $$;

create function app_private.subscription_health(p_barbershop_id uuid,p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_from timestamptz:=now()-make_interval(days=>p_days); v_observed timestamptz; v_metrics jsonb; v_plans jsonb; v_recovery jsonb;
  v_revenue bigint; v_taxfee numeric; v_payment_missing bigint; v_service_cost bigint; v_cost_missing bigint; v_commission bigint; v_commission_missing bigint;
  v_margin numeric; v_opening bigint; v_cancelled bigint; v_completed bigint;
begin
  if (select auth.uid()) is null or not app_private.has_shop_role(p_barbershop_id,array['admin']::public.shop_role[]) then
    raise exception 'Painel disponível apenas para a administração desta barbearia' using errcode='42501'; end if;
  if p_days is null or p_days<7 or p_days>365 then raise exception 'Período inválido' using errcode='22023'; end if;
  select started_at into v_observed from public.subscription_observation_windows where barbershop_id=p_barbershop_id;
  with last_status as (select distinct on (subscription_id) subscription_id,to_status from public.subscription_status_events
    where barbershop_id=p_barbershop_id and occurred_at<=v_from order by subscription_id,occurred_at desc,id desc),
  opening as (select subscription_id from last_status where to_status in ('active','past_due','paused'))
  select count(*),count(*) filter(where exists(select 1 from public.subscription_status_events e where e.barbershop_id=p_barbershop_id
    and e.subscription_id=o.subscription_id and e.to_status='cancelled' and e.occurred_at>v_from and e.occurred_at<=now()))
  into v_opening,v_cancelled from opening o;
  select jsonb_build_object(
    'active_contracts',count(*) filter(where status='active' and current_period_end>now()),
    'authorized_contracts',count(*) filter(where status='authorized'),
    'review_contracts',count(*) filter(where contract_review_required),
    'mrr_cents',coalesce(round(sum((contract_snapshot->>'price_cents')::numeric/(contract_snapshot->>'frequency_months')::numeric)
      filter(where not contract_review_required and status in ('active','authorized') and (status='authorized' or current_period_end>now()))),0),
    'overdue_contracts',count(*) filter(where status='past_due' or (status='active' and current_period_end<=now())),
    'overdue_cents',coalesce(sum((contract_snapshot->>'price_cents')::bigint)
      filter(where not contract_review_required and (status='past_due' or (status='active' and current_period_end<=now()))),0)) into v_metrics
  from public.subscriptions where barbershop_id=p_barbershop_id;
  select coalesce(sum(p.amount_cents),0),coalesce(sum(p.amount_cents*(f.tax_pct+f.fee_pct)/100),0),
    count(*) filter(where f.payment_id is null or not f.reviewed)
  into v_revenue,v_taxfee,v_payment_missing from public.payments p left join public.subscription_payment_financial_snapshots f
    on f.barbershop_id=p.barbershop_id and f.payment_id=p.id
  where p.barbershop_id=p_barbershop_id and p.subscription_id is not null and p.status='paid' and p.paid_at>=v_from and p.paid_at<=now();
  select coalesce(sum(f.cost_cents+f.extra_cost_cents),0),count(*) filter(where f.record_key is null or f.estimated)
  into v_service_cost,v_cost_missing from public.appointments a join public.appointment_services s on s.barbershop_id=a.barbershop_id and s.appointment_id=a.id
    left join public.financial_item_snapshots f on f.barbershop_id=s.barbershop_id and f.record_key='appointment:'||a.id||':'||s.service_id
  where a.barbershop_id=p_barbershop_id and a.subscription_id is not null and a.status='completed' and a.starts_at>=v_from and a.starts_at<=now();
  select count(distinct a.id),coalesce(sum(c.amount_cents),0),count(*) filter(where c.amount_cents is null or c.status not in ('accrued','closed'))
  into v_completed,v_commission,v_commission_missing from public.appointments a
    left join public.commission_entries c on c.barbershop_id=a.barbershop_id and c.appointment_id=a.id
  where a.barbershop_id=p_barbershop_id and a.subscription_id is not null and a.status='completed' and a.starts_at>=v_from and a.starts_at<=now();
  if v_revenue>0 and v_payment_missing=0 and v_cost_missing=0 and v_commission_missing=0 then
    v_margin:=round(v_revenue-v_taxfee-v_service_cost-v_commission);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'name',q.name,'active_contracts',q.active_contracts,'mrr_cents',q.mrr_cents,
    'visits_used',q.visits_used,'visits_reserved',q.visits_reserved,'cycle_visits',q.cycle_visits,'consumption_pct',
    case when q.cycle_visits>0 then round(100.0*(q.visits_used+q.visits_reserved)/q.cycle_visits,1) else null end) order by q.name),'[]'::jsonb)
  into v_plans from (
    select p.id,p.name,count(s.id) filter(where s.status='active' and s.current_period_end>now()) as active_contracts,
      coalesce(round(sum((s.contract_snapshot->>'price_cents')::numeric/(s.contract_snapshot->>'frequency_months')::numeric)
        filter(where not s.contract_review_required and s.status in ('active','authorized') and (s.status='authorized' or s.current_period_end>now()))),0) as mrr_cents,
      coalesce(sum((s.contract_snapshot->>'visits_per_cycle')::integer) filter(where not s.contract_review_required and s.status='active' and s.current_period_end>now()),0) as cycle_visits,
      coalesce(sum(u.used_count),0) as visits_used,coalesce(sum(u.reserved_count),0) as visits_reserved
    from public.subscription_plans p left join public.subscriptions s on s.barbershop_id=p.barbershop_id and s.plan_id=p.id
    left join lateral(select count(*) filter(where su.status='used') as used_count,count(*) filter(where su.status='reserved') as reserved_count
      from public.subscription_usages su join public.appointments a on a.barbershop_id=su.barbershop_id and a.id=su.appointment_id
      where su.barbershop_id=s.barbershop_id and su.subscription_id=s.id and s.status='active' and not s.contract_review_required
      and s.current_period_end>now() and a.starts_at>=s.current_period_start and a.starts_at<s.current_period_end) u on true
    where p.barbershop_id=p_barbershop_id group by p.id,p.name) q;
  select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'client_id',s.client_id,'plan_id',s.plan_id,
    'current_period_start',s.current_period_start,'current_period_end',s.current_period_end,
    'contract_snapshot',s.contract_snapshot,'contract_review_required',s.contract_review_required,'client_name',c.full_name,'phone',c.phone,
    'plan_name',coalesce(s.contract_snapshot->>'plan_name',p.name),'due_at',s.current_period_end,
    'amount_cents',case when not s.contract_review_required then (s.contract_snapshot->>'price_cents')::integer else null end,
    'review_required',s.contract_review_required,'status',s.status) order by s.current_period_end nulls last),'[]'::jsonb)
  into v_recovery from public.subscriptions s join public.clients c on c.barbershop_id=s.barbershop_id and c.id=s.client_id
    join public.subscription_plans p on p.barbershop_id=s.barbershop_id and p.id=s.plan_id
  where s.barbershop_id=p_barbershop_id and (s.status='past_due' or (s.status='active' and s.current_period_end<=now()));
  return v_metrics||jsonb_build_object('days',p_days,'from',v_from,'to',now(),'observed_since',v_observed,
    'history_complete',coalesce(v_observed<=v_from,false),'churn_pct',case when v_observed<=v_from and v_opening>0 then round(100.0*v_cancelled/v_opening,2) else null end,
    'opening_paid_contracts',v_opening,'cancelled_contracts',v_cancelled,'received_cents',v_revenue,
    'contribution_margin_cents',v_margin,'contribution_margin_pct',case when v_margin is not null then round(100.0*v_margin/v_revenue,2) else null end,
    'missing_financial_records',v_payment_missing+v_cost_missing+v_commission_missing,'completed_visits',v_completed,
    'plans',v_plans,'recovery',v_recovery);
end $$;
revoke all on function app_private.subscription_health(uuid,integer) from public,anon,authenticated;
grant execute on function app_private.subscription_health(uuid,integer) to authenticated;
create function public.subscription_health(p_barbershop_id uuid,p_days integer default 30)
returns jsonb language sql stable security invoker set search_path='' as $$ select app_private.subscription_health(p_barbershop_id,p_days) $$;
revoke all on function public.subscription_health(uuid,integer) from public,anon,authenticated;
grant execute on function public.subscription_health(uuid,integer) to authenticated;
