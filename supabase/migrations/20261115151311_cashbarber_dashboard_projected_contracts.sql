-- Painel da barbearia: contratos antigos arquivados só somam em "planos ativos" enquanto não viraram
-- assinatura real (evita contar duas vezes após a projeção), e as assinaturas inadimplentes reais
-- entram na lista de pendências com valor e vencimento.
create or replace function app_private.management_dashboard(p_barbershop_id uuid,p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v jsonb; v_admin boolean; n bigint; debts jsonb; revenue bigint; transactions bigint;
begin
  v:=app_private.management_dashboard_base(p_barbershop_id,p_from,p_to);
  v_admin:=app_private.has_shop_role(p_barbershop_id,array['admin']::public.shop_role[]);
  if v_admin and app_private.has_module(p_barbershop_id,'subscriptions') then
    select count(*) into n from app_private.cashbarber_import_records
      where barbershop_id=p_barbershop_id and dataset='contracts' and projected_id is null and issue is null and payload->>'status'='active';
    v:=jsonb_set(v,'{active_plans}',to_jsonb(coalesce((v->>'active_plans')::bigint,0)+n));
  end if;
  if v_admin then
    select coalesce(jsonb_agg(d order by d->>'due_on' nulls last),'[]') into debts from (
      select jsonb_build_object('id','subscription:'||s.id,'client_name',c.full_name,'phone',c.phone,
        'description',coalesce(s.contract_snapshot->>'plan_name',p.name),
        'amount_cents',case when not s.contract_review_required then (s.contract_snapshot->>'price_cents')::integer end,
        'due_on',(s.current_period_start at time zone b.timezone)::date,'legacy',true,'subscription_id',s.id) d
      from public.subscriptions s
        join public.barbershops b on b.id=s.barbershop_id
        join public.clients c on c.barbershop_id=s.barbershop_id and c.id=s.client_id
        join public.subscription_plans p on p.barbershop_id=s.barbershop_id and p.id=s.plan_id
      where s.barbershop_id=p_barbershop_id and (s.status='past_due' or (s.status='active' and s.current_period_end<=now()))
      union all
      select jsonb_build_object('id','cashbarber:'||r.source_id,'client_name',r.payload->>'name','phone',r.payload->>'phone','description',r.payload->>'plan','amount_cents',null,'due_on',null,'legacy',true)
      from app_private.cashbarber_import_records r
      where r.barbershop_id=p_barbershop_id and r.dataset='contracts' and r.projected_id is null and r.issue is null and r.payload->>'status' in ('pastdue','not_authorized','denied')
    ) q(d);
    v:=jsonb_set(v,'{debts}',coalesce(v->'debts','[]')||debts);
    select sum(p.amount_cents),count(*) filter(where p.amount_cents>0) into revenue,transactions from public.payments p join public.barbershops b on b.id=p.barbershop_id where p.barbershop_id=p_barbershop_id and p.status='paid' and p.paid_at>=p_from::timestamp at time zone b.timezone and p.paid_at<(p_to+1)::timestamp at time zone b.timezone;
    v:=v||jsonb_build_object('paid_transactions',transactions,'ticket_average_cents',case when transactions>0 then round(revenue::numeric/transactions) else 0 end);
  end if;
  return v;
end $$;
