-- Run only after the initial migration, against a disposable database or
-- inside a transaction as below. All fixtures are rolled back at the end.
begin;

insert into auth.users (id, email, aud, role, created_at, updated_at) values
  ('71000000-0000-4000-8000-000000000001', 'rls-admin-a@example.invalid', 'authenticated', 'authenticated', now(), now()),
  ('71000000-0000-4000-8000-000000000002', 'rls-barber-a@example.invalid', 'authenticated', 'authenticated', now(), now()),
  ('71000000-0000-4000-8000-000000000003', 'rls-barber-b@example.invalid', 'authenticated', 'authenticated', now(), now()),
  ('71000000-0000-4000-8000-000000000004', 'rls-client-a@example.invalid', 'authenticated', 'authenticated', now(), now()),
  ('71000000-0000-4000-8000-000000000005', 'rls-client-b@example.invalid', 'authenticated', 'authenticated', now(), now());

insert into public.barbershops (
  id, name, slug, structure_monthly_cost_cents, target_profit_pct, pix_key
) values
  ('81000000-0000-4000-8000-000000000001', 'RLS Shop A', 'rls-fixture-shop-a', 100000, 35, 'private-pix-fixture-a'),
  ('81000000-0000-4000-8000-000000000002', 'RLS Shop B', 'rls-fixture-shop-b', 200000, 45, 'private-pix-fixture-b');
