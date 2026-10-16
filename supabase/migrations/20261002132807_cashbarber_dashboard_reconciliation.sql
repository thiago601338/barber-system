create or replace function app_private.require_barber_membership() returns trigger language plpgsql security definer set search_path='' as $$
declare v_import boolean:=false;
begin
  if tg_table_name in ('appointments','procedure_records','availability_rules') then v_import:=new.import_source='cashbarber' and new.source_id is not null;
  elsif tg_table_name='client_barbers' then v_import:=exists(select 1 from public.appointments a where a.barbershop_id=new.barbershop_id and a.client_id=new.client_id and a.barber_membership_id=new.barber_membership_id and a.import_source='cashbarber'); end if;
  if not exists(select 1 from public.memberships m where m.id=new.barber_membership_id and m.barbershop_id=new.barbershop_id and m.role='barber' and (m.active or (v_import and m.import_source='cashbarber'))) then raise exception 'Barber membership is not active in this barbershop' using errcode='23514';end if;
  return new;
end $$;

alter function app_private.management_dashboard(uuid,date,date) rename to management_dashboard_base;
create function app_private.management_dashboard(p_barbershop_id uuid,p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v jsonb; v_admin boolean; n bigint; debts jsonb; revenue bigint; transactions bigint;
begin
  v:=app_private.management_dashboard_base(p_barbershop_id,p_from,p_to);
  v_admin:=app_private.has_shop_role(p_barbershop_id,array['admin']::public.shop_role[]);
  if v_admin and app_private.has_module(p_barbershop_id,'subscriptions') then
    select count(*) into n from app_private.cashbarber_import_records where barbershop_id=p_barbershop_id and dataset='contracts' and payload->>'status'='active';
    v:=jsonb_set(v,'{active_plans}',to_jsonb(coalesce((v->>'active_plans')::bigint,0)+n));
  end if;
  if v_admin then
    select coalesce(jsonb_agg(jsonb_build_object('id','cashbarber:'||source_id,'client_name',payload->>'name','phone',payload->>'phone','description',payload->>'plan','amount_cents',null,'due_on',null,'legacy',true)),'[]') into debts from app_private.cashbarber_import_records where barbershop_id=p_barbershop_id and dataset='contracts' and payload->>'status' in ('pastdue','not_authorized','denied');
    v:=jsonb_set(v,'{debts}',coalesce(v->'debts','[]')||debts);
    select sum(p.amount_cents),count(*) filter(where p.amount_cents>0) into revenue,transactions from public.payments p join public.barbershops b on b.id=p.barbershop_id where p.barbershop_id=p_barbershop_id and p.status='paid' and p.paid_at>=p_from::timestamp at time zone b.timezone and p.paid_at<(p_to+1)::timestamp at time zone b.timezone;
    v:=v||jsonb_build_object('paid_transactions',transactions,'ticket_average_cents',case when transactions>0 then round(revenue::numeric/transactions) else 0 end);
  end if;
  return v;
end $$;
revoke all on function app_private.management_dashboard(uuid,date,date) from public,anon,authenticated;
grant execute on function app_private.management_dashboard(uuid,date,date) to authenticated;

create or replace function app_private.cashbarber_import_summary(p_barbershop_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if (select auth.uid()) is null or not app_private.has_shop_role(p_barbershop_id,array['admin']::public.shop_role[]) then raise exception 'Import report access denied' using errcode='42501';end if;
  return jsonb_build_object('datasets',(select coalesce(jsonb_agg(d),'[]') from (select dataset,count(*) extracted,count(projected_id) imported,count(*) filter(where projected_id is null and issue is null) preserved,count(*) filter(where issue is not null) review from app_private.cashbarber_import_records where barbershop_id=p_barbershop_id group by dataset order by dataset)d),'issues',(select coalesce(jsonb_agg(d),'[]') from (select dataset,source_id,issue from app_private.cashbarber_import_records where barbershop_id=p_barbershop_id and issue is not null order by dataset,source_id limit 100)d),'last_import',(select max(imported_at) from app_private.cashbarber_import_records where barbershop_id=p_barbershop_id));
end $$;
