-- Keep historical partner/offer labels stable after the first reservation.
-- Other profile fields and future availability may still be edited.
create function app_private.protect_redeemed_offer_identity()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (new.partner_id is distinct from old.partner_id
      or new.code is distinct from old.code
      or new.title is distinct from old.title)
     and exists (
       select 1 from public.partner_redemptions r
       where r.barbershop_id = old.barbershop_id and r.offer_id = old.id
     ) then
    raise exception 'Esta oferta já foi usada. Crie outra oferta para mudar parceiro, código ou nome.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function app_private.protect_redeemed_offer_identity()
  from public, anon, authenticated;
create trigger protect_redeemed_offer_identity
  before update of partner_id, code, title on public.partner_offers
  for each row execute function app_private.protect_redeemed_offer_identity();

create function app_private.protect_redeemed_partner_name()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.name is distinct from old.name
     and exists (
       select 1 from public.partner_redemptions r
       where r.barbershop_id = old.barbershop_id and r.partner_id = old.id
     ) then
    raise exception 'Este parceiro já tem reservas atribuídas. Crie outro cadastro para mudar o nome.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function app_private.protect_redeemed_partner_name()
  from public, anon, authenticated;
create trigger protect_redeemed_partner_name
  before update of name on public.partners
  for each row execute function app_private.protect_redeemed_partner_name();

-- Require the customer-confirmed breakdown. The old signature must not remain
-- callable: it would let a stale UI silently book at a changed price.
drop function public.book_partner_appointment(uuid,uuid,uuid,uuid[],timestamptz,text);

create function public.book_partner_appointment(
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
  v_appointment_id uuid;
begin
  -- The offer lock serializes global/per-client limits and protects the quote
  -- comparison until the redemption is recorded in this transaction.
  v_quote := app_private.partner_offer_quote(
    p_barbershop_id, p_client_id, p_service_ids, p_starts_at, p_code, true
  );
  if p_expected_subtotal_cents is distinct from (v_quote ->> 'subtotal_cents')::integer
     or p_expected_discount_cents is distinct from (v_quote ->> 'discount_cents')::integer
     or p_expected_total_cents is distinct from (v_quote ->> 'total_cents')::integer then
    raise exception 'Preço ou benefício mudou. Aplique o cupom novamente antes de confirmar.'
      using errcode = 'P2001';
  end if;

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
revoke execute on function public.book_partner_appointment(uuid,uuid,uuid,uuid[],timestamptz,text,integer,integer,integer)
  from public, anon, authenticated;
grant execute on function public.book_partner_appointment(uuid,uuid,uuid,uuid[],timestamptz,text,integer,integer,integer)
  to authenticated;
