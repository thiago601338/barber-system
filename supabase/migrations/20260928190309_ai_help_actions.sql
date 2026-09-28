-- Plans and their history are accessible through the authenticated server API only.
create table public.ai_help_plans (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid references public.barbershops(id) on delete cascade,
  requester_user_id uuid not null references auth.users(id) on delete cascade,
  prompt text not null check (length(btrim(prompt)) between 10 and 2000),
  summary text not null check (length(btrim(summary)) between 1 and 500),
  action_type text check (action_type in (
    'create_shop','create_service','create_product','create_shop_goal',
    'create_personal_goal','create_marketing_task'
  )),
  action_values jsonb check (action_values is null or jsonb_typeof(action_values) = 'object'),
  status text not null default 'processing'
    check (status in ('processing','pending','completed','unsupported','failed')),
  result jsonb,
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  executed_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status in ('processing','unsupported','failed') and action_type is null and action_values is null)
    or (status in ('pending','completed') and action_type is not null and action_values is not null)),
  check (status <> 'completed' or (result is not null and executed_at is not null))
);
create index ai_help_plans_user_created_idx
  on public.ai_help_plans (requester_user_id, created_at desc);
create index ai_help_plans_shop_created_idx
  on public.ai_help_plans (barbershop_id, created_at desc);
alter table public.ai_help_plans enable row level security;
revoke all on public.ai_help_plans from public, anon, authenticated;
grant all on public.ai_help_plans to service_role;

-- Atomic per-user daily quota; attempted prompts count even if unsupported.
create function public.start_ai_help_attempt(
  p_actor_id uuid, p_barbershop_id uuid, p_prompt text, p_daily_limit integer
)
returns public.ai_help_plans
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
  v_plan public.ai_help_plans%rowtype;
begin
  if p_daily_limit not between 1 and 100 then
    raise exception 'Limite diário inválido.' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_actor_id::text, 628153));
  select count(*) into v_count
  from public.ai_help_plans
  where requester_user_id = p_actor_id
    and created_at >= now() - interval '24 hours';
  if v_count >= p_daily_limit then
    raise exception 'Limite diário da Ajuda de IA atingido.' using errcode = 'P0001';
  end if;
  insert into public.ai_help_plans (
    barbershop_id, requester_user_id, prompt, summary, status
  ) values (
    p_barbershop_id, p_actor_id, p_prompt, 'Preparando a ação solicitada.', 'processing'
  ) returning * into v_plan;
  return v_plan;
