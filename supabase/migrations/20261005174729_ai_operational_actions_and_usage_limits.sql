-- Depends on the scheduling/contract migrations. No action sends a message or starts a charge.
grant usage on schema app_private to service_role;
grant execute on function app_private.book_appointment(uuid,uuid,uuid,uuid[],timestamptz,uuid) to service_role;
grant execute on function app_private.available_slots(uuid,uuid,uuid[],date) to service_role;
grant execute on function app_private.subscription_eligibility_for_booking(uuid,uuid,uuid[],timestamptz,uuid) to service_role;
grant select,insert on public.schedule_blocks to service_role;
create table public.ai_help_quota_settings (
 id smallint primary key default 1 check(id=1), enabled boolean not null default true,
 master_daily_limit integer not null default 50 check(master_daily_limit between 1 and 1000),
 admin_daily_limit integer not null default 20 check(admin_daily_limit between 1 and 1000),
 barber_daily_limit integer not null default 10 check(barber_daily_limit between 1 and 1000),
 updated_at timestamptz not null default now()
);
insert into public.ai_help_quota_settings(id) values(1);
create table public.ai_help_shop_limits (
 barbershop_id uuid primary key references public.barbershops(id) on delete cascade,
 enabled boolean not null default true,
 admin_daily_limit integer check(admin_daily_limit between 1 and 1000),
 barber_daily_limit integer check(barber_daily_limit between 1 and 1000),
 daily_shop_limit integer check(daily_shop_limit between 1 and 100000),
 monthly_token_limit bigint check(monthly_token_limit between 1000 and 1000000000),
 updated_at timestamptz not null default now()
);
alter table public.ai_help_plans drop constraint ai_help_plans_action_type_check;
alter table public.ai_help_plans add constraint ai_help_plans_action_type_check check(action_type in (
 'create_shop','create_service','create_product','create_shop_goal','create_personal_goal','create_marketing_task',
 'book_appointment','create_schedule_block','update_service','update_product','create_client','update_client'));
alter table public.ai_help_plans add column reserved_tokens integer not null default 0 check(reserved_tokens between 0 and 1000000),
 add column idempotency_key uuid;
