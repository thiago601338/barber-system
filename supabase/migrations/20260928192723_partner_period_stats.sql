-- Counts are grouped by appointment date in the barbershop's timezone.
-- These are reservation values, not collected revenue or ad conversions.
create function public.partner_program_stats(
  p_barbershop_id uuid,
  p_from date,
  p_to date
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_result jsonb;
  v_timezone text;
  v_active_partners bigint;
  v_active_offers bigint;
begin
  if not app_private.has_shop_role(
    p_barbershop_id, array['admin']::public.shop_role[]
  ) then
    raise exception 'Acesso negado às estatísticas de parceiros'
      using errcode = '42501';
  end if;
  if (p_from is null) <> (p_to is null)
     or (p_from is not null and (p_to < p_from or p_to - p_from >= 370)) then
    raise exception 'Informe um período de até 370 dias'
      using errcode = '22023';
  end if;
  select sh.timezone into v_timezone
  from public.barbershops sh where sh.id = p_barbershop_id;
  if not found then
    raise exception 'Barbearia inexistente' using errcode = '22023';
  end if;

  select count(*) into v_active_partners
  from public.partners p
  where p.barbershop_id = p_barbershop_id and p.active;

  select count(*) into v_active_offers
  from public.partner_offers o
  join public.partners p
    on p.barbershop_id = o.barbershop_id and p.id = o.partner_id
  join public.barbershops sh on sh.id = o.barbershop_id
  where o.barbershop_id = p_barbershop_id
    and o.active and p.active and sh.active
    and o.starts_on <= (now() at time zone sh.timezone)::date
    and (o.ends_on is null or o.ends_on >= (now() at time zone sh.timezone)::date)
    and (o.usage_limit is null or (
      select count(*) from public.partner_redemptions r
      join public.appointments a
        on a.barbershop_id = r.barbershop_id and a.id = r.appointment_id
      where r.barbershop_id = o.barbershop_id
        and r.offer_id = o.id and a.status <> 'cancelled'
    ) < o.usage_limit);

  with filtered as (
    select r.id, r.partner_id, r.offer_id,
      r.subtotal_cents, r.discount_cents, r.total_cents, a.status
    from public.partner_redemptions r
    join public.appointments a
      on a.barbershop_id = r.barbershop_id and a.id = r.appointment_id
    where r.barbershop_id = p_barbershop_id
      and (p_from is null or (a.starts_at at time zone v_timezone)::date >= p_from)
      and (p_to is null or (a.starts_at at time zone v_timezone)::date <= p_to)
  ),
  per_partner as (
    select p.id, p.name,
      count(f.id) filter (where f.status <> 'cancelled') as reservations,
      count(f.id) filter (where f.status = 'completed') as completed_visits,
      coalesce(sum(f.subtotal_cents) filter
        (where f.status <> 'cancelled'), 0)::bigint as subtotal_cents,
      coalesce(sum(f.discount_cents) filter
        (where f.status <> 'cancelled'), 0)::bigint as discount_cents,
      coalesce(sum(f.total_cents) filter
        (where f.status <> 'cancelled'), 0)::bigint as total_cents
    from public.partners p
    left join filtered f on f.partner_id = p.id
    where p.barbershop_id = p_barbershop_id
    group by p.id, p.name
  ),
  per_offer as (
    select o.id, o.partner_id, p.name as partner_name, o.title, o.code,
      count(f.id) filter (where f.status <> 'cancelled') as reservations,
      count(f.id) filter (where f.status = 'completed') as completed_visits,
      coalesce(sum(f.subtotal_cents) filter
        (where f.status <> 'cancelled'), 0)::bigint as subtotal_cents,
      coalesce(sum(f.discount_cents) filter
        (where f.status <> 'cancelled'), 0)::bigint as discount_cents,
      coalesce(sum(f.total_cents) filter
        (where f.status <> 'cancelled'), 0)::bigint as total_cents
    from public.partner_offers o
    join public.partners p
      on p.barbershop_id = o.barbershop_id and p.id = o.partner_id
    left join filtered f on f.offer_id = o.id
    where o.barbershop_id = p_barbershop_id
    group by o.id, o.partner_id, p.name, o.title, o.code
  )
  select jsonb_build_object(
    'active_partners', v_active_partners,
    'active_offers', v_active_offers,
    'reservations', (select coalesce(sum(x.reservations), 0) from per_partner x),
    'completed_visits', (select coalesce(sum(x.completed_visits), 0) from per_partner x),
    'subtotal_cents', (select coalesce(sum(x.subtotal_cents), 0) from per_partner x),
    'discount_cents', (select coalesce(sum(x.discount_cents), 0) from per_partner x),
    'total_cents', (select coalesce(sum(x.total_cents), 0) from per_partner x),
    'by_partner', (select coalesce(jsonb_agg(jsonb_build_object(
      'partner_id', x.id, 'partner_name', x.name,
      'reservations', x.reservations,
      'completed_visits', x.completed_visits,
      'subtotal_cents', x.subtotal_cents,
      'discount_cents', x.discount_cents,
      'total_cents', x.total_cents
    ) order by x.name, x.id), '[]'::jsonb) from per_partner x),
    'by_offer', (select coalesce(jsonb_agg(jsonb_build_object(
      'offer_id', x.id, 'partner_id', x.partner_id,
      'partner_name', x.partner_name, 'title', x.title, 'code', x.code,
      'reservations', x.reservations,
      'completed_visits', x.completed_visits,
      'subtotal_cents', x.subtotal_cents,
      'discount_cents', x.discount_cents,
      'total_cents', x.total_cents
    ) order by x.partner_name, x.title, x.id), '[]'::jsonb) from per_offer x)
  ) into v_result;
  return v_result;
end;
$$;
revoke execute on function public.partner_program_stats(uuid,date,date)
  from public, anon, authenticated;
grant execute on function public.partner_program_stats(uuid,date,date)
  to authenticated;

-- Keep the existing one-argument RPC for pages that show lifetime totals.
create or replace function public.partner_program_stats(p_barbershop_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select public.partner_program_stats(p_barbershop_id, null::date, null::date);
$$;

create function public.partner_program_redemptions(
  p_barbershop_id uuid,
  p_from date,
  p_to date
)
returns table (
  id uuid, partner_id uuid, offer_id uuid, code_snapshot text,
  appointment_starts_at timestamptz,
  appointment_status public.appointment_status,
  subtotal_cents integer, discount_cents integer, total_cents integer
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_timezone text;
begin
  if not app_private.has_shop_role(
    p_barbershop_id, array['admin']::public.shop_role[]
  ) then
    raise exception 'Acesso negado às reservas de parceiros'
      using errcode = '42501';
  end if;
  if (p_from is null) <> (p_to is null)
     or (p_from is not null and (p_to < p_from or p_to - p_from >= 370)) then
    raise exception 'Informe um período de até 370 dias'
      using errcode = '22023';
  end if;
  select sh.timezone into v_timezone
  from public.barbershops sh where sh.id = p_barbershop_id;
  if not found then
    raise exception 'Barbearia inexistente' using errcode = '22023';
  end if;
  return query
    select r.id, r.partner_id, r.offer_id, r.code_snapshot,
      a.starts_at, a.status, r.subtotal_cents,
      r.discount_cents, r.total_cents
    from public.partner_redemptions r
    join public.appointments a
      on a.barbershop_id = r.barbershop_id and a.id = r.appointment_id
    where r.barbershop_id = p_barbershop_id
      and (p_from is null or (a.starts_at at time zone v_timezone)::date >= p_from)
      and (p_to is null or (a.starts_at at time zone v_timezone)::date <= p_to)
    order by r.created_at desc, r.id desc
    limit 500;
end;
$$;
revoke execute on function public.partner_program_redemptions(uuid,date,date)
  from public, anon, authenticated;
grant execute on function public.partner_program_redemptions(uuid,date,date)
  to authenticated;
