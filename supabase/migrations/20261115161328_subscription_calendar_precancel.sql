-- Assinaturas: pré-cancelamento (encerra ao fim do ciclo pago), cancelamento de contratos sem cobrança online
-- e calendário de vencimentos e recebimentos.
alter table public.subscriptions
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists cancel_requested_at timestamptz,
  add column if not exists cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 500);

create or replace function app_private.apply_subscription_precancellations(p_barbershop_id uuid)
returns integer language plpgsql security definer set search_path to ''
as $function$
declare v_count integer;
begin
  update public.subscriptions set status = 'cancelled', cancelled_at = now()
    where barbershop_id = p_barbershop_id and cancel_at_period_end
      and status in ('active', 'authorized', 'past_due', 'paused')
      and current_period_end is not null and current_period_end <= now();
  get diagnostics v_count = row_count;
  return v_count;
end $function$;
revoke all on function app_private.apply_subscription_precancellations(uuid) from public, anon, authenticated;

-- p_mode: 'schedule' (encerra ao fim do ciclo), 'unschedule' (mantém o contrato) ou 'now' (encerra já).
create or replace function public.manage_subscription_cancellation(p_barbershop_id uuid, p_subscription_id uuid, p_mode text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare s public.subscriptions; v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
begin
  if (select auth.uid()) is null or not app_private.has_shop_role(p_barbershop_id, array['admin']::public.shop_role[]) then
    raise exception 'Apenas a administração altera contratos.' using errcode = '42501';
  end if;
  select * into s from public.subscriptions where barbershop_id = p_barbershop_id and id = p_subscription_id for update;
  if not found then raise exception 'Contrato não encontrado.' using errcode = 'P0002'; end if;
  if p_mode = 'unschedule' then
    if s.status = 'cancelled' then raise exception 'Este contrato já foi encerrado.' using errcode = '23514'; end if;
    update public.subscriptions set cancel_at_period_end = false, cancel_requested_at = null, cancel_reason = null where id = s.id returning * into s;
  elsif p_mode in ('schedule', 'now') then
    if s.status not in ('pending', 'active', 'authorized', 'past_due', 'paused') then
      raise exception 'Este contrato já foi encerrado.' using errcode = '23514';
    end if;
    if s.provider = 'mercadopago' and s.provider_subscription_id is not null then
      raise exception 'Este contrato é cobrado pelo Mercado Pago. Use "Cancelar recorrência" para interromper a cobrança.' using errcode = '23514';
    end if;
    if p_mode = 'now' or s.current_period_end is null or s.current_period_end <= now() then
      update public.subscriptions set status = 'cancelled', cancelled_at = now(), cancel_requested_at = coalesce(cancel_requested_at, now()),
        cancel_reason = coalesce(v_reason, cancel_reason) where id = s.id returning * into s;
    else
      update public.subscriptions set cancel_at_period_end = true, cancel_requested_at = now(), cancel_reason = v_reason where id = s.id returning * into s;
    end if;
  else
    raise exception 'Ação inválida.' using errcode = '23514';
  end if;
  return jsonb_build_object('id', s.id, 'status', s.status, 'cancel_at_period_end', s.cancel_at_period_end, 'current_period_end', s.current_period_end);
end $function$;
revoke all on function public.manage_subscription_cancellation(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.manage_subscription_cancellation(uuid, uuid, text, text) to authenticated;

-- Calendário: vencimentos previstos por dia (com os próximos ciclos) e mensalidades recebidas por dia.
create or replace function public.subscription_calendar(p_barbershop_id uuid, p_from date, p_to date)
returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v_tz text; v_admin boolean; v_own uuid; v_today date; v_due jsonb; v_received jsonb := '[]'::jsonb;
begin
  if (select auth.uid()) is null or not app_private.has_module(p_barbershop_id, 'subscriptions') then
    raise exception 'Seu acesso não permite ver as assinaturas.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'Período inválido.' using errcode = '22023';
  end if;
  select b.timezone into v_tz from public.barbershops b where b.id = p_barbershop_id;
  if v_tz is null then raise exception 'Barbearia não encontrada.' using errcode = '22023'; end if;
  v_admin := app_private.has_shop_role(p_barbershop_id, array['admin']::public.shop_role[]);
  v_today := (now() at time zone v_tz)::date;
  if v_admin then
    perform app_private.apply_subscription_precancellations(p_barbershop_id);
  else
    select m.id into v_own from public.memberships m
      where m.barbershop_id = p_barbershop_id and m.user_id = (select auth.uid()) and m.role = 'barber' and m.active;
  end if;

  with live as (
    select s.id, s.client_id, s.status, s.cancel_at_period_end, c.full_name, c.phone,
      coalesce(s.contract_snapshot->>'plan_name', p.name) as plan_name,
      coalesce((s.contract_snapshot->>'price_cents')::integer, p.price_cents) as amount_cents,
      greatest(1, coalesce((s.contract_snapshot->>'frequency_months')::integer, p.frequency_months, 1)) as months,
      (s.current_period_end at time zone v_tz)::date as due
    from public.subscriptions s
      join public.clients c on c.barbershop_id = s.barbershop_id and c.id = s.client_id
      join public.subscription_plans p on p.barbershop_id = s.barbershop_id and p.id = s.plan_id
    where s.barbershop_id = p_barbershop_id and s.status in ('active', 'authorized', 'past_due') and s.current_period_end is not null
      and (v_admin or exists (select 1 from public.client_barbers cb
        where cb.barbershop_id = s.barbershop_id and cb.client_id = s.client_id and cb.barber_membership_id = v_own))
  ), occurrences as (
    select l.*, (l.due + make_interval(months => k * l.months))::date as day, k
    from live l cross join lateral generate_series(0, case when l.cancel_at_period_end or l.status = 'past_due' then 0 else 3 end) as k
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id::text || ':' || o.k, 'subscription_id', o.id, 'day', o.day, 'client_id', o.client_id, 'client_name', o.full_name, 'phone', o.phone,
      'plan_name', o.plan_name, 'amount_cents', o.amount_cents, 'status', o.status, 'projected', o.k > 0,
      'ending', o.cancel_at_period_end, 'overdue', o.k = 0 and (o.status = 'past_due' or o.day < v_today)
    ) order by o.day, o.full_name), '[]'::jsonb) into v_due
  from occurrences o where o.day between p_from and p_to;

  if v_admin then
    select coalesce(jsonb_agg(jsonb_build_object('day', q.day, 'amount_cents', q.total, 'count', q.n) order by q.day), '[]'::jsonb) into v_received
    from (
      select (pay.paid_at at time zone v_tz)::date as day, sum(pay.amount_cents) as total, count(*) as n
      from public.payments pay
      where pay.barbershop_id = p_barbershop_id and pay.status = 'paid'
        and (pay.subscription_id is not null or (pay.provider = 'cashbarber' and pay.provider_payment_id like 'subscription:%'))
        and pay.paid_at >= p_from::timestamp at time zone v_tz and pay.paid_at < (p_to + 1)::timestamp at time zone v_tz
      group by 1
    ) q;
  end if;
  return jsonb_build_object('today', v_today, 'due', v_due, 'received', v_received);
