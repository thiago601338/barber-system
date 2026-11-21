-- Sincronização contínua CashBarber -> Barber System (extensão do Chrome chama public.cashbarber_sync_ext)

create table if not exists app_private.cashbarber_sync_runs (
  id bigint generated always as identity primary key,
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  ran_at timestamptz not null default now(),
  dry_run boolean not null default false,
  result jsonb not null
);

create or replace function app_private.cb_norm(t text) returns text
language sql immutable set search_path = '' as $$
  select btrim(regexp_replace(lower(translate(coalesce(t,''),
    'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
    'aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn')), '\s+', ' ', 'g'))
$$;

create or replace function app_private.cb_phone(t text) returns text
language sql immutable set search_path = '' as $$
  select nullif(regexp_replace(regexp_replace(coalesce(t,''), '\D', '', 'g'), '^55(\d{10,11})$', '\1'), '')
$$;

-- Pagamentos vindos do CashBarber também garantem o direito da assinatura cashbarber.
create or replace function public.reconcile_subscription_entitlement(p_subscription_id uuid)
returns text language plpgsql set search_path = '' as $function$
declare s public.subscriptions%rowtype;
begin
  select * into s from public.subscriptions where id=p_subscription_id for update;
  if not found then raise exception 'Subscription not found' using errcode='P0002'; end if;
  if s.status='active' and s.current_period_start is not null and s.current_period_end is not null
    and not exists(select 1 from public.payments p where p.barbershop_id=s.barbershop_id and p.subscription_id=s.id
      and p.status='paid'
      and (p.provider='mercadopago' or (s.provider='cashbarber' and p.provider='cashbarber'))
      and p.paid_at >= s.current_period_start - case when s.provider='cashbarber' then interval '20 days' else interval '0' end
      and p.paid_at < s.current_period_end
      and (s.provider='cashbarber' or s.contract_review_required or p.amount_cents=(s.contract_snapshot->>'price_cents')::integer)) then
    update public.subscriptions set status='past_due' where id=s.id;
    return 'past_due';
  end if;
  return s.status;
end $function$;

