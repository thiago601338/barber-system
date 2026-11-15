-- PENDENTE DE APLICAÇÃO (rodar no SQL Editor do Supabase ou com `supabase db push`).
-- Contratos migrados do CashBarber (snapshot com "migrated_from") carregam preço, serviços e dia de
-- cobrança comprovados na origem. Esta migração permite concluir a revisão deles
-- (contract_review_required true -> false) e conclui a revisão dos contratos da Kingsman, para que
-- entrem na receita recorrente, no consumo por plano e na inadimplência. As demais condições do
-- contrato continuam imutáveis.
create or replace function app_private.capture_subscription_contract() returns trigger
language plpgsql security definer set search_path='' as $$
declare p public.subscription_plans%rowtype; v_services jsonb; v_slug text; v_acceptance jsonb;
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
  select slug into v_slug from public.barbershops where id=new.barbershop_id;
  select * into p from public.subscription_plans where id=new.plan_id and barbershop_id=new.barbershop_id and active for share;
  if not found then raise exception 'Plano indisponível' using errcode='22023'; end if;
  select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'price_cents',s.price_cents,'duration_minutes',s.duration_minutes) order by s.id) into v_services
    from public.subscription_plan_services ps join public.services s on s.barbershop_id=ps.barbershop_id and s.id=ps.service_id and s.active
    where ps.barbershop_id=new.barbershop_id and ps.plan_id=new.plan_id;
  if v_services is null then raise exception 'Defina os serviços cobertos antes de contratar o plano' using errcode='22023'; end if;
  v_acceptance := new.contract_snapshot->'acceptance';
  if v_slug='kingsman' and (v_acceptance is null or v_acceptance->>'version' <> 'kingsman_subscription_terms_2026_11_11' or v_acceptance->>'source' not in ('online','staff_assisted')) then
    raise exception 'O Termo de Aceite da Kingsman deve ser aceito antes da assinatura.' using errcode='22023';
  end if;
  new.contract_snapshot:=jsonb_build_object('version',1,'captured_at',clock_timestamp(),'plan_id',p.id,'plan_name',p.name,'description',p.description,'price_cents',p.price_cents,'frequency_months',p.frequency_months,'visits_per_cycle',p.visits_per_cycle,'services',v_services)
    || case when v_slug='kingsman' then jsonb_build_object('legal_acceptance',jsonb_build_object('terms_version',v_acceptance->>'version','accepted_at',clock_timestamp(),'source',v_acceptance->>'source','statement','Li e aceito o Termo de Aceite da Assinatura Kingsman, versão 11/11/2026.')) else '{}'::jsonb end;
  new.contract_review_required:=false;
  return new;
end $$;

update public.subscriptions s
  set contract_review_required = false
where s.provider = 'cashbarber' and s.contract_snapshot ? 'migrated_from' and s.contract_review_required;
