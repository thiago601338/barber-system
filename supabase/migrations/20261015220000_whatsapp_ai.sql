-- Atendimento por IA no WhatsApp (API oficial da Meta, Cloud API).
-- A IA só responde mensagens recebidas: nunca inicia conversa.

-- Token da Meta por barbearia (criptografado pelas funções do servidor). Sem políticas: só o servidor lê.
create table if not exists public.whatsapp_credentials (
  barbershop_id uuid primary key references public.barbershops(id) on delete cascade,
  access_token_encrypted text not null,
  updated_at timestamptz not null default now()
);
alter table public.whatsapp_credentials enable row level security;

create table if not exists public.whatsapp_connections (
  barbershop_id uuid primary key references public.barbershops(id) on delete cascade,
  waba_id text not null,
  phone_number_id text not null unique,
  display_phone_number text,
  verified_name text,
  coexistence boolean not null default false,
  status text not null default 'connected' check (status in ('connected', 'disconnected', 'error')),
  ai_enabled boolean not null default false,
  ai_instructions text check (ai_instructions is null or length(ai_instructions) <= 4000),
  ai_can_book boolean not null default true,
  human_pause_minutes integer not null default 120 check (human_pause_minutes between 0 and 1440),
  last_error text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  wa_id text not null check (wa_id ~ '^[0-9]{8,20}$'),
  contact_name text,
  client_id uuid references public.clients(id) on delete set null,
  last_customer_message_at timestamptz,
  last_message_at timestamptz,
  last_message_preview text,
  ai_paused_until timestamptz,
  unread_count integer not null default 0 check (unread_count >= 0),
  created_at timestamptz not null default now(),
  unique (barbershop_id, wa_id)
);
create index if not exists whatsapp_conversations_shop_recent_idx on public.whatsapp_conversations (barbershop_id, last_message_at desc nulls last);

create table if not exists public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  wa_message_id text unique,
  direction text not null check (direction in ('in', 'out')),
  author text not null check (author in ('customer', 'ai', 'staff', 'phone')),
  kind text not null default 'text',
  body text,
  status text,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists whatsapp_messages_conversation_idx on public.whatsapp_messages (conversation_id, created_at);

alter table public.whatsapp_connections enable row level security;
alter table public.whatsapp_conversations enable row level security;
alter table public.whatsapp_messages enable row level security;

create policy whatsapp_connections_admin_read on public.whatsapp_connections for select to authenticated
  using (app_private.is_platform_admin() or app_private.has_shop_role(barbershop_id, array['admin'::public.shop_role]));

create policy whatsapp_conversations_admin_read on public.whatsapp_conversations for select to authenticated
  using (app_private.is_platform_admin() or app_private.has_shop_role(barbershop_id, array['admin'::public.shop_role]));

create policy whatsapp_messages_admin_read on public.whatsapp_messages for select to authenticated
  using (app_private.is_platform_admin() or app_private.has_shop_role(barbershop_id, array['admin'::public.shop_role]));

-- Leitura pelo painel (só administradores, pelas políticas acima); alterações apenas pelo servidor.
grant all on public.whatsapp_credentials, public.whatsapp_connections, public.whatsapp_conversations, public.whatsapp_messages to service_role;

-- Telefone brasileiro normalizado para DDD + número (11 dígitos com o nono dígito).
create or replace function app_private.br_phone_key(p text) returns text
language sql immutable set search_path to ''
as $function$
  with d as (select regexp_replace(coalesce(p, ''), '\D', '', 'g') v),
  n as (select case when length(v) in (12, 13) and left(v, 2) = '55' then substr(v, 3) else v end v from d)
  select case
    when length(v) = 10 and substr(v, 3, 1) in ('6','7','8','9') then left(v, 2) || '9' || substr(v, 3)
    when length(v) in (10, 11) then v
    else nullif(v, '') end
  from n
$function$;
create index if not exists clients_shop_phone_key_idx on public.clients (barbershop_id, app_private.br_phone_key(phone)) where phone is not null;

