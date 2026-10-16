-- Cadastro rápido de serviço: nome e número do cliente obrigatórios, profissional, serviços e (opcional) recebimento.
create or replace function app_private.quick_service_entry(
  p_shop uuid, p_client_name text, p_phone text, p_barber uuid, p_service_ids uuid[],
  p_starts_at timestamptz default null, p_total_cents integer default null, p_method text default null, p_request uuid default null, p_notes text default null)
returns jsonb
language plpgsql security definer set search_path to ''
as $function$
declare
  v_admin boolean := app_private.has_shop_role(p_shop, array['admin']::public.shop_role[]);
  v_own uuid; v_name text := btrim(regexp_replace(coalesce(p_client_name,''), '\s+', ' ', 'g'));
  v_digits text := regexp_replace(coalesce(p_phone,''), '\D', '', 'g');
  v_phone text; v_client uuid; v_client_name text; v_created boolean := false;
  v_duration int; v_price bigint; v_total bigint; v_start timestamptz; v_appt uuid; v_ids jsonb := null; v_count int;
begin
  if (select auth.uid()) is null or not app_private.has_module(p_shop, 'appointments') then
    raise exception 'Seu acesso não permite registrar atendimentos' using errcode = '42501';
  end if;
  if length(v_name) < 2 or length(v_name) > 160 then raise exception 'Informe o nome do cliente' using errcode = '22023'; end if;
  if left(v_digits, 2) = '55' and length(v_digits) in (12, 13) then v_digits := substr(v_digits, 3); end if;
  if length(v_digits) not in (10, 11) then raise exception 'Informe o número do cliente com DDD' using errcode = '22023'; end if;
  v_phone := case when length(v_digits) = 11 then format('(%s) %s-%s', substr(v_digits,1,2), substr(v_digits,3,5), substr(v_digits,8,4))
                  else format('(%s) %s-%s', substr(v_digits,1,2), substr(v_digits,3,4), substr(v_digits,7,4)) end;
  if p_service_ids is null or cardinality(p_service_ids) = 0 or cardinality(p_service_ids) > 10 then raise exception 'Escolha pelo menos um serviço' using errcode = '22023'; end if;

  if not v_admin then
    select m.id into v_own from public.memberships m where m.barbershop_id = p_shop and m.user_id = (select auth.uid()) and m.role = 'barber' and m.active;
    if v_own is null or p_barber is distinct from v_own then raise exception 'Registre apenas os seus atendimentos' using errcode = '42501'; end if;
  end if;
  if not exists (select 1 from public.memberships m where m.id = p_barber and m.barbershop_id = p_shop and m.role = 'barber' and m.active) then
    raise exception 'Profissional não encontrado ou desativado' using errcode = '22023';
  end if;

  select count(*), coalesce(sum(s.duration_minutes), 0), coalesce(sum(s.price_cents), 0) into v_count, v_duration, v_price
    from public.services s where s.barbershop_id = p_shop and s.active and s.id = any(p_service_ids);
  if v_count <> cardinality(p_service_ids) then raise exception 'Serviço indisponível' using errcode = '22023'; end if;
  v_total := coalesce(p_total_cents, v_price);
  if v_total < 0 or v_total > 100000000 then raise exception 'Valor inválido' using errcode = '22023'; end if;
  v_start := coalesce(p_starts_at, now());
  if v_start > now() + interval '10 minutes' or v_start < now() - interval '60 days' then raise exception 'Data do atendimento inválida' using errcode = '22023'; end if;

  -- Cliente: encontra pelo número (com ou sem 55) ou cadastra.
  select c.id, c.full_name into v_client, v_client_name from public.clients c
    where c.barbershop_id = p_shop and regexp_replace(coalesce(c.phone,''), '\D', '', 'g') in (v_digits, '55' || v_digits)
    order by c.created_at limit 1;
  if v_client is null then
    insert into public.clients (barbershop_id, full_name, phone) values (p_shop, v_name, v_phone) returning id, full_name into v_client, v_client_name;
    v_created := true;
  end if;
  insert into public.client_barbers (barbershop_id, client_id, barber_membership_id) values (p_shop, v_client, p_barber) on conflict do nothing;

  -- Atendimento já realizado: entra como confirmado (sem ocupar agenda) e é concluído, para gerar comissão e fidelidade.
  insert into public.appointments (barbershop_id, client_id, barber_membership_id, starts_at, ends_at, occupied_starts_at, occupied_ends_at, status, source, total_price_cents, notes)
    values (p_shop, v_client, p_barber, v_start, v_start + make_interval(mins => greatest(v_duration, 5)), v_start, v_start, 'confirmed',
      case when v_admin then 'admin' else 'barber' end, v_total::int, nullif(btrim(coalesce(p_notes,'')), ''))
    returning id into v_appt;
  insert into public.appointment_services (barbershop_id, appointment_id, service_id, price_cents, duration_minutes)
    select p_shop, v_appt, s.id, s.price_cents, s.duration_minutes from public.services s where s.barbershop_id = p_shop and s.id = any(p_service_ids);
  update public.appointments set status = 'completed' where id = v_appt;

  -- Recebimento opcional (somente administração, com caixa aberto).
  if p_method is not null and v_total > 0 then
    if not v_admin then raise exception 'Apenas a administração registra o recebimento' using errcode = '42501'; end if;
    v_ids := app_private.cash_receive(p_shop, null, v_appt, jsonb_build_array(jsonb_build_object('method', p_method, 'amount_cents', v_total)), coalesce(p_request, gen_random_uuid()));
  end if;

  return jsonb_build_object('appointment_id', v_appt, 'client_id', v_client, 'client_name', v_client_name, 'client_created', v_created,
    'total_cents', v_total, 'paid', v_ids is not null);
