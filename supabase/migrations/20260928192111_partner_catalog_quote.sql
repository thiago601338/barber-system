-- Public catalogue hides globally exhausted offers; booking keeps the row lock as final authority.
create or replace function public.list_partner_offers(p_barbershop_id uuid)
returns table (
  id uuid, partner_id uuid, partner_name text, partner_logo_url text,
  title text, code text, description text, terms text, service_id uuid,
  discount_bps integer, discount_cents integer, max_discount_cents integer,
  min_spend_cents integer, starts_on date, ends_on date,
  usage_limit integer, per_client_limit integer
)
language sql stable security definer set search_path = ''
as $$
  select o.id, p.id, p.name, p.logo_url, o.title, o.code,
         o.description, o.terms, o.service_id, o.discount_bps,
         o.discount_cents, o.max_discount_cents, o.min_spend_cents,
         o.starts_on, o.ends_on, o.usage_limit, o.per_client_limit
  from public.partner_offers o
  join public.partners p
    on p.barbershop_id = o.barbershop_id and p.id = o.partner_id
  join public.barbershops sh on sh.id = o.barbershop_id
  where o.barbershop_id = p_barbershop_id
    and sh.active and p.active and o.active
    and o.starts_on <= (now() at time zone sh.timezone)::date
    and (o.ends_on is null or o.ends_on >= (now() at time zone sh.timezone)::date)
    and (o.usage_limit is null or (
      select count(*)
      from public.partner_redemptions r
      join public.appointments a
        on a.barbershop_id = r.barbershop_id and a.id = r.appointment_id
      where r.barbershop_id = o.barbershop_id
        and r.offer_id = o.id
        and a.status <> 'cancelled'
    ) < o.usage_limit)
  order by p.name, o.title, o.id;
$$;

-- Preview works before a new authenticated customer creates the client record.
create or replace function app_private.partner_offer_quote(
  p_barbershop_id uuid,
  p_client_id uuid,
  p_service_ids uuid[],
  p_starts_at timestamptz,
  p_code text,
  p_lock boolean default false
)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_offer public.partner_offers%rowtype;
  v_effective_client_id uuid;
  v_partner_name text;
  v_timezone text;
  v_slot_day date;
  v_service_count integer;
  v_subtotal bigint;
  v_eligible_subtotal bigint;
  v_used bigint;
  v_client_used bigint;
  v_discount bigint;
begin
  if (select auth.uid()) is null then
    raise exception 'Entre na sua conta para usar um cupom'
      using errcode = '42501';
  end if;
  v_effective_client_id := p_client_id;
  if v_effective_client_id is null then
    -- A newly signed-in customer can preview before creating a client row.
    -- Existing customers are still checked against their personal limit.
    select c.id into v_effective_client_id
    from public.clients c
    where c.barbershop_id = p_barbershop_id
      and c.user_id = (select auth.uid());
  elsif not app_private.can_read_client(
    p_barbershop_id, v_effective_client_id, 'appointments'
  ) then
    raise exception 'Cliente sem acesso a esta reserva'
      using errcode = '42501';
  end if;
  if p_starts_at is null or p_starts_at < now()
     or coalesce(cardinality(p_service_ids), 0) not between 1 and 8
     or array_position(p_service_ids, null) is not null
     or p_code is null or length(btrim(p_code)) not between 3 and 40 then
    raise exception 'Confira serviço, horário e cupom'
      using errcode = '22023';
  end if;

  select sh.timezone into v_timezone
  from public.barbershops sh
  where sh.id = p_barbershop_id and sh.active;
  if not found then
    raise exception 'Barbearia indisponível' using errcode = '22023';
  end if;
  v_slot_day := (p_starts_at at time zone v_timezone)::date;

  if p_lock then
    select o.* into v_offer
    from public.partner_offers o
    where o.barbershop_id = p_barbershop_id
      and upper(o.code) = upper(btrim(p_code))
    for update;
  else
    select o.* into v_offer
    from public.partner_offers o
    where o.barbershop_id = p_barbershop_id
      and upper(o.code) = upper(btrim(p_code));
  end if;
  if not found or not v_offer.active
     or v_slot_day < v_offer.starts_on
     or (v_offer.ends_on is not null and v_slot_day > v_offer.ends_on) then
    raise exception 'Cupom indisponível para a data escolhida'
      using errcode = '22023';
  end if;

  if p_lock then
    select p.name into v_partner_name
    from public.partners p
    where p.barbershop_id = p_barbershop_id
      and p.id = v_offer.partner_id and p.active
    for share;
  else
    select p.name into v_partner_name
    from public.partners p
    where p.barbershop_id = p_barbershop_id
      and p.id = v_offer.partner_id and p.active;
  end if;
  if not found then
    raise exception 'Parceiro indisponível' using errcode = '22023';
  end if;

  select count(*), sum(s.price_cents)::bigint,
         sum(s.price_cents) filter
           (where v_offer.service_id is null or s.id = v_offer.service_id)::bigint
  into v_service_count, v_subtotal, v_eligible_subtotal
  from public.services s
  where s.barbershop_id = p_barbershop_id
    and s.id = any(p_service_ids)
    and s.active;
  if v_service_count <> cardinality(p_service_ids)
     or v_eligible_subtotal is null
     or v_subtotal > 2147483647 then
    raise exception 'Cupom não aplicável aos serviços selecionados'
      using errcode = '22023';
  end if;
  if v_eligible_subtotal < v_offer.min_spend_cents then
    raise exception 'Valor mínimo do cupom não alcançado'
      using errcode = '22023';
  end if;

  select count(*), count(*) filter (where r.client_id = v_effective_client_id)
  into v_used, v_client_used
  from public.partner_redemptions r
  join public.appointments a
    on a.barbershop_id = r.barbershop_id and a.id = r.appointment_id
  where r.barbershop_id = p_barbershop_id
    and r.offer_id = v_offer.id
    and a.status <> 'cancelled';
  if (v_offer.usage_limit is not null and v_used >= v_offer.usage_limit)
     or (v_offer.per_client_limit is not null
         and v_client_used >= v_offer.per_client_limit) then
    raise exception 'Limite de uso do cupom atingido'
      using errcode = '22023';
  end if;

  v_discount := case
    when v_offer.discount_bps is not null then
      floor(v_eligible_subtotal::numeric * v_offer.discount_bps / 10000)::bigint
    else least(v_offer.discount_cents::bigint, v_eligible_subtotal)
  end;
  if v_offer.max_discount_cents is not null then
    v_discount := least(v_discount, v_offer.max_discount_cents);
  end if;
  v_discount := least(v_discount, v_eligible_subtotal);

  return jsonb_build_object(
    'offer_id', v_offer.id,
    'partner_id', v_offer.partner_id,
    'partner_name', v_partner_name,
    'title', v_offer.title,
    'code', v_offer.code,
    'terms', v_offer.terms,
    'subtotal_cents', v_subtotal::integer,
    'eligible_subtotal_cents', v_eligible_subtotal::integer,
    'discount_cents', v_discount::integer,
    'total_cents', (v_subtotal - v_discount)::integer
  );
end;
$$;