create or replace function app_private.whatsapp_bot_client(p_barbershop_id uuid, p_wa_id text, p_name text) returns uuid
language plpgsql security definer set search_path to ''
as $function$
declare v_key text := app_private.br_phone_key(p_wa_id); v_id uuid; v_name text; v_phone text;
begin
  if v_key is null then raise exception 'Telefone inválido' using errcode = '22023'; end if;
  select c.id into v_id from public.clients c
    where c.barbershop_id = p_barbershop_id and app_private.br_phone_key(c.phone) = v_key
    order by (c.user_id is not null) desc, c.created_at limit 1;
  if v_id is not null then return v_id; end if;
  v_name := left(btrim(coalesce(p_name, '')), 160);
  if length(v_name) < 2 then v_name := 'Cliente WhatsApp'; end if;
  v_phone := case when length(v_key) = 11 then format('(%s) %s-%s', left(v_key, 2), substr(v_key, 3, 5), substr(v_key, 8)) else v_key end;
  insert into public.clients (barbershop_id, full_name, phone, notes)
  values (p_barbershop_id, v_name, v_phone, 'Cadastrado pelo atendimento do WhatsApp')
  returning id into v_id;
  return v_id;
end $function$;

create or replace function app_private.whatsapp_bot_book(p_barbershop_id uuid, p_client_id uuid, p_barber_membership_id uuid, p_service_ids uuid[], p_starts_at timestamptz) returns uuid
language plpgsql security definer set search_path to ''
as $function$
declare v_timezone text; v_schedule jsonb; v_price integer; v_id uuid;
begin
  select timezone into v_timezone from public.barbershops where id = p_barbershop_id and active;
  if not found then raise exception 'Barbearia indisponível' using errcode = '22023'; end if;
  if not exists (select 1 from public.clients where id = p_client_id and barbershop_id = p_barbershop_id) then
    raise exception 'Cliente não pertence a esta barbearia' using errcode = '22023'; end if;
  if coalesce(array_length(p_service_ids, 1), 0) = 0 or (select count(*) from public.services s where s.barbershop_id = p_barbershop_id and s.active and s.id = any(p_service_ids)) <> cardinality(p_service_ids) then
    raise exception 'Serviço indisponível' using errcode = '22023'; end if;
  if exists (select 1 from public.services s where s.barbershop_id = p_barbershop_id and s.id = any(p_service_ids) and s.requires_subscription) then
    raise exception 'Serviço exclusivo para assinantes: agende pelo aplicativo da barbearia' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext(p_barbershop_id::text), hashtext('appointment_schedule'));
  perform 1 from public.memberships where id = p_barber_membership_id and barbershop_id = p_barbershop_id and role = 'barber' and active for update;
  if not found then raise exception 'Profissional indisponível' using errcode = '22023'; end if;
  v_schedule := app_private.appointment_schedule_details(p_barbershop_id, p_barber_membership_id, p_service_ids, p_starts_at);
  if not coalesce((v_schedule->>'available')::boolean, false) or not exists (
    select 1 from app_private.available_slots(p_barbershop_id, p_barber_membership_id, p_service_ids, (p_starts_at at time zone v_timezone)::date) slot
    where slot.starts_at = p_starts_at) then
    raise exception 'Horário indisponível' using errcode = '22023'; end if;
  select sum(price_cents)::integer into v_price from public.services where barbershop_id = p_barbershop_id and id = any(p_service_ids);
  insert into public.appointments (barbershop_id, client_id, barber_membership_id, starts_at, ends_at, status, source, total_price_cents, notes)
  values (p_barbershop_id, p_client_id, p_barber_membership_id, p_starts_at, (v_schedule->>'ends_at')::timestamptz, 'confirmed', 'client', coalesce(v_price, 0), 'Agendado pelo atendimento de IA no WhatsApp')
  returning id into v_id;
  insert into public.appointment_services (barbershop_id, appointment_id, service_id, price_cents, duration_minutes)
  select p_barbershop_id, v_id, s.id, s.price_cents, app_private.appointment_duration_minutes(p_barbershop_id, p_barber_membership_id, array[s.id])
  from public.services s where s.barbershop_id = p_barbershop_id and s.id = any(p_service_ids);
  perform app_private.commit_appointment_schedule(p_barbershop_id, v_id, p_service_ids);
  insert into public.client_barbers (barbershop_id, client_id, barber_membership_id)
  values (p_barbershop_id, p_client_id, p_barber_membership_id) on conflict do nothing;
  return v_id;
end $function$;