end;
$$;
revoke execute on function public.start_ai_help_attempt(uuid, uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.start_ai_help_attempt(uuid, uuid, text, integer)
  to service_role;

-- One transaction locks a plan, rechecks current permissions, creates exactly one
-- record, and marks the plan completed. Calling twice cannot create duplicates.
create function public.execute_ai_help_plan(p_plan_id uuid, p_actor_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_plan public.ai_help_plans%rowtype;
  v_values jsonb;
  v_result jsonb;
  v_created_id uuid;
  v_master boolean;
  v_member_id uuid;
  v_member_role public.shop_role;
  v_ai_access boolean;
  v_action_permission boolean;
begin
  select * into v_plan
  from public.ai_help_plans
  where id = p_plan_id
  for update;
  if not found or v_plan.requester_user_id <> p_actor_id then
    raise exception 'Plano não encontrado.' using errcode = 'P0001';
  end if;
  if v_plan.status <> 'pending' then
    raise exception 'Este plano já foi usado.' using errcode = 'P0001';
  end if;
  if v_plan.expires_at <= now() then
    raise exception 'Este plano expirou. Peça outro à IA.' using errcode = 'P0001';
  end if;

  select exists (select 1 from public.platform_admins pa where pa.user_id = p_actor_id)
    into v_master;
  if v_plan.action_type = 'create_shop' then
    if not v_master or v_plan.barbershop_id is not null then
      raise exception 'Sem permissão para criar barbearias.' using errcode = '42501';
    end if;
  else
    if v_plan.barbershop_id is null or not exists (
      select 1 from public.barbershops b
      where b.id = v_plan.barbershop_id and b.active
    ) then
      raise exception 'Barbearia indisponível.' using errcode = '42501';
    end if;
    select m.id, m.role into v_member_id, v_member_role
    from public.memberships m
    where m.barbershop_id = v_plan.barbershop_id
      and m.user_id = p_actor_id and m.active;
    if not v_master and v_member_role is null then
      raise exception 'Acesso à barbearia revogado.' using errcode = '42501';
    end if;
    if not v_master and v_member_role = 'barber' then
      select coalesce(bool_or(mp.module = 'ai'), false),
             coalesce(bool_or(mp.module = case v_plan.action_type
               when 'create_personal_goal' then 'goals'
               when 'create_marketing_task' then 'marketing'
               else '__not_allowed__' end), false)
      into v_ai_access, v_action_permission
      from public.module_permissions mp
      where mp.barbershop_id = v_plan.barbershop_id
        and mp.user_id = p_actor_id and mp.allowed;
      if not v_ai_access or not v_action_permission then
        raise exception 'Permissão para esta ação foi revogada.' using errcode = '42501';
      end if;
    elsif not v_master and v_member_role <> 'admin' then
      raise exception 'Sem permissão para esta ação.' using errcode = '42501';
    end if;
    if v_plan.action_type = 'create_personal_goal'
      and (v_member_role <> 'barber' or v_member_id is null) then
      raise exception 'A meta pessoal exige um barbeiro ativo.' using errcode = '42501';
    end if;
    if v_plan.action_type not in (
      'create_service','create_product','create_shop_goal',
      'create_personal_goal','create_marketing_task'
    ) then
      raise exception 'Ação indisponível.' using errcode = 'P0001';
    end if;
  end if;

  v_values := v_plan.action_values;
  if v_plan.action_type = 'create_shop' then
    insert into public.barbershops (name, slug)
    values (v_values->>'name', v_values->>'slug')
    returning id into v_created_id;
    insert into public.memberships (barbershop_id, user_id, role, display_name, active)
    values (v_created_id, p_actor_id, 'admin', 'Administrador master', true);
    v_result := jsonb_build_object('id', v_created_id, 'name', v_values->>'name', 'slug', v_values->>'slug');
  elsif v_plan.action_type = 'create_service' then
    insert into public.services (
      barbershop_id, name, description, duration_minutes, price_cents, cost_cents, active
    ) values (
      v_plan.barbershop_id, v_values->>'name', v_values->>'description',
      (v_values->>'duration_minutes')::integer, (v_values->>'price_cents')::integer,
      (v_values->>'cost_cents')::integer, true
    ) returning id into v_created_id;
    v_result := jsonb_build_object('id', v_created_id, 'name', v_values->>'name');
  elsif v_plan.action_type = 'create_product' then
    insert into public.products (
      barbershop_id, name, sku, description, category,
      price_cents, cost_cents, stock_quantity, active
    ) values (
      v_plan.barbershop_id, v_values->>'name', nullif(v_values->>'sku', ''),
      v_values->>'description', v_values->>'category',
      (v_values->>'price_cents')::integer, (v_values->>'cost_cents')::integer,
      (v_values->>'stock_quantity')::integer, true
    ) returning id into v_created_id;
    v_result := jsonb_build_object('id', v_created_id, 'name', v_values->>'name');
  elsif v_plan.action_type in ('create_shop_goal','create_personal_goal') then
    insert into public.goals (
      barbershop_id, barber_membership_id, title, metric, target_value,
      period_start, period_end, created_by
    ) values (
      v_plan.barbershop_id,
      case when v_plan.action_type = 'create_personal_goal' then v_member_id else null end,
      v_values->>'title', v_values->>'metric',
      (v_values->>'target_value')::numeric,
      (v_values->>'period_start')::date, (v_values->>'period_end')::date,
      p_actor_id
    ) returning id into v_created_id;
    v_result := jsonb_build_object('id', v_created_id, 'title', v_values->>'title');
  elsif v_plan.action_type = 'create_marketing_task' then
    insert into public.marketing_tasks (
      barbershop_id, assignee_user_id, title, channel, due_on
    ) values (
      v_plan.barbershop_id, p_actor_id, v_values->>'title',
      v_values->>'channel', nullif(v_values->>'due_on', '')::date
    ) returning id into v_created_id;
    v_result := jsonb_build_object('id', v_created_id, 'title', v_values->>'title');
  else
    raise exception 'Ação indisponível.' using errcode = 'P0001';
  end if;

  update public.ai_help_plans
  set status = 'completed', result = v_result, executed_at = now()
  where id = p_plan_id;
  return jsonb_build_object('status', 'completed', 'result', v_result);
end;
$$;
revoke execute on function public.execute_ai_help_plan(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.execute_ai_help_plan(uuid, uuid)
  to service_role;
