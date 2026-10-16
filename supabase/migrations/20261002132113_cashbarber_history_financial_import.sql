-- Missing client identity remains unknown, rather than attaching revenue to a guessed customer.
alter table public.payments alter column client_id drop not null;
do $$ declare t text; begin
  foreach t in array array['procedure_records','availability_rules'] loop
    execute format('alter table public.%I add column import_source text, add column source_id text',t);
    execute format('create unique index %I on public.%I(barbershop_id,import_source,source_id) where import_source is not null',t||'_import_identity_uq',t);
    execute format('create trigger protect_import_identity before insert or update on public.%I for each row execute function app_private.protect_import_identity()',t);
  end loop;
end $$;
alter table public.procedure_records add column import_price_known boolean not null default true;
create or replace function app_private.require_barber_membership() returns trigger language plpgsql security definer set search_path='' as $$
declare v_import boolean:=false;
begin
  if tg_table_name in ('appointments','procedure_records','availability_rules') then v_import:=new.import_source='cashbarber' and new.source_id is not null; end if;
  if not exists(select 1 from public.memberships m where m.id=new.barber_membership_id and m.barbershop_id=new.barbershop_id and m.role='barber' and (m.active or (v_import and m.import_source='cashbarber'))) then raise exception 'Barber membership is not active in this barbershop' using errcode='23514'; end if;
  return new;
end $$;