create or replace function app_private.whatsapp_bot_cancel(p_barbershop_id uuid, p_client_id uuid, p_appointment_id uuid) returns boolean
language plpgsql security definer set search_path to ''
as $function$
begin
  update public.appointments set status = 'cancelled', cancellation_reason = 'Cancelado pelo cliente no WhatsApp'
  where id = p_appointment_id and barbershop_id = p_barbershop_id and client_id = p_client_id
    and status in ('pending', 'confirmed') and starts_at > now();
  if not found then raise exception 'Agendamento não encontrado ou não pode mais ser cancelado' using errcode = '22023'; end if;
  return true;
end $function$;

-- Expostas pela API só para o servidor (chave secreta): qualquer outro papel é recusado.
create or replace function public.whatsapp_bot_client(p_barbershop_id uuid, p_wa_id text, p_name text) returns uuid
language plpgsql set search_path to '' as $function$
begin
  if current_user not in ('service_role', 'postgres') then raise exception 'Acesso restrito' using errcode = '42501'; end if;
  return app_private.whatsapp_bot_client(p_barbershop_id, p_wa_id, p_name);
end $function$;
create or replace function public.whatsapp_bot_book(p_barbershop_id uuid, p_client_id uuid, p_barber_membership_id uuid, p_service_ids uuid[], p_starts_at timestamptz) returns uuid
language plpgsql set search_path to '' as $function$
begin
  if current_user not in ('service_role', 'postgres') then raise exception 'Acesso restrito' using errcode = '42501'; end if;
  return app_private.whatsapp_bot_book(p_barbershop_id, p_client_id, p_barber_membership_id, p_service_ids, p_starts_at);
end $function$;
create or replace function public.whatsapp_bot_cancel(p_barbershop_id uuid, p_client_id uuid, p_appointment_id uuid) returns boolean
language plpgsql set search_path to '' as $function$
begin
  if current_user not in ('service_role', 'postgres') then raise exception 'Acesso restrito' using errcode = '42501'; end if;
  return app_private.whatsapp_bot_cancel(p_barbershop_id, p_client_id, p_appointment_id);
end $function$;
grant execute on function app_private.whatsapp_bot_client(uuid, text, text), app_private.whatsapp_bot_book(uuid, uuid, uuid, uuid[], timestamptz), app_private.whatsapp_bot_cancel(uuid, uuid, uuid) to service_role;

-- WhatsApp usernames: clientes podem chegar só com o ID da conta comercial (BSUID, ex.: BR.123...), sem telefone.
alter table public.whatsapp_conversations drop constraint if exists whatsapp_conversations_wa_id_check;
alter table public.whatsapp_conversations add constraint whatsapp_conversations_wa_id_check
  check (wa_id ~ '^([0-9]{8,20}|[A-Z]{2}\.[0-9A-Za-z_-]{4,64})$');
alter table public.whatsapp_conversations add column if not exists user_id text;

create or replace function app_private.whatsapp_bot_client(p_barbershop_id uuid, p_wa_id text, p_name text) returns uuid
language plpgsql security definer set search_path to ''
as $function$
declare v_is_phone boolean := p_wa_id ~ '^[0-9]{8,20}$'; v_key text; v_id uuid; v_name text; v_phone text;
begin
  v_name := left(btrim(coalesce(p_name, '')), 160);
  if length(v_name) < 2 then v_name := 'Cliente WhatsApp'; end if;
  if not v_is_phone then
    insert into public.clients (barbershop_id, full_name, notes)
    values (p_barbershop_id, v_name, 'Cadastrado pelo atendimento do WhatsApp (sem telefone visível)')
    returning id into v_id;
    return v_id;
  end if;
  v_key := app_private.br_phone_key(p_wa_id);
  if v_key is null then raise exception 'Telefone inválido' using errcode = '22023'; end if;
  select c.id into v_id from public.clients c
    where c.barbershop_id = p_barbershop_id and app_private.br_phone_key(c.phone) = v_key
    order by (c.user_id is not null) desc, c.created_at limit 1;
  if v_id is not null then return v_id; end if;
  v_phone := case when length(v_key) = 11 then format('(%s) %s-%s', left(v_key, 2), substr(v_key, 3, 5), substr(v_key, 8)) else v_key end;
  insert into public.clients (barbershop_id, full_name, phone, notes)
  values (p_barbershop_id, v_name, v_phone, 'Cadastrado pelo atendimento do WhatsApp')
  returning id into v_id;
  return v_id;
end $function$;
