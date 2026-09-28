-- Calculate every visible goal from complete, indexed source data in the shop's timezone.
-- A barber sees shop targets, but shop-wide progress is reserved for administrators.
create function public.goal_progress(p_barbershop_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_timezone text;
  v_can_view_all boolean;
  v_own_barber_id uuid;
  v_goal public.goals%rowtype;
  v_from timestamptz;
  v_to timestamptz;
  v_current numeric;
  v_revenue_cents bigint;
  v_expense_cents bigint;
  v_structure_cents numeric;
  v_eligible bigint;
  v_returned bigint;
  v_result jsonb := '[]'::jsonb;
begin
  if (select auth.uid()) is null
    or not app_private.has_module(p_barbershop_id, 'goals') then
    raise exception 'Goal access denied' using errcode = '42501';
  end if;
  select b.timezone into v_timezone
  from public.barbershops b where b.id = p_barbershop_id and b.active;
  if v_timezone is null then
    raise exception 'Barbershop not found' using errcode = '22023';
  end if;
  v_can_view_all := app_private.has_shop_role(
    p_barbershop_id, array['admin']::public.shop_role[]);
  if not v_can_view_all then
    select m.id into v_own_barber_id
    from public.memberships m
    where m.barbershop_id = p_barbershop_id
      and m.user_id = (select auth.uid())
      and m.role = 'barber' and m.active;
    if v_own_barber_id is null then
      raise exception 'Goal access denied' using errcode = '42501';
    end if;
  end if;

  for v_goal in
    select g.* from public.goals g
    where g.barbershop_id = p_barbershop_id
      and (v_can_view_all or g.barber_membership_id is null
        or g.barber_membership_id = v_own_barber_id)
    order by g.period_start desc, g.created_at desc, g.id
  loop
    v_current := null;
    if v_can_view_all or v_goal.barber_membership_id = v_own_barber_id then
      v_from := v_goal.period_start::timestamp at time zone v_timezone;
      v_to := (v_goal.period_end + 1)::timestamp at time zone v_timezone;

      if v_goal.metric = 'appointments' then
        select count(*)::numeric into v_current
        from public.appointments a
        where a.barbershop_id = p_barbershop_id
          and a.status = 'completed'
          and a.starts_at >= v_from and a.starts_at < v_to
          and (v_goal.barber_membership_id is null
            or a.barber_membership_id = v_goal.barber_membership_id);
      elsif v_goal.metric = 'revenue' then
        select coalesce(sum(p.amount_cents), 0)::numeric / 100 into v_current
        from public.payments p
        left join public.appointments a
          on a.barbershop_id = p.barbershop_id and a.id = p.appointment_id
        where p.barbershop_id = p_barbershop_id
          and p.status = 'paid'
          and p.paid_at >= v_from and p.paid_at < v_to
          and (v_goal.barber_membership_id is null
            or a.barber_membership_id = v_goal.barber_membership_id);
      elsif v_goal.metric = 'new_clients' then
        select count(*)::numeric into v_current
        from public.clients c
        where c.barbershop_id = p_barbershop_id
          and c.created_at >= v_from and c.created_at < v_to
          and (v_goal.barber_membership_id is null or exists (
            select 1 from public.client_barbers cb
            where cb.barbershop_id = c.barbershop_id
              and cb.client_id = c.id
              and cb.barber_membership_id = v_goal.barber_membership_id
          ));
      elsif v_goal.metric = 'client_return_pct' then
        with first_visits as (
          select distinct on (a.client_id)
            a.client_id, a.barber_membership_id, a.starts_at
          from public.appointments a
          where a.barbershop_id = p_barbershop_id and a.status = 'completed'
          order by a.client_id, a.starts_at
        ), eligible as (
          select f.client_id, f.starts_at from first_visits f
          where f.starts_at >= v_from and f.starts_at < v_to
            and f.starts_at <= now() - interval '30 days'
            and (v_goal.barber_membership_id is null
              or f.barber_membership_id = v_goal.barber_membership_id)
        )
        select count(*), count(*) filter (where exists (
          select 1 from public.appointments followup
          where followup.barbershop_id = p_barbershop_id
            and followup.client_id = eligible.client_id
            and followup.status = 'completed'
            and followup.starts_at > eligible.starts_at
            and followup.starts_at <= eligible.starts_at + interval '30 days'
        )) into v_eligible, v_returned
        from eligible;
        v_current := case when v_eligible = 0 then null
          else round(v_returned::numeric * 100 / v_eligible, 2) end;
      elsif v_goal.metric = 'profit_pct' and v_can_view_all
        and v_goal.barber_membership_id is null then
        select coalesce(sum(p.amount_cents), 0) into v_revenue_cents
        from public.payments p
        where p.barbershop_id = p_barbershop_id and p.status = 'paid'
          and p.paid_at >= v_from and p.paid_at < v_to;
        select coalesce(sum(e.amount_cents), 0) into v_expense_cents
        from public.expenses e
        where e.barbershop_id = p_barbershop_id
          and e.occurred_on >= v_goal.period_start
          and e.occurred_on <= v_goal.period_end;
        select coalesce(sum(
          b.structure_monthly_cost_cents::numeric
          * (least(v_goal.period_end, (months.month_start + interval '1 month - 1 day')::date)
            - greatest(v_goal.period_start, months.month_start::date) + 1)
          / ((months.month_start + interval '1 month')::date - months.month_start::date)
        ), 0) into v_structure_cents
        from public.barbershops b
        cross join pg_catalog.generate_series(
          pg_catalog.date_trunc('month', v_goal.period_start::timestamp),
          pg_catalog.date_trunc('month', v_goal.period_end::timestamp),
          interval '1 month'
        ) as months(month_start)
        where b.id = p_barbershop_id;
        v_current := case when v_revenue_cents = 0 then null
          else round((v_revenue_cents - v_expense_cents - v_structure_cents)
            * 100 / v_revenue_cents, 2) end;
      end if;
    end if;
    v_result := v_result || pg_catalog.jsonb_build_array(
      to_jsonb(v_goal) || pg_catalog.jsonb_build_object('current_value', v_current));
  end loop;
  return v_result;
end;
$$;

revoke execute on function public.goal_progress(uuid)
  from public, anon, authenticated;
grant execute on function public.goal_progress(uuid) to authenticated;