end $function$;
revoke all on function public.subscription_calendar(uuid, date, date) from public, anon, authenticated;
grant execute on function public.subscription_calendar(uuid, date, date) to authenticated;

-- "Contratos ativos" da página de assinaturas: contratos antigos só somam enquanto não viraram assinatura real.
create or replace function app_private.subscription_overview(p_barbershop_id uuid)
returns jsonb language plpgsql stable security definer set search_path to ''
as $function$
declare legacy integer; received bigint; current_contracts integer;
begin
  if (select auth.uid()) is null or not app_private.has_shop_role(p_barbershop_id,array['admin']::public.shop_role[]) then raise exception 'Overview access denied' using errcode='42501';end if;
  select count(*) into legacy from app_private.cashbarber_import_records
    where barbershop_id=p_barbershop_id and dataset='contracts' and projected_id is null and issue is null and payload->>'status'='active';
  select count(*) into current_contracts from public.subscriptions where barbershop_id=p_barbershop_id and status in ('active','authorized') and (current_period_end is null or current_period_end>now());
  select coalesce(sum(amount_cents),0) into received from public.payments where barbershop_id=p_barbershop_id and status='paid' and (subscription_id is not null or (provider='cashbarber' and provider_payment_id like 'subscription:%'));
  return jsonb_build_object('active',current_contracts+legacy,'legacy_active',legacy,'received_cents',received);
