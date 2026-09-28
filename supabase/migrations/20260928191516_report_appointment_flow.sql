-- Report-only access to attendance aggregates. A barber may open Reports even
-- when the Agenda tab is disabled; this RPC never exposes other barbers' visits.
create function public.report_appointment_flow(
  p_barbershop_id uuid,
  p_from date,
  p_to date,
  p_barber_membership_id uuid default null
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_timezone text;
  v_barber_id uuid;
  v_own_barber_id uuid;
  v_result jsonb;
begin
  if (select auth.uid()) is null
    or not app_private.has_module(p_barbershop_id, 'reports') then
    raise exception 'Report access denied' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 370 then
    raise exception 'Invalid report period' using errcode = '22023';
  end if;
  select b.timezone into v_timezone
  from public.barbershops b where b.id = p_barbershop_id;
  if v_timezone is null then
    raise exception 'Barbershop not found' using errcode = '22023';
  end if;

  if app_private.has_shop_role(p_barbershop_id, array['admin']::public.shop_role[]) then
    if p_barber_membership_id is not null and not exists (
      select 1 from public.memberships m
      where m.barbershop_id = p_barbershop_id
        and m.id = p_barber_membership_id and m.role = 'barber'
    ) then
      raise exception 'Barber not found in this shop' using errcode = '22023';
    end if;
    v_barber_id := p_barber_membership_id;
  else
    select m.id into v_own_barber_id
    from public.memberships m
    where m.barbershop_id = p_barbershop_id
      and m.user_id = (select auth.uid())
      and m.role = 'barber' and m.active;
    if v_own_barber_id is null
      or (p_barber_membership_id is not null and p_barber_membership_id <> v_own_barber_id) then
      raise exception 'Report access denied' using errcode = '42501';
    end if;
    v_barber_id := v_own_barber_id;
  end if;

  select coalesce(jsonb_agg(to_jsonb(grouped) order by grouped.day, grouped.hour), '[]'::jsonb)
  into v_result
  from (
    select
      (a.starts_at at time zone v_timezone)::date as day,
      extract(hour from a.starts_at at time zone v_timezone)::integer as hour,
      count(*)::bigint as completed_count
    from public.appointments a
    where a.barbershop_id = p_barbershop_id
      and a.status = 'completed'
      and a.starts_at >= p_from::timestamp at time zone v_timezone
      and a.starts_at < (p_to + 1)::timestamp at time zone v_timezone
      and (v_barber_id is null or a.barber_membership_id = v_barber_id)
    group by 1, 2
  ) grouped;
  return v_result;
end;
$$;

revoke execute on function public.report_appointment_flow(uuid,date,date,uuid)
  from public, anon, authenticated;
grant execute on function public.report_appointment_flow(uuid,date,date,uuid)
  to authenticated;