alter function app_private.import_cashbarber_batch(uuid,text,jsonb) rename to import_cashbarber_entities;
create function app_private.import_cashbarber_batch(p_shop uuid,p_dataset text,p_rows jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r jsonb; v_id uuid; v_client uuid; v_staff uuid; a public.appointments; s public.services; v_issue text; v_ok integer:=0; v_skip integer:=0; v_bad integer:=0; v_date timestamptz;
begin
  if p_dataset in ('clients','memberships','services','products','appointments') then return app_private.import_cashbarber_entities(p_shop,p_dataset,p_rows); end if;
  if p_dataset not in ('appointment_services','availability_rules','availability_blocks','payments','expenses','orders','plans','contracts','overdue','sales_summary','receivables','product_history') or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>1000 then raise exception 'Invalid import batch' using errcode='22023'; end if;
  if not exists(select 1 from public.barbershops where id=p_shop) then raise exception 'Shop not found' using errcode='22023'; end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    if nullif(r->>'id','') is null then raise exception 'Missing source ID' using errcode='22023'; end if;
    if exists(select 1 from app_private.cashbarber_import_records where barbershop_id=p_shop and dataset=p_dataset and source_id=r->>'id') then v_skip:=v_skip+1;continue;end if;
    v_id:=null;v_issue:=null;
    insert into app_private.cashbarber_import_records(barbershop_id,dataset,source_id,payload) values(p_shop,p_dataset,r->>'id',r);
    begin
      if p_dataset='payments' then
        if coalesce((r->>'source_active')::boolean,false) and r->>'source_status' in ('paid','payExternal') then
          select id into v_client from public.clients where barbershop_id=p_shop and import_source='cashbarber' and source_id=r->>'client';
          v_date:=case when r->>'paid_at' ~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then (r->>'paid_at')::timestamptz else (r->>'paid_at')::timestamp at time zone 'America/Sao_Paulo' end;
          if v_date is null then raise exception 'Data de recebimento ausente' using errcode='22023'; end if;
          insert into public.payments(barbershop_id,client_id,provider,provider_payment_id,amount_cents,status,method,paid_at)
            values(p_shop,v_client,'cashbarber',r->>'id',(r->>'amount')::integer,'paid',r->>'method',v_date) returning id into v_id;
          if v_client is null then v_issue:='Receita preservada sem cliente: identidade não pôde ser confirmada.';end if;
        end if;
      elsif p_dataset='expenses' then
        if (r->>'paid')::boolean and (r->>'active')::boolean then
          insert into public.expenses(barbershop_id,category,description,amount_cents,occurred_on,cost_kind)
            values(p_shop,r->>'category',r->>'description',(r->>'amount')::integer,(r->>'occurred_on')::date,r->>'cost_kind') returning id into v_id;
        end if;
      elsif p_dataset='appointment_services' then
        select * into a from public.appointments where barbershop_id=p_shop and import_source='cashbarber' and source_id=r->>'appointment';
        select * into s from public.services where barbershop_id=p_shop and import_source='cashbarber' and source_id=r->>'service';
        if a.id is null or s.id is null then raise exception 'Agendamento ou serviço não encontrado' using errcode='23503'; end if;
        insert into public.appointment_services(barbershop_id,appointment_id,service_id,price_cents,duration_minutes) values(p_shop,a.id,s.id,0,s.duration_minutes) on conflict do nothing;
        v_id:=a.id;
        if a.status='completed' then
          insert into public.procedure_records(barbershop_id,client_id,barber_membership_id,appointment_id,service_id,performed_at,description,price_cents,notes,import_source,source_id,import_price_known)
            values(p_shop,a.client_id,a.barber_membership_id,a.id,s.id,a.starts_at,s.name,0,'Histórico Cashbarber. Valor por procedimento não informado na origem.','cashbarber',r->>'id',false);
        end if;
      elsif p_dataset='availability_rules' then
        select id into v_staff from public.memberships where barbershop_id=p_shop and import_source='cashbarber' and source_id=r->>'barber' and role='barber';
        if v_staff is null then raise exception 'Profissional não encontrado' using errcode='23503';end if;
        insert into public.availability_rules(barbershop_id,barber_membership_id,weekday,start_time,end_time,import_source,source_id)
          values(p_shop,v_staff,(r->>'weekday')::smallint,(r->>'start')::time,(r->>'end')::time,'cashbarber',r->>'id') returning id into v_id;
      end if;
      update app_private.cashbarber_import_records set projected_id=v_id,issue=v_issue where barbershop_id=p_shop and dataset=p_dataset and source_id=r->>'id';
      v_ok:=v_ok+1;
    exception when check_violation or foreign_key_violation or unique_violation or exclusion_violation or invalid_text_representation or invalid_datetime_format or invalid_parameter_value then
      update app_private.cashbarber_import_records set issue=sqlerrm where barbershop_id=p_shop and dataset=p_dataset and source_id=r->>'id';v_bad:=v_bad+1;
    end;
  end loop;
  return jsonb_build_object('imported',v_ok,'skipped',v_skip,'review',v_bad);
end $$;
revoke all on function app_private.import_cashbarber_batch(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function app_private.import_cashbarber_batch(uuid,text,jsonb) to service_role;
create function public.import_cashbarber_batch(p_shop uuid,p_dataset text,p_rows jsonb) returns jsonb language sql security invoker set search_path='' as $$select app_private.import_cashbarber_batch(p_shop,p_dataset,p_rows)$$;
revoke all on function public.import_cashbarber_batch(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.import_cashbarber_batch(uuid,text,jsonb) to service_role;

-- Historical billing data is visible only to administrators, with no charge/cancel action.
create function app_private.cashbarber_legacy_data(p_barbershop_id uuid,p_from date default null,p_to date default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if (select auth.uid()) is null or not app_private.has_shop_role(p_barbershop_id,array['admin']::public.shop_role[]) then raise exception 'Legacy report access denied' using errcode='42501';end if;
  return jsonb_build_object('contracts',(select coalesce(jsonb_agg(jsonb_build_object('id',source_id,'name',payload->>'name','phone',payload->>'phone','plan',payload->>'plan','price',payload->'price','status',payload->>'status','provider',payload->>'provider','starts_on',payload->>'starts_on')),'[]') from app_private.cashbarber_import_records where barbershop_id=p_barbershop_id and dataset='contracts'),
    'plans',(select coalesce(jsonb_agg(jsonb_build_object('id',source_id,'name',payload->>'name','price',payload->'price','active',payload->'active')),'[]') from app_private.cashbarber_import_records where barbershop_id=p_barbershop_id and dataset='plans'),
    'sales_summary',(select coalesce(jsonb_agg(payload),'[]') from app_private.cashbarber_import_records where barbershop_id=p_barbershop_id and dataset='sales_summary' and (p_from is null or (payload->>'month'||'-01')::date>=date_trunc('month',p_from)::date) and (p_to is null or (payload->>'month'||'-01')::date<=p_to)));
end $$;
revoke all on function app_private.cashbarber_legacy_data(uuid,date,date) from public,anon,authenticated;
grant execute on function app_private.cashbarber_legacy_data(uuid,date,date) to authenticated;
create function public.cashbarber_legacy_data(p_barbershop_id uuid,p_from date default null,p_to date default null) returns jsonb language sql stable security invoker set search_path='' as $$select app_private.cashbarber_legacy_data(p_barbershop_id,p_from,p_to)$$;
revoke all on function public.cashbarber_legacy_data(uuid,date,date) from public,anon,authenticated;
grant execute on function public.cashbarber_legacy_data(uuid,date,date) to authenticated;
