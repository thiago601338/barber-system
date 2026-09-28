-- Partner offers belong to exactly one partner and one shop. A redemption is
-- created with the appointment, but it is not a payment or received revenue.
alter table public.partners
  add column description text,
  add column instagram_url text,
  add column website_url text,
  add column logo_url text,
  add constraint partners_shop_id_uq unique (barbershop_id, id);

create table public.partner_offers (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  partner_id uuid not null,
  title text not null check (length(btrim(title)) between 2 and 160),
  code text not null check (code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,39}$'),
  description text,
  terms text,
  service_id uuid,
  discount_bps integer check (discount_bps between 1 and 10000),
  discount_cents integer check (discount_cents > 0),
  max_discount_cents integer check (max_discount_cents > 0),
  min_spend_cents integer not null default 0 check (min_spend_cents >= 0),
  starts_on date not null,
  ends_on date,
  usage_limit integer check (usage_limit > 0),
  per_client_limit integer check (per_client_limit > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (barbershop_id, id),
  foreign key (barbershop_id, partner_id)
    references public.partners(barbershop_id, id),
  foreign key (barbershop_id, service_id)
    references public.services(barbershop_id, id),
  check ((discount_bps is null) <> (discount_cents is null)),
  check (ends_on is null or ends_on >= starts_on)
);
create unique index partner_offers_shop_code_uq
  on public.partner_offers (barbershop_id, upper(code));
create index partner_offers_partner_idx
  on public.partner_offers (barbershop_id, partner_id, active);
create index partner_offers_service_idx
  on public.partner_offers (barbershop_id, service_id, active);
create trigger set_updated_at before update on public.partner_offers
  for each row execute function app_private.touch_updated_at();

create table public.partner_redemptions (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null,
  offer_id uuid not null,
  partner_id uuid not null,
  client_id uuid not null,
  appointment_id uuid not null,
  code_snapshot text not null,
  subtotal_cents integer not null check (subtotal_cents >= 0),
  eligible_subtotal_cents integer not null check
    (eligible_subtotal_cents >= 0 and eligible_subtotal_cents <= subtotal_cents),
  discount_cents integer not null check
    (discount_cents >= 0 and discount_cents <= eligible_subtotal_cents),
  total_cents integer not null check
    (total_cents >= 0 and total_cents = subtotal_cents - discount_cents),
  created_at timestamptz not null default now(),
  unique (barbershop_id, appointment_id),
  foreign key (barbershop_id, offer_id)
    references public.partner_offers(barbershop_id, id),
  foreign key (barbershop_id, partner_id)
    references public.partners(barbershop_id, id),
  foreign key (barbershop_id, client_id)
    references public.clients(barbershop_id, id),
  foreign key (barbershop_id, appointment_id)
    references public.appointments(barbershop_id, id) on delete cascade
);
create index partner_redemptions_offer_count_idx
  on public.partner_redemptions (barbershop_id, offer_id, client_id);
create index partner_redemptions_partner_idx
  on public.partner_redemptions (barbershop_id, partner_id, created_at desc);

alter table public.partner_offers enable row level security;
alter table public.partner_redemptions enable row level security;
revoke all on public.partner_offers, public.partner_redemptions
  from public, anon, authenticated;
grant all on public.partner_offers, public.partner_redemptions to service_role;
grant select, insert, update, delete on public.partner_offers to authenticated;
grant select on public.partner_redemptions to authenticated;
grant update (description, instagram_url, website_url, logo_url)
  on public.partners to authenticated;

create policy partner_offers_admin on public.partner_offers
  for all to authenticated
  using (app_private.has_shop_role(barbershop_id, array['admin']::public.shop_role[]))
  with check (app_private.has_shop_role(barbershop_id, array['admin']::public.shop_role[]));
create policy partner_offers_staff_read on public.partner_offers
  for select to authenticated
  using (app_private.has_module(barbershop_id, 'partners'));
create policy partner_redemptions_admin_read on public.partner_redemptions
  for select to authenticated
  using (app_private.has_shop_role(barbershop_id, array['admin']::public.shop_role[]));

-- The public catalogue exposes only display-safe offer fields. A quote checks
-- client identity, slot date, service scope, remaining uses and current price.
create function public.list_partner_offers(p_barbershop_id uuid)
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
  order by p.name, o.title, o.id;
$$;
revoke execute on function public.list_partner_offers(uuid)
  from public, anon, authenticated;
grant execute on function public.list_partner_offers(uuid)
  to anon, authenticated;

create function app_private.partner_offer_quote(
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
  if not app_private.can_read_client(p_barbershop_id, p_client_id, 'appointments') then
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

  select count(*), count(*) filter (where r.client_id = p_client_id)
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
revoke execute on function app_private.partner_offer_quote(uuid,uuid,uuid[],timestamptz,text,boolean)
  from public, anon, authenticated;

create function public.quote_partner_offer(
  p_barbershop_id uuid,
  p_client_id uuid,
  p_service_ids uuid[],
  p_starts_at timestamptz,
  p_code text
)
returns jsonb
language sql volatile security definer set search_path = ''
as $$
  select app_private.partner_offer_quote(
    p_barbershop_id, p_client_id, p_service_ids, p_starts_at, p_code, false
  );
$$;
revoke execute on function public.quote_partner_offer(uuid,uuid,uuid[],timestamptz,text)
  from public, anon, authenticated;
grant execute on function public.quote_partner_offer(uuid,uuid,uuid[],timestamptz,text)
  to authenticated;

create function public.book_partner_appointment(
  p_barbershop_id uuid,
  p_client_id uuid,
  p_barber_membership_id uuid,
  p_service_ids uuid[],
  p_starts_at timestamptz,
  p_code text
)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_quote jsonb;
  v_appointment_id uuid;
begin
  -- The offer row lock covers validation, count, booking and redemption.
  -- The existing booking RPC verifies ownership, availability and overlap.
  v_quote := app_private.partner_offer_quote(
    p_barbershop_id, p_client_id, p_service_ids, p_starts_at, p_code, true
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
    discount_cents, total_cents
  ) values (
    p_barbershop_id, (v_quote ->> 'offer_id')::uuid,
    (v_quote ->> 'partner_id')::uuid, p_client_id, v_appointment_id,
    v_quote ->> 'code', (v_quote ->> 'subtotal_cents')::integer,
    (v_quote ->> 'eligible_subtotal_cents')::integer,
    (v_quote ->> 'discount_cents')::integer,
    (v_quote ->> 'total_cents')::integer
  );
  return (v_quote - 'eligible_subtotal_cents' - 'partner_id')
    || jsonb_build_object('appointment_id', v_appointment_id);
end;
$$;
revoke execute on function public.book_partner_appointment(uuid,uuid,uuid,uuid[],timestamptz,text)
  from public, anon, authenticated;
grant execute on function public.book_partner_appointment(uuid,uuid,uuid,uuid[],timestamptz,text)
  to authenticated;

create function public.partner_program_stats(p_barbershop_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not app_private.has_shop_role(
    p_barbershop_id, array['admin']::public.shop_role[]
  ) then
    raise exception 'Acesso negado às estatísticas de parceiros'
      using errcode = '42501';
  end if;
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
revoke execute on function public.partner_program_stats(uuid)
  from public, anon, authenticated;
grant execute on function public.partner_program_stats(uuid)
  to authenticated;
