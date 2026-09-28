-- Run after tutorial migration. Fixtures and progress disappear at ROLLBACK.
begin;

insert into auth.users (id, email, aud, role, created_at, updated_at) values
  ('72000000-0000-4000-8000-000000000001', 'tutorial-master@example.invalid', 'authenticated', 'authenticated', now(), now()),
  ('72000000-0000-4000-8000-000000000002', 'tutorial-admin@example.invalid', 'authenticated', 'authenticated', now(), now()),
  ('72000000-0000-4000-8000-000000000003', 'tutorial-barber-a@example.invalid', 'authenticated', 'authenticated', now(), now()),
  ('72000000-0000-4000-8000-000000000004', 'tutorial-client-a@example.invalid', 'authenticated', 'authenticated', now(), now()),
  ('72000000-0000-4000-8000-000000000005', 'tutorial-barber-b@example.invalid', 'authenticated', 'authenticated', now(), now()),
  ('72000000-0000-4000-8000-000000000006', 'tutorial-client-b@example.invalid', 'authenticated', 'authenticated', now(), now());
insert into public.platform_admins (user_id) values
  ('72000000-0000-4000-8000-000000000001');
insert into public.barbershops (id, name, slug) values
  ('91000000-0000-4000-8000-000000000001', 'Tutorial Shop A', 'tutorial-fixture-a'),
  ('91000000-0000-4000-8000-000000000002', 'Tutorial Shop B', 'tutorial-fixture-b');
insert into public.memberships (id, barbershop_id, user_id, role) values
  ('92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000002', 'admin'),
  ('92000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000003', 'barber'),
  ('92000000-0000-4000-8000-000000000003', '91000000-0000-4000-8000-000000000002', '72000000-0000-4000-8000-000000000005', 'barber');
insert into public.module_permissions (barbershop_id, user_id, module, allowed) values
  ('91000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000003', 'clients', true),
  ('91000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000003', 'marketing', false);
insert into public.clients (id, barbershop_id, user_id, full_name) values
  ('93000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000004', 'Tutorial Client A'),
  ('93000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000002', '72000000-0000-4000-8000-000000000006', 'Tutorial Client B');

do $$
begin
  if has_table_privilege('anon', 'public.tutorial_steps', 'SELECT')
     or has_table_privilege('anon', 'public.tutorial_progress', 'SELECT')
     or has_table_privilege('authenticated', 'public.tutorial_steps', 'INSERT')
     or has_table_privilege('authenticated', 'public.tutorial_progress', 'DELETE') then
    raise exception 'Tutorial table privileges are too broad';
  end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '72000000-0000-4000-8000-000000000002', true);
do $$
declare
  v_step_id uuid;
begin
  select id into v_step_id from public.tutorial_steps
  where role = 'admin' and module_key = 'clients' and position = 1;
  if v_step_id is null then raise exception 'Admin tutorial missing'; end if;
  insert into public.tutorial_progress (user_id, barbershop_id, step_id, completed_at)
  values ('72000000-0000-4000-8000-000000000002',
          '91000000-0000-4000-8000-000000000001', v_step_id, now());
  if (select count(*) from public.tutorial_progress where completed_at is not null) <> 1 then
    raise exception 'Admin progress was not stored';
  end if;
  begin
    insert into public.tutorial_progress (user_id, barbershop_id, step_id, completed_at)
    values ('72000000-0000-4000-8000-000000000002',
            '91000000-0000-4000-8000-000000000002', v_step_id, now());
    raise exception 'Admin wrote progress for another shop';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '72000000-0000-4000-8000-000000000003', true);
do $$
declare
  v_step_id uuid;
  v_admin_step_id uuid;
begin
  if (select count(*) from public.tutorial_steps
      where role = 'barber' and module_key = 'clients') = 0
     or (select count(*) from public.tutorial_steps
      where role = 'barber' and module_key = 'marketing') <> 0 then
    raise exception 'Barber module permission did not filter steps';
  end if;
  select id into v_step_id from public.tutorial_steps
  where role = 'barber' and module_key = 'clients' and position = 1;
  select id into v_admin_step_id from public.tutorial_steps
  where role = 'admin' and module_key = 'clients' and position = 1;
  -- RLS hides admin steps; obtain that ID through a fixture constant-independent
  -- subquery is impossible as this role, so verify denied cross-shop instead.
  if v_admin_step_id is not null then
    raise exception 'Barber can see admin steps';
  end if;
  insert into public.tutorial_progress (user_id, barbershop_id, step_id, completed_at)
  values ('72000000-0000-4000-8000-000000000003',
          '91000000-0000-4000-8000-000000000001', v_step_id, now());
  if (select count(*) from public.tutorial_progress) <> 1 then
    raise exception 'Barber should see only own progress';
  end if;
  begin
    insert into public.tutorial_progress (user_id, barbershop_id, step_id, completed_at)
    values ('72000000-0000-4000-8000-000000000003',
            '91000000-0000-4000-8000-000000000002', v_step_id, now());
    raise exception 'Barber wrote progress for another shop';
  exception when insufficient_privilege then null;
  end;
  update public.tutorial_progress set completed_at = null
  where user_id = '72000000-0000-4000-8000-000000000003'
    and step_id = v_step_id;
  if (select count(*) from public.tutorial_progress where completed_at is null) <> 1 then
    raise exception 'Barber could not clear own step';
  end if;
end;
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '72000000-0000-4000-8000-000000000005', true);
do $$
begin
  if (select count(*) from public.tutorial_steps
      where role = 'barber' and module_key = 'clients') <> 0
     or (select count(*) from public.tutorial_steps
      where role = 'barber' and module_key = 'tutorial') = 0
     or (select count(*) from public.tutorial_progress) <> 0 then
    raise exception 'Second-shop barber saw another role or user progress';
  end if;
end;
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '72000000-0000-4000-8000-000000000004', true);
do $$
declare
  v_step_id uuid;
begin
  select id into v_step_id from public.tutorial_steps
  where role = 'client' and module_key = 'appointments' and position = 1;
  if v_step_id is null then raise exception 'Client tutorial missing'; end if;
  insert into public.tutorial_progress (user_id, barbershop_id, step_id, completed_at)
  values ('72000000-0000-4000-8000-000000000004',
          '91000000-0000-4000-8000-000000000001', v_step_id, now());
  if (select count(*) from public.tutorial_progress) <> 1 then
    raise exception 'Client saw another user progress';
  end if;
  begin
    insert into public.tutorial_progress (user_id, barbershop_id, step_id, completed_at)
    values ('72000000-0000-4000-8000-000000000004',
            '91000000-0000-4000-8000-000000000002', v_step_id, now());
    raise exception 'Client wrote progress for another shop';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '72000000-0000-4000-8000-000000000001', true);
do $$
declare
  v_step_id uuid;
begin
  select id into v_step_id from public.tutorial_steps
  where role = 'master' and module_key = 'master' and position = 1;
  if v_step_id is null then raise exception 'Master tutorial missing'; end if;
  insert into public.tutorial_progress (user_id, barbershop_id, step_id, completed_at)
  values ('72000000-0000-4000-8000-000000000001', null, v_step_id, now());
  if (select count(*) from public.tutorial_progress) <> 1 then
    raise exception 'Master saw another user progress';
  end if;
  begin
    insert into public.tutorial_progress (user_id, barbershop_id, step_id, completed_at)
    values ('72000000-0000-4000-8000-000000000001',
            '91000000-0000-4000-8000-000000000001', v_step_id, now());
    raise exception 'Master step was saved with a shop context';
  exception when check_violation then null;
  end;
end;
$$;
reset role;

rollback;
