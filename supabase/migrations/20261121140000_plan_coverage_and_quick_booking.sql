-- Cobertura do plano + cadastro rápido sem bloqueio e com agendamento futuro (21/11/2026)
--
-- 1) Plano ativo cobre os serviços do plano do cliente.
--    * Contratos fora do Mercado Pago (migrados do CashBarber, manuais): basta o contrato estar ativo.
--      Antes exigia pagamento pelo Mercado Pago no ciclo, e nenhum contrato do CashBarber passava.
--    * Contratos migrados do CashBarber seguem as regras de lá, gravadas na descrição do contrato:
--      "Dias liberados" e limite por serviço ("1x/ciclo"); "ilimitado" não tem limite de usos.
--    * Cobertura parcial: o plano cobre os serviços dele e o resto do atendimento é cobrado.
--    * Contratos do Mercado Pago continuam exigindo o pagamento confirmado do ciclo.
-- 2) Cadastro rápido: não é barrado pelos bloqueios importados do CashBarber, aceita horário futuro
--    (vira agendamento) e aplica o plano do cliente.

alter table public.appointments add column if not exists quick_entry boolean not null default false;

create or replace function app_private.subscription_eligibility_for_booking(p_barbershop_id uuid, p_client_id uuid, p_service_ids uuid[], p_starts_at timestamp with time zone, p_ignore_appointment_id uuid DEFAULT NULL::uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_required boolean; v_required_ids uuid[]; v_tz text; v_list jsonb := '[]'::jsonb; v_eligible_required boolean := false;
  s record; v_desc text; v_migrated boolean; v_freq int; v_months int; v_cs timestamptz; v_ce timestamptz;
  v_days text; v_dow int; v_remaining int; v_limit int; v_used int; v_item text; v_m text[]; v_sid uuid; v_sname text;
  v_covered uuid[]; v_uncovered_cents int;
  v_day_names text[] := array['Segunda','Terca','Quarta','Quinta','Sexta','Sabado','Domingo'];
begin
  if p_service_ids is null or cardinality(p_service_ids)<1 or cardinality(p_service_ids)>30
    or (select count(*) from public.services where barbershop_id=p_barbershop_id and active and id=any(p_service_ids))<>cardinality(p_service_ids) then
    raise exception 'Selecione serviços válidos desta barbearia' using errcode='22023';
  end if;
  select bool_or(requires_subscription), array_agg(id) filter (where requires_subscription)
    into v_required, v_required_ids from public.services where barbershop_id=p_barbershop_id and id=any(p_service_ids);
  select coalesce(nullif(timezone,''),'America/Sao_Paulo') into v_tz from public.barbershops where id=p_barbershop_id;

  for s in
    select x.* from public.subscriptions x
    where x.barbershop_id=p_barbershop_id and x.client_id=p_client_id and x.status='active'
      and not x.contract_review_required and x.contract_snapshot is not null
      and exists(select 1 from jsonb_array_elements(coalesce(x.contract_snapshot->'services','[]'::jsonb)) item
                 where (item->>'id')::uuid = any(p_service_ids))
    order by x.current_period_end, x.created_at
  loop
    v_desc := coalesce(s.contract_snapshot->>'description','');
    v_migrated := coalesce(s.contract_snapshot->'migrated_from'->>'system','') = 'cashbarber';
    v_freq := greatest(coalesce((s.contract_snapshot->>'frequency_months')::int, 1), 1);

    if s.provider = 'mercadopago' then
      continue when not (p_starts_at>=s.current_period_start and p_starts_at<s.current_period_end);
      continue when not exists(select 1 from public.payments pay where pay.barbershop_id=s.barbershop_id and pay.subscription_id=s.id
        and pay.provider='mercadopago' and pay.status='paid' and pay.amount_cents=(s.contract_snapshot->>'price_cents')::integer
        and pay.paid_at>=s.current_period_start and pay.paid_at<s.current_period_end);
      v_cs := s.current_period_start; v_ce := s.current_period_end;
    else
      -- Contrato ativo cobre. O ciclo usado para contar os usos é o que contém o horário do atendimento.
      if s.current_period_start is null then
        v_cs := date_trunc('month', p_starts_at); v_ce := v_cs + make_interval(months => v_freq);
      else
        v_months := (extract(year from age(p_starts_at, s.current_period_start))*12 + extract(month from age(p_starts_at, s.current_period_start)))::int;
        v_cs := s.current_period_start + make_interval(months => floor(v_months::numeric / v_freq)::int * v_freq);
        while v_cs > p_starts_at loop v_cs := v_cs - make_interval(months => v_freq); end loop;
        while v_cs + make_interval(months => v_freq) <= p_starts_at loop v_cs := v_cs + make_interval(months => v_freq); end loop;
        v_ce := v_cs + make_interval(months => v_freq);
      end if;
    end if;

    -- Dias liberados do contrato migrado do CashBarber.
    if v_migrated then
      v_days := substring(v_desc from 'Dias liberados: ([^.]*)');
      if v_days is not null then
        v_dow := extract(isodow from (p_starts_at at time zone v_tz))::int;
        continue when position(v_day_names[v_dow] in v_days) = 0;
      end if;
    end if;

    select array_agg(sid) into v_covered from unnest(p_service_ids) sid
     where exists(select 1 from jsonb_array_elements(s.contract_snapshot->'services') item where (item->>'id')::uuid = sid);
    continue when v_covered is null;

    v_remaining := null;
    if v_migrated then
      -- Limite por serviço gravado no contrato ("1x/ciclo"); "ilimitado" não limita.
      foreach v_sid in array v_covered loop
        select name into v_sname from public.services where id = v_sid;
        v_limit := null;
        for v_item in select unnest(string_to_array(coalesce(substring(v_desc from 'Serviços: (.*)$'),''), ';')) loop
          v_m := regexp_match(v_item, '^\s*(.*?) \(([^)]*)\)');
          if v_m is not null and lower(regexp_replace(btrim(v_m[1]),'\s+',' ','g')) = lower(regexp_replace(btrim(coalesce(v_sname,'')),'\s+',' ','g')) then
            v_limit := (regexp_match(v_m[2], '(\d+)\s*x/ciclo'))[1]::int;
            exit;
          end if;
        end loop;
        if v_limit is not null then
          select count(distinct a.id)::int into v_used
            from public.subscription_usages u
            join public.appointments a on a.barbershop_id=u.barbershop_id and a.id=u.appointment_id
            join public.appointment_services aps on aps.appointment_id=a.id and aps.service_id=v_sid
           where u.barbershop_id=s.barbershop_id and u.subscription_id=s.id and u.status in ('reserved','used')
             and a.starts_at>=v_cs and a.starts_at<v_ce and a.id is distinct from p_ignore_appointment_id;
          v_remaining := least(coalesce(v_remaining, 2147483647), v_limit - v_used);
        end if;
      end loop;
    else
      select (s.contract_snapshot->>'visits_per_cycle')::integer - count(*)::integer into v_remaining
        from public.subscription_usages u join public.appointments a on a.barbershop_id=u.barbershop_id and a.id=u.appointment_id
       where u.barbershop_id=s.barbershop_id and u.subscription_id=s.id and u.status in ('reserved','used')
         and a.starts_at>=v_cs and a.starts_at<v_ce and a.id is distinct from p_ignore_appointment_id;
    end if;
    continue when v_remaining is not null and v_remaining <= 0;

    select coalesce(sum(sv.price_cents),0)::int into v_uncovered_cents from public.services sv
     where sv.barbershop_id=p_barbershop_id and sv.id = any(p_service_ids) and not (sv.id = any(v_covered));

    if v_required_ids is not null and v_required_ids <@ v_covered then v_eligible_required := true; end if;
    v_list := v_list || jsonb_build_array(jsonb_build_object(
      'id', s.id, 'plan_name', s.contract_snapshot->>'plan_name',
      'remaining_visits', v_remaining, 'unlimited', v_remaining is null,
      'period_start', v_cs, 'period_end', v_ce,
      'covered_service_ids', to_jsonb(v_covered),
      'covers_all', cardinality(v_covered) = cardinality(p_service_ids),
      'uncovered_price_cents', v_uncovered_cents));
  end loop;

  return jsonb_build_object('requires_subscription', coalesce(v_required,false),
    'eligible', not coalesce(v_required,false) or v_eligible_required, 'subscriptions', v_list,
    'reason', case when coalesce(v_required,false) and not v_eligible_required then 'Este serviço é exclusivo para assinantes com plano ativo que cubra o serviço.' else null end);
end $function$;

-- Preço do atendimento com plano: só os serviços que o plano não cobre.
create or replace function app_private.subscription_uncovered_price(p_eligibility jsonb, p_subscription_id uuid)
 returns integer language sql immutable set search_path to ''
as $function$
  select (item->>'uncovered_price_cents')::integer from jsonb_array_elements(coalesce(p_eligibility->'subscriptions','[]'::jsonb)) item
  where (item->>'id')::uuid = p_subscription_id limit 1
$function$;
revoke all on function app_private.subscription_uncovered_price(jsonb, uuid) from public, anon, authenticated;

-- Os bloqueios importados do CashBarber não barram o cadastro rápido.
create or replace function app_private.guard_cashbarber_blocked_slot()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
begin
  if new.status='cancelled' then return new; end if;
  if coalesce(current_setting('app.quick_entry', true), '') = 'on' then return new; end if;
  if new.import_source = 'cashbarber' and current_user in ('postgres','supabase_admin') then return new; end if;
  if (tg_op='INSERT' and new.import_source is distinct from 'cashbarber') or
     (tg_op='UPDATE' and (new.starts_at,new.ends_at,new.barber_membership_id) is distinct from (old.starts_at,old.ends_at,old.barber_membership_id)) then
    if app_private.cashbarber_slot_blocked(new.barbershop_id,new.barber_membership_id,new.starts_at,new.ends_at) then
      raise exception 'Horário bloqueado na agenda importada. Escolha outro horário.' using errcode='23514';
    end if;
  end if;
  return new;
end $function$;

-- Agenda: com plano, cobra só os serviços que o plano não cobre (antes zerava tudo).
do $do$
declare v_def text;
begin
  select pg_get_functiondef('app_private.book_appointment(uuid,uuid,uuid,uuid[],timestamptz,uuid)'::regprocedure) into v_def;
  if position('case when p_subscription_id is null then v_price else 0 end' in v_def) = 0 then
    raise exception 'book_appointment mudou; revise a migração';
  end if;
  v_def := replace(v_def, 'case when p_subscription_id is null then v_price else 0 end',
    'case when p_subscription_id is null then v_price else coalesce(app_private.subscription_uncovered_price(v_eligibility,p_subscription_id),0) end');
  execute v_def;
end $do$;

-- Cadastro rápido: atendimento feito (agora/passado) ou agendamento futuro, sem bloqueio de agenda, com plano do cliente.
create or replace function app_private.quick_service_entry(p_shop uuid, p_client_name text, p_phone text, p_barber uuid, p_service_ids uuid[],
  p_starts_at timestamp with time zone default null, p_total_cents integer default null, p_method text default null, p_request uuid default null,
  p_notes text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_admin boolean := app_private.has_shop_role(p_shop, array['admin']::public.shop_role[]);
  v_own uuid; v_name text := btrim(regexp_replace(coalesce(p_client_name,''), '\s+', ' ', 'g'));
  v_digits text := regexp_replace(coalesce(p_phone,''), '\D', '', 'g');
  v_phone text; v_client uuid; v_client_name text; v_created boolean := false;
  v_duration int; v_price bigint; v_total bigint; v_start timestamptz; v_end timestamptz; v_appt uuid; v_ids jsonb := null; v_count int;
  v_future boolean; v_overlap boolean := false; v_elig jsonb; v_sub uuid; v_plan text;
begin
  if (select auth.uid()) is null or not app_private.has_module(p_shop, 'appointments') then
    raise exception 'Seu acesso não permite registrar atendimentos' using errcode = '42501';
  end if;
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
  v_start := coalesce(p_starts_at, now());
  if v_start > now() + interval '366 days' or v_start < now() - interval '60 days' then raise exception 'Data do atendimento inválida' using errcode = '22023'; end if;
  v_future := v_start > now() + interval '10 minutes';
  v_end := v_start + make_interval(mins => greatest(v_duration, 5));

  select c.id, c.full_name into v_client, v_client_name from public.clients c
    where c.barbershop_id = p_shop and regexp_replace(coalesce(c.phone,''), '\D', '', 'g') in (v_digits, '55' || v_digits)
    order by c.created_at limit 1;
  if v_client is null then
    if length(v_name) < 2 or length(v_name) > 160 then raise exception 'Informe o nome do cliente' using errcode = '22023'; end if;
    insert into public.clients (barbershop_id, full_name, phone) values (p_shop, v_name, v_phone) returning id, full_name into v_client, v_client_name;
    v_created := true;
  end if;
  insert into public.client_barbers (barbershop_id, client_id, barber_membership_id) values (p_shop, v_client, p_barber) on conflict do nothing;

  -- Plano ativo do cliente cobre os serviços do plano; o resto é cobrado.
  v_total := coalesce(p_total_cents, v_price);
  if not v_created then
    v_elig := app_private.subscription_eligibility_for_booking(p_shop, v_client, p_service_ids, v_start);
    select (item->>'id')::uuid, item->>'plan_name' into v_sub, v_plan
      from jsonb_array_elements(coalesce(v_elig->'subscriptions','[]'::jsonb)) with ordinality t(item, n)
     order by (item->>'covers_all')::boolean desc, n limit 1;
    if v_sub is not null then
      perform 1 from public.subscriptions where id = v_sub for update;
      if p_total_cents is null or p_total_cents = v_price then
        v_total := coalesce(app_private.subscription_uncovered_price(v_elig, v_sub), 0);
      end if;
    end if;
  end if;
  if v_total < 0 or v_total > 100000000 then raise exception 'Valor inválido' using errcode = '22023'; end if;

  perform pg_advisory_xact_lock(hashtext(p_shop::text), hashtext('appointment_schedule'));
  if v_future then
    -- Agendamento futuro ocupa o horário na agenda; se já houver alguém nesse horário, salva mesmo assim e avisa.
    select exists(select 1 from public.appointments a where a.barbershop_id = p_shop and a.barber_membership_id = p_barber
      and a.status in ('pending','confirmed','in_progress')
      and tstzrange(coalesce(a.occupied_starts_at, a.starts_at), coalesce(a.occupied_ends_at, a.ends_at), '[)') && tstzrange(v_start, v_end, '[)')) into v_overlap;
  end if;

  perform set_config('app.quick_entry', 'on', true);
  insert into public.appointments (barbershop_id, client_id, barber_membership_id, subscription_id, starts_at, ends_at, occupied_starts_at, occupied_ends_at,
      status, source, total_price_cents, notes, booking_origin, quick_entry)
    values (p_shop, v_client, p_barber, v_sub, v_start, v_end, v_start,
      case when v_future and not v_overlap then v_end else v_start end, 'confirmed',
      case when v_admin then 'admin' else 'barber' end, v_total::int, nullif(btrim(coalesce(p_notes,'')), ''), 'reception', true)
    returning id into v_appt;
  insert into public.appointment_services (barbershop_id, appointment_id, service_id, price_cents, duration_minutes)
    select p_shop, v_appt, s.id, s.price_cents, s.duration_minutes from public.services s where s.barbershop_id = p_shop and s.id = any(p_service_ids);
  if v_sub is not null then
    insert into public.subscription_usages (barbershop_id, subscription_id, appointment_id, status) values (p_shop, v_sub, v_appt, 'reserved');
  end if;
  if not v_future then
    update public.appointments set status = 'completed' where id = v_appt;
  end if;
  perform set_config('app.quick_entry', 'off', true);

  if p_method is not null and v_total > 0 and not v_future then
    if not v_admin then raise exception 'Apenas a administração registra o recebimento' using errcode = '42501'; end if;
    v_ids := app_private.cash_receive(p_shop, null, v_appt, jsonb_build_array(jsonb_build_object('method', p_method, 'amount_cents', v_total)), coalesce(p_request, gen_random_uuid()));
  end if;

  return jsonb_build_object('appointment_id', v_appt, 'client_id', v_client, 'client_name', v_client_name, 'client_created', v_created,
    'total_cents', v_total, 'paid', v_ids is not null, 'scheduled', v_future, 'starts_at', v_start, 'overlap', v_overlap,
    'subscription_id', v_sub, 'plan_name', v_plan);
end $function$;

-- Últimos cadastros rápidos: inclui agendados e os cobertos pelo plano.
create or replace function public.quick_service_recent(p_shop uuid, p_limit integer default 20)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare v_admin boolean := app_private.has_shop_role(p_shop, array['admin']::public.shop_role[]); v_own uuid; v_rows jsonb;
begin
  if (select auth.uid()) is null or not app_private.has_module(p_shop, 'appointments') then raise exception 'Acesso restrito' using errcode = '42501'; end if;
  if not v_admin then select m.id into v_own from public.memberships m where m.barbershop_id = p_shop and m.user_id = (select auth.uid()) and m.role = 'barber' and m.active; end if;
  select coalesce(jsonb_agg(r order by r.created_at desc), '[]') into v_rows from (
    select a.id, a.starts_at, a.created_at, a.status, a.total_price_cents, c.full_name client_name, c.phone, coalesce(nullif(btrim(m.display_name),''), 'Profissional') barber_name,
      (select string_agg(s.name, ' + ' order by s.name) from public.appointment_services aps join public.services s on s.id = aps.service_id where aps.appointment_id = a.id) services,
      exists (select 1 from public.payments p where p.appointment_id = a.id and p.status in ('paid','approved')) paid,
      sub.contract_snapshot->>'plan_name' plan_name
    from public.appointments a join public.clients c on c.id = a.client_id left join public.memberships m on m.id = a.barber_membership_id
    left join public.subscriptions sub on sub.id = a.subscription_id
    where a.barbershop_id = p_shop and a.status <> 'cancelled' and (v_admin or a.barber_membership_id = v_own)
      and (a.quick_entry or (a.status = 'completed' and a.source in ('admin','barber') and a.import_source is null
           and a.occupied_starts_at = a.occupied_ends_at and a.subscription_id is null))
    order by a.created_at desc limit least(greatest(coalesce(p_limit, 20), 1), 50)) r;
  return v_rows;
end $function$;

-- IA do WhatsApp: cliente com plano ativo agenda pelo plano.
do $do$
declare v_def text;
begin
  select pg_get_functiondef('app_private.whatsapp_bot_book(uuid,uuid,uuid,uuid[],timestamptz)'::regprocedure) into v_def;
  if position('declare v_timezone text; v_schedule jsonb; v_price integer; v_id uuid;' in v_def) = 0
     or position('insert into public.appointments (barbershop_id, client_id, barber_membership_id, starts_at, ends_at, status, source, total_price_cents, notes)' in v_def) = 0
     or position('values (p_barbershop_id, p_client_id, p_barber_membership_id, p_starts_at, (v_schedule->>''ends_at'')::timestamptz, ''confirmed'', ''client'', coalesce(v_price, 0), ''Agendado pelo atendimento de IA no WhatsApp'')' in v_def) = 0
     or position('  return v_id;' in v_def) = 0 then
    raise exception 'whatsapp_bot_book mudou; revise a migração';
  end if;
  v_def := replace(v_def, 'declare v_timezone text; v_schedule jsonb; v_price integer; v_id uuid;',
    'declare v_timezone text; v_schedule jsonb; v_price integer; v_id uuid; v_elig jsonb; v_sub uuid;');
  v_def := replace(v_def, 'insert into public.appointments (barbershop_id, client_id, barber_membership_id, starts_at, ends_at, status, source, total_price_cents, notes)',
    'v_elig := app_private.subscription_eligibility_for_booking(p_barbershop_id, p_client_id, p_service_ids, p_starts_at);
  select (item->>''id'')::uuid into v_sub from jsonb_array_elements(coalesce(v_elig->''subscriptions'',''[]''::jsonb)) with ordinality t(item, n)
   order by (item->>''covers_all'')::boolean desc, n limit 1;
  if v_sub is not null then v_price := coalesce(app_private.subscription_uncovered_price(v_elig, v_sub), 0); end if;
  insert into public.appointments (barbershop_id, client_id, barber_membership_id, subscription_id, starts_at, ends_at, status, source, total_price_cents, notes)');
  v_def := replace(v_def, 'values (p_barbershop_id, p_client_id, p_barber_membership_id, p_starts_at, (v_schedule->>''ends_at'')::timestamptz, ''confirmed'', ''client'', coalesce(v_price, 0), ''Agendado pelo atendimento de IA no WhatsApp'')',
    'values (p_barbershop_id, p_client_id, p_barber_membership_id, v_sub, p_starts_at, (v_schedule->>''ends_at'')::timestamptz, ''confirmed'', ''client'', coalesce(v_price, 0), ''Agendado pelo atendimento de IA no WhatsApp'')');
  v_def := replace(v_def, '  return v_id;',
    '  if v_sub is not null then
    insert into public.subscription_usages (barbershop_id, subscription_id, appointment_id, status) values (p_barbershop_id, v_sub, v_id, ''reserved'');
  end if;
  return v_id;');
  execute v_def;
end $do$;