create unique index ai_help_plan_idempotency on public.ai_help_plans(requester_user_id,idempotency_key) where idempotency_key is not null;
create table public.ai_help_usage (
 plan_id uuid primary key references public.ai_help_plans(id) on delete cascade,
 barbershop_id uuid references public.barbershops(id) on delete cascade,
 requester_user_id uuid not null references auth.users(id) on delete cascade,
 model text not null,
 prompt_tokens integer check(prompt_tokens>=0), completion_tokens integer check(completion_tokens>=0), total_tokens integer check(total_tokens>=0),
 cost_cents bigint check(cost_cents>=0), cost_currency text, cost_source text not null default 'not_reported',
 created_at timestamptz not null default now(),
 check((cost_cents is null and cost_currency is null) or (cost_cents is not null and cost_currency is not null))
);
create index ai_help_usage_shop_date on public.ai_help_usage(barbershop_id,created_at);
create table public.ai_help_action_audit (
 id uuid primary key default gen_random_uuid(), plan_id uuid not null unique references public.ai_help_plans(id),
 barbershop_id uuid references public.barbershops(id), actor_user_id uuid not null references auth.users(id),
 actor_role text not null check(actor_role in ('master','admin','barber')), action_type text not null,
 record_id uuid not null, before_values jsonb, after_values jsonb not null, created_at timestamptz not null default now()
);
create index ai_action_audit_shop_date on public.ai_help_action_audit(barbershop_id,created_at);
do $$ declare t text; begin
 foreach t in array array['ai_help_quota_settings','ai_help_shop_limits','ai_help_usage','ai_help_action_audit'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
grant select on public.ai_help_usage,public.ai_help_action_audit to authenticated;
create policy ai_usage_admin_read on public.ai_help_usage for select to authenticated
 using(app_private.is_platform_admin() or (barbershop_id is not null and app_private.has_shop_role(barbershop_id,array['admin']::public.shop_role[])));
create policy ai_action_audit_read on public.ai_help_action_audit for select to authenticated
 using(app_private.is_platform_admin() or (barbershop_id is not null and app_private.has_shop_role(barbershop_id,array['admin']::public.shop_role[]))
  or (actor_user_id=(select auth.uid()) and barbershop_id is not null and app_private.has_module(barbershop_id,'ai')));

create function app_private.ai_help_assert_actor(p_actor_id uuid,p_barbershop_id uuid,p_action_type text default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_master boolean; m public.memberships%rowtype; v_module text;
begin
 if p_actor_id is null then raise exception 'Solicitante não identificado' using errcode='42501'; end if;
 select exists(select 1 from public.platform_admins where user_id=p_actor_id) into v_master;
 if p_barbershop_id is null then
  if not v_master or (p_action_type is not null and p_action_type<>'create_shop') then raise exception 'Ação exige contexto autorizado' using errcode='42501'; end if;
  return jsonb_build_object('role','master','member_id',null);
 end if;
 if not exists(select 1 from public.barbershops where id=p_barbershop_id and active) then raise exception 'Barbearia indisponível' using errcode='42501'; end if;
 if v_master then
  if p_action_type='create_shop' then raise exception 'Crie a barbearia no contexto da plataforma' using errcode='42501'; end if;
  return jsonb_build_object('role','master','member_id',null);
 end if;
 select * into m from public.memberships where barbershop_id=p_barbershop_id and user_id=p_actor_id and active;
 if not found then raise exception 'Acesso à barbearia revogado' using errcode='42501'; end if;
 if m.role='admin' then
  if p_action_type in ('create_shop','create_personal_goal') then raise exception 'Ação não permitida para este perfil' using errcode='42501'; end if;
  return jsonb_build_object('role','admin','member_id',m.id);
 end if;
 if not exists(select 1 from public.module_permissions where barbershop_id=p_barbershop_id and user_id=p_actor_id and module='ai' and allowed) then
  raise exception 'Ajuda de IA não permitida' using errcode='42501'; end if;
 v_module:=case p_action_type when 'create_personal_goal' then 'goals' when 'create_marketing_task' then 'marketing'
  when 'book_appointment' then 'appointments' when 'create_schedule_block' then 'availability'
  when 'create_client' then 'clients' when 'update_client' then 'clients' else null end;
 if p_action_type is not null and (v_module is null or not exists(select 1 from public.module_permissions
   where barbershop_id=p_barbershop_id and user_id=p_actor_id and module=v_module and allowed)) then
  raise exception 'Permissão para esta ação foi revogada' using errcode='42501'; end if;
 return jsonb_build_object('role','barber','member_id',m.id);
end $$;
revoke all on function app_private.ai_help_assert_actor(uuid,uuid,text) from public,anon,authenticated;
grant execute on function app_private.ai_help_assert_actor(uuid,uuid,text) to service_role;

create function public.ai_help_limits(p_actor_id uuid,p_barbershop_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a jsonb; q public.ai_help_quota_settings%rowtype; s public.ai_help_shop_limits%rowtype;
begin
 a:=app_private.ai_help_assert_actor(p_actor_id,p_barbershop_id);
 select * into strict q from public.ai_help_quota_settings where id=1;
 select * into s from public.ai_help_shop_limits where barbershop_id=p_barbershop_id;
 return jsonb_build_object('enabled',q.enabled and coalesce(s.enabled,true),'daily_limit',case a->>'role'
   when 'master' then q.master_daily_limit when 'admin' then coalesce(s.admin_daily_limit,q.admin_daily_limit)
   else coalesce(s.barber_daily_limit,q.barber_daily_limit) end,'daily_shop_limit',s.daily_shop_limit,'monthly_token_limit',s.monthly_token_limit);
end $$;
revoke all on function public.ai_help_limits(uuid,uuid) from public,anon,authenticated;
grant execute on function public.ai_help_limits(uuid,uuid) to service_role;

drop function public.start_ai_help_attempt(uuid,uuid,text,integer);
create function public.start_ai_help_attempt(p_actor_id uuid,p_barbershop_id uuid,p_prompt text,p_daily_limit integer,
 p_token_reservation integer default 0,p_idempotency_key uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare l jsonb; n bigint; tokens bigint; v_plan public.ai_help_plans%rowtype;
begin
 -- p_daily_limit remains for API compatibility; only master-configured limits are authoritative.
 perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text,628153));
 if p_barbershop_id is not null then perform pg_advisory_xact_lock(hashtextextended(p_barbershop_id::text,628154)); end if;
 l:=public.ai_help_limits(p_actor_id,p_barbershop_id);
 if not (l->>'enabled')::boolean then raise exception 'Ajuda de IA desativada pelo master' using errcode='42501'; end if;
 if p_idempotency_key is not null then
  select * into v_plan from public.ai_help_plans where requester_user_id=p_actor_id and idempotency_key=p_idempotency_key;
  if found then
   if v_plan.barbershop_id is distinct from p_barbershop_id or v_plan.prompt<>p_prompt then raise exception 'Chave de pedido usada em outro contexto' using errcode='22023'; end if;
   return to_jsonb(v_plan)||jsonb_build_object('reused',true);
  end if;
 end if;
 select count(*) into n from public.ai_help_plans where requester_user_id=p_actor_id and created_at>=now()-interval '24 hours';
 if n>=(l->>'daily_limit')::integer then raise exception 'Limite diário do perfil atingido' using errcode='P0001'; end if;
 if p_barbershop_id is not null and l->>'daily_shop_limit' is not null then
  select count(*) into n from public.ai_help_plans where barbershop_id=p_barbershop_id and created_at>=now()-interval '24 hours';
  if n>=(l->>'daily_shop_limit')::integer then raise exception 'Limite diário da barbearia atingido' using errcode='P0001'; end if;
 end if;
 if p_token_reservation is null or p_token_reservation<0 or p_token_reservation>1000000 then raise exception 'Reserva de tokens inválida' using errcode='22023'; end if;
 if p_barbershop_id is not null and l->>'monthly_token_limit' is not null then
  select coalesce(sum(coalesce(u.total_tokens,p.reserved_tokens)),0) into tokens from public.ai_help_usage u join public.ai_help_plans p on p.id=u.plan_id
   where u.barbershop_id=p_barbershop_id and u.created_at>=date_trunc('month',now());
  select tokens+coalesce(sum(reserved_tokens),0) into tokens from public.ai_help_plans where barbershop_id=p_barbershop_id
   and status='processing' and created_at>=date_trunc('month',now()) and not exists(select 1 from public.ai_help_usage u where u.plan_id=ai_help_plans.id);
  if tokens+p_token_reservation>(l->>'monthly_token_limit')::bigint then raise exception 'Limite mensal de tokens da barbearia atingido' using errcode='P0001'; end if;
 end if;
 insert into public.ai_help_plans(barbershop_id,requester_user_id,prompt,summary,status,reserved_tokens,idempotency_key)
 values(p_barbershop_id,p_actor_id,p_prompt,'Preparando a solicitação.','processing',p_token_reservation,p_idempotency_key) returning * into v_plan;
 return to_jsonb(v_plan)||jsonb_build_object('reused',false);
end $$;
revoke all on function public.start_ai_help_attempt(uuid,uuid,text,integer,integer,uuid) from public,anon,authenticated;
grant execute on function public.start_ai_help_attempt(uuid,uuid,text,integer,integer,uuid) to service_role;

create function public.validate_ai_help_action(p_actor_id uuid,p_barbershop_id uuid,p_action_type text,p_values jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a jsonb; v_member uuid; v_client uuid; v_services uuid[]; v_start timestamptz; v_end timestamptz; v_sub uuid;
  v_eligibility jsonb; v_record jsonb; v_timezone text; v_values jsonb:=p_values; v_previous_claims text:=current_setting('request.jwt.claims',true);
  v_previous_sub text:=current_setting('request.jwt.claim.sub',true);
begin
 a:=app_private.ai_help_assert_actor(p_actor_id,p_barbershop_id,p_action_type);
 if p_values is null or jsonb_typeof(p_values)<>'object' then raise exception 'Proposta inválida' using errcode='22023'; end if;
 if p_action_type in ('book_appointment','create_schedule_block') then
  v_member:=(p_values->>'barber_membership_id')::uuid;
  if not exists(select 1 from public.memberships where id=v_member and barbershop_id=p_barbershop_id and role='barber' and active)
    or (a->>'role'='barber' and v_member<>(a->>'member_id')::uuid) then raise exception 'Profissional fora do seu acesso' using errcode='42501'; end if;
  v_start:=(p_values->>'starts_at')::timestamptz;
  if v_start is null or v_start<now() or v_start>now()+interval '365 days' then raise exception 'Escolha um horário futuro em até 365 dias' using errcode='22023'; end if;
  select display_name into v_timezone from public.memberships where id=v_member;
  v_values:=v_values||jsonb_build_object('professional_label',coalesce(v_timezone,'Profissional'));
 end if;
 if p_action_type='book_appointment' then
  v_client:=(p_values->>'client_id')::uuid;
  if not exists(select 1 from public.clients where id=v_client and barbershop_id=p_barbershop_id)
    or (a->>'role'='barber' and not exists(select 1 from public.client_barbers where barbershop_id=p_barbershop_id and client_id=v_client and barber_membership_id=v_member)) then
   raise exception 'Cliente fora do seu acesso' using errcode='42501'; end if;
  select array_agg(value::uuid) into v_services from jsonb_array_elements_text(p_values->'service_ids');
  if v_services is null or cardinality(v_services)<1 or cardinality(v_services)>30 or (select count(distinct id) from public.services where barbershop_id=p_barbershop_id and active and id=any(v_services))<>cardinality(v_services) then
   raise exception 'Serviços fora desta barbearia ou repetidos' using errcode='22023'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor_id,'role','authenticated')::text,true);
  perform set_config('request.jwt.claim.sub',p_actor_id::text,true);
  v_sub:=nullif(p_values->>'subscription_id','')::uuid;
  v_eligibility:=app_private.subscription_eligibility_for_booking(p_barbershop_id,v_client,v_services,v_start);
  if (v_sub is null and (v_eligibility->>'requires_subscription')::boolean) or (v_sub is not null and not exists(
    select 1 from jsonb_array_elements(v_eligibility->'subscriptions') item where (item->>'id')::uuid=v_sub)) then
   raise exception 'Serviço exclusivo ou assinatura sem cobertura e saldo. Revise o contrato.' using errcode='22023'; end if;
  select timezone into v_timezone from public.barbershops where id=p_barbershop_id;
  if not exists(select 1 from app_private.available_slots(p_barbershop_id,v_member,v_services,(v_start at time zone v_timezone)::date) s where s.starts_at=v_start) then
   raise exception 'Esse horário não está livre. Escolha uma vaga da agenda.' using errcode='22023'; end if;
  v_values:=v_values||jsonb_build_object('client_label',(select full_name from public.clients where id=v_client),
    'services_label',(select string_agg(name,', ' order by name) from public.services where id=any(v_services) and barbershop_id=p_barbershop_id));
 elsif p_action_type='create_schedule_block' then
  v_end:=(p_values->>'ends_at')::timestamptz;
  if v_end is null or v_end<=v_start or v_end-v_start>interval '7 days' or length(btrim(p_values->>'reason')) not between 2 and 500 then raise exception 'Bloqueio inválido' using errcode='22023'; end if;
  if exists(select 1 from public.appointments where barbershop_id=p_barbershop_id and barber_membership_id=v_member and status in ('pending','confirmed','in_progress')
    and coalesce(occupied_starts_at,starts_at)<v_end and coalesce(occupied_ends_at,ends_at)>v_start) then
   raise exception 'Há atendimentos nesse intervalo. Reagende antes de bloquear.' using errcode='22023'; end if;
 elsif p_action_type in ('update_service','update_product') then
  if p_values ?| array['price_cents','cost_cents','stock_quantity','tax_pct','fee_pct','commission_pct','requires_subscription','image_url','image_path'] then raise exception 'Não é permitido alterar dados financeiros, imagens, estoque ou assinatura nesta ação' using errcode='22023'; end if;
  if p_action_type='update_service' then
   select jsonb_build_object('id',id,'name',name,'updated_at',updated_at) into v_record from public.services where id=(p_values->>'id')::uuid and barbershop_id=p_barbershop_id;
  else select jsonb_build_object('id',id,'name',name,'updated_at',updated_at) into v_record from public.products where id=(p_values->>'id')::uuid and barbershop_id=p_barbershop_id; end if;
  if v_record is null then raise exception 'Cadastro fora desta barbearia' using errcode='42501'; end if;
  if (v_record->>'updated_at')::timestamptz is distinct from (p_values->>'expected_updated_at')::timestamptz then raise exception 'Este cadastro mudou. Recarregue e prepare outra proposta.' using errcode='22023'; end if;
  v_values:=v_values||jsonb_build_object('record_label',v_record->>'name');
 elsif p_action_type='update_client' then
  v_client:=(p_values->>'id')::uuid;
  select jsonb_build_object('id',id,'full_name',full_name,'updated_at',updated_at) into v_record from public.clients where id=v_client and barbershop_id=p_barbershop_id;
  if v_record is null or (a->>'role'='barber' and not exists(select 1 from public.client_barbers where barbershop_id=p_barbershop_id and client_id=v_client and barber_membership_id=(a->>'member_id')::uuid)) then
   raise exception 'Cliente fora do seu acesso' using errcode='42501'; end if;
  if (v_record->>'updated_at')::timestamptz is distinct from (p_values->>'expected_updated_at')::timestamptz then raise exception 'Cliente atualizado após a proposta. Recarregue o cadastro.' using errcode='22023'; end if;
  v_values:=v_values||jsonb_build_object('record_label',v_record->>'full_name');
 end if;
 perform set_config('request.jwt.claims',coalesce(v_previous_claims,''),true);
 perform set_config('request.jwt.claim.sub',coalesce(v_previous_sub,''),true);
 return v_values;
end $$;
revoke all on function public.validate_ai_help_action(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.validate_ai_help_action(uuid,uuid,text,jsonb) to service_role;

alter function public.execute_ai_help_plan(uuid,uuid) rename to execute_ai_help_plan_legacy;
create function public.execute_ai_help_plan(p_plan_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.ai_help_plans%rowtype; a jsonb; v jsonb; r jsonb; v_id uuid; v_before jsonb; v_audit uuid;
 v_claims text:=current_setting('request.jwt.claims',true); v_sub_claim text:=current_setting('request.jwt.claim.sub',true);
begin
 select * into p from public.ai_help_plans where id=p_plan_id and requester_user_id=p_actor_id for update;
 if not found then raise exception 'Proposta não encontrada' using errcode='P0001'; end if;
 a:=app_private.ai_help_assert_actor(p_actor_id,p.barbershop_id,p.action_type);
 if p.status='completed' then return jsonb_build_object('status','completed','result',p.result,'replayed',true); end if;
 if p.status<>'pending' or p.expires_at<=now() then raise exception 'Esta proposta expirou ou não está pronta' using errcode='P0001'; end if;
 if p.action_type in ('book_appointment','create_schedule_block') then
  perform pg_advisory_xact_lock(hashtext(p.barbershop_id::text),hashtext('appointment_schedule'));
 elsif p.action_type in ('update_service','update_product','update_client') then
  if p.action_type='update_service' then perform 1 from public.services where id=(p.action_values->>'id')::uuid and barbershop_id=p.barbershop_id for update;
  elsif p.action_type='update_product' then perform 1 from public.products where id=(p.action_values->>'id')::uuid and barbershop_id=p.barbershop_id for update;
  else perform 1 from public.clients where id=(p.action_values->>'id')::uuid and barbershop_id=p.barbershop_id for update; end if;
 end if;
 v:=public.validate_ai_help_action(p_actor_id,p.barbershop_id,p.action_type,p.action_values);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor_id,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',p_actor_id::text,true);
 if p.action_type='book_appointment' then
  v_id:=app_private.book_appointment(p.barbershop_id,(v->>'client_id')::uuid,(v->>'barber_membership_id')::uuid,
    array(select value::uuid from jsonb_array_elements_text(v->'service_ids')),(v->>'starts_at')::timestamptz,nullif(v->>'subscription_id','')::uuid);
  r:=jsonb_build_object('id',v_id,'starts_at',v->>'starts_at');
 elsif p.action_type='create_schedule_block' then
  insert into public.schedule_blocks(barbershop_id,barber_membership_id,starts_at,ends_at,reason)
  values(p.barbershop_id,(v->>'barber_membership_id')::uuid,(v->>'starts_at')::timestamptz,(v->>'ends_at')::timestamptz,v->>'reason') returning id into v_id;
  r:=jsonb_build_object('id',v_id,'reason',v->>'reason');
 elsif p.action_type='update_service' then
  v_id:=(v->>'id')::uuid;
  select jsonb_build_object('name',name,'description',description,'duration_minutes',duration_minutes,'active',active) into v_before from public.services where id=v_id and barbershop_id=p.barbershop_id;
  update public.services set name=case when v?'name' then v->>'name' else name end,
    description=case when v?'description' then nullif(v->>'description','') else description end,
    duration_minutes=case when v?'duration_minutes' then (v->>'duration_minutes')::integer else duration_minutes end,
    active=case when v?'active' then (v->>'active')::boolean else active end where id=v_id and barbershop_id=p.barbershop_id;
  r:=jsonb_build_object('id',v_id,'name',coalesce(v->>'name',v_before->>'name'));
 elsif p.action_type='update_product' then
  v_id:=(v->>'id')::uuid;
  select jsonb_build_object('name',name,'description',description,'sku',sku,'category',category,'active',active) into v_before from public.products where id=v_id and barbershop_id=p.barbershop_id;
  update public.products set name=case when v?'name' then v->>'name' else name end,
    description=case when v?'description' then nullif(v->>'description','') else description end,sku=case when v?'sku' then nullif(v->>'sku','') else sku end,
    category=case when v?'category' then v->>'category' else category end,
    active=case when v?'active' then (v->>'active')::boolean else active end where id=v_id and barbershop_id=p.barbershop_id;
  r:=jsonb_build_object('id',v_id,'name',coalesce(v->>'name',v_before->>'name'));
 elsif p.action_type in ('create_client','update_client') then
  if p.action_type='create_client' then
   insert into public.clients(barbershop_id,full_name,email,phone,notes)
   values(p.barbershop_id,v->>'full_name',nullif(v->>'email',''),nullif(v->>'phone',''),nullif(v->>'notes','')) returning id into v_id;
   if a->>'role'='barber' then insert into public.client_barbers(barbershop_id,client_id,barber_membership_id) values(p.barbershop_id,v_id,(a->>'member_id')::uuid) on conflict do nothing; end if;
  else
   v_id:=(v->>'id')::uuid;
   select jsonb_build_object('full_name',full_name,'email',email,'phone',phone,'notes',notes) into v_before from public.clients where id=v_id and barbershop_id=p.barbershop_id;
   update public.clients set full_name=case when v?'full_name' then v->>'full_name' else full_name end,
    email=case when v?'email' then nullif(v->>'email','') else email end,phone=case when v?'phone' then nullif(v->>'phone','') else phone end,
    notes=case when v?'notes' then nullif(v->>'notes','') else notes end where id=v_id and barbershop_id=p.barbershop_id;
  end if;
  r:=jsonb_build_object('id',v_id,'name',coalesce(v->>'full_name',v_before->>'full_name'));
 else
  r:=public.execute_ai_help_plan_legacy(p_plan_id,p_actor_id)->'result'; v_id:=(r->>'id')::uuid;
 end if;
 insert into public.ai_help_action_audit(plan_id,barbershop_id,actor_user_id,actor_role,action_type,record_id,before_values,after_values)
 values(p.id,case when p.action_type='create_shop' then v_id else p.barbershop_id end,p_actor_id,a->>'role',p.action_type,v_id,v_before,v) returning id into v_audit;
 r:=r||jsonb_build_object('audit_id',v_audit);
 update public.ai_help_plans set status='completed',result=r,executed_at=now() where id=p.id;
 perform set_config('request.jwt.claims',coalesce(v_claims,''),true);
 perform set_config('request.jwt.claim.sub',coalesce(v_sub_claim,''),true);
 return jsonb_build_object('status','completed','result',r,'replayed',false);
end $$;
revoke all on function public.execute_ai_help_plan(uuid,uuid) from public,anon,authenticated;
grant execute on function public.execute_ai_help_plan(uuid,uuid) to service_role;

create function public.ai_help_available_slots(p_actor_id uuid,p_barbershop_id uuid,p_client_id uuid,p_member_id uuid,p_service_ids uuid[],p_day date)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a jsonb; r jsonb; v_claims text:=current_setting('request.jwt.claims',true); v_sub text:=current_setting('request.jwt.claim.sub',true);
begin
 a:=app_private.ai_help_assert_actor(p_actor_id,p_barbershop_id,'book_appointment');
 if not exists(select 1 from public.memberships where barbershop_id=p_barbershop_id and id=p_member_id and active and role='barber')
  or (a->>'role'='barber' and p_member_id<>(a->>'member_id')::uuid) then raise exception 'Profissional fora do seu acesso' using errcode='42501'; end if;
 if not exists(select 1 from public.clients where id=p_client_id and barbershop_id=p_barbershop_id)
  or (a->>'role'='barber' and not exists(select 1 from public.client_barbers where barbershop_id=p_barbershop_id and client_id=p_client_id and barber_membership_id=p_member_id)) then raise exception 'Cliente fora do seu acesso' using errcode='42501'; end if;
 if p_day is null or p_day<current_date or p_day>current_date+365 then raise exception 'Data inválida' using errcode='22023'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor_id,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',p_actor_id::text,true);
 select coalesce(jsonb_agg(jsonb_build_object('starts_at',s.starts_at,'ends_at',s.ends_at,'eligibility',
  app_private.subscription_eligibility_for_booking(p_barbershop_id,p_client_id,p_service_ids,s.starts_at)) order by s.starts_at),'[]'::jsonb) into r
 from app_private.available_slots(p_barbershop_id,p_member_id,p_service_ids,p_day) s;
 perform set_config('request.jwt.claims',coalesce(v_claims,''),true); perform set_config('request.jwt.claim.sub',coalesce(v_sub,''),true);
 return r;
end $$;
revoke all on function public.ai_help_available_slots(uuid,uuid,uuid,uuid,uuid[],date) from public,anon,authenticated;
grant execute on function public.ai_help_available_slots(uuid,uuid,uuid,uuid,uuid[],date) to service_role;

create table public.ai_help_policy_audit (
 id uuid primary key default gen_random_uuid(), actor_user_id uuid not null references auth.users(id),
 barbershop_id uuid references public.barbershops(id), before_values jsonb, after_values jsonb not null, created_at timestamptz not null default now()
);
alter table public.ai_help_policy_audit enable row level security;
revoke all on public.ai_help_policy_audit from public,anon,authenticated;
grant all on public.ai_help_policy_audit to service_role;
create function public.configure_ai_help_limits(p_actor_id uuid,p_barbershop_id uuid,p_values jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b jsonb; a jsonb;
begin
 if not exists(select 1 from public.platform_admins where user_id=p_actor_id) then raise exception 'Somente o master configura os limites' using errcode='42501'; end if;
 if jsonb_typeof(p_values)<>'object' then raise exception 'Configuração inválida' using errcode='22023'; end if;
 if p_barbershop_id is null then
  select to_jsonb(q) into b from public.ai_help_quota_settings q where id=1 for update;
  update public.ai_help_quota_settings set enabled=(p_values->>'enabled')::boolean,
   master_daily_limit=(p_values->>'master_daily_limit')::integer,admin_daily_limit=(p_values->>'admin_daily_limit')::integer,
   barber_daily_limit=(p_values->>'barber_daily_limit')::integer,updated_at=now() where id=1 returning to_jsonb(ai_help_quota_settings) into a;
 else
  if not exists(select 1 from public.barbershops where id=p_barbershop_id) then raise exception 'Barbearia não encontrada' using errcode='22023'; end if;
  select to_jsonb(q) into b from public.ai_help_shop_limits q where barbershop_id=p_barbershop_id for update;
  insert into public.ai_help_shop_limits(barbershop_id,enabled,admin_daily_limit,barber_daily_limit,daily_shop_limit,monthly_token_limit)
   values(p_barbershop_id,(p_values->>'enabled')::boolean,(p_values->>'admin_daily_limit')::integer,(p_values->>'barber_daily_limit')::integer,
    (p_values->>'daily_shop_limit')::integer,(p_values->>'monthly_token_limit')::bigint)
  on conflict(barbershop_id) do update set enabled=excluded.enabled,admin_daily_limit=excluded.admin_daily_limit,
   barber_daily_limit=excluded.barber_daily_limit,daily_shop_limit=excluded.daily_shop_limit,monthly_token_limit=excluded.monthly_token_limit,updated_at=now()
  returning to_jsonb(ai_help_shop_limits) into a;
 end if;
 insert into public.ai_help_policy_audit(actor_user_id,barbershop_id,before_values,after_values) values(p_actor_id,p_barbershop_id,b,a);
 return a;
end $$;
revoke all on function public.configure_ai_help_limits(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.configure_ai_help_limits(uuid,uuid,jsonb) to service_role;

create function public.ai_help_admin_usage(p_actor_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_shops jsonb; v_settings jsonb; v_platform jsonb;
begin
 if not exists(select 1 from public.platform_admins where user_id=p_actor_id) then raise exception 'Somente o master consulta o consumo central' using errcode='42501'; end if;
 select to_jsonb(q) into v_settings from public.ai_help_quota_settings q where id=1;
 select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'limits',to_jsonb(l),'requests_24h',coalesce(n.amount,0),
   'tokens_month',coalesce(u.tokens,0),'calls_month',coalesce(u.calls,0),'calls_without_token_metadata',coalesce(u.missing_tokens,0),
   'cost_status','not_reported') order by b.name),'[]'::jsonb) into v_shops
 from public.barbershops b left join public.ai_help_shop_limits l on l.barbershop_id=b.id
 left join lateral(select count(*) as amount from public.ai_help_plans where barbershop_id=b.id and created_at>=now()-interval '24 hours') n on true
 left join lateral(select sum(total_tokens) as tokens,count(*) as calls,count(*) filter(where total_tokens is null) as missing_tokens
  from public.ai_help_usage where barbershop_id=b.id and created_at>=date_trunc('month',now())) u on true;
 select jsonb_build_object('tokens_month',coalesce(sum(total_tokens),0),'calls_month',count(*),'cost_status','not_reported') into v_platform
 from public.ai_help_usage where barbershop_id is null and created_at>=date_trunc('month',now());
 return jsonb_build_object('settings',v_settings,'shops',v_shops,'platform',v_platform,'cost_note','O provedor informa tokens, mas não informa o custo monetário nesta integração. Nenhum preço é estimado.');
end $$;
revoke all on function public.ai_help_admin_usage(uuid) from public,anon,authenticated;
grant execute on function public.ai_help_admin_usage(uuid) to service_role;
