-- Run after ai_help_actions. Every fixture and action is rolled back.
begin;

insert into auth.users (id, email, aud, role, created_at, updated_at) values
  ('75000000-0000-4000-8000-000000000031', 'ai-admin@example.invalid', 'authenticated', 'authenticated', now(), now()),
  ('75000000-0000-4000-8000-000000000032', 'ai-barber@example.invalid', 'authenticated', 'authenticated', now(), now()),
  ('75000000-0000-4000-8000-000000000033', 'ai-barber-no-access@example.invalid', 'authenticated', 'authenticated', now(), now()),
  ('75000000-0000-4000-8000-000000000034', 'ai-client@example.invalid', 'authenticated', 'authenticated', now(), now()),
  ('75000000-0000-4000-8000-000000000035', 'ai-master@example.invalid', 'authenticated', 'authenticated', now(), now()),
  ('75000000-0000-4000-8000-000000000036', 'ai-quota@example.invalid', 'authenticated', 'authenticated', now(), now());

insert into public.barbershops (id, name, slug) values
  ('97000000-0000-4000-8000-000000000031', 'AI Test A', 'ai-test-fixture-a'),
  ('97000000-0000-4000-8000-000000000032', 'AI Test B', 'ai-test-fixture-b');
insert into public.memberships (id, barbershop_id, user_id, role, display_name, active) values
  ('76000000-0000-4000-8000-000000000031', '97000000-0000-4000-8000-000000000031', '75000000-0000-4000-8000-000000000031', 'admin', 'Admin', true),
  ('76000000-0000-4000-8000-000000000032', '97000000-0000-4000-8000-000000000031', '75000000-0000-4000-8000-000000000032', 'barber', 'Barber with AI', true),
  ('76000000-0000-4000-8000-000000000033', '97000000-0000-4000-8000-000000000031', '75000000-0000-4000-8000-000000000033', 'barber', 'Barber without AI', true);
insert into public.platform_admins (user_id)
values ('75000000-0000-4000-8000-000000000035');
insert into public.module_permissions (barbershop_id, user_id, module, allowed) values
  ('97000000-0000-4000-8000-000000000031', '75000000-0000-4000-8000-000000000032', 'ai', true),
  ('97000000-0000-4000-8000-000000000031', '75000000-0000-4000-8000-000000000032', 'goals', true),
  ('97000000-0000-4000-8000-000000000031', '75000000-0000-4000-8000-000000000033', 'ai', false),
  ('97000000-0000-4000-8000-000000000031', '75000000-0000-4000-8000-000000000033', 'goals', true);

do $$
begin
  if has_function_privilege('anon', 'public.start_ai_help_attempt(uuid,uuid,text,integer)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.start_ai_help_attempt(uuid,uuid,text,integer)', 'EXECUTE')
    or has_function_privilege('anon', 'public.execute_ai_help_plan(uuid,uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.execute_ai_help_plan(uuid,uuid)', 'EXECUTE')
    or has_table_privilege('anon', 'public.ai_help_plans', 'SELECT')
    or has_table_privilege('authenticated', 'public.ai_help_plans', 'SELECT')
    or has_table_privilege('authenticated', 'public.ai_help_plans', 'INSERT') then
    raise exception 'AI plans or RPCs are exposed to a browser role';
  end if;
end;
$$;

insert into public.ai_help_plans
  (id, barbershop_id, requester_user_id, prompt, summary, status, action_type, action_values)
values
  ('98000000-0000-4000-8000-000000000031', '97000000-0000-4000-8000-000000000031', '75000000-0000-4000-8000-000000000032', 'Create my personal monthly goal', 'Personal goal', 'pending', 'create_personal_goal', '{"title":"AI goal allowed","metric":"appointments","target_value":10,"period_start":"2026-09-01","period_end":"2026-09-30"}'),
  ('98000000-0000-4000-8000-000000000032', '97000000-0000-4000-8000-000000000031', '75000000-0000-4000-8000-000000000032', 'Create another personal goal', 'Revoked goal', 'pending', 'create_personal_goal', '{"title":"AI goal revoked","metric":"appointments","target_value":10,"period_start":"2026-09-01","period_end":"2026-09-30"}'),
  ('98000000-0000-4000-8000-000000000033', '97000000-0000-4000-8000-000000000031', '75000000-0000-4000-8000-000000000033', 'Create a personal goal without AI permission', 'Unauthorized goal', 'pending', 'create_personal_goal', '{"title":"AI goal no AI access","metric":"appointments","target_value":10,"period_start":"2026-09-01","period_end":"2026-09-30"}'),
  ('98000000-0000-4000-8000-000000000034', '97000000-0000-4000-8000-000000000032', '75000000-0000-4000-8000-000000000032', 'Create a goal in another shop', 'Other shop goal', 'pending', 'create_personal_goal', '{"title":"AI goal other shop","metric":"appointments","target_value":10,"period_start":"2026-09-01","period_end":"2026-09-30"}'),
  ('98000000-0000-4000-8000-000000000035', '97000000-0000-4000-8000-000000000031', '75000000-0000-4000-8000-000000000034', 'Create a goal for a client', 'Client goal', 'pending', 'create_personal_goal', '{"title":"AI goal client","metric":"appointments","target_value":10,"period_start":"2026-09-01","period_end":"2026-09-30"}'),
  ('98000000-0000-4000-8000-000000000036', null, '75000000-0000-4000-8000-000000000031', 'Create a shop without master access', 'Unauthorized shop', 'pending', 'create_shop', '{"name":"AI Invalid Shop","slug":"ai-invalid-fixture"}'),
  ('98000000-0000-4000-8000-000000000037', null, '75000000-0000-4000-8000-000000000035', 'Create a shop with master access', 'Master shop', 'pending', 'create_shop', '{"name":"AI Master Shop","slug":"ai-master-fixture"}');