end $function$;

create or replace function public.quick_service_entry(
  p_shop uuid, p_client_name text, p_phone text, p_barber uuid, p_service_ids uuid[],
  p_starts_at timestamptz default null, p_total_cents integer default null, p_method text default null, p_request uuid default null, p_notes text default null)
returns jsonb language sql set search_path to ''
as $function$ select app_private.quick_service_entry(p_shop, p_client_name, p_phone, p_barber, p_service_ids, p_starts_at, p_total_cents, p_method, p_request, p_notes) $function$;
grant execute on function app_private.quick_service_entry(uuid, text, text, uuid, uuid[], timestamptz, integer, text, uuid, text) to authenticated;
grant execute on function public.quick_service_entry(uuid, text, text, uuid, uuid[], timestamptz, integer, text, uuid, text) to authenticated;

-- Últimos cadastros rápidos (para a lista da aba).
create or replace function public.quick_service_recent(p_shop uuid, p_limit integer default 20)
returns jsonb language plpgsql stable security definer set search_path to ''
as $function$
declare v_admin boolean := app_private.has_shop_role(p_shop, array['admin']::public.shop_role[]); v_own uuid; v_rows jsonb;
begin
  if (select auth.uid()) is null or not app_private.has_module(p_shop, 'appointments') then raise exception 'Acesso restrito' using errcode = '42501'; end if;
  if not v_admin then select m.id into v_own from public.memberships m where m.barbershop_id = p_shop and m.user_id = (select auth.uid()) and m.role = 'barber' and m.active; end if;
  select coalesce(jsonb_agg(r order by r.starts_at desc), '[]') into v_rows from (
    select a.id, a.starts_at, a.total_price_cents, c.full_name client_name, c.phone, coalesce(nullif(btrim(m.display_name),''), 'Profissional') barber_name,
      (select string_agg(s.name, ' + ' order by s.name) from public.appointment_services aps join public.services s on s.id = aps.service_id where aps.appointment_id = a.id) services,
      exists (select 1 from public.payments p where p.appointment_id = a.id and p.status in ('paid','approved')) paid
    from public.appointments a join public.clients c on c.id = a.client_id left join public.memberships m on m.id = a.barber_membership_id
    where a.barbershop_id = p_shop and a.status = 'completed' and a.source in ('admin','barber') and a.occupied_starts_at = a.occupied_ends_at
      and a.subscription_id is null and (v_admin or a.barber_membership_id = v_own)
    order by a.starts_at desc limit least(greatest(coalesce(p_limit, 20), 1), 50)) r;
  return v_rows;
end $function$;
grant execute on function public.quick_service_recent(uuid, integer) to authenticated;
