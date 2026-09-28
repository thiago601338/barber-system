-- Run after goal_progress. Includes more than 500 source records and rolls all back.
begin;

insert into auth.users (id, email, aud, role, created_at, updated_at) values
  ('75000000-0000-4000-8000-000000000051', 'goal-admin@example.invalid', 'authenticated', 'authenticated', now(), now()),
  ('75000000-0000-4000-8000-000000000052', 'goal-barber-a@example.invalid', 'authenticated', 'authenticated', now(), now()),
  ('75000000-0000-4000-8000-000000000053', 'goal-barber-b@example.invalid', 'authenticated', 'authenticated', now(), now()),
  ('75000000-0000-4000-8000-000000000054', 'goal-barber-no-goals@example.invalid', 'authenticated', 'authenticated', now(), now()),
  ('75000000-0000-4000-8000-000000000055', 'goal-client@example.invalid', 'authenticated', 'authenticated', now(), now());
insert into public.barbershops (id, name, slug, timezone, structure_monthly_cost_cents) values
  ('97000000-0000-4000-8000-000000000051', 'Goal Test A', 'goal-test-fixture-a', 'America/Sao_Paulo', 3000),
  ('97000000-0000-4000-8000-000000000052', 'Goal Test B', 'goal-test-fixture-b', 'UTC', 0);
insert into public.memberships (id, barbershop_id, user_id, role, active) values
  ('76000000-0000-4000-8000-000000000051', '97000000-0000-4000-8000-000000000051', '75000000-0000-4000-8000-000000000051', 'admin', true),
  ('76000000-0000-4000-8000-000000000052', '97000000-0000-4000-8000-000000000051', '75000000-0000-4000-8000-000000000052', 'barber', true),
  ('76000000-0000-4000-8000-000000000053', '97000000-0000-4000-8000-000000000051', '75000000-0000-4000-8000-000000000053', 'barber', true),
  ('76000000-0000-4000-8000-000000000054', '97000000-0000-4000-8000-000000000051', '75000000-0000-4000-8000-000000000054', 'barber', true);
insert into public.module_permissions (barbershop_id, user_id, module, allowed) values
  ('97000000-0000-4000-8000-000000000051', '75000000-0000-4000-8000-000000000052', 'goals', true),
  ('97000000-0000-4000-8000-000000000051', '75000000-0000-4000-8000-000000000053', 'goals', true),
  ('97000000-0000-4000-8000-000000000051', '75000000-0000-4000-8000-000000000054', 'appointments', true);
insert into public.clients (id, barbershop_id, user_id, full_name, created_at) values
  ('77000000-0000-4000-8000-000000000051', '97000000-0000-4000-8000-000000000051', '75000000-0000-4000-8000-000000000055', 'Goal Client', '2026-09-28 03:30:00+00'),
  ('77000000-0000-4000-8000-000000000052', '97000000-0000-4000-8000-000000000051', null, 'Historical Client', '2026-07-01 13:30:00+00');
insert into public.client_barbers (barbershop_id, client_id, barber_membership_id) values
  ('97000000-0000-4000-8000-000000000051', '77000000-0000-4000-8000-000000000051', '76000000-0000-4000-8000-000000000052');

with visits as (
  insert into public.appointments
    (barbershop_id, client_id, barber_membership_id, starts_at, ends_at, status, source)
  select '97000000-0000-4000-8000-000000000051'::uuid,
    '77000000-0000-4000-8000-000000000051'::uuid,
    '76000000-0000-4000-8000-000000000052'::uuid,
    '2026-09-28 13:00:00+00'::timestamptz + n * interval '1 second',
    '2026-09-28 13:30:00+00'::timestamptz + n * interval '1 second',
    'completed'::public.appointment_status, 'admin'
  from generate_series(1, 501) as n
  returning id
)
insert into public.payments
  (barbershop_id, client_id, appointment_id, amount_cents, status, method, paid_at)
select '97000000-0000-4000-8000-000000000051',
  '77000000-0000-4000-8000-000000000051', id, 1000, 'paid', 'cash',
  '2026-09-28 13:40:00+00'::timestamptz
from visits;

insert into public.appointments
  (id, barbershop_id, client_id, barber_membership_id, starts_at, ends_at, status, source)
values
  ('78000000-0000-4000-8000-000000000051', '97000000-0000-4000-8000-000000000051', '77000000-0000-4000-8000-000000000051', '76000000-0000-4000-8000-000000000053', '2026-09-28 15:00:00+00', '2026-09-28 15:30:00+00', 'completed', 'admin'),
  ('78000000-0000-4000-8000-000000000052', '97000000-0000-4000-8000-000000000051', '77000000-0000-4000-8000-000000000051', '76000000-0000-4000-8000-000000000052', '2026-09-28 02:30:00+00', '2026-09-28 03:00:00+00', 'completed', 'admin'),
  ('78000000-0000-4000-8000-000000000053', '97000000-0000-4000-8000-000000000051', '77000000-0000-4000-8000-000000000051', '76000000-0000-4000-8000-000000000052', '2026-09-29 02:30:00+00', '2026-09-29 03:00:00+00', 'completed', 'admin');
insert into public.appointments
  (barbershop_id, client_id, barber_membership_id, starts_at, ends_at, status, source)
