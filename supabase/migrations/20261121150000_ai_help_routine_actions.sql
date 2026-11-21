-- Ajuda de IA: ações da rotina da barbearia.
-- Novas ações: manage_appointment (confirmar, chegada, iniciar, concluir, falta, cancelar, remarcar),
-- quick_service (atendimento feito), register_sale (comanda de produtos), receive_payment (receber no caixa),
-- cash_register (abrir, fechar, sangria, suprimento), create_expense (despesa), stock_entry (entrada de estoque),
-- stock_adjust (consumo, perda, ajuste). update_service/update_product passam a aceitar preço e custo.
-- Toda ação continua sendo proposta, revisada e confirmada pelo usuário; a execução chama as mesmas
-- funções que as telas usam, com a identidade de quem confirmou.

create or replace function app_private.ai_help_assert_actor(p_actor_id uuid, p_barbershop_id uuid, p_action_type text default null::text)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
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
  when 'create_client' then 'clients' when 'update_client' then 'clients'
  when 'manage_appointment' then 'appointments' when 'quick_service' then 'appointments'
  when 'register_sale' then 'products' else null end;
 if p_action_type is not null and (v_module is null or not exists(select 1 from public.module_permissions
   where barbershop_id=p_barbershop_id and user_id=p_actor_id and module=v_module and allowed)) then
  raise exception 'Permissão para esta ação foi revogada' using errcode='42501';
 end if;
 return jsonb_build_object('role','barber','member_id',m.id);
end $function$;

create or replace function public.validate_ai_help_action(p_actor_id uuid, p_barbershop_id uuid, p_action_type text, p_values jsonb)
returns jsonb
language plpgsql
set search_path to ''
as $function$
declare a jsonb; v_member uuid; v_client uuid; v_services uuid[]; v_start timestamptz; v_end timestamptz; v_sub uuid;
  v_eligibility jsonb; v_record jsonb; v_timezone text; v_values jsonb:=p_values; v_previous_claims text:=current_setting('request.jwt.claims',true);
  v_previous_sub text:=current_setting('request.jwt.claim.sub',true);
  v_appt public.appointments%rowtype; v_op text; v_details jsonb; v_digits text; v_existing text; v_price bigint; v_amount bigint;
  v_total bigint; v_paid bigint; v_remaining bigint; v_session public.cash_sessions%rowtype; v_expected bigint; v_sale public.sales%rowtype;
  v_methods jsonb; v_label text; v_product public.products%rowtype; v_quantity integer; v_date date;