create or replace function app_private.cashbarber_sync_apply(p_shop uuid, p_payments jsonb, p_contracts jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r jsonb; s public.subscriptions%rowtype; v_pay public.payments%rowtype;
  v_client uuid; v_plan uuid; v_months int; v_paid timestamptz; v_day date; v_start date; v_end date;
  v_status text; v_cur_start date; v_cur_end date; v_ambig int; v_ids text[] := '{}';
  n_ins int := 0; n_link int := 0; n_known int := 0; n_skip int := 0; n_renew int := 0;
  n_status int := 0; n_new_sub int := 0; n_new_client int := 0; n_cancel int := 0;
  unmatched jsonb := '[]'; v_has_contracts boolean := jsonb_array_length(coalesce(p_contracts,'[]')) > 0;
  tz constant text := 'America/Sao_Paulo';
begin
  -- 1) Contratos novos no CashBarber viram assinaturas aqui (cliente e plano casados).
  for r in select value from jsonb_array_elements(coalesce(p_contracts,'[]')) loop
    v_ids := v_ids || ('cashbarber:' || (r->>'id'));
    if exists(select 1 from public.subscriptions where barbershop_id=p_shop and provider='cashbarber'
              and provider_subscription_id='cashbarber:' || (r->>'id')) then continue; end if;
    v_client := null;
    if app_private.cb_phone(r->>'phone') is not null then
      select case when count(*)=1 then (array_agg(id))[1] end into v_client from public.clients
        where barbershop_id=p_shop and app_private.cb_phone(phone)=app_private.cb_phone(r->>'phone');
    end if;
    if v_client is null then
      select case when count(*)=1 then (array_agg(id))[1] end into v_client from public.clients
        where barbershop_id=p_shop and app_private.cb_norm(full_name)=app_private.cb_norm(r->>'name');
    end if;
    select id into v_plan from public.subscription_plans
      where barbershop_id=p_shop and app_private.cb_norm(name)=app_private.cb_norm(r->>'plan')
      order by (price_cents = round(coalesce((r->>'price')::numeric,0)*100)) desc, active desc, created_at limit 1;
    if v_plan is null then
      unmatched := unmatched || jsonb_build_object('tipo','contrato','id',r->>'id','nome',r->>'name','motivo','plano não encontrado: '||coalesce(r->>'plan',''));
      continue;
    end if;
    if v_client is null then
      insert into public.clients(barbershop_id,full_name,phone,email,import_source,source_id)
        values(p_shop, btrim(r->>'name'), nullif(r->>'phone',''), nullif(r->>'email',''), 'cashbarber_sync', 'contract:'||(r->>'id'))
        returning id into v_client;
      n_new_client := n_new_client + 1;
    end if;
    v_status := case when r->>'status' in ('active','captured') then 'active' else 'past_due' end;
    begin
      insert into public.subscriptions(barbershop_id,client_id,plan_id,status,provider,provider_subscription_id,contract_snapshot)
        values(p_shop, v_client, v_plan, v_status, 'cashbarber', 'cashbarber:'||(r->>'id'),
               jsonb_build_object('acceptance', jsonb_build_object('source','migration'),
                 'migrated_from', jsonb_build_object('system','cashbarber','contract_id',r->>'id','starts_on',left(r->>'start',10),
                   'source_status',r->>'status','billing_provider',r->>'billing',
                   'contract_price_cents',round(coalesce((r->>'price')::numeric,0)*100)::int,'synced_at',now())));
      n_new_sub := n_new_sub + 1;
    exception when others then
      unmatched := unmatched || jsonb_build_object('tipo','contrato','id',r->>'id','nome',r->>'name','motivo',sqlerrm);
    end;
  end loop;

  -- 2) Pagamentos de assinatura: grava, vincula à assinatura e renova o período.
  for r in select value from jsonb_array_elements(coalesce(p_payments,'[]')) loop
    if coalesce(r->>'status','') not in ('paid','payExternal') or coalesce((r->>'active')::boolean, true) = false then
      n_skip := n_skip + 1; continue;
    end if;
    v_paid := case when r->>'paid_at' ~ '(Z|[+-]\d{2}:?\d{2})$' then (r->>'paid_at')::timestamptz
                   else (r->>'paid_at')::timestamp at time zone tz end;
    if v_paid is null then n_skip := n_skip + 1; continue; end if;

    s := null;
    select count(distinct x.client_id) into v_ambig from public.subscriptions x join public.clients c on c.id=x.client_id
      where x.barbershop_id=p_shop and x.provider='cashbarber' and x.status<>'cancelled'
        and app_private.cb_norm(c.full_name)=app_private.cb_norm(r->>'name');
    if v_ambig <= 1 then
      select x.* into s from public.subscriptions x join public.clients c on c.id=x.client_id
        where x.barbershop_id=p_shop and x.provider='cashbarber'
          and app_private.cb_norm(c.full_name)=app_private.cb_norm(r->>'name')
        order by (x.status<>'cancelled') desc, x.created_at desc limit 1;
    end if;

    select * into v_pay from public.payments
      where barbershop_id=p_shop and provider='cashbarber' and provider_payment_id='subscription:'||(r->>'id');

    if s.id is null then
      if v_pay.id is null then
        insert into public.payments(barbershop_id,provider,provider_payment_id,amount_cents,status,method,paid_at)
          values(p_shop,'cashbarber','subscription:'||(r->>'id'),round((r->>'amount')::numeric*100)::int,'paid',
                 case when r->>'method' in ('card','pix','cash') then r->>'method' else 'other' end, v_paid);
        n_ins := n_ins + 1;
      end if;
      unmatched := unmatched || jsonb_build_object('tipo','pagamento','id',r->>'id','nome',r->>'name',
        'motivo', case when v_ambig > 1 then 'mais de um assinante com esse nome' else 'assinatura não encontrada' end);
      continue;
    end if;

    -- Renovação do período (antes de vincular, para a conferência de direito já ver o período novo).
    v_months := coalesce((select frequency_months from public.subscription_plans where id=s.plan_id), 1);
    v_day := (v_paid at time zone tz)::date;
    v_cur_start := (s.current_period_start at time zone tz)::date;
    v_cur_end := (s.current_period_end at time zone tz)::date;
    if v_cur_end is null or v_day >= v_cur_start + 7 then
      v_start := case when v_cur_end is not null and v_day between v_cur_end - 10 and v_cur_end + 20 then v_cur_end else v_day end;
      if v_cur_start is null or v_cur_end is null or v_start > v_cur_start then
        v_end := (v_start + make_interval(months => v_months))::date;
        update public.subscriptions
          set current_period_start = v_start::timestamp at time zone tz,
              current_period_end = v_end::timestamp at time zone tz,
              status = case when status = 'cancelled' then status else 'active' end,
              cancelled_at = case when status = 'cancelled' then cancelled_at else null end
          where id = s.id;
        n_renew := n_renew + 1;
      end if;
    end if;

    if v_pay.id is null then
      insert into public.payments(barbershop_id,client_id,subscription_id,provider,provider_payment_id,amount_cents,status,method,paid_at)
        values(p_shop,s.client_id,s.id,'cashbarber','subscription:'||(r->>'id'),round((r->>'amount')::numeric*100)::int,'paid',
               case when r->>'method' in ('card','pix','cash') then r->>'method' else 'other' end, v_paid);
      n_ins := n_ins + 1;
    elsif v_pay.subscription_id is null and (v_pay.client_id is null or v_pay.client_id = s.client_id) then
      update public.payments set client_id = s.client_id, subscription_id = s.id where id = v_pay.id;
      n_link := n_link + 1;
    else
      n_known := n_known + 1;
    end if;
  end loop;

  -- 3) Status do contrato no CashBarber é o que vale.
  for r in select value from jsonb_array_elements(coalesce(p_contracts,'[]')) loop
    v_status := case when r->>'status' in ('active','captured') then 'active' else 'past_due' end;
    update public.subscriptions set status = v_status, cancelled_at = null
      where barbershop_id=p_shop and provider='cashbarber' and provider_subscription_id='cashbarber:'||(r->>'id')
        and status is distinct from v_status;
    if found then n_status := n_status + 1; end if;
  end loop;

  -- 4) Assinaturas cashbarber que saíram da lista de contratos ativos foram canceladas lá.
  if v_has_contracts and jsonb_array_length(p_contracts) >= 0.6 * greatest(1, (select count(*) from public.subscriptions
       where barbershop_id=p_shop and provider='cashbarber' and status in ('active','past_due','pending','authorized'))) then
    with c as (
      update public.subscriptions set status='cancelled', cancelled_at=now()
        where barbershop_id=p_shop and provider='cashbarber' and status in ('active','past_due','pending','authorized')
          and not (provider_subscription_id = any(v_ids))
        returning 1)
    select count(*) into n_cancel from c;
  end if;

  return jsonb_build_object(
    'pagamentos_novos', n_ins, 'pagamentos_vinculados', n_link, 'pagamentos_ja_existentes', n_known,
    'pagamentos_ignorados', n_skip, 'periodos_renovados', n_renew,
    'assinaturas_novas', n_new_sub, 'clientes_novos', n_new_client, 'status_atualizados', n_status,
    'assinaturas_canceladas', n_cancel, 'nao_casados', unmatched,
    'contratos_recebidos', jsonb_array_length(coalesce(p_contracts,'[]')),
    'pagamentos_recebidos', jsonb_array_length(coalesce(p_payments,'[]')));
