-- Existing redemptions have no trustworthy historical terms; leave their
-- snapshot null. Every booking through the RPC below records the offer as it
-- stood when the customer confirmed the appointment.
alter table public.partner_redemptions
  add column offer_snapshot jsonb,
  add constraint partner_redemptions_offer_snapshot_object
    check (offer_snapshot is null or jsonb_typeof(offer_snapshot) = 'object');

-- Keep period totals unchanged, while exposing all-time non-cancelled uses
-- for each offer so the administration can distinguish active from exhausted.
create or replace function public.partner_program_stats(
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
  lifetime as (
    select r.offer_id, count(*)::bigint as uses
    from public.partner_redemptions r
    join public.appointments a
      on a.barbershop_id = r.barbershop_id and a.id = r.appointment_id
    where r.barbershop_id = p_barbershop_id and a.status <> 'cancelled'
    group by r.offer_id
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
      coalesce(l.uses, 0)::bigint as lifetime_uses,
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
    left join lifetime l on l.offer_id = o.id
    left join filtered f on f.offer_id = o.id
    where o.barbershop_id = p_barbershop_id
    group by o.id, o.partner_id, p.name, o.title, o.code, l.uses
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
      'lifetime_uses', x.lifetime_uses,
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

-- The quote has already locked the offer and the chosen services. Capture
-- their exact conditions in the same transaction as the appointment.
create or replace function public.book_partner_appointment(
  p_barbershop_id uuid,
  p_client_id uuid,
  p_barber_membership_id uuid,
  p_service_ids uuid[],
  p_starts_at timestamptz,
  p_code text,
  p_expected_subtotal_cents integer,
  p_expected_discount_cents integer,
  p_expected_total_cents integer
)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_quote jsonb;
  v_offer public.partner_offers%rowtype;
  v_partner_name text;
  v_service_name text;
  v_timezone text;
  v_snapshot jsonb;
  v_appointment_id uuid;
begin
  v_quote := app_private.partner_offer_quote(
    p_barbershop_id, p_client_id, p_service_ids, p_starts_at, p_code, true
  );
  if p_expected_subtotal_cents is distinct from (v_quote ->> 'subtotal_cents')::integer
     or p_expected_discount_cents is distinct from (v_quote ->> 'discount_cents')::integer
     or p_expected_total_cents is distinct from (v_quote ->> 'total_cents')::integer then
    raise exception 'Preço ou benefício mudou. Aplique o cupom novamente antes de confirmar.'
      using errcode = 'P2001';
  end if;

  select o.* into strict v_offer
  from public.partner_offers o
  where o.barbershop_id = p_barbershop_id
    and o.id = (v_quote ->> 'offer_id')::uuid;
  v_partner_name := v_quote ->> 'partner_name';
  if v_offer.service_id is not null then
    select s.name into strict v_service_name
    from public.services s
    where s.barbershop_id = p_barbershop_id and s.id = v_offer.service_id;
  end if;
  select sh.timezone into strict v_timezone
  from public.barbershops sh where sh.id = p_barbershop_id;
  v_snapshot := jsonb_build_object(
    'schema_version', 1,
    'offer_id', v_offer.id,
    'partner_id', v_offer.partner_id,
    'partner_name', v_partner_name,
    'title', v_offer.title,
    'code', v_offer.code,
    'description', v_offer.description,
    'terms', v_offer.terms,
    'service_id', v_offer.service_id,
    'service_name', v_service_name,
    'discount_bps', v_offer.discount_bps,
    'discount_cents', v_offer.discount_cents,
    'max_discount_cents', v_offer.max_discount_cents,
    'min_spend_cents', v_offer.min_spend_cents,
    'starts_on', v_offer.starts_on,
    'ends_on', v_offer.ends_on,
    'usage_limit', v_offer.usage_limit,
    'per_client_limit', v_offer.per_client_limit,
    'active', v_offer.active,
    'shop_timezone', v_timezone,
    'selected_service_ids', p_service_ids,
    'subtotal_cents', (v_quote ->> 'subtotal_cents')::integer,
    'eligible_subtotal_cents', (v_quote ->> 'eligible_subtotal_cents')::integer,
    'applied_discount_cents', (v_quote ->> 'discount_cents')::integer,
    'total_cents', (v_quote ->> 'total_cents')::integer
  );

  v_appointment_id := app_private.book_appointment(
    p_barbershop_id, p_client_id, p_barber_membership_id,
    p_service_ids, p_starts_at, null
  );
  update public.appointments a
  set total_price_cents = (v_quote ->> 'total_cents')::integer
  where a.barbershop_id = p_barbershop_id and a.id = v_appointment_id;
  insert into public.partner_redemptions (
    barbershop_id, offer_id, partner_id, client_id, appointment_id,
    code_snapshot, subtotal_cents, eligible_subtotal_cents,
    discount_cents, total_cents, offer_snapshot
  ) values (
    p_barbershop_id, (v_quote ->> 'offer_id')::uuid,
    (v_quote ->> 'partner_id')::uuid, p_client_id, v_appointment_id,
    v_quote ->> 'code', (v_quote ->> 'subtotal_cents')::integer,
    (v_quote ->> 'eligible_subtotal_cents')::integer,
    (v_quote ->> 'discount_cents')::integer,
    (v_quote ->> 'total_cents')::integer, v_snapshot
  );
  return (v_quote - 'eligible_subtotal_cents' - 'partner_id')
    || jsonb_build_object('appointment_id', v_appointment_id);
end;
$$;
revoke execute on function public.book_partner_appointment(uuid,uuid,uuid,uuid[],timestamptz,text,integer,integer,integer)
  from public, anon, authenticated;
grant execute on function public.book_partner_appointment(uuid,uuid,uuid,uuid[],timestamptz,text,integer,integer,integer)
  to authenticated;