insert into public.memberships (id, barbershop_id, user_id, role, display_name) values
  ('82000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'admin', 'Admin A'),
  ('82000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002', 'barber', 'Barber A'),
  ('82000000-0000-4000-8000-000000000003', '81000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000003', 'barber', 'Barber B');
insert into public.module_permissions (barbershop_id, user_id, module, allowed) values
  ('81000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002', 'clients', true),
  ('81000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002', 'services', true),
  ('81000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002', 'appointments', true),
  ('81000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002', 'procedures', false),
  ('81000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002', 'availability', false),
  ('81000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000003', 'clients', true),
  ('81000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000003', 'services', true);
insert into public.clients (id, barbershop_id, user_id, full_name) values
  ('83000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000004', 'Client A'),
  ('83000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000001', null, 'Unassigned A'),
  ('83000000-0000-4000-8000-000000000003', '81000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000005', 'Client B');
insert into public.client_barbers (barbershop_id, client_id, barber_membership_id) values
  ('81000000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000002'),
  ('81000000-0000-4000-8000-000000000002', '83000000-0000-4000-8000-000000000003', '82000000-0000-4000-8000-000000000003');
insert into public.services (id, barbershop_id, name, duration_minutes, price_cents, cost_cents) values
  ('84000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', 'Corte A', 30, 5000, 1000),
  ('84000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000002', 'Corte B', 30, 5000, 2000);
insert into public.products (
  barbershop_id, name, category, price_cents, cost_cents,
  stock_quantity, active
) values
  ('81000000-0000-4000-8000-000000000001', 'Pomada A', 'retail', 3500, 1200, 3, true),
  ('81000000-0000-4000-8000-000000000001', 'Shampoo A', 'retail', 2500, 900, 0, true),
  ('81000000-0000-4000-8000-000000000001', 'Produto inativo A', 'retail', 1500, 300, 1, false),
  ('81000000-0000-4000-8000-000000000001', 'Lanche interno A', 'kitchen', 1000, 200, 2, true),
  ('81000000-0000-4000-8000-000000000002', 'Pomada B', 'retail', 4000, 1500, 4, true);
insert into public.barber_services (barbershop_id, barber_membership_id, service_id) values
  ('81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000002', '84000000-0000-4000-8000-000000000001'),
  ('81000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000003', '84000000-0000-4000-8000-000000000002');
insert into public.availability_rules (
  barbershop_id, barber_membership_id, weekday, start_time, end_time
) values
  ('81000000-0000-4000-8000-000000000001',
   '82000000-0000-4000-8000-000000000002',
   extract(dow from (now() at time zone 'America/Sao_Paulo')::date + 1)::smallint,
   time '09:00', time '18:00'),
  ('81000000-0000-4000-8000-000000000002',
   '82000000-0000-4000-8000-000000000003',
   extract(dow from (now() at time zone 'America/Sao_Paulo')::date + 1)::smallint,
   time '09:00', time '18:00');
insert into public.availability_exceptions (
  barbershop_id, barber_membership_id, day
) values
  ('81000000-0000-4000-8000-000000000001',
   '82000000-0000-4000-8000-000000000002', (now() at time zone 'America/Sao_Paulo')::date + 2),
  ('81000000-0000-4000-8000-000000000002',
   '82000000-0000-4000-8000-000000000003', (now() at time zone 'America/Sao_Paulo')::date + 2);
insert into public.procedure_records (
  barbershop_id, client_id, barber_membership_id, description
) values
  ('81000000-0000-4000-8000-000000000001',
   '83000000-0000-4000-8000-000000000001',
   '82000000-0000-4000-8000-000000000002', 'Assigned procedure'),
  ('81000000-0000-4000-8000-000000000001',
   '83000000-0000-4000-8000-000000000002',
   '82000000-0000-4000-8000-000000000002', 'Unassigned procedure'),
  ('81000000-0000-4000-8000-000000000002',
   '83000000-0000-4000-8000-000000000003',
   '82000000-0000-4000-8000-000000000003', 'Other shop procedure');
insert into public.chemical_records (
  barbershop_id, client_id, barber_membership_id, product_name
) values
  ('81000000-0000-4000-8000-000000000001',
   '83000000-0000-4000-8000-000000000001',
   '82000000-0000-4000-8000-000000000002', 'Assigned chemical'),
  ('81000000-0000-4000-8000-000000000001',
   '83000000-0000-4000-8000-000000000002',
   '82000000-0000-4000-8000-000000000002', 'Unassigned chemical'),
  ('81000000-0000-4000-8000-000000000002',
   '83000000-0000-4000-8000-000000000003',
   '82000000-0000-4000-8000-000000000003', 'Other shop chemical');
insert into public.subscription_plans (
  id, barbershop_id, name, price_cents, visits_per_cycle
) values (
  '85000000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000001',
  'RLS Test Plan', 10000, 1
);
insert into public.subscription_plan_services (
  barbershop_id, plan_id, service_id
) values (
  '81000000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000001',
  '84000000-0000-4000-8000-000000000001'
);
insert into public.subscriptions (
  id, barbershop_id, client_id, plan_id, status,
  current_period_start, current_period_end
) values (
  '86000000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000001',
  'active', now() - interval '1 day', now() + interval '1 month'
);

-- Table privileges protect credentials/master billing even before row policies.
do $$
begin
  if has_table_privilege('anon', 'public.clients', 'SELECT')
     or has_table_privilege('anon', 'public.products', 'SELECT')
     or has_table_privilege('authenticated', 'public.platform_admins', 'SELECT')
     or has_table_privilege('authenticated', 'public.integration_credentials', 'SELECT')
     or has_table_privilege('authenticated', 'public.platform_invoices', 'SELECT')
     or has_column_privilege('anon', 'public.barbershops', 'structure_monthly_cost_cents', 'SELECT')
     or has_column_privilege('authenticated', 'public.barbershops', 'target_profit_pct', 'SELECT')
     or has_column_privilege('authenticated', 'public.barbershops', 'pix_key', 'SELECT')
     or has_column_privilege('anon', 'public.services', 'cost_cents', 'SELECT')
     or has_column_privilege('authenticated', 'public.services', 'cost_cents', 'SELECT')
     or has_function_privilege('authenticated', 'public.reconcile_subscription_entitlement(uuid)', 'EXECUTE') then
    raise exception 'Private table privilege leaked';
  end if;
end;
$$;

set local role anon;
do $$
begin
  if (select count(*) from public.barbershops) <> 2
     or (select count(*) from public.services) <> 2 then
    raise exception 'Public shop and service catalogs unavailable';
  end if;
  if (select count(*) from public.public_products('81000000-0000-4000-8000-000000000001')) <> 2
     or (select count(*) from public.public_products('81000000-0000-4000-8000-000000000002')) <> 1
     or (select in_stock from public.public_products('81000000-0000-4000-8000-000000000001') where name = 'Shampoo A') is distinct from false then
    raise exception 'Public products leaked inactive/internal items or stock state is wrong';
  end if;
  begin
    perform structure_monthly_cost_cents from public.barbershops;
    raise exception 'Anonymous role read shop cost';
  exception when insufficient_privilege then null;
  end;
  begin
    perform cost_cents from public.services;
    raise exception 'Anonymous role read service cost';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000002', true);
do $$
begin
  if (select count(*) from public.clients) <> 1 then
    raise exception 'Barber A must see only assigned Client A';
  end if;
  if (select count(*) from public.procedure_records) <> 1
     or (select count(*) from public.chemical_records) <> 1 then
    raise exception 'Clientes tab must show only assigned history and chemistry';
  end if;
  if (select count(*) from public.availability_rules) <> 1
     or (select count(*) from public.availability_exceptions) <> 1 then
    raise exception 'Serviços tab must show only own availability';
  end if;
  if (select public.is_platform_admin()) then
    raise exception 'Barber A must not be platform admin';
  end if;
  begin
    perform public.shop_financial_settings('81000000-0000-4000-8000-000000000001');
    raise exception 'Barber A accessed shop cost';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.service_costs('81000000-0000-4000-8000-000000000001');
    raise exception 'Barber A accessed service cost';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

update public.module_permissions
set allowed = module in ('procedures','availability')
where barbershop_id = '81000000-0000-4000-8000-000000000001'
  and user_id = '71000000-0000-4000-8000-000000000002'
  and module in ('clients','services','procedures','availability');
set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000002', true);
do $$
begin
  if (select count(*) from public.procedure_records) <> 0
     or (select count(*) from public.chemical_records) <> 0
     or (select count(*) from public.availability_rules) <> 0
     or (select count(*) from public.availability_exceptions) <> 0 then
    raise exception 'Legacy hidden permissions must not bypass visible tabs';
  end if;
end;
$$;
reset role;

update public.module_permissions
set allowed = module in ('clients','services')
where barbershop_id = '81000000-0000-4000-8000-000000000001'
  and user_id = '71000000-0000-4000-8000-000000000002'
  and module in ('clients','services','procedures','availability');
set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000002', true);
do $$
begin
  if (select count(*) from public.procedure_records) <> 1
     or (select count(*) from public.chemical_records) <> 1
     or (select count(*) from public.availability_rules) <> 1
     or (select count(*) from public.availability_exceptions) <> 1 then
    raise exception 'Visible-tab permissions failed to restore assigned data';
  end if;
  insert into public.procedure_records (
    barbershop_id, client_id, barber_membership_id, description
  ) values (
    '81000000-0000-4000-8000-000000000001',
    '83000000-0000-4000-8000-000000000001',
    '82000000-0000-4000-8000-000000000002', 'Barber added procedure'
  );
  insert into public.chemical_records (
    barbershop_id, client_id, barber_membership_id, product_name
  ) values (
    '81000000-0000-4000-8000-000000000001',
    '83000000-0000-4000-8000-000000000001',
    '82000000-0000-4000-8000-000000000002', 'Barber added chemical'
  );
  insert into public.availability_rules (
    barbershop_id, barber_membership_id, weekday, start_time, end_time
  ) values (
    '81000000-0000-4000-8000-000000000001',
    '82000000-0000-4000-8000-000000000002',
    0, time '12:00', time '13:00'
  );
  insert into public.availability_exceptions (
    barbershop_id, barber_membership_id, day
  ) values (
    '81000000-0000-4000-8000-000000000001',
    '82000000-0000-4000-8000-000000000002',
    (now() at time zone 'America/Sao_Paulo')::date + 3
  );
  begin
    insert into public.procedure_records (
      barbershop_id, client_id, barber_membership_id, description
    ) values (
      '81000000-0000-4000-8000-000000000001',
      '83000000-0000-4000-8000-000000000002',
      '82000000-0000-4000-8000-000000000002', 'Forbidden unassigned procedure'
    );
    raise exception 'Barber wrote procedure for unassigned client';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.chemical_records (
      barbershop_id, client_id, barber_membership_id, product_name
    ) values (
      '81000000-0000-4000-8000-000000000001',
      '83000000-0000-4000-8000-000000000002',
      '82000000-0000-4000-8000-000000000002', 'Forbidden unassigned chemical'
    );
    raise exception 'Barber wrote chemical record for unassigned client';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.availability_rules (
      barbershop_id, barber_membership_id, weekday, start_time, end_time
    ) values (
      '81000000-0000-4000-8000-000000000002',
      '82000000-0000-4000-8000-000000000003',
      0, time '12:00', time '13:00'
    );
    raise exception 'Barber wrote availability for another shop';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
do $$
begin
  if (select count(*) from public.clients) <> 2 then
    raise exception 'Shop A admin must see both Shop A clients and no Shop B client';
  end if;
  if (public.shop_financial_settings('81000000-0000-4000-8000-000000000001')->>'structure_monthly_cost_cents')::integer <> 100000
     or (select cost_cents from public.service_costs('81000000-0000-4000-8000-000000000001')) <> 1000 then
    raise exception 'Shop A admin could not read own private costs';
  end if;
  begin
    perform public.shop_financial_settings('81000000-0000-4000-8000-000000000002');
    raise exception 'Shop A admin accessed Shop B cost';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000003', true);
do $$
begin
  if (select count(*) from public.clients) <> 1 then
    raise exception 'Shop B barber must see only Client B';
  end if;
  if (select count(*) from public.procedure_records) <> 1
     or (select count(*) from public.chemical_records) <> 1
     or (select count(*) from public.availability_rules) <> 1
     or (select count(*) from public.availability_exceptions) <> 1 then
    raise exception 'Shop B barber saw another shop history or availability';
  end if;
end;
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000004', true);
do $$
declare
  v_day date := (now() at time zone 'America/Sao_Paulo')::date + 1;
  v_first timestamptz;
  v_second timestamptz;
begin
  if (select count(*) from public.clients) <> 1
     or (select count(*) from public.subscriptions) <> 1 then
    raise exception 'Client A must see only own client and subscription rows';
  end if;
  v_first := (v_day + time '10:00') at time zone 'America/Sao_Paulo';
  v_second := (v_day + time '11:00') at time zone 'America/Sao_Paulo';
  perform public.book_appointment(
    '81000000-0000-4000-8000-000000000001',
    '83000000-0000-4000-8000-000000000001',
    '82000000-0000-4000-8000-000000000002',
    array['84000000-0000-4000-8000-000000000001']::uuid[],
    v_first,
    '86000000-0000-4000-8000-000000000001'
  );
  begin
    perform public.book_appointment(
      '81000000-0000-4000-8000-000000000001',
      '83000000-0000-4000-8000-000000000001',
      '82000000-0000-4000-8000-000000000002',
      array['84000000-0000-4000-8000-000000000001']::uuid[],
      v_second,
      '86000000-0000-4000-8000-000000000001'
    );
    raise exception 'Second visit exceeded one-visit subscription';
  exception when sqlstate '22023' then
    null;
  end;
  begin
    perform public.book_appointment(
      '81000000-0000-4000-8000-000000000002',
      '83000000-0000-4000-8000-000000000001',
      '82000000-0000-4000-8000-000000000003',
      array['84000000-0000-4000-8000-000000000002']::uuid[],
      v_second,
      null
    );
    raise exception 'Cross-shop booking should fail';
  exception when sqlstate '22023' then
    null;
  end;
  if (select count(*) from public.appointments) <> 1
     or (select count(*) from public.subscription_usages where status = 'reserved') <> 1 then
    raise exception 'Only one appointment and one reserved visit should exist';
  end if;
end;
$$;
reset role;

-- A payment reversal must revoke remaining subscription booking entitlement.
insert into public.payments (
  id, barbershop_id, client_id, subscription_id, provider,
  provider_payment_id, amount_cents, status, method, paid_at
) values (
  '87000000-0000-4000-8000-000000000001',
  '81000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000001',
  '86000000-0000-4000-8000-000000000001',
  'mercadopago', 'rls-fixture-payment-a', 10000, 'paid', 'card', now()
);
update public.payments
set status = 'refunded', paid_at = null
where id = '87000000-0000-4000-8000-000000000001';
do $$
begin
  if (select status from public.subscriptions
      where id = '86000000-0000-4000-8000-000000000001') <> 'past_due' then
    raise exception 'Reversal did not revoke subscription entitlement';
  end if;
  begin
    update public.payments set status = 'paid', paid_at = now()
    where id = '87000000-0000-4000-8000-000000000001';
    raise exception 'Refunded payment was reactivated';
  exception when check_violation then null;
  end;
end;
$$;

rollback;
