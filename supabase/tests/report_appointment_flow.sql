-- Run after report_appointment_flow. Fixtures and results are rolled back.
begin;

insert into auth.users (id, email, aud, role, created_at, updated_at) values
  ('75000000-0000-4000-8000-000000000041', 'flow-admin@example.invalid', 'authenticated', 'authenticated', now(), now()),
  ('75000000-0000-4000-8000-000000000042', 'flow-barber-a@example.invalid', 'authenticated', 'authenticated', now(), now()),
  ('75000000-0000-4000-8000-000000000043', 'flow-barber-b@example.invalid', 'authenticated', 'authenticated', now(), now()),
  ('75000000-0000-4000-8000-000000000044', 'flow-barber-no-reports@example.invalid', 'authenticated', 'authenticated', now(), now()),
  ('75000000-0000-4000-8000-000000000045', 'flow-client@example.invalid', 'authenticated', 'authenticated', now(), now());
insert into public.barbershops (id, name, slug, timezone) values
  ('97000000-0000-4000-8000-000000000041', 'Flow Test A', 'flow-test-fixture-a', 'America/Sao_Paulo'),
  ('97000000-0000-4000-8000-000000000042', 'Flow Test B', 'flow-test-fixture-b', 'UTC');
insert into public.memberships (id, barbershop_id, user_id, role, active) values
  ('76000000-0000-4000-8000-000000000041', '97000000-0000-4000-8000-000000000041', '75000000-0000-4000-8000-000000000041', 'admin', true),
  ('76000000-0000-4000-8000-000000000042', '97000000-0000-4000-8000-000000000041', '75000000-0000-4000-8000-000000000042', 'barber', true),
  ('76000000-0000-4000-8000-000000000043', '97000000-0000-4000-8000-000000000041', '75000000-0000-4000-8000-000000000043', 'barber', true),
  ('76000000-0000-4000-8000-000000000044', '97000000-0000-4000-8000-000000000041', '75000000-0000-4000-8000-000000000044', 'barber', true);
insert into public.module_permissions (barbershop_id, user_id, module, allowed) values
  ('97000000-0000-4000-8000-000000000041', '75000000-0000-4000-8000-000000000042', 'reports', true),
  ('97000000-0000-4000-8000-000000000041', '75000000-0000-4000-8000-000000000043', 'reports', true),
  ('97000000-0000-4000-8000-000000000041', '75000000-0000-4000-8000-000000000044', 'appointments', true);
insert into public.clients (id, barbershop_id, user_id, full_name) values
  ('77000000-0000-4000-8000-000000000041', '97000000-0000-4000-8000-000000000041', '75000000-0000-4000-8000-000000000045', 'Flow Client');
insert into public.appointments
  (id, barbershop_id, client_id, barber_membership_id, starts_at, ends_at, status, source)
values
  -- São Paulo 27 Sep 23:30: outside the 28 Sep local-day filter.
  ('78000000-0000-4000-8000-000000000041', '97000000-0000-4000-8000-000000000041', '77000000-0000-4000-8000-000000000041', '76000000-0000-4000-8000-000000000042', '2026-09-28 02:30:00+00', '2026-09-28 03:00:00+00', 'completed', 'admin'),
  -- São Paulo 28 Sep 00:30 and 23:30, both inside the same local day.
  ('78000000-0000-4000-8000-000000000042', '97000000-0000-4000-8000-000000000041', '77000000-0000-4000-8000-000000000041', '76000000-0000-4000-8000-000000000042', '2026-09-28 03:30:00+00', '2026-09-28 04:00:00+00', 'completed', 'admin'),
  ('78000000-0000-4000-8000-000000000043', '97000000-0000-4000-8000-000000000041', '77000000-0000-4000-8000-000000000041', '76000000-0000-4000-8000-000000000042', '2026-09-29 02:30:00+00', '2026-09-29 03:00:00+00', 'completed', 'admin'),
  ('78000000-0000-4000-8000-000000000044', '97000000-0000-4000-8000-000000000041', '77000000-0000-4000-8000-000000000041', '76000000-0000-4000-8000-000000000043', '2026-09-28 15:30:00+00', '2026-09-28 16:00:00+00', 'completed', 'admin'),
  -- São Paulo 29 Sep 00:30: outside 28 Sep.
  ('78000000-0000-4000-8000-000000000045', '97000000-0000-4000-8000-000000000041', '77000000-0000-4000-8000-000000000041', '76000000-0000-4000-8000-000000000042', '2026-09-29 03:30:00+00', '2026-09-29 04:00:00+00', 'completed', 'admin'),
  ('78000000-0000-4000-8000-000000000046', '97000000-0000-4000-8000-000000000041', '77000000-0000-4000-8000-000000000041', '76000000-0000-4000-8000-000000000043', '2026-09-28 18:30:00+00', '2026-09-28 19:00:00+00', 'cancelled', 'admin');