values
  ('97000000-0000-4000-8000-000000000051', '77000000-0000-4000-8000-000000000052', '76000000-0000-4000-8000-000000000052', '2026-08-01 13:00:00+00', '2026-08-01 13:30:00+00', 'completed', 'admin'),
  ('97000000-0000-4000-8000-000000000051', '77000000-0000-4000-8000-000000000052', '76000000-0000-4000-8000-000000000052', '2026-08-15 13:00:00+00', '2026-08-15 13:30:00+00', 'completed', 'admin');
insert into public.payments
  (barbershop_id, client_id, appointment_id, amount_cents, status, method, paid_at)
values
  ('97000000-0000-4000-8000-000000000051', '77000000-0000-4000-8000-000000000051', '78000000-0000-4000-8000-000000000051', 2000, 'paid', 'cash', '2026-09-28 15:40:00+00'),
  ('97000000-0000-4000-8000-000000000051', '77000000-0000-4000-8000-000000000051', '78000000-0000-4000-8000-000000000052', 5000, 'paid', 'cash', '2026-09-28 02:40:00+00'),
  ('97000000-0000-4000-8000-000000000051', '77000000-0000-4000-8000-000000000051', '78000000-0000-4000-8000-000000000053', 3000, 'paid', 'cash', '2026-09-29 02:40:00+00');
insert into public.expenses (barbershop_id, category, description, amount_cents, occurred_on)
values ('97000000-0000-4000-8000-000000000051', 'supplies', 'Goal test expense', 1000, '2026-09-28');

insert into public.goals
  (id, barbershop_id, barber_membership_id, title, metric, target_value, period_start, period_end)
values
  ('98000000-0000-4000-8000-000000000051', '97000000-0000-4000-8000-000000000051', null, 'Shop visits', 'appointments', 600, '2026-09-28', '2026-09-28'),
  ('98000000-0000-4000-8000-000000000052', '97000000-0000-4000-8000-000000000051', null, 'Shop revenue', 'revenue', 6000, '2026-09-28', '2026-09-28'),
  ('98000000-0000-4000-8000-000000000053', '97000000-0000-4000-8000-000000000051', '76000000-0000-4000-8000-000000000052', 'Barber visits', 'appointments', 600, '2026-09-28', '2026-09-28'),
  ('98000000-0000-4000-8000-000000000054', '97000000-0000-4000-8000-000000000051', '76000000-0000-4000-8000-000000000052', 'Barber revenue', 'revenue', 6000, '2026-09-28', '2026-09-28'),
  ('98000000-0000-4000-8000-000000000055', '97000000-0000-4000-8000-000000000051', '76000000-0000-4000-8000-000000000053', 'Other barber visits', 'appointments', 10, '2026-09-28', '2026-09-28'),
  ('98000000-0000-4000-8000-000000000056', '97000000-0000-4000-8000-000000000051', null, 'New clients', 'new_clients', 5, '2026-09-28', '2026-09-28'),
  ('98000000-0000-4000-8000-000000000057', '97000000-0000-4000-8000-000000000051', null, 'Profit percentage', 'profit_pct', 20, '2026-09-28', '2026-09-28'),
  ('98000000-0000-4000-8000-000000000058', '97000000-0000-4000-8000-000000000051', '76000000-0000-4000-8000-000000000052', 'Return percentage', 'client_return_pct', 60, '2026-08-01', '2026-08-31');

do $$
begin
  if has_function_privilege('anon', 'public.goal_progress(uuid)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.goal_progress(uuid)', 'EXECUTE') then
    raise exception 'Goal RPC grants are incorrect';
  end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '75000000-0000-4000-8000-000000000051', true);
do $$
declare v_goals jsonb;
begin
  v_goals := public.goal_progress('97000000-0000-4000-8000-000000000051');
  if jsonb_array_length(v_goals) <> 8
    or not v_goals @> '[{"title":"Shop visits","current_value":503},{"title":"Shop revenue","current_value":5060},{"title":"Barber visits","current_value":502},{"title":"Barber revenue","current_value":5040},{"title":"New clients","current_value":1},{"title":"Profit percentage","current_value":99.78},{"title":"Return percentage","current_value":100}]'::jsonb then
    raise exception 'Admin goal aggregate or timezone is incorrect: %', v_goals;
  end if;
end;
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '75000000-0000-4000-8000-000000000052', true);
do $$
declare
  v_goals jsonb;
  v_denied boolean := false;
begin
  v_goals := public.goal_progress('97000000-0000-4000-8000-000000000051');
  if jsonb_array_length(v_goals) <> 7
    or not v_goals @> '[{"title":"Shop visits","current_value":null},{"title":"Shop revenue","current_value":null},{"title":"Barber visits","current_value":502},{"title":"Barber revenue","current_value":5040}]'::jsonb
    or v_goals @> '[{"title":"Other barber visits"}]'::jsonb then
    raise exception 'Barber goal scope exposed shop or other barber progress: %', v_goals;
  end if;
  begin
    perform public.goal_progress('97000000-0000-4000-8000-000000000052');
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then raise exception 'Barber opened another shop goal report'; end if;
end;
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '75000000-0000-4000-8000-000000000054', true);
do $$
declare v_denied boolean := false;
begin
  begin
    perform public.goal_progress('97000000-0000-4000-8000-000000000051');
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then raise exception 'Barber without Goals opened progress'; end if;
end;
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '75000000-0000-4000-8000-000000000055', true);
do $$
declare v_denied boolean := false;
begin
  begin
    perform public.goal_progress('97000000-0000-4000-8000-000000000051');
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then raise exception 'Client opened goal progress'; end if;
end;
$$;
reset role;

rollback;