begin
 a:=app_private.ai_help_assert_actor(p_actor_id,p_barbershop_id,p_action_type);
 if p_values is null or jsonb_typeof(p_values)<>'object' then raise exception 'Proposta inválida' using errcode='22023'; end if;
 select timezone into v_timezone from public.barbershops where id=p_barbershop_id;
 v_timezone:=coalesce(v_timezone,'America/Sao_Paulo');
 if p_action_type in ('book_appointment','create_schedule_block') then
  v_member:=(p_values->>'barber_membership_id')::uuid;
  if not exists(select 1 from public.memberships where id=v_member and barbershop_id=p_barbershop_id and role='barber' and active)
    or (a->>'role'='barber' and v_member<>(a->>'member_id')::uuid) then raise exception 'Profissional fora do seu acesso' using errcode='42501'; end if;
  v_start:=(p_values->>'starts_at')::timestamptz;
  if v_start is null or v_start<now() or v_start>now()+interval '365 days' then raise exception 'Escolha um horário futuro em até 365 dias' using errcode='22023'; end if;
  v_values:=v_values||jsonb_build_object('professional_label',coalesce((select display_name from public.memberships where id=v_member),'Profissional'));
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
  if p_values ?| array['stock_quantity','tax_pct','fee_pct','commission_pct','requires_subscription','image_url','image_path'] then raise exception 'Estoque, imagens, taxas e regras de assinatura têm ação ou área própria' using errcode='22023'; end if;
  if (p_values ? 'price_cents' and (jsonb_typeof(p_values->'price_cents')<>'number' or (p_values->>'price_cents')::numeric not between 0 and 100000000 or (p_values->>'price_cents')::numeric<>trunc((p_values->>'price_cents')::numeric)))
   or (p_values ? 'cost_cents' and (jsonb_typeof(p_values->'cost_cents')<>'number' or (p_values->>'cost_cents')::numeric not between 0 and 100000000 or (p_values->>'cost_cents')::numeric<>trunc((p_values->>'cost_cents')::numeric))) then
   raise exception 'Preço ou custo inválido' using errcode='22023'; end if;
  if p_action_type='update_service' then
   select jsonb_build_object('id',id,'name',name,'updated_at',updated_at,'price_cents',price_cents,'cost_cents',cost_cents) into v_record from public.services where id=(p_values->>'id')::uuid and barbershop_id=p_barbershop_id;
  else select jsonb_build_object('id',id,'name',name,'updated_at',updated_at,'price_cents',price_cents,'cost_cents',cost_cents) into v_record from public.products where id=(p_values->>'id')::uuid and barbershop_id=p_barbershop_id; end if;
  if v_record is null then raise exception 'Cadastro fora desta barbearia' using errcode='42501'; end if;
  if (v_record->>'updated_at')::timestamptz is distinct from (p_values->>'expected_updated_at')::timestamptz then raise exception 'Este cadastro mudou. Recarregue e prepare outra proposta.' using errcode='22023'; end if;
  v_values:=v_values||jsonb_build_object('record_label',v_record->>'name');
  if p_values ? 'price_cents' then v_values:=v_values||jsonb_build_object('current_price_cents',(v_record->>'price_cents')::bigint); end if;
  if p_values ? 'cost_cents' then v_values:=v_values||jsonb_build_object('current_cost_cents',(v_record->>'cost_cents')::bigint); end if;
 elsif p_action_type='update_client' then
  v_client:=(p_values->>'id')::uuid;
  select jsonb_build_object('id',id,'full_name',full_name,'updated_at',updated_at) into v_record from public.clients where id=v_client and barbershop_id=p_barbershop_id;
  if v_record is null or (a->>'role'='barber' and not exists(select 1 from public.client_barbers where barbershop_id=p_barbershop_id and client_id=v_client and barber_membership_id=(a->>'member_id')::uuid)) then
   raise exception 'Cliente fora do seu acesso' using errcode='42501'; end if;
  if (v_record->>'updated_at')::timestamptz is distinct from (p_values->>'expected_updated_at')::timestamptz then raise exception 'Cliente atualizado após a proposta. Recarregue o cadastro.' using errcode='22023'; end if;
  v_values:=v_values||jsonb_build_object('record_label',v_record->>'full_name');
 elsif p_action_type='create_client' then
  v_digits:=regexp_replace(coalesce(p_values->>'phone',''),'\D','','g');
  if left(v_digits,2)='55' and length(v_digits) in (12,13) then v_digits:=substr(v_digits,3); end if;
  if length(v_digits) between 10 and 11 then
   select full_name into v_existing from public.clients where barbershop_id=p_barbershop_id
     and regexp_replace(coalesce(phone,''),'\D','','g') in (v_digits,'55'||v_digits) order by created_at limit 1;
   if v_existing is not null then v_values:=v_values||jsonb_build_object('warning_label','Já existe cliente com este telefone: '||v_existing); end if;
  end if;
 elsif p_action_type='manage_appointment' then
  select * into v_appt from public.appointments where id=(p_values->>'appointment_id')::uuid and barbershop_id=p_barbershop_id;
  if not found or (a->>'role'='barber' and v_appt.barber_membership_id<>(a->>'member_id')::uuid) then raise exception 'Agendamento fora do seu acesso' using errcode='42501'; end if;
  v_op:=p_values->>'operation';
  if v_op is null or v_op not in ('confirm','arrive','undo_arrive','start','complete','no_show','cancel','reschedule') then raise exception 'Operação de agendamento inválida' using errcode='22023'; end if;
  if v_appt.status::text in ('completed','cancelled','no_show') then
   raise exception 'Esse atendimento já está encerrado (%).',case v_appt.status::text when 'completed' then 'concluído' when 'cancelled' then 'cancelado' else 'falta' end using errcode='22023'; end if;
  if v_op in ('start','complete','no_show') and v_appt.starts_at>now() then raise exception 'O horário desse atendimento ainda não chegou.' using errcode='22023'; end if;
  if v_op='no_show' and v_appt.status::text='in_progress' then raise exception 'Atendimento em andamento não pode ser marcado como falta.' using errcode='22023'; end if;
  if v_op='undo_arrive' and v_appt.arrived_at is null then raise exception 'A chegada desse cliente não foi marcada.' using errcode='22023'; end if;
  if v_op='reschedule' then
   v_start:=(p_values->>'starts_at')::timestamptz;
   if v_start is null or v_start<now() or v_start>now()+interval '365 days' then raise exception 'Escolha um horário futuro em até 365 dias' using errcode='22023'; end if;
   if v_appt.status::text='in_progress' then raise exception 'Um atendimento em andamento não pode ser reagendado.' using errcode='22023'; end if;
   select array_agg(service_id) into v_services from public.appointment_services where barbershop_id=p_barbershop_id and appointment_id=v_appt.id;
   perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor_id,'role','authenticated')::text,true);
   perform set_config('request.jwt.claim.sub',p_actor_id::text,true);
   v_details:=app_private.appointment_schedule_details(p_barbershop_id,v_appt.barber_membership_id,v_services,v_start,v_appt.id);
   if not coalesce((v_details->>'available')::boolean,false) then raise exception '%',coalesce(v_details->>'reason','Esse horário não está livre.') using errcode='22023'; end if;
   v_values:=v_values||jsonb_build_object('starts_at',v_start);
  else
   v_values:=v_values-'starts_at';
  end if;
  if v_op<>'cancel' then v_values:=v_values-'reason'; end if;
  v_values:=v_values||jsonb_build_object('operation_label',case v_op when 'confirm' then 'Confirmar presença' when 'arrive' then 'Marcar chegada do cliente'
     when 'undo_arrive' then 'Desfazer chegada' when 'start' then 'Iniciar atendimento' when 'complete' then 'Concluir atendimento'
     when 'no_show' then 'Marcar falta' when 'cancel' then 'Cancelar agendamento' else 'Remarcar' end,
   'client_label',coalesce((select full_name from public.clients where id=v_appt.client_id),'Cliente'),
   'professional_label',coalesce((select display_name from public.memberships where id=v_appt.barber_membership_id),'Profissional'),
   'appointment_label',to_char(v_appt.starts_at at time zone v_timezone,'DD/MM/YYYY "às" HH24:MI')||coalesce(' · '||(select string_agg(s.name,', ' order by s.name)
     from public.appointment_services x join public.services s on s.id=x.service_id where x.appointment_id=v_appt.id and x.barbershop_id=p_barbershop_id),''));
 elsif p_action_type='quick_service' then
  v_member:=(p_values->>'barber_membership_id')::uuid;
  if not exists(select 1 from public.memberships where id=v_member and barbershop_id=p_barbershop_id and role='barber' and active)
    or (a->>'role'='barber' and v_member<>(a->>'member_id')::uuid) then raise exception 'Profissional fora do seu acesso' using errcode='42501'; end if;
  select array_agg(value::uuid) into v_services from jsonb_array_elements_text(p_values->'service_ids');
  if v_services is null or cardinality(v_services) not between 1 and 10 or (select count(distinct id) from public.services where barbershop_id=p_barbershop_id and active and id=any(v_services))<>cardinality(v_services) then
   raise exception 'Serviços fora desta barbearia, inativos ou repetidos' using errcode='22023'; end if;
  v_digits:=regexp_replace(coalesce(p_values->>'phone',''),'\D','','g');
  if left(v_digits,2)='55' and length(v_digits) in (12,13) then v_digits:=substr(v_digits,3); end if;
  if length(v_digits) not in (10,11) then raise exception 'Informe o número do cliente com DDD' using errcode='22023'; end if;
  v_start:=nullif(p_values->>'starts_at','')::timestamptz;
  if v_start is not null and (v_start>now()+interval '366 days' or v_start<now()-interval '60 days') then raise exception 'Data do atendimento inválida' using errcode='22023'; end if;
  if nullif(p_values->>'method','') is not null then
   if p_values->>'method' not in ('cash','card','pix','other') then raise exception 'Forma de recebimento inválida' using errcode='22023'; end if;
   if a->>'role'='barber' then raise exception 'Apenas a administração registra o recebimento' using errcode='42501'; end if;
   if not exists(select 1 from public.cash_sessions where barbershop_id=p_barbershop_id and closed_at is null) then
    raise exception 'O caixa está fechado. Abra o caixa ou registre o atendimento para receber depois.' using errcode='22023'; end if;
  end if;
  select full_name into v_existing from public.clients where barbershop_id=p_barbershop_id
    and regexp_replace(coalesce(phone,''),'\D','','g') in (v_digits,'55'||v_digits) order by created_at limit 1;
  if v_existing is null and length(btrim(coalesce(p_values->>'client_name',''))) not between 2 and 160 then raise exception 'Informe o nome do cliente' using errcode='22023'; end if;
  select coalesce(sum(price_cents),0) into v_price from public.services where barbershop_id=p_barbershop_id and id=any(v_services);
  if p_values ? 'total_cents' and p_values->'total_cents'<>'null'::jsonb and (jsonb_typeof(p_values->'total_cents')<>'number' or (p_values->>'total_cents')::numeric not between 0 and 100000000) then
   raise exception 'Valor cobrado inválido' using errcode='22023'; end if;
  v_values:=v_values||jsonb_build_object('total_cents',coalesce(nullif(p_values->>'total_cents','')::bigint,v_price),
   'client_label',coalesce(v_existing||' (já cadastrado)',btrim(p_values->>'client_name')||' (novo cadastro)'),
   'professional_label',(select display_name from public.memberships where id=v_member),
   'services_label',(select string_agg(name,', ' order by name) from public.services where id=any(v_services) and barbershop_id=p_barbershop_id),
   'when_label',case when v_start is null then 'Agora' else to_char(v_start at time zone v_timezone,'DD/MM/YYYY "às" HH24:MI') end);
 elsif p_action_type='register_sale' then
  if jsonb_typeof(p_values->'items') is distinct from 'array' or jsonb_array_length(p_values->'items') not between 1 and 50 then raise exception 'Informe os produtos da venda' using errcode='22023'; end if;
  if (select count(*)<>count(distinct value->>'product_id') from jsonb_array_elements(p_values->'items')) then raise exception 'Produto repetido na venda' using errcode='22023'; end if;
  for v_record in select value from jsonb_array_elements(p_values->'items') loop
   v_quantity:=case when jsonb_typeof(v_record->'quantity')='number' then (v_record->>'quantity')::numeric::integer end;
   select * into v_product from public.products where id=(v_record->>'product_id')::uuid and barbershop_id=p_barbershop_id and active and category<>'supply';
   if not found then raise exception 'Produto fora desta barbearia ou inativo' using errcode='22023'; end if;
   if v_quantity is null or v_quantity not between 1 and 1000 then raise exception 'Quantidade inválida para %',v_product.name using errcode='22023'; end if;
   if v_product.stock_quantity<v_quantity then raise exception 'Estoque insuficiente de % (tem %).',v_product.name,v_product.stock_quantity using errcode='22023'; end if;
  end loop;
  v_member:=nullif(p_values->>'barber_membership_id','')::uuid;
  if a->>'role'='barber' then
   v_member:=coalesce(v_member,(a->>'member_id')::uuid);
   if v_member<>(a->>'member_id')::uuid then raise exception 'Profissional fora do seu acesso' using errcode='42501'; end if;
   v_values:=v_values||jsonb_build_object('barber_membership_id',v_member);
  end if;
  if v_member is not null and not exists(select 1 from public.memberships where id=v_member and barbershop_id=p_barbershop_id and role='barber' and active) then
   raise exception 'Profissional inválido' using errcode='22023'; end if;
  v_client:=nullif(p_values->>'client_id','')::uuid;
  if v_client is not null and not exists(select 1 from public.clients where id=v_client and barbershop_id=p_barbershop_id) then raise exception 'Cliente fora desta barbearia' using errcode='42501'; end if;
  select string_agg((i->>'quantity')||'x '||pr.name,', ' order by pr.name), sum((i->>'quantity')::numeric*pr.price_cents)::bigint into v_label,v_total
   from jsonb_array_elements(p_values->'items') i join public.products pr on pr.id=(i->>'product_id')::uuid and pr.barbershop_id=p_barbershop_id;
  v_values:=v_values||jsonb_build_object('items_label',v_label,'total_cents',v_total,
   'client_label',coalesce((select full_name from public.clients where id=v_client),'Cliente avulso'),
   'professional_label',coalesce((select display_name from public.memberships where id=v_member),'Sem profissional'));
 elsif p_action_type='receive_payment' then
  if (nullif(p_values->>'appointment_id','') is null)=(nullif(p_values->>'sale_id','') is null) then raise exception 'Escolha um atendimento ou uma comanda para receber' using errcode='22023'; end if;
  if not exists(select 1 from public.cash_sessions where barbershop_id=p_barbershop_id and closed_at is null) then raise exception 'O caixa está fechado. Abra o caixa antes de receber.' using errcode='22023'; end if;
  if nullif(p_values->>'sale_id','') is not null then
   select * into v_sale from public.sales where id=(p_values->>'sale_id')::uuid and barbershop_id=p_barbershop_id;
   if not found or v_sale.status not in ('open','delivered') then raise exception 'Comanda indisponível para recebimento' using errcode='22023'; end if;
   v_client:=v_sale.client_id; v_total:=v_sale.total_cents;
   v_label:='Comanda de '||to_char(v_sale.created_at at time zone v_timezone,'DD/MM/YYYY HH24:MI')||coalesce(' · '||(select string_agg(si.quantity||'x '||coalesce(pr.name,si.description),', ')
     from public.sale_items si left join public.products pr on pr.id=si.product_id where si.sale_id=v_sale.id),'');
   select coalesce(sum(amount_cents),0) into v_paid from public.payments where barbershop_id=p_barbershop_id and sale_id=v_sale.id and status in ('paid','approved');
  else
   select * into v_appt from public.appointments where id=(p_values->>'appointment_id')::uuid and barbershop_id=p_barbershop_id;
   if not found then raise exception 'Atendimento não encontrado' using errcode='22023'; end if;
   if v_appt.subscription_id is not null then raise exception 'Esse atendimento é coberto por assinatura; não há valor a receber.' using errcode='22023'; end if;
   if v_appt.status::text<>'completed' then raise exception 'Conclua o atendimento antes de receber.' using errcode='22023'; end if;
   v_client:=v_appt.client_id; v_total:=v_appt.total_price_cents;
   v_label:='Atendimento de '||to_char(v_appt.starts_at at time zone v_timezone,'DD/MM/YYYY HH24:MI')||coalesce(' · '||(select string_agg(s.name,', ' order by s.name)
     from public.appointment_services x join public.services s on s.id=x.service_id where x.appointment_id=v_appt.id),'');
   select coalesce(sum(amount_cents),0) into v_paid from public.payments where barbershop_id=p_barbershop_id and appointment_id=v_appt.id and status in ('paid','approved');
  end if;
  v_remaining:=coalesce(v_total,0)-v_paid;
  if v_remaining<=0 then raise exception 'Esse valor já foi totalmente recebido.' using errcode='22023'; end if;
  if jsonb_typeof(p_values->'methods') is distinct from 'array' or jsonb_array_length(p_values->'methods') not between 1 and 8 then raise exception 'Informe a forma de pagamento' using errcode='22023'; end if;
  v_methods:='[]'::jsonb; v_amount:=0;
  for v_record in select value from jsonb_array_elements(p_values->'methods') loop
   if v_record->>'method' is null or v_record->>'method' not in ('cash','card','pix','other') then raise exception 'Forma de pagamento inválida (use dinheiro, cartão, pix ou outro)' using errcode='22023'; end if;
   if v_record->'amount_cents' is null or v_record->'amount_cents'='null'::jsonb then
    if jsonb_array_length(p_values->'methods')<>1 then raise exception 'Informe o valor de cada forma de pagamento' using errcode='22023'; end if;
    v_record:=v_record||jsonb_build_object('amount_cents',v_remaining);
   end if;
   if jsonb_typeof(v_record->'amount_cents')<>'number' or (v_record->>'amount_cents')::numeric<=0 or (v_record->>'amount_cents')::numeric<>trunc((v_record->>'amount_cents')::numeric) then raise exception 'Valor de pagamento inválido' using errcode='22023'; end if;
   v_amount:=v_amount+(v_record->>'amount_cents')::bigint;
   v_methods:=v_methods||jsonb_build_array(jsonb_build_object('method',v_record->>'method','amount_cents',(v_record->>'amount_cents')::bigint));
  end loop;
  if v_amount>v_remaining then raise exception 'O valor informado passa do saldo em aberto (R$ %).',to_char(v_remaining/100.0,'FM999999990.00') using errcode='22023'; end if;
  v_values:=v_values||jsonb_build_object('methods',v_methods,'source_label',v_label,
   'client_label',coalesce((select full_name from public.clients where id=v_client),'Cliente avulso'),'remaining_cents',v_remaining,'amount_cents',v_amount,
   'methods_label',(select string_agg(case m->>'method' when 'cash' then 'Dinheiro' when 'card' then 'Cartão' when 'pix' then 'Pix' else 'Outro' end
     ||' R$ '||to_char((m->>'amount_cents')::numeric/100,'FM999999990.00'),' + ') from jsonb_array_elements(v_methods) m));
 elsif p_action_type='cash_register' then
  v_op:=p_values->>'operation';
  if v_op is null or v_op not in ('open','close','withdrawal','supply') then raise exception 'Operação de caixa inválida' using errcode='22023'; end if;
  if jsonb_typeof(p_values->'amount_cents') is distinct from 'number' or (p_values->>'amount_cents')::numeric<0 or (p_values->>'amount_cents')::numeric>2147483647
    or (p_values->>'amount_cents')::numeric<>trunc((p_values->>'amount_cents')::numeric) then raise exception 'Informe o valor em reais' using errcode='22023'; end if;
  v_amount:=(p_values->>'amount_cents')::bigint;
  select * into v_session from public.cash_sessions where barbershop_id=p_barbershop_id and closed_at is null order by opened_at desc limit 1;
  if v_op='open' then
   if found then raise exception 'O caixa já está aberto desde %.',to_char(v_session.opened_at at time zone v_timezone,'DD/MM HH24:MI') using errcode='22023'; end if;
  else
   if not found then raise exception 'O caixa está fechado.' using errcode='22023'; end if;
   select v_session.opening_cents+coalesce(sum(case when kind in ('receipt','supply') then amount_cents else -amount_cents end),0) into v_expected
    from public.cash_movements where session_id=v_session.id and method='cash';
   v_values:=v_values||jsonb_build_object('session_id',v_session.id,'expected_cents',v_expected);
   if v_op in ('withdrawal','supply') then
    if v_amount<=0 then raise exception 'Informe um valor maior que zero' using errcode='22023'; end if;
    if length(btrim(coalesce(p_values->>'notes','')))<3 then raise exception 'Informe o motivo da % (mínimo 3 letras)',case v_op when 'withdrawal' then 'sangria' else 'entrada de troco' end using errcode='22023'; end if;
    if v_op='withdrawal' and v_amount>v_expected then raise exception 'Dinheiro insuficiente no caixa para essa sangria (tem R$ %).',to_char(v_expected/100.0,'FM999999990.00') using errcode='22023'; end if;
   end if;
  end if;
  v_values:=v_values||jsonb_build_object('operation_label',case v_op when 'open' then 'Abrir caixa' when 'close' then 'Fechar caixa' when 'withdrawal' then 'Sangria (retirada de dinheiro)' else 'Suprimento (entrada de troco)' end);
 elsif p_action_type='create_expense' then
  if length(btrim(coalesce(p_values->>'description',''))) not between 2 and 300 then raise exception 'Descreva a despesa' using errcode='22023'; end if;
  if length(btrim(coalesce(p_values->>'category',''))) not between 2 and 80 then raise exception 'Informe a categoria da despesa' using errcode='22023'; end if;
  if jsonb_typeof(p_values->'amount_cents') is distinct from 'number' or (p_values->>'amount_cents')::numeric<=0 or (p_values->>'amount_cents')::numeric>100000000
    or (p_values->>'amount_cents')::numeric<>trunc((p_values->>'amount_cents')::numeric) then raise exception 'Informe o valor da despesa' using errcode='22023'; end if;
  v_date:=coalesce(nullif(p_values->>'occurred_on','')::date,(now() at time zone v_timezone)::date);
  if v_date<(now() at time zone v_timezone)::date-366 or v_date>(now() at time zone v_timezone)::date+366 then raise exception 'Data da despesa inválida' using errcode='22023'; end if;
  if coalesce(nullif(p_values->>'cost_kind',''),'operating') not in ('operating','structure','tax','fees','inventory') then raise exception 'Tipo de custo inválido' using errcode='22023'; end if;
  v_member:=nullif(p_values->>'barber_membership_id','')::uuid;
  if v_member is not null and not exists(select 1 from public.memberships where id=v_member and barbershop_id=p_barbershop_id and active) then raise exception 'Profissional inválido' using errcode='22023'; end if;
  v_values:=v_values||jsonb_build_object('occurred_on',v_date,'cost_kind',coalesce(nullif(p_values->>'cost_kind',''),'operating'),
   'professional_label',(select display_name from public.memberships where id=v_member));
  if v_member is null then v_values:=v_values-'professional_label'; end if;
 elsif p_action_type='stock_entry' then
  if jsonb_typeof(p_values->'items') is distinct from 'array' or jsonb_array_length(p_values->'items') not between 1 and 100 then raise exception 'Informe os produtos que chegaram' using errcode='22023'; end if;
  if (select count(*)<>count(distinct value->>'product_id') from jsonb_array_elements(p_values->'items')) then raise exception 'Produto repetido na entrada' using errcode='22023'; end if;
  v_methods:='[]'::jsonb;
  for v_record in select value from jsonb_array_elements(p_values->'items') loop
   select * into v_product from public.products where id=(v_record->>'product_id')::uuid and barbershop_id=p_barbershop_id;
   if not found then raise exception 'Produto fora desta barbearia' using errcode='22023'; end if;
   if jsonb_typeof(v_record->'quantity') is distinct from 'number' or (v_record->>'quantity')::numeric not between 1 and 100000 or (v_record->>'quantity')::numeric<>trunc((v_record->>'quantity')::numeric) then
    raise exception 'Quantidade inválida para %',v_product.name using errcode='22023'; end if;
   if v_record->'unit_cost_cents' is not null and v_record->'unit_cost_cents'<>'null'::jsonb and (jsonb_typeof(v_record->'unit_cost_cents')<>'number' or (v_record->>'unit_cost_cents')::numeric<0) then
    raise exception 'Custo inválido para %',v_product.name using errcode='22023'; end if;
   v_methods:=v_methods||jsonb_build_array(jsonb_build_object('product_id',v_product.id,'quantity',(v_record->>'quantity')::integer,
    'unit_cost_cents',coalesce(nullif(v_record->>'unit_cost_cents','')::numeric::integer,v_product.cost_cents,0)));
  end loop;
  select string_agg((i->>'quantity')||'x '||pr.name||' (custo R$ '||to_char((i->>'unit_cost_cents')::numeric/100,'FM999999990.00')||')',', ' order by pr.name)
   into v_label from jsonb_array_elements(v_methods) i join public.products pr on pr.id=(i->>'product_id')::uuid;
  v_values:=v_values||jsonb_build_object('items',v_methods,'items_label',v_label,'paid',coalesce((p_values->>'paid')::boolean,false));
 elsif p_action_type='stock_adjust' then
  select * into v_product from public.products where id=(p_values->>'product_id')::uuid and barbershop_id=p_barbershop_id;
  if not found then raise exception 'Produto fora desta barbearia' using errcode='22023'; end if;
  v_op:=p_values->>'reason';
  if v_op is null or v_op not in ('internal_use','loss','adjustment') then raise exception 'Motivo do ajuste inválido (consumo interno, perda ou ajuste)' using errcode='22023'; end if;
  if jsonb_typeof(p_values->'quantity') is distinct from 'number' or (p_values->>'quantity')::numeric=0 or abs((p_values->>'quantity')::numeric)>100000
    or (p_values->>'quantity')::numeric<>trunc((p_values->>'quantity')::numeric) then raise exception 'Informe a quantidade' using errcode='22023'; end if;
  v_quantity:=(p_values->>'quantity')::integer;
  if v_op in ('internal_use','loss') then v_quantity:=-abs(v_quantity); end if;
  if length(btrim(coalesce(p_values->>'notes','')))<3 then raise exception 'Informe a justificativa do ajuste (mínimo 3 letras)' using errcode='22023'; end if;
  if v_product.stock_quantity+v_quantity<0 then raise exception 'Estoque insuficiente de % (tem %).',v_product.name,v_product.stock_quantity using errcode='22023'; end if;
  v_values:=v_values||jsonb_build_object('quantity',v_quantity,'record_label',v_product.name,
   'stock_label',v_product.stock_quantity||' → '||(v_product.stock_quantity+v_quantity),
   'operation_label',case v_op when 'internal_use' then 'Consumo interno' when 'loss' then 'Perda' else 'Ajuste de inventário' end);
 end if;
 perform set_config('request.jwt.claims',coalesce(v_previous_claims,''),true);
 perform set_config('request.jwt.claim.sub',coalesce(v_previous_sub,''),true);
 return v_values;
