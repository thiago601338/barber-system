-- Calendário de assinaturas: contrato em atraso aparece no dia em que venceu (início do ciclo sem pagamento)
-- e o total em atraso não depende do mês exibido.
create or replace function public.subscription_calendar(p_barbershop_id uuid, p_from date, p_to date)
returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v_tz text; v_admin boolean; v_own uuid; v_today date; v_due jsonb; v_received jsonb := '[]'::jsonb; v_overdue jsonb;
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
      -- Em atraso: o dia do vencimento é o início do ciclo que ficou sem pagamento.
      ((case when s.status = 'past_due' and s.current_period_start is not null then s.current_period_start else s.current_period_end end) at time zone v_tz)::date as due
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

  -- Total em atraso, independente do mês exibido.
  select jsonb_build_object('count', count(*), 'amount_cents', coalesce(sum(coalesce((s.contract_snapshot->>'price_cents')::integer, p.price_cents)), 0)) into v_overdue
  from public.subscriptions s join public.subscription_plans p on p.barbershop_id = s.barbershop_id and p.id = s.plan_id
  where s.barbershop_id = p_barbershop_id and not s.cancel_at_period_end
    and (s.status = 'past_due' or (s.status in ('active', 'authorized') and s.current_period_end <= now()))
    and (v_admin or exists (select 1 from public.client_barbers cb
      where cb.barbershop_id = s.barbershop_id and cb.client_id = s.client_id and cb.barber_membership_id = v_own));

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
  return jsonb_build_object('today', v_today, 'due', v_due, 'received', v_received, 'overdue', v_overdue);
end $function$;
revoke all on function public.subscription_calendar(uuid, date, date) from public, anon, authenticated;
grant execute on function public.subscription_calendar(uuid, date, date) to authenticated;
