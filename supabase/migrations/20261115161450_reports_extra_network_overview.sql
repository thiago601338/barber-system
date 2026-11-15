-- Relatórios adicionais: aniversariantes, ausentes, captação, frequência, serviços por período,
-- origem dos agendamentos e estornos. Mesma regra de acesso dos demais relatórios.
create or replace function public.report_extra(p_barbershop_id uuid, p_kind text, p_from date, p_to date, p_barber_membership_id uuid default null, p_days integer default null)
returns jsonb language plpgsql stable security definer set search_path to ''
as $function$
declare
  v_tz text; v_admin boolean; v_own uuid; v_barber uuid;
  v_from timestamptz; v_to timestamptz; v_today date; v_result jsonb;
begin
  if (select auth.uid()) is null or not app_private.has_module(p_barbershop_id, 'reports') then
    raise exception 'Report access denied' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 370 then
    raise exception 'Invalid report period' using errcode = '22023';
  end if;
  select b.timezone into v_tz from public.barbershops b where b.id = p_barbershop_id;
  if v_tz is null then raise exception 'Barbershop not found' using errcode = '22023'; end if;
  v_admin := app_private.has_shop_role(p_barbershop_id, array['admin']::public.shop_role[]);
  if v_admin then
    if p_barber_membership_id is not null and not exists (
      select 1 from public.memberships m where m.barbershop_id = p_barbershop_id and m.id = p_barber_membership_id and m.role = 'barber') then
      raise exception 'Barber not found in this shop' using errcode = '22023';
    end if;
    v_barber := p_barber_membership_id;
  else
    select m.id into v_own from public.memberships m
      where m.barbershop_id = p_barbershop_id and m.user_id = (select auth.uid()) and m.role = 'barber' and m.active;
    if v_own is null or (p_barber_membership_id is not null and p_barber_membership_id <> v_own) then
      raise exception 'Report access denied' using errcode = '42501';
    end if;
    v_barber := v_own;
  end if;
  v_from := p_from::timestamp at time zone v_tz;
  v_to := (p_to + 1)::timestamp at time zone v_tz;
  v_today := (now() at time zone v_tz)::date;

  if p_kind = 'birthdays' then
    with visits as (
      select a.client_id, max(a.starts_at) as last_visit, count(*) as visits
      from public.appointments a where a.barbershop_id = p_barbershop_id and a.status = 'completed' group by 1
    )
    select coalesce(jsonb_agg(to_jsonb(q) order by q.birthday, q.full_name), '[]'::jsonb) into v_result from (
      select c.id, c.full_name, c.phone, c.birth_date, bd.day as birthday,
        extract(year from bd.day)::integer - extract(year from c.birth_date)::integer as age,
        v.last_visit, coalesce(v.visits, 0) as visits
      from public.clients c
        cross join lateral (
          select z.day from (
            select make_date(y, extract(month from c.birth_date)::integer,
              least(extract(day from c.birth_date)::integer,
                extract(day from (make_date(y, extract(month from c.birth_date)::integer, 1) + interval '1 month' - interval '1 day'))::integer)) as day
            from generate_series(extract(year from p_from)::integer, extract(year from p_to)::integer) as y
          ) z where z.day between p_from and p_to order by z.day limit 1
        ) bd
        left join visits v on v.client_id = c.id
      where c.barbershop_id = p_barbershop_id and c.birth_date is not null
        and (v_barber is null or exists (select 1 from public.client_barbers cb
          where cb.barbershop_id = c.barbershop_id and cb.client_id = c.id and cb.barber_membership_id = v_barber))
      order by bd.day, c.full_name limit 2000
    ) q;

  elsif p_kind = 'absent' then
    with visits as (
      select a.client_id, max(a.starts_at) as last_visit, count(*) as visits,
        (array_agg(a.barber_membership_id order by a.starts_at desc))[1] as last_barber
      from public.appointments a where a.barbershop_id = p_barbershop_id and a.status = 'completed' group by 1
    ), upcoming as (
      select distinct a.client_id from public.appointments a
      where a.barbershop_id = p_barbershop_id and a.status in ('pending', 'confirmed', 'in_progress') and a.starts_at >= now()
    )
    select coalesce(jsonb_agg(to_jsonb(q) order by q.last_visit desc), '[]'::jsonb) into v_result from (
      select c.id, c.full_name, c.phone, v.last_visit, v_today - (v.last_visit at time zone v_tz)::date as days_absent, v.visits,
        coalesce(nullif(btrim(m.display_name), ''), '—') as last_barber,
        exists (select 1 from public.subscriptions s where s.barbershop_id = c.barbershop_id and s.client_id = c.id
          and s.status in ('active', 'authorized') and (s.current_period_end is null or s.current_period_end > now())) as subscriber
      from visits v
        join public.clients c on c.barbershop_id = p_barbershop_id and c.id = v.client_id
        left join public.memberships m on m.id = v.last_barber
      where (v.last_visit at time zone v_tz)::date <= v_today - greatest(1, least(coalesce(p_days, 45), 3650))
        and not exists (select 1 from upcoming u where u.client_id = v.client_id)
        and (v_barber is null or v.last_barber = v_barber)
      order by v.last_visit desc limit 1500
    ) q;

  elsif p_kind = 'acquisition' then
    with fresh as (
      select c.*, exists (select 1 from public.appointments a
          where a.barbershop_id = c.barbershop_id and a.client_id = c.id and a.status = 'completed') as visited
      from public.clients c
      where c.barbershop_id = p_barbershop_id and c.created_at >= v_from and c.created_at < v_to
        and (v_barber is null or exists (select 1 from public.client_barbers cb
          where cb.barbershop_id = c.barbershop_id and cb.client_id = c.id and cb.barber_membership_id = v_barber))
    )
    select jsonb_build_object(
      'total', (select count(*) from fresh),
      'sources', (select coalesce(jsonb_agg(to_jsonb(s) order by s.clients desc, s.source), '[]'::jsonb) from (
        select coalesce(nullif(btrim(f.acquisition_source), ''), 'Não informado') as source, count(*) as clients, count(*) filter (where f.visited) as visited
        from fresh f group by 1) s),
      'referrers', (select coalesce(jsonb_agg(to_jsonb(r) order by r.clients desc, r.name), '[]'::jsonb) from (
        select btrim(f.referred_by) as name, count(*) as clients from fresh f
        where nullif(btrim(f.referred_by), '') is not null group by 1 order by 2 desc limit 50) r),
      'clients', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'full_name', l.full_name, 'phone', l.phone, 'created_at', l.created_at,
          'source', l.acquisition_source, 'referred_by', l.referred_by, 'visited', l.visited) order by l.created_at desc), '[]'::jsonb)
        from (select * from fresh order by created_at desc limit 1500) l)
    ) into v_result;

  elsif p_kind = 'frequency' then
    with visits as (
      select a.client_id, count(*) as visits, count(distinct (a.starts_at at time zone v_tz)::date) as days,
        min(a.starts_at) as first_visit, max(a.starts_at) as last_visit
      from public.appointments a
      where a.barbershop_id = p_barbershop_id and a.status = 'completed' and a.starts_at >= v_from and a.starts_at < v_to
        and (v_barber is null or a.barber_membership_id = v_barber)
      group by 1
    ), paid as (
      select pay.client_id, sum(pay.amount_cents) as paid_cents from public.payments pay
      where pay.barbershop_id = p_barbershop_id and pay.status = 'paid' and pay.client_id is not null
        and pay.paid_at >= v_from and pay.paid_at < v_to group by 1
    )
    select coalesce(jsonb_agg(to_jsonb(q) order by q.visits desc, q.full_name), '[]'::jsonb) into v_result from (
      select c.id, c.full_name, c.phone, v.visits, v.days, v.last_visit,
        case when v.days > 1 then round(((v.last_visit at time zone v_tz)::date - (v.first_visit at time zone v_tz)::date)::numeric / (v.days - 1), 1) end as interval_days,
        case when v_admin and v_barber is null then coalesce(p.paid_cents, 0) end as paid_cents,
        exists (select 1 from public.subscriptions s where s.barbershop_id = c.barbershop_id and s.client_id = c.id
          and s.status in ('active', 'authorized') and (s.current_period_end is null or s.current_period_end > now())) as subscriber
      from visits v
        join public.clients c on c.barbershop_id = p_barbershop_id and c.id = v.client_id
        left join paid p on p.client_id = v.client_id
      order by v.visits desc, c.full_name limit 1500
    ) q;

  elsif p_kind = 'services' then
    select coalesce(jsonb_agg(to_jsonb(q) order by q.quantity desc, q.name), '[]'::jsonb) into v_result from (
      select s.id, s.name, s.category, count(*) as quantity,
        count(*) filter (where a.subscription_id is not null or x.price_cents = 0) as plan_covered,
        coalesce(sum(x.price_cents), 0) as revenue_cents, count(distinct a.client_id) as clients
      from public.appointment_services x
        join public.appointments a on a.barbershop_id = x.barbershop_id and a.id = x.appointment_id
        join public.services s on s.barbershop_id = x.barbershop_id and s.id = x.service_id
      where x.barbershop_id = p_barbershop_id and a.status = 'completed' and a.starts_at >= v_from and a.starts_at < v_to
        and (v_barber is null or a.barber_membership_id = v_barber)
      group by s.id, s.name, s.category
    ) q;

  elsif p_kind = 'origin' then
    with base as (
      select a.id, a.status,
        coalesce(a.booking_origin, case when a.import_source is not null then 'unknown' when a.source = 'client' then 'app' else 'reception' end) as origin
      from public.appointments a
      where a.barbershop_id = p_barbershop_id and a.starts_at >= v_from and a.starts_at < v_to
        and (v_barber is null or a.barber_membership_id = v_barber)
    ), paid as (
      select pay.appointment_id, sum(pay.amount_cents) as paid_cents from public.payments pay
      where pay.barbershop_id = p_barbershop_id and pay.status = 'paid' and pay.appointment_id is not null group by 1
    )
    select coalesce(jsonb_agg(to_jsonb(q) order by q.total desc), '[]'::jsonb) into v_result from (
      select b.origin as id, b.origin, count(*) as total,
        count(*) filter (where b.status = 'completed') as completed,
        count(*) filter (where b.status = 'cancelled') as cancelled,
        count(*) filter (where b.status = 'no_show') as no_show,
        case when v_admin then coalesce(sum(p.paid_cents), 0) end as paid_cents
      from base b left join paid p on p.appointment_id = b.id group by b.origin
    ) q;

  elsif p_kind = 'refunds' then
    if not v_admin then raise exception 'Report access denied' using errcode = '42501'; end if;
    select coalesce(jsonb_agg(to_jsonb(q) order by q.refunded_at desc), '[]'::jsonb) into v_result from (
      select pay.id, coalesce(cm.created_at, pay.updated_at) as refunded_at, pay.paid_at, pay.amount_cents, pay.method, pay.status, pay.provider,
        c.full_name as client_name, cm.notes as reason,
        case when pay.subscription_id is not null then 'subscription' when pay.sale_id is not null then 'sale'
          when pay.appointment_id is not null then 'appointment' else 'other' end as origin,
        (select coalesce(nullif(btrim(m.display_name), ''), pr.full_name) from public.memberships m left join public.profiles pr on pr.user_id = m.user_id
          where m.barbershop_id = pay.barbershop_id and m.user_id = cm.actor_id order by (m.role = 'admin') desc limit 1) as actor_name
      from public.payments pay
        left join public.clients c on c.id = pay.client_id
        left join lateral (select m2.created_at, m2.notes, m2.actor_id from public.cash_movements m2
          where m2.barbershop_id = pay.barbershop_id and m2.payment_id = pay.id and m2.kind = 'refund' order by m2.created_at desc limit 1) cm on true
      where pay.barbershop_id = p_barbershop_id and pay.status in ('refunded', 'charged_back')
        and coalesce(cm.created_at, pay.updated_at) >= v_from and coalesce(cm.created_at, pay.updated_at) < v_to
      order by 2 desc limit 1500
    ) q;

  else
    raise exception 'Unknown report' using errcode = '22023';
  end if;
  return v_result;