end $$;

create or replace function public.cashbarber_sync(p_shop uuid, p_payments jsonb, p_contracts jsonb, p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb; v_detail text;
begin
  if not exists(select 1 from public.barbershops where id=p_shop) then raise exception 'Shop not found' using errcode='22023'; end if;
  if jsonb_typeof(coalesce(p_payments,'[]')) <> 'array' or jsonb_typeof(coalesce(p_contracts,'[]')) <> 'array'
     or jsonb_array_length(coalesce(p_payments,'[]')) > 5000 or jsonb_array_length(coalesce(p_contracts,'[]')) > 2000 then
    raise exception 'Invalid sync batch' using errcode='22023';
  end if;
  begin
    v_result := app_private.cashbarber_sync_apply(p_shop, p_payments, p_contracts);
    if p_dry_run then raise exception 'cashbarber_dry_run' using detail = v_result::text; end if;
  exception when raise_exception then
    if sqlerrm <> 'cashbarber_dry_run' then raise; end if;
    get stacked diagnostics v_detail = pg_exception_detail;
    v_result := v_detail::jsonb;
  end;
  v_result := v_result || jsonb_build_object('dry_run', p_dry_run, 'ran_at', now());
  insert into app_private.cashbarber_sync_runs(barbershop_id, dry_run, result) values(p_shop, p_dry_run, v_result);
  return v_result;
end $$;

revoke all on function public.cashbarber_sync(uuid, jsonb, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.cashbarber_sync(uuid, jsonb, jsonb, boolean) to service_role;
revoke all on function app_private.cashbarber_sync_apply(uuid, jsonb, jsonb) from public, anon, authenticated;

-- Contratos novos sincronizados do CashBarber entram como migração (o aceite original está na origem).
create or replace function app_private.capture_subscription_contract()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare p public.subscription_plans%rowtype; v_services jsonb; v_slug text; v_acceptance jsonb; v_input jsonb; v_migrated boolean;
begin
  if tg_op='UPDATE' then
    if new.contract_snapshot is distinct from old.contract_snapshot
      or new.barbershop_id<>old.barbershop_id or new.client_id<>old.client_id or new.plan_id<>old.plan_id
      or (new.contract_review_required is distinct from old.contract_review_required
          and not (old.contract_review_required and not new.contract_review_required and old.contract_snapshot ? 'migrated_from')) then
      raise exception 'As condições do contrato são imutáveis. Crie um novo contrato para uma nova condição.' using errcode='22023';
    end if;
    return new;
  end if;
  v_input := new.contract_snapshot;
  select slug into v_slug from public.barbershops where id=new.barbershop_id;
  select * into p from public.subscription_plans where id=new.plan_id and barbershop_id=new.barbershop_id and active for share;
  if not found then raise exception 'Plano indisponível' using errcode='22023'; end if;
  select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'price_cents',s.price_cents,'duration_minutes',s.duration_minutes) order by s.id) into v_services
    from public.subscription_plan_services ps join public.services s on s.barbershop_id=ps.barbershop_id and s.id=ps.service_id and s.active
    where ps.barbershop_id=new.barbershop_id and ps.plan_id=new.plan_id;
  if v_services is null then raise exception 'Defina os serviços cobertos antes de contratar o plano' using errcode='22023'; end if;
  v_acceptance := v_input->'acceptance';
  v_migrated := new.provider='cashbarber' and v_acceptance->>'source'='migration' and v_input ? 'migrated_from';
  if v_slug='kingsman' and not v_migrated and (v_acceptance is null or v_acceptance->>'version' <> 'kingsman_subscription_terms_2026_11_11' or v_acceptance->>'source' not in ('online','staff_assisted')) then
    raise exception 'O Termo de Aceite da Kingsman deve ser aceito antes da assinatura.' using errcode='22023';
  end if;
  new.contract_snapshot:=jsonb_build_object('version',1,'captured_at',clock_timestamp(),'plan_id',p.id,'plan_name',p.name,'description',p.description,'price_cents',p.price_cents,'frequency_months',p.frequency_months,'visits_per_cycle',p.visits_per_cycle,'services',v_services)
    || case
         when v_migrated then jsonb_build_object('migrated_from',v_input->'migrated_from','legal_acceptance',jsonb_build_object('source','migration','statement','Contrato sincronizado do CashBarber em '||to_char(clock_timestamp() at time zone 'America/Sao_Paulo','DD/MM/YYYY')||'. O aceite original do cliente foi registrado na plataforma de origem; o Termo de Aceite da Assinatura Kingsman ainda não foi coletado neste sistema.'))
         when v_slug='kingsman' then jsonb_build_object('legal_acceptance',jsonb_build_object('terms_version',v_acceptance->>'version','accepted_at',clock_timestamp(),'source',v_acceptance->>'source','statement','Li e aceito o Termo de Aceite da Assinatura Kingsman, versão 11/11/2026.'))
         else '{}'::jsonb end;
  new.contract_review_required:=false;
  return new;