end $function$;

create or replace function public.execute_ai_help_plan(p_plan_id uuid, p_actor_id uuid)
returns jsonb
language plpgsql
set search_path to ''
as $function$
declare p public.ai_help_plans%rowtype; a jsonb; v jsonb; r jsonb; v_id uuid; v_before jsonb; v_audit uuid;
 v_claims text:=current_setting('request.jwt.claims',true); v_sub_claim text:=current_setting('request.jwt.claim.sub',true);
begin
 select * into p from public.ai_help_plans where id=p_plan_id and requester_user_id=p_actor_id for update;
 if not found then raise exception 'Proposta não encontrada' using errcode='P0001'; end if;
 a:=app_private.ai_help_assert_actor(p_actor_id,p.barbershop_id,p.action_type);
 if p.status='completed' then return jsonb_build_object('status','completed','result',p.result,'replayed',true); end if;
 if p.status<>'pending' or p.expires_at<=now() then raise exception 'Esta proposta expirou ou não está pronta' using errcode='P0001'; end if;
 if p.action_type in ('book_appointment','create_schedule_block','manage_appointment','quick_service') then
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
  select jsonb_build_object('name',name,'description',description,'duration_minutes',duration_minutes,'active',active,'price_cents',price_cents,'cost_cents',cost_cents) into v_before from public.services where id=v_id and barbershop_id=p.barbershop_id;
  update public.services set name=case when v?'name' then v->>'name' else name end,
    description=case when v?'description' then nullif(v->>'description','') else description end,
    duration_minutes=case when v?'duration_minutes' then (v->>'duration_minutes')::integer else duration_minutes end,
    price_cents=case when v?'price_cents' then (v->>'price_cents')::numeric::integer else price_cents end,
    cost_cents=case when v?'cost_cents' then (v->>'cost_cents')::numeric::integer else cost_cents end,
    active=case when v?'active' then (v->>'active')::boolean else active end where id=v_id and barbershop_id=p.barbershop_id;
  r:=jsonb_build_object('id',v_id,'name',coalesce(v->>'name',v_before->>'name'));
 elsif p.action_type='update_product' then
  v_id:=(v->>'id')::uuid;
  select jsonb_build_object('name',name,'description',description,'sku',sku,'category',category,'active',active,'price_cents',price_cents,'cost_cents',cost_cents) into v_before from public.products where id=v_id and barbershop_id=p.barbershop_id;
  update public.products set name=case when v?'name' then v->>'name' else name end,
    description=case when v?'description' then nullif(v->>'description','') else description end,sku=case when v?'sku' then nullif(v->>'sku','') else sku end,
    category=case when v?'category' then v->>'category' else category end,
    price_cents=case when v?'price_cents' then (v->>'price_cents')::numeric::integer else price_cents end,
    cost_cents=case when v?'cost_cents' then (v->>'cost_cents')::numeric::integer else cost_cents end,
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
 elsif p.action_type='manage_appointment' then
  v_id:=(v->>'appointment_id')::uuid;
  select jsonb_build_object('status',status,'starts_at',starts_at,'arrived_at',arrived_at) into v_before from public.appointments where id=v_id and barbershop_id=p.barbershop_id;
  if v->>'operation' in ('arrive','undo_arrive') then
   perform public.appointment_checkin(p.barbershop_id,v_id,v->>'operation',null::uuid);
  else
   perform app_private.manage_appointment(p.barbershop_id,v_id,v->>'operation',nullif(v->>'starts_at','')::timestamptz,nullif(btrim(coalesce(v->>'reason','')),''));
  end if;
  r:=jsonb_build_object('id',v_id,'operation',v->>'operation');
 elsif p.action_type='quick_service' then
  r:=app_private.quick_service_entry(p.barbershop_id,coalesce(v->>'client_name',''),v->>'phone',(v->>'barber_membership_id')::uuid,
    array(select value::uuid from jsonb_array_elements_text(v->'service_ids')),nullif(v->>'starts_at','')::timestamptz,
    nullif(v->>'total_cents','')::numeric::integer,nullif(v->>'method',''),p.id,nullif(btrim(coalesce(v->>'notes','')),''));
  v_id:=nullif(r->>'appointment_id','')::uuid;
 elsif p.action_type='register_sale' then
  v_id:=app_private.sale_professional(p.barbershop_id,nullif(v->>'client_id','')::uuid,
    (select jsonb_agg(jsonb_build_object('product_id',i->>'product_id','quantity',(i->>'quantity')::numeric::integer)) from jsonb_array_elements(v->'items') i),
    nullif(v->>'barber_membership_id','')::uuid,p.id);
  r:=jsonb_build_object('id',v_id,'total_cents',v->'total_cents');
 elsif p.action_type='receive_payment' then
  r:=jsonb_build_object('payment_ids',app_private.cash_receive(p.barbershop_id,nullif(v->>'sale_id','')::uuid,nullif(v->>'appointment_id','')::uuid,v->'methods',p.id),
    'amount_cents',v->'amount_cents');
  v_id:=coalesce(nullif(v->>'appointment_id','')::uuid,nullif(v->>'sale_id','')::uuid);
 elsif p.action_type='cash_register' then
  if v->>'operation'='open' then v_id:=app_private.cash_open(p.barbershop_id,(v->>'amount_cents')::bigint,nullif(btrim(coalesce(v->>'notes','')),''));
  elsif v->>'operation'='close' then v_id:=app_private.cash_close(p.barbershop_id,(v->>'session_id')::uuid,(v->>'amount_cents')::bigint,nullif(btrim(coalesce(v->>'notes','')),''));
  else v_id:=app_private.cash_adjust(p.barbershop_id,v->>'operation',(v->>'amount_cents')::bigint,btrim(v->>'notes'),p.id); end if;
  r:=jsonb_build_object('id',v_id,'operation',v->>'operation');
 elsif p.action_type='create_expense' then
  insert into public.expenses(barbershop_id,category,description,amount_cents,occurred_on,created_by,cost_kind,barber_membership_id)
  values(p.barbershop_id,btrim(v->>'category'),btrim(v->>'description'),(v->>'amount_cents')::numeric::integer,(v->>'occurred_on')::date,p_actor_id,
   coalesce(nullif(v->>'cost_kind',''),'operating'),nullif(v->>'barber_membership_id','')::uuid) returning id into v_id;
  r:=jsonb_build_object('id',v_id,'amount_cents',v->'amount_cents');
 elsif p.action_type='stock_entry' then
  v_id:=app_private.inventory_receive(p.barbershop_id,null::uuid,nullif(btrim(coalesce(v->>'invoice','')),''),v->'items',coalesce((v->>'paid')::boolean,false),p.id);
  r:=jsonb_build_object('id',v_id);
 elsif p.action_type='stock_adjust' then
  v_id:=app_private.inventory_adjust(p.barbershop_id,(v->>'product_id')::uuid,(v->>'quantity')::integer,v->>'reason',btrim(v->>'notes'),p.id);
  r:=jsonb_build_object('id',v_id);
 else
  r:=public.execute_ai_help_plan_legacy(p_plan_id,p_actor_id)->'result'; v_id:=(r->>'id')::uuid;
 end if;
 insert into public.ai_help_action_audit(plan_id,barbershop_id,actor_user_id,actor_role,action_type,record_id,before_values,after_values)
 values(p.id,case when p.action_type='create_shop' then v_id else p.barbershop_id end,p_actor_id,a->>'role',p.action_type,v_id,v_before,v) returning id into v_audit;
 r:=coalesce(r,'{}'::jsonb)||jsonb_build_object('audit_id',v_audit);
 update public.ai_help_plans set status='completed',result=r,executed_at=now() where id=p.id;
 perform set_config('request.jwt.claims',coalesce(v_claims,''),true);
 perform set_config('request.jwt.claim.sub',coalesce(v_sub_claim,''),true);
 return jsonb_build_object('status','completed','result',r,'replayed',false);