end $function$;
revoke all on function public.report_extra(uuid, text, date, date, uuid, integer) from public, anon, authenticated;
grant execute on function public.report_extra(uuid, text, date, date, uuid, integer) to authenticated;

-- Filiais: resumo das barbearias em que a pessoa é administradora, para comparar unidades.
create or replace function public.network_overview(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path to ''
as $function$
declare v_user uuid := (select auth.uid()); v_result jsonb;
begin
  if v_user is null then raise exception 'Entre na sua conta.' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 370 then
    raise exception 'Período inválido.' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(to_jsonb(q) order by q.revenue_cents desc, q.name), '[]'::jsonb) into v_result from (
    select b.id, b.name, b.slug,
      (select coalesce(sum(pay.amount_cents), 0) from public.payments pay where pay.barbershop_id = b.id and pay.status = 'paid'
        and pay.paid_at >= p_from::timestamp at time zone b.timezone and pay.paid_at < (p_to + 1)::timestamp at time zone b.timezone) as revenue_cents,
      (select count(*) from public.appointments a where a.barbershop_id = b.id and a.status = 'completed'
        and a.starts_at >= p_from::timestamp at time zone b.timezone and a.starts_at < (p_to + 1)::timestamp at time zone b.timezone) as completed,
      (select count(*) from public.subscriptions s where s.barbershop_id = b.id and s.status in ('active', 'authorized')
        and (s.current_period_end is null or s.current_period_end > now())) as active_plans,
      (select count(*) from public.clients c where c.barbershop_id = b.id
        and c.created_at >= p_from::timestamp at time zone b.timezone and c.created_at < (p_to + 1)::timestamp at time zone b.timezone) as new_clients
    from public.barbershops b
    where b.active and exists (select 1 from public.memberships m
      where m.barbershop_id = b.id and m.user_id = v_user and m.role = 'admin' and m.active)
  ) q;
  return v_result;
end $function$;
revoke all on function public.network_overview(date, date) from public, anon, authenticated;
grant execute on function public.network_overview(date, date) to authenticated;
