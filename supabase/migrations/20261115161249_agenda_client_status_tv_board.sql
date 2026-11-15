-- Agenda: status do cliente (lembrete enviado, confirmou pelo link, chegou), origem do agendamento
-- e painel de TV com link próprio (sem login).
alter table public.appointments
  add column if not exists arrived_at timestamptz,
  add column if not exists reminder_sent_at timestamptz,
  add column if not exists confirm_token uuid,
  add column if not exists booking_origin text check (booking_origin is null or booking_origin in ('reception','app','site','whatsapp'));
create unique index if not exists appointments_confirm_token_uq on public.appointments(confirm_token) where confirm_token is not null;

-- Primeiro nome + inicial do último sobrenome, para telas públicas.
create or replace function app_private.short_name(p_name text)
returns text language sql immutable set search_path to ''
as $function$
  select case
    when coalesce(btrim(p_name), '') = '' then 'Cliente'
    when array_length(regexp_split_to_array(btrim(p_name), '\s+'), 1) = 1 then initcap(lower(btrim(p_name)))
    else initcap(lower((regexp_split_to_array(btrim(p_name), '\s+'))[1])) || ' '
      || upper(left((regexp_split_to_array(btrim(p_name), '\s+'))[array_length(regexp_split_to_array(btrim(p_name), '\s+'), 1)], 1)) || '.'
  end
$function$;
revoke all on function app_private.short_name(text) from public, anon, authenticated;

-- Recepção: marca chegada e registra o lembrete enviado (com o link de confirmação do cliente).
create or replace function public.appointment_checkin(p_barbershop_id uuid, p_appointment_id uuid, p_action text, p_token uuid default null)
returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v_a public.appointments; v_staff boolean;
begin
  if (select auth.uid()) is null then raise exception 'Entre na sua conta.' using errcode = '42501'; end if;
  select * into v_a from public.appointments where barbershop_id = p_barbershop_id and id = p_appointment_id for update;
  if not found then raise exception 'Agendamento não encontrado.' using errcode = 'P0002'; end if;
  v_staff := app_private.has_shop_role(p_barbershop_id, array['admin']::public.shop_role[])
    or (app_private.has_module(p_barbershop_id, 'appointments') and app_private.is_own_barber(p_barbershop_id, v_a.barber_membership_id));
  if not v_staff then raise exception 'Ação exclusiva da equipe.' using errcode = '42501'; end if;
  if v_a.status in ('completed', 'cancelled', 'no_show') then raise exception 'Esse atendimento já foi encerrado.' using errcode = '23514'; end if;
  if p_action = 'arrive' then
    if v_a.status = 'pending' then
      update public.appointments set arrived_at = coalesce(arrived_at, now()), status = 'confirmed' where id = p_appointment_id returning * into v_a;
    else
      update public.appointments set arrived_at = coalesce(arrived_at, now()) where id = p_appointment_id returning * into v_a;
    end if;
  elsif p_action = 'undo_arrive' then
    if v_a.status = 'in_progress' then raise exception 'O atendimento já começou.' using errcode = '23514'; end if;
    update public.appointments set arrived_at = null where id = p_appointment_id returning * into v_a;
  elsif p_action = 'remind' then
    update public.appointments set reminder_sent_at = now(), confirm_token = coalesce(confirm_token, p_token, gen_random_uuid())
      where id = p_appointment_id returning * into v_a;
  else
    raise exception 'Ação inválida.' using errcode = '23514';
  end if;
  return jsonb_build_object('id', v_a.id, 'status', v_a.status, 'arrived_at', v_a.arrived_at,
    'reminder_sent_at', v_a.reminder_sent_at, 'confirm_token', v_a.confirm_token);