end $function$;

-- Painel: contrato pré-cancelado cujo ciclo terminou não entra como inadimplente.
create or replace function app_private.management_dashboard(p_barbershop_id uuid,p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v jsonb; v_admin boolean; n bigint; debts jsonb; revenue bigint; transactions bigint;
begin
  v:=app_private.management_dashboard_base(p_barbershop_id,p_from,p_to);
  v_admin:=app_private.has_shop_role(p_barbershop_id,array['admin']::public.shop_role[]);
  if v_admin and app_private.has_module(p_barbershop_id,'subscriptions') then
    select count(*) into n from app_private.cashbarber_import_records
      where barbershop_id=p_barbershop_id and dataset='contracts' and projected_id is null and issue is null and payload->>'status'='active';
    v:=jsonb_set(v,'{active_plans}',to_jsonb(coalesce((v->>'active_plans')::bigint,0)+n));
  end if;
  if v_admin then
    select coalesce(jsonb_agg(d order by d->>'due_on' nulls last),'[]') into debts from (
      select jsonb_build_object('id','subscription:'||s.id,'client_name',c.full_name,'phone',c.phone,
        'description',coalesce(s.contract_snapshot->>'plan_name',p.name),
        'amount_cents',case when not s.contract_review_required then (s.contract_snapshot->>'price_cents')::integer end,
        'due_on',(s.current_period_start at time zone b.timezone)::date,'legacy',true,'subscription_id',s.id) d
      from public.subscriptions s
        join public.barbershops b on b.id=s.barbershop_id
        join public.clients c on c.barbershop_id=s.barbershop_id and c.id=s.client_id
        join public.subscription_plans p on p.barbershop_id=s.barbershop_id and p.id=s.plan_id
      where s.barbershop_id=p_barbershop_id and not s.cancel_at_period_end and (s.status='past_due' or (s.status='active' and s.current_period_end<=now()))
      union all
      select jsonb_build_object('id','cashbarber:'||r.source_id,'client_name',r.payload->>'name','phone',r.payload->>'phone','description',r.payload->>'plan','amount_cents',null,'due_on',null,'legacy',true)
      from app_private.cashbarber_import_records r
      where r.barbershop_id=p_barbershop_id and r.dataset='contracts' and r.projected_id is null and r.issue is null and r.payload->>'status' in ('pastdue','not_authorized','denied')
    ) q(d);
    v:=jsonb_set(v,'{debts}',coalesce(v->'debts','[]')||debts);
    select sum(p.amount_cents),count(*) filter(where p.amount_cents>0) into revenue,transactions from public.payments p join public.barbershops b on b.id=p.barbershop_id where p.barbershop_id=p_barbershop_id and p.status='paid' and p.paid_at>=p_from::timestamp at time zone b.timezone and p.paid_at<(p_to+1)::timestamp at time zone b.timezone;
    v:=v||jsonb_build_object('paid_transactions',transactions,'ticket_average_cents',case when transactions>0 then round(revenue::numeric/transactions) else 0 end);
  end if;
  return v;
end $$;
