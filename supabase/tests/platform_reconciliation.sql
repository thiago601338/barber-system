-- Execute after platform_billing_reconciliation; leaves no fixtures.
begin;

insert into auth.users (id, email, aud, role, created_at, updated_at) values
  ('74000000-0000-4000-8000-000000000001', 'billing-barber@example.invalid',
   'authenticated', 'authenticated', now(), now());
insert into public.barbershops (id, name, slug) values
  ('94000000-0000-4000-8000-000000000001', 'Billing Test Shop', 'billing-test-shop'),
  ('94000000-0000-4000-8000-000000000002', 'Billing No Provider', 'billing-no-provider');
insert into public.platform_subscriptions (
  barbershop_id, provider_subscription_id, seat_count,
  unit_price_cents, amount_cents, last_reconciled_at
) values
  ('94000000-0000-4000-8000-000000000001', 'saas-fixture-provider',
   2, 1000, 2000, now()),
  ('94000000-0000-4000-8000-000000000002', null,
   0, 0, 0, now());

do $$
begin
  if has_table_privilege('anon', 'public.platform_subscription_rates', 'SELECT')
     or has_table_privilege('authenticated', 'public.platform_subscription_rates', 'SELECT')
     or has_table_privilege('service_role', 'public.platform_subscription_rates', 'UPDATE') then
    raise exception 'Rate history grants are too broad';
  end if;
  if (select count(*) from public.platform_subscription_rates
      where barbershop_id = '94000000-0000-4000-8000-000000000001'
        and amount_cents = 2000 and seat_count = 2) <> 1 then
    raise exception 'Initial provider rate was not captured';
  end if;
end;
$$;

-- Setting identical values must not create a new snapshot.
update public.platform_subscriptions
set seat_count = 2, unit_price_cents = 1000, amount_cents = 2000
where barbershop_id = '94000000-0000-4000-8000-000000000001';
do $$
begin
  if (select count(*) from public.platform_subscription_rates
      where barbershop_id = '94000000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'Unchanged rate generated a duplicate snapshot';
  end if;
end;
$$;

update public.platform_subscriptions
set seat_count = 3, amount_cents = 3000,
    last_reconciled_at = now()
where barbershop_id = '94000000-0000-4000-8000-000000000001';
do $$
begin
  if (select count(*) from public.platform_subscription_rates
      where barbershop_id = '94000000-0000-4000-8000-000000000001') <> 2
     or (select count(*) from public.platform_subscription_rates
      where barbershop_id = '94000000-0000-4000-8000-000000000001'
        and amount_cents in (2000,3000)) <> 2 then
    raise exception 'Changed seat count did not preserve both rates';
  end if;
  begin
    update public.platform_subscription_rates
    set amount_cents = 9999
    where barbershop_id = '94000000-0000-4000-8000-000000000001';
    raise exception 'Rate history was edited';
  exception when check_violation then null;
  end;
  begin
    delete from public.platform_subscription_rates
    where barbershop_id = '94000000-0000-4000-8000-000000000001';
    raise exception 'Rate history was deleted';
  exception when check_violation then null;
  end;
end;
$$;

insert into public.memberships (id, barbershop_id, user_id, role, active) values
  ('95000000-0000-4000-8000-000000000001',
   '94000000-0000-4000-8000-000000000001',
   '74000000-0000-4000-8000-000000000001', 'barber', true),
  ('95000000-0000-4000-8000-000000000002',
   '94000000-0000-4000-8000-000000000002',
   '74000000-0000-4000-8000-000000000001', 'barber', true);
do $$
begin
  if (select last_reconciled_at from public.platform_subscriptions
      where barbershop_id = '94000000-0000-4000-8000-000000000001') is not null
     or (select last_reconciled_at from public.platform_subscriptions
      where barbershop_id = '94000000-0000-4000-8000-000000000002') is null then
    raise exception 'Membership change did not prioritize only connected subscription';
  end if;
end;
$$;

update public.platform_subscriptions set last_reconciled_at = now()
where barbershop_id = '94000000-0000-4000-8000-000000000001';
update public.memberships set active = false
where id = '95000000-0000-4000-8000-000000000001';
do $$
begin
  if (select last_reconciled_at from public.platform_subscriptions
      where barbershop_id = '94000000-0000-4000-8000-000000000001') is not null then
    raise exception 'Barber deactivation did not prioritize billing';
  end if;
end;
$$;

update public.platform_subscriptions set last_reconciled_at = now()
where barbershop_id = '94000000-0000-4000-8000-000000000001';
update public.platform_settings
set seat_price_cents = seat_price_cents + 1, billing_enabled = true
where id = 1;
do $$
begin
  if (select last_reconciled_at from public.platform_subscriptions
      where barbershop_id = '94000000-0000-4000-8000-000000000001') is not null then
    raise exception 'Platform price change did not prioritize billing';
  end if;
end;
$$;

update public.platform_subscriptions set last_reconciled_at = now()
where barbershop_id = '94000000-0000-4000-8000-000000000001';
update public.barbershops set active = false
where id = '94000000-0000-4000-8000-000000000001';
do $$
begin
  if (select last_reconciled_at from public.platform_subscriptions
      where barbershop_id = '94000000-0000-4000-8000-000000000001') is not null then
    raise exception 'Shop deactivation did not prioritize billing';
  end if;
end;
$$;

rollback;