end $function$;

-- Horários livres para remarcar um agendamento (consulta da IA, sem gravar nada).
create or replace function public.ai_help_reschedule_slots(p_actor_id uuid, p_barbershop_id uuid, p_appointment_id uuid, p_day date)
returns jsonb
language plpgsql
set search_path to ''
as $function$
declare a jsonb; r jsonb; v_barber uuid; v_claims text:=current_setting('request.jwt.claims',true); v_sub text:=current_setting('request.jwt.claim.sub',true);
begin
 a:=app_private.ai_help_assert_actor(p_actor_id,p_barbershop_id,'manage_appointment');
 select barber_membership_id into v_barber from public.appointments where id=p_appointment_id and barbershop_id=p_barbershop_id;
 if v_barber is null or (a->>'role'='barber' and v_barber<>(a->>'member_id')::uuid) then raise exception 'Agendamento fora do seu acesso' using errcode='42501'; end if;
 if p_day is null or p_day<current_date-1 or p_day>current_date+365 then raise exception 'Data inválida' using errcode='22023'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor_id,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',p_actor_id::text,true);
 select coalesce(jsonb_agg(jsonb_build_object('starts_at',s.starts_at,'ends_at',s.ends_at) order by s.starts_at),'[]'::jsonb) into r
  from app_private.reschedule_slots(p_barbershop_id,p_appointment_id,p_day) s;
 perform set_config('request.jwt.claims',coalesce(v_claims,''),true);
 perform set_config('request.jwt.claim.sub',coalesce(v_sub,''),true);
 return r;