end $function$;

-- Acesso da extensão: chamada direta pela API com token próprio (apenas o hash fica no banco).
create table if not exists app_private.cashbarber_sync_tokens (
  barbershop_id uuid primary key references public.barbershops(id) on delete cascade,
  token_sha256 text not null,
  created_at timestamptz not null default now()
);
insert into app_private.cashbarber_sync_tokens(barbershop_id, token_sha256)
  select id, '131539356ad8666f86b5af927f70f7cc6109d3cad6c3c2addecae09a5dfa5647' from public.barbershops where slug='kingsman'
  on conflict (barbershop_id) do update set token_sha256 = excluded.token_sha256, created_at = now();

create or replace function public.cashbarber_sync_ext(p_token text, p_shop_slug text, p_payments jsonb, p_contracts jsonb, p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_shop uuid;
begin
  select b.id into v_shop from public.barbershops b join app_private.cashbarber_sync_tokens t on t.barbershop_id=b.id
    where b.slug=p_shop_slug and t.token_sha256 = encode(extensions.digest(coalesce(p_token,''),'sha256'),'hex');
  if v_shop is null then raise exception 'Token de sincronização inválido' using errcode='42501'; end if;
  return public.cashbarber_sync(v_shop, p_payments, p_contracts, coalesce(p_dry_run,false));
end $$;
revoke all on function public.cashbarber_sync_ext(text, text, jsonb, jsonb, boolean) from public;
grant execute on function public.cashbarber_sync_ext(text, text, jsonb, jsonb, boolean) to anon, authenticated, service_role;