do $$
begin
  if has_function_privilege('anon', 'public.report_appointment_flow(uuid,date,date,uuid)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.report_appointment_flow(uuid,date,date,uuid)', 'EXECUTE') then
    raise exception 'Flow report RPC grants are incorrect';
  end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '75000000-0000-4000-8000-000000000041', true);
do $$
declare
  v_rows jsonb;
  v_denied boolean := false;
begin
  v_rows := public.report_appointment_flow(
    '97000000-0000-4000-8000-000000000041', '2026-09-28', '2026-09-28');
  if jsonb_array_length(v_rows) <> 3
    or not v_rows @> '[{"day":"2026-09-28","hour":0,"completed_count":1},{"day":"2026-09-28","hour":12,"completed_count":1},{"day":"2026-09-28","hour":23,"completed_count":1}]'::jsonb then
    raise exception 'Admin flow or local-day boundaries are incorrect: %', v_rows;
  end if;
  v_rows := public.report_appointment_flow(
    '97000000-0000-4000-8000-000000000041', '2026-09-27', '2026-09-27');
  if not v_rows @> '[{"day":"2026-09-27","hour":23,"completed_count":1}]'::jsonb then
    raise exception 'Previous local day lost the late visit: %', v_rows;
  end if;
  v_rows := public.report_appointment_flow(
    '97000000-0000-4000-8000-000000000041', '2026-09-28', '2026-09-28',
    '76000000-0000-4000-8000-000000000043');
  if jsonb_array_length(v_rows) <> 1
    or not v_rows @> '[{"day":"2026-09-28","hour":12,"completed_count":1}]'::jsonb then
    raise exception 'Admin barber filter is incorrect: %', v_rows;
  end if;
  begin
    perform public.report_appointment_flow(
      '97000000-0000-4000-8000-000000000042', '2026-09-28', '2026-09-28');
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then raise exception 'Shop admin opened another shop report'; end if;
end;
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '75000000-0000-4000-8000-000000000042', true);
do $$
declare
  v_rows jsonb;
  v_denied boolean := false;
begin
  if exists (select 1 from public.appointments
    where barbershop_id = '97000000-0000-4000-8000-000000000041') then
    raise exception 'Barber unexpectedly has direct appointment access';
  end if;
  v_rows := public.report_appointment_flow(
    '97000000-0000-4000-8000-000000000041', '2026-09-28', '2026-09-28');
  if jsonb_array_length(v_rows) <> 2
    or not v_rows @> '[{"day":"2026-09-28","hour":0,"completed_count":1},{"day":"2026-09-28","hour":23,"completed_count":1}]'::jsonb then
    raise exception 'Report-only barber did not see exactly own visits: %', v_rows;
  end if;
  begin
    perform public.report_appointment_flow(
      '97000000-0000-4000-8000-000000000041', '2026-09-28', '2026-09-28',
      '76000000-0000-4000-8000-000000000043');
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then raise exception 'Barber requested another barber report'; end if;
end;
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '75000000-0000-4000-8000-000000000044', true);
do $$
declare v_denied boolean := false;
begin
  begin
    perform public.report_appointment_flow(
      '97000000-0000-4000-8000-000000000041', '2026-09-28', '2026-09-28');
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then raise exception 'Barber without Reports opened flow report'; end if;
end;
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '75000000-0000-4000-8000-000000000045', true);
do $$
declare v_denied boolean := false;
begin
  begin
    perform public.report_appointment_flow(
      '97000000-0000-4000-8000-000000000041', '2026-09-28', '2026-09-28');
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then raise exception 'Client opened flow report'; end if;
end;
$$;
reset role;

rollback;
