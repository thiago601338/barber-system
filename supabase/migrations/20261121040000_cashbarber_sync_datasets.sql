-- Sincronização contínua do restante: clientes, agenda (com bloqueios), comandas pagas e despesas.

create or replace function app_private.cb_local(t text) returns timestamptz
language sql stable set search_path = '' as $$
  select case when t is null or t = '' then null
              when t ~ '(Z|[+-]\d{2}:?\d{2})$' then t::timestamptz
              else replace(t,'T',' ')::timestamp at time zone 'America/Sao_Paulo' end
$$;

create or replace function app_private.cb_client(p_shop uuid, p_id text, p_name text, p_phone text, p_email text, p_birth text, p_create boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v uuid; v_birth date := case when p_birth ~ '^\d{4}-\d{2}-\d{2}' and left(p_birth,4) > '1900' then left(p_birth,10)::date end;
begin
  if nullif(p_id,'') is null then return null; end if;
  select id into v from public.clients where barbershop_id=p_shop and import_source='cashbarber' and source_id=p_id;
  if v is not null then return v; end if;
  -- Adota cliente criado antes pela sincronização de contratos (sem o ID do CashBarber).
  if app_private.cb_phone(p_phone) is not null then
    select case when count(*)=1 then (array_agg(id))[1] end into v from public.clients
      where barbershop_id=p_shop and import_source='cashbarber_sync' and app_private.cb_phone(phone)=app_private.cb_phone(p_phone);
    if v is not null then
      update public.clients set import_source='cashbarber', source_id=p_id where id=v;
      return v;
    end if;
  end if;
  if not p_create or nullif(btrim(coalesce(p_name,'')),'') is null then return null; end if;
  insert into public.clients(barbershop_id,full_name,phone,email,birth_date,import_source,source_id)
    values(p_shop, btrim(p_name), nullif(p_phone,''), nullif(p_email,''), v_birth, 'cashbarber', p_id) returning id into v;
  insert into app_private.cashbarber_import_records(barbershop_id,dataset,source_id,payload,projected_id)
    values(p_shop,'clients',p_id,jsonb_build_object('id',p_id,'name',p_name,'phone',p_phone,'synced',true),v)
    on conflict (barbershop_id,dataset,source_id) do update set projected_id=excluded.projected_id;
  return v;
end $$;

create or replace function app_private.cashbarber_sync_dataset_apply(p_shop uuid, p_dataset text, p_rows jsonb, p_ctx jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r jsonb; tz constant text := 'America/Sao_Paulo';
  n_new int := 0; n_upd int := 0; n_same int := 0; n_cancel int := 0; n_del int := 0; n_blocks int := 0; n_proc int := 0;
  issues jsonb := '[]'; v_ids text[]; v_from timestamptz; v_to timestamptz;
  v_client uuid; v_staff uuid; v_sub uuid; v_appt public.appointments%rowtype; v_status public.appointment_status;
  v_start timestamptz; v_end timestamptz; v_svc record; v_id uuid; v_pay public.payments%rowtype; v_rec record;
  v_amount int; v_method text; v_date date; v_cat text; v_kind text;
begin
  v_from := app_private.cb_local(p_ctx->>'from'); v_to := app_private.cb_local(p_ctx->>'to');

  if p_dataset = 'clients' then
    for r in select value from jsonb_array_elements(p_rows) loop
      begin
        select id into v_id from public.clients where barbershop_id=p_shop and import_source='cashbarber' and source_id=r->>'id';
        if v_id is null then
          v_id := app_private.cb_client(p_shop, r->>'id', r->>'name', r->>'phone', r->>'email', r->>'birth', true);
          if v_id is not null then n_new := n_new + 1; end if;
        else
          update public.clients set
              full_name = coalesce(nullif(btrim(r->>'name'),''), full_name),
              phone = coalesce(nullif(r->>'phone',''), phone),
              email = coalesce(nullif(r->>'email',''), email),
              birth_date = coalesce(case when r->>'birth' ~ '^\d{4}-\d{2}-\d{2}' and left(r->>'birth',4) > '1900' then left(r->>'birth',10)::date end, birth_date)
            where id = v_id and (full_name, phone, email, birth_date) is distinct from (
              coalesce(nullif(btrim(r->>'name'),''), full_name), coalesce(nullif(r->>'phone',''), phone),
              coalesce(nullif(r->>'email',''), email),
              coalesce(case when r->>'birth' ~ '^\d{4}-\d{2}-\d{2}' and left(r->>'birth',4) > '1900' then left(r->>'birth',10)::date end, birth_date));
          if found then n_upd := n_upd + 1; else n_same := n_same + 1; end if;
        end if;
      exception when others then
        issues := issues || jsonb_build_object('tipo','cliente','id',r->>'id','nome',r->>'name','motivo',sqlerrm);
      end;
    end loop;

  elsif p_dataset = 'appointments' then
    if v_from is null or v_to is null or v_to <= v_from or v_to - v_from > interval '15 days' then
      raise exception 'Janela inválida' using errcode='22023';
    end if;
    select coalesce(array_agg(value->>'id'),'{}') into v_ids from jsonb_array_elements(p_rows);
    -- Cancelados no CashBarber somem da agenda: cancela aqui (primeiro, para liberar horários).
    if coalesce((p_ctx->>'complete')::boolean, false) then
      with c as (
        update public.appointments set status='cancelled', cancellation_reason=coalesce(cancellation_reason,'Cancelado no CashBarber')
          where barbershop_id=p_shop and import_source='cashbarber' and starts_at >= v_from and starts_at < v_to
            and status in ('pending','confirmed','in_progress') and not (source_id = any(v_ids))
          returning source_id)
      select count(*) into n_cancel from c;
      update app_private.cashbarber_import_records set payload = payload || '{"source_status":"Cancelado","status":"cancelled"}'
        where barbershop_id=p_shop and dataset='appointments'
          and source_id in (select source_id from public.appointments where barbershop_id=p_shop and import_source='cashbarber'
                            and starts_at >= v_from and starts_at < v_to and status='cancelled' and not (source_id = any(v_ids)))
          and payload->>'source_status' is distinct from 'Cancelado';
    end if;

    for r in select value from jsonb_array_elements(p_rows) loop
      begin
        v_status := (r->>'status')::public.appointment_status;
        v_start := app_private.cb_local(r->>'start'); v_end := app_private.cb_local(r->>'end');
        v_client := app_private.cb_client(p_shop, r->>'client_id', r->>'client_name', r->>'client_phone', null, r->>'client_birth', true);
        select id into v_staff from public.memberships where barbershop_id=p_shop and import_source='cashbarber' and source_id=r->>'barber' and role='barber';
        if v_client is null or v_staff is null then
          issues := issues || jsonb_build_object('tipo','agendamento','id',r->>'id','nome',r->>'client_name',
            'motivo', case when v_staff is null then 'profissional '||coalesce(r->>'barber','?')||' não existe no Barber System' else 'cliente sem cadastro' end);
          continue;
        end if;
        v_sub := null;
        if coalesce((r->>'has_plan')::boolean,false) then
          select id into v_sub from public.subscriptions where barbershop_id=p_shop and client_id=v_client and status in ('active','past_due')
            order by (status='active') desc, created_at desc limit 1;
        end if;

        select * into v_appt from public.appointments where barbershop_id=p_shop and import_source='cashbarber' and source_id=r->>'id';
        if v_appt.id is null then
          insert into public.appointments(barbershop_id,client_id,barber_membership_id,subscription_id,starts_at,ends_at,status,source,total_price_cents,notes,import_source,source_id,import_price_known,booking_origin)
            values(p_shop,v_client,v_staff,v_sub,v_start,v_end,v_status,'admin',0,null,'cashbarber',r->>'id',false,
                   case upper(coalesce(r->>'origin','')) when 'RECEPCAO' then 'reception' when 'APP' then 'app' when 'SITE' then 'site' when 'WHATSAPP' then 'whatsapp' end)
            returning * into v_appt;
          insert into public.client_barbers(barbershop_id,client_id,barber_membership_id) values(p_shop,v_client,v_staff) on conflict do nothing;
          n_new := n_new + 1;
        else
          if v_appt.status in ('completed','cancelled','no_show') then
            if v_appt.status <> v_status then
              issues := issues || jsonb_build_object('tipo','agendamento','id',r->>'id','nome',r->>'client_name',
                'motivo','já estava '||v_appt.status||' aqui e no CashBarber está '||v_status);
            end if;
            n_same := n_same + 1;
          elsif (v_appt.starts_at, v_appt.ends_at, v_appt.barber_membership_id, v_appt.client_id, v_appt.status) is distinct from (v_start, v_end, v_staff, v_client, v_status) then
            update public.appointments set starts_at=v_start, ends_at=v_end, barber_membership_id=v_staff, client_id=v_client,
                subscription_id = case when v_appt.client_id = v_client then coalesce(subscription_id, v_sub) else v_sub end
              where id=v_appt.id;
            if v_appt.status <> v_status then update public.appointments set status=v_status where id=v_appt.id; end if;
            n_upd := n_upd + 1;
          else
            n_same := n_same + 1;
          end if;
        end if;

        for v_svc in select s.* from jsonb_array_elements_text(coalesce(r->'services','[]')) e(sid)
                     join public.services s on s.barbershop_id=p_shop and s.import_source='cashbarber' and s.source_id=e.sid loop
          insert into public.appointment_services(barbershop_id,appointment_id,service_id,price_cents,duration_minutes)
            values(p_shop,v_appt.id,v_svc.id,0,v_svc.duration_minutes) on conflict do nothing;
          if v_status='completed' then
            insert into public.procedure_records(barbershop_id,client_id,barber_membership_id,appointment_id,service_id,performed_at,description,price_cents,notes,import_source,source_id,import_price_known)
              values(p_shop,v_client,v_staff,v_appt.id,v_svc.id,v_start,v_svc.name,0,'Histórico Cashbarber. Valor por procedimento não informado na origem.','cashbarber','sync:'||(r->>'id')||':'||v_svc.source_id,false)
              on conflict(barbershop_id,import_source,source_id) where import_source is not null do nothing;
            if found then n_proc := n_proc + 1; end if;
          end if;
        end loop;

        insert into app_private.cashbarber_import_records(barbershop_id,dataset,source_id,payload,projected_id)
          values(p_shop,'appointments',r->>'id', r || jsonb_build_object('source_status', case v_status when 'completed' then 'Finalizado' when 'no_show' then 'Faltou' when 'cancelled' then 'Cancelado' else 'Agendado' end), v_appt.id)
          on conflict (barbershop_id,dataset,source_id) do update set payload=excluded.payload, projected_id=excluded.projected_id, issue=null;
      exception when others then
        issues := issues || jsonb_build_object('tipo','agendamento','id',r->>'id','nome',r->>'client_name','motivo',sqlerrm);
      end;
    end loop;

    -- Bloqueios, intervalos e folgas da agenda (usados para impedir agendamento nesses horários).
    if p_ctx ? 'blocks' then
      select coalesce(array_agg(value->>'id'),'{}') into v_ids from jsonb_array_elements(p_ctx->'blocks');
      delete from app_private.cashbarber_import_records
        where barbershop_id=p_shop and dataset='availability_blocks' and payload->>'source_kind' in ('blocked_slot','interval')
          and app_private.cb_local(payload->>'start') >= v_from and app_private.cb_local(payload->>'start') < v_to
          and not (source_id = any(v_ids));
      get diagnostics n_del = row_count;
      insert into app_private.cashbarber_import_records(barbershop_id,dataset,source_id,payload)
        select p_shop,'availability_blocks',value->>'id',value from jsonb_array_elements(p_ctx->'blocks')
        on conflict (barbershop_id,dataset,source_id) do update set payload=excluded.payload;
      get diagnostics n_blocks = row_count;
    end if;

  elsif p_dataset = 'order_payments' then
    for r in select value from jsonb_array_elements(p_rows) loop
      begin
        v_amount := round((r->>'amount')::numeric*100)::int;
        v_method := case when r->>'method' in ('card','pix','cash') then r->>'method' else 'other' end;
        select * into v_pay from public.payments where provider='cashbarber' and provider_payment_id='order:'||(r->>'id') and barbershop_id=p_shop;
        if v_pay.id is not null then
          if v_pay.status='paid' and (v_pay.amount_cents, v_pay.method) is distinct from (v_amount, v_method) then
            update public.payments set amount_cents=v_amount, method=v_method where id=v_pay.id; n_upd := n_upd + 1;
          else n_same := n_same + 1; end if;
          continue;
        end if;
        v_client := null;
        if app_private.cb_phone(r->>'phone') is not null then
          select case when count(*)=1 then (array_agg(id))[1] end into v_client from public.clients
            where barbershop_id=p_shop and app_private.cb_phone(phone)=app_private.cb_phone(r->>'phone');
        end if;
        if v_client is null then
          select case when count(*)=1 then (array_agg(id))[1] end into v_client from public.clients
            where barbershop_id=p_shop and app_private.cb_norm(full_name)=app_private.cb_norm(r->>'name');
        end if;
        v_start := app_private.cb_local(r->>'paid_at');
        v_id := null;
        if v_client is not null then
          select a.id into v_id from public.appointments a left join public.memberships m on m.id=a.barber_membership_id
            where a.barbershop_id=p_shop and a.client_id=v_client and a.status <> 'cancelled'
              and (a.starts_at at time zone tz)::date = (v_start at time zone tz)::date
              and not exists(select 1 from public.payments p where p.appointment_id=a.id and p.provider_payment_id like 'order:%')
            order by (app_private.cb_norm(m.display_name)=app_private.cb_norm(r->>'barber')) desc nulls last,
                     abs(extract(epoch from (a.starts_at - v_start))) limit 1;
        end if;
        insert into public.payments(barbershop_id,client_id,appointment_id,provider,provider_payment_id,amount_cents,status,method,paid_at)
          values(p_shop,v_client,v_id,'cashbarber','order:'||(r->>'id'),v_amount,'paid',v_method,v_start);
        n_new := n_new + 1;
        if v_client is null then
          issues := issues || jsonb_build_object('tipo','comanda','id',r->>'id','nome',r->>'name','motivo','recebimento gravado sem cliente identificado');
        end if;
      exception when others then
        issues := issues || jsonb_build_object('tipo','comanda','id',r->>'id','nome',r->>'name','motivo',sqlerrm);
      end;
    end loop;

  elsif p_dataset = 'expenses' then
    for r in select value from jsonb_array_elements(p_rows) loop
      begin
        v_amount := round((r->>'amount')::numeric*100)::int;
        v_date := left(r->>'occurred_on',10)::date;
        v_cat := coalesce(nullif(r->>'category',''),'Despesa importada');
        v_kind := case when v_cat ~* 'comiss' then 'commission' when v_cat ~* 'taxa' then 'fees' else 'operating' end;
        select * into v_rec from app_private.cashbarber_import_records where barbershop_id=p_shop and dataset='expenses' and source_id=r->>'id';
        if coalesce((r->>'paid')::boolean,false) and coalesce((r->>'active')::boolean,true) then
          if v_rec.projected_id is not null and exists(select 1 from public.expenses where id=v_rec.projected_id) then
            update public.expenses set category=v_cat, description=coalesce(nullif(r->>'description',''),'Despesa Cashbarber'),
                amount_cents=v_amount, occurred_on=v_date, cost_kind=v_kind
              where id=v_rec.projected_id and (category,description,amount_cents,occurred_on,cost_kind) is distinct from
                (v_cat, coalesce(nullif(r->>'description',''),'Despesa Cashbarber'), v_amount, v_date, v_kind);
            if found then n_upd := n_upd + 1; else n_same := n_same + 1; end if;
          else
            insert into public.expenses(barbershop_id,category,description,amount_cents,occurred_on,cost_kind)
              values(p_shop,v_cat,coalesce(nullif(r->>'description',''),'Despesa Cashbarber'),v_amount,v_date,v_kind) returning id into v_id;
            insert into app_private.cashbarber_import_records(barbershop_id,dataset,source_id,payload,projected_id)
              values(p_shop,'expenses',r->>'id',r,v_id)
              on conflict (barbershop_id,dataset,source_id) do update set payload=excluded.payload, projected_id=excluded.projected_id, issue=null;
            n_new := n_new + 1;
          end if;
        elsif v_rec.projected_id is not null then
          delete from public.expenses where id=v_rec.projected_id;
          update app_private.cashbarber_import_records set projected_id=null, payload=r where barbershop_id=p_shop and dataset='expenses' and source_id=r->>'id';
          n_del := n_del + 1;
        else
          insert into app_private.cashbarber_import_records(barbershop_id,dataset,source_id,payload) values(p_shop,'expenses',r->>'id',r)
            on conflict (barbershop_id,dataset,source_id) do update set payload=excluded.payload;
          n_same := n_same + 1;
        end if;
      exception when others then
        issues := issues || jsonb_build_object('tipo','despesa','id',r->>'id','nome',r->>'description','motivo',sqlerrm);
      end;
    end loop;
    -- Despesas pagas na janela que foram apagadas no CashBarber.
    if coalesce((p_ctx->>'complete')::boolean,false) and v_from is not null and v_to is not null then
      select coalesce(array_agg(value->>'id'),'{}') into v_ids from jsonb_array_elements(p_rows);
      for v_rec in select source_id, projected_id from app_private.cashbarber_import_records x
          join public.expenses e on e.id = x.projected_id
          where x.barbershop_id=p_shop and x.dataset='expenses' and x.projected_id is not null
            and e.occurred_on >= (v_from at time zone tz)::date and e.occurred_on <= (v_to at time zone tz)::date
            and not (x.source_id = any(v_ids)) loop
        delete from public.expenses where id=v_rec.projected_id;
        update app_private.cashbarber_import_records set projected_id=null where barbershop_id=p_shop and dataset='expenses' and source_id=v_rec.source_id;
        n_del := n_del + 1;
      end loop;
    end if;
  else
    raise exception 'Conjunto desconhecido' using errcode='22023';
  end if;

  return jsonb_build_object('conjunto',p_dataset,'novos',n_new,'atualizados',n_upd,'iguais',n_same,'cancelados',n_cancel,
    'removidos',n_del,'bloqueios',n_blocks,'procedimentos',n_proc,'nao_casados',issues,'recebidos',jsonb_array_length(p_rows));
end $$;

create or replace function public.cashbarber_sync_dataset(p_token text, p_shop_slug text, p_dataset text, p_rows jsonb, p_ctx jsonb default '{}', p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_shop uuid; v_result jsonb; v_detail text;
begin
  select b.id into v_shop from public.barbershops b join app_private.cashbarber_sync_tokens t on t.barbershop_id=b.id
    where b.slug=p_shop_slug and t.token_sha256 = encode(extensions.digest(coalesce(p_token,''),'sha256'),'hex');
  if v_shop is null then raise exception 'Token de sincronização inválido' using errcode='42501'; end if;
  if jsonb_typeof(coalesce(p_rows,'[]')) <> 'array' or jsonb_array_length(coalesce(p_rows,'[]')) > 1500 then
    raise exception 'Lote inválido' using errcode='22023';
  end if;
  begin
    v_result := app_private.cashbarber_sync_dataset_apply(v_shop, p_dataset, coalesce(p_rows,'[]'), coalesce(p_ctx,'{}'));
    if p_dry_run then raise exception 'cashbarber_dry_run' using detail = v_result::text; end if;
  exception when raise_exception then
    if sqlerrm <> 'cashbarber_dry_run' then raise; end if;
    get stacked diagnostics v_detail = pg_exception_detail;
    v_result := v_detail::jsonb;
  end;
  v_result := v_result || jsonb_build_object('dry_run', p_dry_run);
  if not p_dry_run and (coalesce((v_result->>'novos')::int,0) + coalesce((v_result->>'atualizados')::int,0) + coalesce((v_result->>'cancelados')::int,0)
                        + coalesce((v_result->>'removidos')::int,0) + jsonb_array_length(coalesce(v_result->'nao_casados','[]'))) > 0 then
    insert into app_private.cashbarber_sync_runs(barbershop_id, dry_run, result) values(v_shop, false, v_result);
  end if;
  return v_result;
end $$;

revoke all on function app_private.cashbarber_sync_dataset_apply(uuid, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function app_private.cb_client(uuid, text, text, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.cashbarber_sync_dataset(text, text, text, jsonb, jsonb, boolean) from public;
grant execute on function public.cashbarber_sync_dataset(text, text, text, jsonb, jsonb, boolean) to anon, authenticated, service_role;
