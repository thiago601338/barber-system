-- Current source schedules can explain imported activity without granting staff access.
do $$ declare body text; begin
  select pg_get_functiondef('app_private.management_dashboard_base(uuid,date,date)'::regprocedure) into body;
  body:=replace(body,'role=''barber'' and active and (v_admin or id=v_barber)',
    'role=''barber'' and (active or (v_admin and exists(select 1 from app_private.cashbarber_import_records ir where ir.barbershop_id=p_barbershop_id and ir.dataset=''memberships'' and ir.projected_id=public.memberships.id and (ir.payload->>''source_active'')::boolean))) and (v_admin or id=v_barber)');
  body:=replace(body,'merged as (select barber_id,unnest(range_agg(slot)) slot from windows group by barber_id)',
    'original_windows as (select barber_id,range_agg(slot) slots from windows group by barber_id),
    source_blocks as (select m.id barber_id,range_agg(tsrange((ir.payload->>''start'')::timestamp,(ir.payload->>''end'')::timestamp,''[)'')) slots from app_private.cashbarber_import_records ir join public.memberships m on m.barbershop_id=ir.barbershop_id and m.import_source=''cashbarber'' and m.source_id=ir.payload->>''id_barbeiro'' where ir.barbershop_id=p_barbershop_id and ir.dataset=''availability_blocks'' and (ir.payload->>''end'')::timestamp>(ir.payload->>''start'')::timestamp group by m.id),
    merged as (select w.barber_id,unnest(w.slots-coalesce(b.slots,''{}''::tsmultirange)) slot from original_windows w left join source_blocks b on b.barber_id=w.barber_id)');
  execute body;
end $$;

-- Do not count historical receipts twice when giving them source categories.
alter function app_private.profitability_data(uuid,date,date) rename to profitability_data_base;
do $$ declare body text; begin
  select pg_get_functiondef('app_private.profitability_data_base(uuid,date,date)'::regprocedure) into body;
  body:=replace(body,'and status=''paid'' and paid_at>=v_start','and status=''paid'' and provider<>''cashbarber'' and paid_at>=v_start');execute body;
end $$;
create function app_private.profitability_data(p_barbershop_id uuid,p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v jsonb; l jsonb; f jsonb;
begin
  v:=app_private.profitability_data_base(p_barbershop_id,p_from,p_to);f:=v->'settings';
  with receipts as (
    select p.amount_cents,r.payload,coalesce((r.payload->>'services')::numeric,0) services,coalesce((r.payload->>'products')::numeric,0) products
    from public.payments p join public.barbershops b on b.id=p.barbershop_id join app_private.cashbarber_import_records r on r.barbershop_id=p.barbershop_id and r.dataset='payments' and r.projected_id=p.id
    where p.barbershop_id=p_barbershop_id and p.provider='cashbarber' and p.status='paid' and p.paid_at>=p_from::timestamp at time zone b.timezone and p.paid_at<(p_to+1)::timestamp at time zone b.timezone
  ), classified as (
    select case when payload->>'source_kind'='subscription' then 'subscription' else 'other' end kind,
      case when payload->>'source_kind'='subscription' then 'Assinaturas · histórico Cashbarber' else 'Recebimentos sem itens · Cashbarber' end name,
      case when payload->>'source_kind'='subscription' then 'subscription' else 'other' end category,amount_cents revenue from receipts where payload->>'source_kind'='subscription' or services+products=0
    union all select 'service','Procedimentos · histórico Cashbarber','service',floor(amount_cents*services/(services+products)) from receipts where payload->>'source_kind'<>'subscription' and services>0 and services+products>0
    union all select 'product','Produtos / bar / cozinha · histórico Cashbarber','historical_products',amount_cents-floor(amount_cents*services/(services+products)) from receipts where payload->>'source_kind'<>'subscription' and products>0 and services+products>0
  ) select coalesce(jsonb_agg(jsonb_build_object('item_id',null,'kind',kind,'name',name,'category',category,'revenue_cents',revenue,'quantity',0,'direct_cost_cents',0,'extra_cost_cents',0,'tax_pct',f->'tax_pct','fee_pct',f->'payment_fee_pct','commission_pct',case when kind='product' then f->'product_commission_pct' else f->'service_commission_pct' end,'estimated',true)),'[]') into l from (select kind,name,category,sum(revenue) revenue from classified group by kind,name,category)c;
  return jsonb_set(v,'{lines}',(v->'lines')||l);
end $$;
revoke all on function app_private.profitability_data(uuid,date,date) from public,anon,authenticated;
grant execute on function app_private.profitability_data(uuid,date,date) to authenticated;

create function app_private.cashbarber_history_page(p_barbershop_id uuid,p_dataset text,p_page integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_total integer; v_rows jsonb; ds text;
begin
  if (select auth.uid()) is null or not app_private.has_shop_role(p_barbershop_id,array['admin']::public.shop_role[]) then raise exception 'History access denied' using errcode='42501';end if;
  if p_dataset not in ('orders','receivables','product_history','appointments_review') or p_page<0 or p_page>10000 then raise exception 'Invalid history page' using errcode='22023';end if;
  ds:=case when p_dataset='appointments_review' then 'appointments' else p_dataset end;
  select count(*) into v_total from app_private.cashbarber_import_records where barbershop_id=p_barbershop_id and dataset=ds and (p_dataset<>'appointments_review' or issue is not null);
  select coalesce(jsonb_agg(x),'[]') into v_rows from (
    select r.source_id id,
      case ds when 'orders' then r.payload->>'paid_at' when 'appointments' then r.payload->>'start' when 'receivables' then r.payload->'source_record'->>'mov_data_vencimento' else r.payload->'source_record'->>'data' end date,
      case ds when 'orders' then 'Comanda #'||r.source_id when 'appointments' then 'Agendamento com sobreposição' when 'receivables' then r.payload->'source_record'->>'mov_descricao' else r.payload->'source_record'->>'produto' end description,
      case ds when 'orders' then c.full_name when 'appointments' then c.full_name else r.payload->'source_record'->>'cliente' end client_name,
      case ds when 'orders' then (r.payload->>'total')::numeric when 'receivables' then round((r.payload->'source_record'->>'mov_valor')::numeric*100) end amount_cents,
      case ds when 'orders' then case when (r.payload->>'paid')::numeric>0 then 'Com pagamento' else 'Conferir comanda' end when 'receivables' then case when (r.payload->'source_record'->>'mov_pago')::integer=1 then 'Pago na origem' else 'Em aberto na origem' end when 'appointments' then r.payload->>'source_status' else 'Venda na origem' end status
    from app_private.cashbarber_import_records r left join public.clients c on c.barbershop_id=r.barbershop_id and c.import_source='cashbarber' and c.source_id=r.payload->>'client'
    where r.barbershop_id=p_barbershop_id and r.dataset=ds and (p_dataset<>'appointments_review' or r.issue is not null)
    order by r.source_id limit 50 offset p_page*50
  )x;
  return jsonb_build_object('total',v_total,'rows',v_rows);
end $$;
revoke all on function app_private.cashbarber_history_page(uuid,text,integer) from public,anon,authenticated;
grant execute on function app_private.cashbarber_history_page(uuid,text,integer) to authenticated;
create function public.cashbarber_history_page(p_barbershop_id uuid,p_dataset text,p_page integer default 0) returns jsonb language sql stable security invoker set search_path='' as $$select app_private.cashbarber_history_page(p_barbershop_id,p_dataset,p_page)$$;
revoke all on function public.cashbarber_history_page(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.cashbarber_history_page(uuid,text,integer) to authenticated;

create function app_private.subscription_overview(p_barbershop_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare legacy integer; received bigint; current_contracts integer;
begin
  if (select auth.uid()) is null or not app_private.has_shop_role(p_barbershop_id,array['admin']::public.shop_role[]) then raise exception 'Overview access denied' using errcode='42501';end if;
  select count(*) into legacy from app_private.cashbarber_import_records where barbershop_id=p_barbershop_id and dataset='contracts' and payload->>'status'='active';
  select count(*) into current_contracts from public.subscriptions where barbershop_id=p_barbershop_id and status in ('active','authorized') and (current_period_end is null or current_period_end>now());
  select coalesce(sum(amount_cents),0) into received from public.payments where barbershop_id=p_barbershop_id and status='paid' and (subscription_id is not null or (provider='cashbarber' and provider_payment_id like 'subscription:%'));
  return jsonb_build_object('active',current_contracts+legacy,'legacy_active',legacy,'received_cents',received);
end $$;
revoke all on function app_private.subscription_overview(uuid) from public,anon,authenticated;
grant execute on function app_private.subscription_overview(uuid) to authenticated;
create function public.subscription_overview(p_barbershop_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select app_private.subscription_overview(p_barbershop_id)$$;
revoke all on function public.subscription_overview(uuid) from public,anon,authenticated;
grant execute on function public.subscription_overview(uuid) to authenticated;