end $function$;

revoke all on function public.ai_help_reschedule_slots(uuid,uuid,uuid,date) from public, anon, authenticated;
grant execute on function public.ai_help_reschedule_slots(uuid,uuid,uuid,date) to service_role;
revoke all on function public.validate_ai_help_action(uuid,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.validate_ai_help_action(uuid,uuid,text,jsonb) to service_role;
revoke all on function public.execute_ai_help_plan(uuid,uuid) from public, anon, authenticated;
grant execute on function public.execute_ai_help_plan(uuid,uuid) to service_role;

alter table public.ai_help_plans drop constraint ai_help_plans_action_type_check;
alter table public.ai_help_plans add constraint ai_help_plans_action_type_check check (action_type = any (array[
 'create_shop','create_service','create_product','create_shop_goal','create_personal_goal','create_marketing_task',
 'book_appointment','create_schedule_block','update_service','update_product','create_client','update_client',
 'manage_appointment','quick_service','register_sale','receive_payment','cash_register','create_expense','stock_entry','stock_adjust']::text[]));

-- Busca de clientes por nome (sem acento) ou telefone, só dentro do acesso de quem pergunta.
create or replace function public.ai_help_find_clients(p_actor_id uuid, p_barbershop_id uuid, p_query text)
returns jsonb
language plpgsql
stable
set search_path to ''
as $function$
declare a jsonb; v_digits text:=regexp_replace(coalesce(p_query,''),'\D','','g'); v_text text; r jsonb;
begin
 a:=app_private.ai_help_assert_actor(p_actor_id,p_barbershop_id,null);
 v_text:=lower(translate(btrim(regexp_replace(coalesce(p_query,''),'[0-9()+-]',' ','g')),'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ','aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'));
 v_text:=btrim(regexp_replace(v_text,'\s+',' ','g'));
 if length(v_digits)<4 and length(v_text)<2 then return '[]'::jsonb; end if;
 if left(v_digits,2)='55' and length(v_digits) in (12,13) then v_digits:=substr(v_digits,3); end if;
 select coalesce(jsonb_agg(x order by x->>'nome'),'[]'::jsonb) into r from (
  select jsonb_build_object('id',c.id,'nome',c.full_name,'telefone_final',nullif(right(regexp_replace(coalesce(c.phone,''),'\D','','g'),4),''),
    'tem_email',c.email is not null,'updated_at',c.updated_at,
    'ultima_visita',(select to_char(max(ap.starts_at) at time zone coalesce(b.timezone,'America/Sao_Paulo'),'DD/MM/YYYY') from public.appointments ap where ap.client_id=c.id and ap.barbershop_id=c.barbershop_id and ap.status='completed')) x
  from public.clients c join public.barbershops b on b.id=c.barbershop_id
  where c.barbershop_id=p_barbershop_id
   and (a->>'role'<>'barber' or exists(select 1 from public.client_barbers cb where cb.barbershop_id=c.barbershop_id and cb.client_id=c.id and cb.barber_membership_id=(a->>'member_id')::uuid))
   and ((length(v_digits)>=4 and regexp_replace(coalesce(c.phone,''),'\D','','g') like '%'||v_digits||'%')
    or (length(v_text)>=2 and not exists(select 1 from regexp_split_to_table(v_text,' ') t where t<>''
      and lower(translate(c.full_name,'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ','aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')) not like '%'||t||'%')))
  order by c.full_name limit 12) s;
 return r;
end $function$;
revoke all on function public.ai_help_find_clients(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.ai_help_find_clients(uuid,uuid,text) to service_role;
