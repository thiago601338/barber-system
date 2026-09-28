-- Transactional smoke test. The controlled exception rolls the fixture back.
do $$
declare
  v_admin uuid;
  v_barber_user uuid;
  v_shop uuid;
  v_barber uuid;
  v_client uuid;
  v_service uuid;
  v_other_service uuid;
  v_partner uuid;
  v_other_partner uuid;
  v_offer uuid;
  v_day date := (now() at time zone 'America/Sao_Paulo')::date + 3;
  v_slot timestamptz;
  v_quote jsonb;
  v_booking jsonb;
  v_stats jsonb;
begin
  select user_id into v_admin from public.platform_admins limit 1;
  select id into v_barber_user from auth.users
  where id <> v_admin order by created_at limit 1;
  if v_admin is null or v_barber_user is null then
    raise exception 'Test requires two existing users';
  end if;
  v_slot := (v_day + time '12:00') at time zone 'America/Sao_Paulo';

  insert into public.barbershops(name, slug, timezone)
  values ('Partner fixture', 'partner-fixture-' || substr(gen_random_uuid()::text, 1, 8),
          'America/Sao_Paulo') returning id into v_shop;
  insert into public.memberships(barbershop_id,user_id,role,display_name)
  values (v_shop,v_barber_user,'barber','Fixture barber')
  returning id into v_barber;
  insert into public.clients(barbershop_id,full_name)
  values (v_shop,'Fixture client') returning id into v_client;
  insert into public.services(barbershop_id,name,duration_minutes,price_cents)
  values (v_shop,'Fixture cut',30,5000) returning id into v_service;
  insert into public.services(barbershop_id,name,duration_minutes,price_cents)
  values (v_shop,'Fixture beard',30,3000) returning id into v_other_service;
  insert into public.barber_services(barbershop_id,barber_membership_id,service_id)
  values (v_shop,v_barber,v_service),(v_shop,v_barber,v_other_service);
  insert into public.availability_rules
    (barbershop_id,barber_membership_id,weekday,start_time,end_time)
  values (v_shop,v_barber,extract(dow from v_day)::smallint,time '09:00',time '18:00');
  insert into public.partners(barbershop_id,name)
  values (v_shop,'Fixture partner') returning id into v_partner;
  insert into public.partners(barbershop_id,name,active)
  values (v_shop,'Other fixture partner',false) returning id into v_other_partner;
  insert into public.partner_offers
    (barbershop_id,partner_id,title,code,service_id,discount_bps,
     max_discount_cents,min_spend_cents,starts_on,ends_on,
     usage_limit,per_client_limit)
  values (v_shop,v_partner,'Fixture offer','FIXTURE20',v_service,2000,
          1000,1000,v_day - 3,v_day + 5,1,1)
  returning id into v_offer;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  v_quote := public.quote_partner_offer(
    v_shop,null,array[v_service,v_other_service],v_slot,'FIXTURE20'
  );
  if (v_quote ->> 'total_cents')::integer <> 7000 then
    raise exception 'New-client preview mismatch: %', v_quote;
  end if;
  v_quote := public.quote_partner_offer(
    v_shop,v_client,array[v_service,v_other_service],v_slot,'fixture20'
  );
  if (v_quote ->> 'subtotal_cents')::integer <> 8000
     or (v_quote ->> 'eligible_subtotal_cents')::integer <> 5000
     or (v_quote ->> 'discount_cents')::integer <> 1000
     or (v_quote ->> 'total_cents')::integer <> 7000 then
    raise exception 'Wrong service-scoped quote: %', v_quote;
  end if;

  update public.services set price_cents=6000 where id=v_service;
  begin
    perform public.book_partner_appointment(
      v_shop,v_client,v_barber,array[v_service,v_other_service],v_slot,
      'FIXTURE20',8000,1000,7000
    );
    raise exception 'Stale quoted price was accepted';
  exception when sqlstate 'P2001' then null;
  end;
  if exists (select 1 from public.appointments where barbershop_id=v_shop) then
    raise exception 'Stale quote created an appointment';
  end if;
  update public.services set price_cents=5000 where id=v_service;

  v_booking := public.book_partner_appointment(
    v_shop,v_client,v_barber,array[v_service,v_other_service],v_slot,
    'FIXTURE20',8000,1000,7000
  );
  if (v_booking ->> 'total_cents')::integer <> 7000
     or not exists (
       select 1 from public.appointments a
       join public.partner_redemptions r
         on r.barbershop_id=a.barbershop_id and r.appointment_id=a.id
       where a.barbershop_id=v_shop
         and a.id=(v_booking ->> 'appointment_id')::uuid
         and a.subscription_id is null
         and a.total_price_cents=7000
         and r.offer_id=v_offer and r.discount_cents=1000
     ) then
    raise exception 'Booking/redemption mismatch: %', v_booking;
  end if;
  begin
    update public.partner_offers set code='CHANGED20' where id=v_offer;
    raise exception 'Redeemed code was changed';
  exception when sqlstate '23514' then null;
  end;
  begin
    update public.partner_offers set partner_id=v_other_partner where id=v_offer;
    raise exception 'Redeemed partner was changed';
  exception when sqlstate '23514' then null;
  end;
  begin
    update public.partner_offers set title='Changed title' where id=v_offer;
    raise exception 'Redeemed title was changed';
  exception when sqlstate '23514' then null;
  end;
  begin
    update public.partners set name='Changed partner' where id=v_partner;
    raise exception 'Redeemed partner name was changed';
  exception when sqlstate '23514' then null;
  end;
  update public.partners set contact='New phone' where id=v_partner;
  if (select contact from public.partners where id=v_partner) <> 'New phone' then
    raise exception 'Ordinary contact edit was blocked';
  end if;
  if exists (select 1 from public.list_partner_offers(v_shop)) then
    raise exception 'Exhausted offer remains in public catalogue';
  end if;

  begin
    perform public.quote_partner_offer(
      v_shop,v_client,array[v_service,v_other_service],v_slot + interval '1 day','FIXTURE20'
    );
    raise exception 'Usage limit was not enforced';
  exception when sqlstate '22023' then null;
  end;

  update public.appointments set status='cancelled'
  where id=(v_booking ->> 'appointment_id')::uuid;
  if not exists (select 1 from public.list_partner_offers(v_shop)) then
    raise exception 'Cancelled redemption did not restore catalogue offer';
  end if;
  v_quote := public.quote_partner_offer(
    v_shop,v_client,array[v_service,v_other_service],v_slot,'FIXTURE20'
  );
  if (v_quote ->> 'total_cents')::integer <> 7000 then
    raise exception 'Cancellation did not release coupon capacity';
  end if;
  v_booking := public.book_partner_appointment(
    v_shop,v_client,v_barber,array[v_service,v_other_service],v_slot,
    'FIXTURE20',8000,1000,7000
  );
  v_stats := public.partner_program_stats(v_shop);
  if (v_stats ->> 'active_partners')::integer <> 1
     or (v_stats ->> 'active_offers')::integer <> 0
     or (v_stats ->> 'reservations')::integer <> 1
     or (v_stats ->> 'total_cents')::integer <> 7000 then
    raise exception 'Aggregate mismatch: %', v_stats;
  end if;
  v_stats := public.partner_program_stats(v_shop,v_day,v_day);
  if (v_stats ->> 'reservations')::integer <> 1
     or jsonb_array_length(v_stats -> 'by_offer') <> 1
     or (v_stats -> 'by_offer' -> 0 ->> 'reservations')::integer <> 1 then
    raise exception 'Offer/day aggregate mismatch: %', v_stats;
  end if;
  if (select count(*) from public.partner_program_redemptions(v_shop,v_day,v_day)) <> 2 then
    raise exception 'Filtered reservation list omitted cancelled/valid rows';
  end if;
  v_stats := public.partner_program_stats(v_shop,v_day + 1,v_day + 1);
  if (v_stats ->> 'reservations')::integer <> 0 then
    raise exception 'Appointment date filter leaked another day: %', v_stats;
  end if;

  begin
    perform public.partner_program_stats(v_shop,v_day,v_day + 370);
    raise exception '370+ day range was accepted';
  exception when sqlstate '22023' then null;
  end;

  raise exception 'ROLLBACK_PARTNER_FIXTURE';
exception when sqlstate 'P0001' then
  if sqlerrm <> 'ROLLBACK_PARTNER_FIXTURE' then raise; end if;
end;
$$;

select count(*) as leftover_fixture_shops
from public.barbershops where slug like 'partner-fixture-%';
