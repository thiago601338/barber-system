-- Count the whole tenant, not just the 500 rows fetched by the dashboard.
create or replace function public.partner_program_stats(p_barbershop_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_result jsonb;
  v_active_partners bigint;
  v_active_offers bigint;
begin
  if not app_private.has_shop_role(
    p_barbershop_id, array['admin']::public.shop_role[]
  ) then
    raise exception 'Acesso negado às estatísticas de parceiros'
      using errcode = '42501';
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
    and (o.ends_on is null or o.ends_on >= (now() at time zone sh.timezone)::date);

  with per_partner as (
    select p.id, p.name,
      count(r.id) filter (where a.status <> 'cancelled') as reservations,
      count(r.id) filter (where a.status = 'completed') as completed_visits,
      coalesce(sum(r.subtotal_cents) filter
        (where a.status <> 'cancelled'), 0)::bigint as subtotal_cents,
      coalesce(sum(r.discount_cents) filter
        (where a.status <> 'cancelled'), 0)::bigint as discount_cents,
      coalesce(sum(r.total_cents) filter
        (where a.status <> 'cancelled'), 0)::bigint as total_cents
    from public.partners p
    left join public.partner_redemptions r
      on r.barbershop_id = p.barbershop_id and r.partner_id = p.id
    left join public.appointments a
      on a.barbershop_id = r.barbershop_id and a.id = r.appointment_id
    where p.barbershop_id = p_barbershop_id
    group by p.id, p.name
  )
  select jsonb_build_object(
    'active_partners', v_active_partners,
    'active_offers', v_active_offers,
    'reservations', coalesce(sum(x.reservations), 0),
    'completed_visits', coalesce(sum(x.completed_visits), 0),
    'subtotal_cents', coalesce(sum(x.subtotal_cents), 0),
    'discount_cents', coalesce(sum(x.discount_cents), 0),
    'total_cents', coalesce(sum(x.total_cents), 0),
    'by_partner', coalesce(jsonb_agg(jsonb_build_object(
      'partner_id', x.id, 'partner_name', x.name,
      'reservations', x.reservations,
      'completed_visits', x.completed_visits,
      'subtotal_cents', x.subtotal_cents,
      'discount_cents', x.discount_cents,
      'total_cents', x.total_cents
    ) order by x.name, x.id), '[]'::jsonb)
  ) into v_result
  from per_partner x;
  return v_result;
end;
$$;