end $function$;
revoke all on function public.appointment_checkin(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.appointment_checkin(uuid, uuid, text, uuid) to authenticated;

-- Link de confirmação enviado ao cliente: mostra o horário e registra a confirmação, sem login.
create or replace function public.appointment_confirmation(p_token uuid, p_confirm boolean default false)
returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v_a public.appointments; v_shop public.barbershops; v_open boolean;
begin
  if p_token is null then return null; end if;
  select * into v_a from public.appointments where confirm_token = p_token;
  if not found then return null; end if;
  select * into v_shop from public.barbershops where id = v_a.barbershop_id;
  v_open := v_a.status in ('pending', 'confirmed') and v_a.starts_at > now() - interval '30 minutes';
  if p_confirm and v_open and v_a.client_confirmed_at is null then
    if v_a.status = 'pending' then
      update public.appointments set status = 'confirmed', client_confirmed_at = now() where id = v_a.id returning * into v_a;
    else
      update public.appointments set client_confirmed_at = now() where id = v_a.id returning * into v_a;
    end if;
  end if;
  return jsonb_build_object(
    'shop_name', v_shop.name, 'shop_slug', v_shop.slug, 'logo_url', v_shop.logo_url, 'brand_theme', v_shop.brand_theme,
    'whatsapp', coalesce(nullif(btrim(v_shop.whatsapp), ''), v_shop.phone), 'address', v_shop.address, 'timezone', v_shop.timezone,
    'starts_at', v_a.starts_at, 'status', v_a.status, 'confirmed_at', v_a.client_confirmed_at, 'can_confirm', v_open,
    'client', (select split_part(btrim(c.full_name), ' ', 1) from public.clients c where c.id = v_a.client_id),
    'barber', (select split_part(btrim(coalesce(m.display_name, '')), ' ', 1) from public.memberships m where m.id = v_a.barber_membership_id),
    'services', (select string_agg(s.name, ', ' order by s.name) from public.appointment_services x join public.services s on s.id = x.service_id where x.appointment_id = v_a.id));
end $function$;
revoke all on function public.appointment_confirmation(uuid, boolean) from public, anon, authenticated;
grant execute on function public.appointment_confirmation(uuid, boolean) to anon, authenticated;

-- Painel de TV: um link por barbearia, trocável pela administração.
create table if not exists public.shop_display_links (
  barbershop_id uuid primary key references public.barbershops(id) on delete cascade,
  token uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);
alter table public.shop_display_links enable row level security;
revoke all on public.shop_display_links from public, anon, authenticated;

create or replace function public.tv_board_link(p_barbershop_id uuid, p_rotate boolean default false)
returns uuid language plpgsql security definer set search_path to ''
as $function$
declare v_token uuid; v_admin boolean := app_private.has_shop_role(p_barbershop_id, array['admin']::public.shop_role[]);
begin
  if (select auth.uid()) is null or not (v_admin or app_private.has_module(p_barbershop_id, 'appointments')) then
    raise exception 'Seu acesso não permite abrir o painel.' using errcode = '42501';
  end if;
  if p_rotate then
    if not v_admin then raise exception 'Apenas a administração gera um novo link.' using errcode = '42501'; end if;
    insert into public.shop_display_links (barbershop_id) values (p_barbershop_id)
      on conflict (barbershop_id) do update set token = gen_random_uuid(), rotated_at = now()
      returning token into v_token;
  else
    insert into public.shop_display_links (barbershop_id) values (p_barbershop_id) on conflict (barbershop_id) do nothing;
    select token into v_token from public.shop_display_links where barbershop_id = p_barbershop_id;
  end if;
  return v_token;
end $function$;
revoke all on function public.tv_board_link(uuid, boolean) from public, anon, authenticated;
grant execute on function public.tv_board_link(uuid, boolean) to authenticated;

create or replace function public.tv_board(p_token uuid)
returns jsonb language plpgsql stable security definer set search_path to ''
as $function$
declare v_shop public.barbershops; v_day date; v_from timestamptz; v_to timestamptz;
begin
  if p_token is null then return null; end if;
  select b.* into v_shop from public.shop_display_links l join public.barbershops b on b.id = l.barbershop_id where l.token = p_token and b.active;
  if not found then return null; end if;
  v_day := (now() at time zone v_shop.timezone)::date;
  v_from := v_day::timestamp at time zone v_shop.timezone;
  v_to := (v_day + 1)::timestamp at time zone v_shop.timezone;
  return jsonb_build_object(
    'shop', jsonb_build_object('name', v_shop.name, 'logo_url', v_shop.logo_url, 'brand_theme', v_shop.brand_theme, 'timezone', v_shop.timezone),
    'now', now(),
    'appointments', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'starts_at', a.starts_at, 'ends_at', a.ends_at, 'status', a.status, 'arrived_at', a.arrived_at,
        'client', app_private.short_name(c.full_name),
        'barber', split_part(btrim(coalesce(m.display_name, '')), ' ', 1),
        'services', (select string_agg(s.name, ', ' order by s.name) from public.appointment_services x join public.services s on s.id = x.service_id where x.appointment_id = a.id)
      ) order by a.starts_at, a.id), '[]'::jsonb)
      from public.appointments a
        join public.clients c on c.id = a.client_id
        join public.memberships m on m.id = a.barber_membership_id
      where a.barbershop_id = v_shop.id and a.starts_at >= v_from and a.starts_at < v_to
        and a.status in ('pending', 'confirmed', 'in_progress')));
end $function$;
revoke all on function public.tv_board(uuid) from public, anon, authenticated;
grant execute on function public.tv_board(uuid) to anon, authenticated;