set local role service_role;

do $$
declare
  v_result jsonb;
  v_denied boolean;
  v_shop_id uuid;
begin
  -- A permitted barber can create exactly one personal goal, linked to self.
  v_result := public.execute_ai_help_plan(
    '98000000-0000-4000-8000-000000000031', '75000000-0000-4000-8000-000000000032');
  if v_result->>'status' <> 'completed'
    or (select count(*) from public.goals where title = 'AI goal allowed'
      and barbershop_id = '97000000-0000-4000-8000-000000000031'
      and barber_membership_id = '76000000-0000-4000-8000-000000000032') <> 1 then
    raise exception 'Permitted barber did not get exactly one own goal';
  end if;
  v_denied := false;
  begin
    perform public.execute_ai_help_plan(
      '98000000-0000-4000-8000-000000000031', '75000000-0000-4000-8000-000000000032');
  exception when sqlstate 'P0001' then v_denied := true;
  end;
  if not v_denied or (select count(*) from public.goals where title = 'AI goal allowed') <> 1 then
    raise exception 'Duplicate execution created another goal or was accepted';
  end if;

  -- A plan must not survive revocation of its action permission.
  update public.module_permissions set allowed = false
  where barbershop_id = '97000000-0000-4000-8000-000000000031'
    and user_id = '75000000-0000-4000-8000-000000000032' and module = 'goals';
  v_denied := false;
  begin
    perform public.execute_ai_help_plan(
      '98000000-0000-4000-8000-000000000032', '75000000-0000-4000-8000-000000000032');
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied or exists (select 1 from public.goals where title = 'AI goal revoked') then
    raise exception 'Revoked goal permission was ignored';
  end if;

  v_denied := false;
  begin
    perform public.execute_ai_help_plan(
      '98000000-0000-4000-8000-000000000033', '75000000-0000-4000-8000-000000000033');
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied or exists (select 1 from public.goals where title = 'AI goal no AI access') then
    raise exception 'Barber without AI permission executed a plan';
  end if;

  v_denied := false;
  begin
    perform public.execute_ai_help_plan(
      '98000000-0000-4000-8000-000000000034', '75000000-0000-4000-8000-000000000032');
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied or exists (select 1 from public.goals where title = 'AI goal other shop') then
    raise exception 'Cross-shop barber action was accepted';
  end if;

  v_denied := false;
  begin
    perform public.execute_ai_help_plan(
      '98000000-0000-4000-8000-000000000035', '75000000-0000-4000-8000-000000000034');
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied or exists (select 1 from public.goals where title = 'AI goal client') then
    raise exception 'Client executed an AI plan';
  end if;

  v_denied := false;
  begin
    perform public.execute_ai_help_plan(
      '98000000-0000-4000-8000-000000000036', '75000000-0000-4000-8000-000000000031');
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied or exists (select 1 from public.barbershops where slug = 'ai-invalid-fixture') then
    raise exception 'Non-master created a shop';
  end if;

  v_result := public.execute_ai_help_plan(
    '98000000-0000-4000-8000-000000000037', '75000000-0000-4000-8000-000000000035');
  v_shop_id := (v_result->'result'->>'id')::uuid;
  if v_shop_id is null or not exists (
    select 1 from public.memberships
    where barbershop_id = v_shop_id and user_id = '75000000-0000-4000-8000-000000000035'
      and role = 'admin' and active
  ) then
    raise exception 'Master shop action did not assign its administrator';
  end if;
end;
$$;

-- Quota rejects the next prompt atomically for the same user.
do $$
declare
  v_denied boolean := false;
begin
  perform public.start_ai_help_attempt(
    '75000000-0000-4000-8000-000000000036', null, 'A valid request for a shop goal', 1);
  begin
    perform public.start_ai_help_attempt(
      '75000000-0000-4000-8000-000000000036', null, 'Another valid request for a goal', 1);
  exception when sqlstate 'P0001' then v_denied := true;
  end;
  if not v_denied or (select count(*) from public.ai_help_plans
    where requester_user_id = '75000000-0000-4000-8000-000000000036') <> 1 then
    raise exception 'Daily AI request limit was not enforced';
  end if;
end;
$$;

reset role;
rollback;
