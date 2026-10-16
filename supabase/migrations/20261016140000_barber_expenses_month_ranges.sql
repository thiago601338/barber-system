-- Gastos com o barbeiro (acessórios e outros itens comprados para ele) e rendimentos por intervalo de meses.
alter table public.expenses add column if not exists barber_membership_id uuid references public.memberships(id) on delete set null;
alter table public.expenses add column if not exists item_kind text;
alter table public.expenses add column if not exists quantity integer;
alter table public.expenses add column if not exists unit_cost_cents integer;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'expenses_item_kind_check') then
    alter table public.expenses add constraint expenses_item_kind_check check (item_kind is null or item_kind in ('accessory','uniform','training','allowance','equipment','other'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'expenses_quantity_check') then
    alter table public.expenses add constraint expenses_quantity_check check (quantity is null or quantity between 1 and 10000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'expenses_unit_cost_check') then
    alter table public.expenses add constraint expenses_unit_cost_check check (unit_cost_cents is null or unit_cost_cents >= 0);
  end if;
end $$;
create index if not exists expenses_barber_idx on public.expenses (barbershop_id, barber_membership_id, occurred_on) where barber_membership_id is not null;

-- O barbeiro precisa ser da mesma barbearia do gasto.
create or replace function app_private.expenses_barber_guard() returns trigger
language plpgsql security definer set search_path to ''
as $function$
begin
  if new.barber_membership_id is not null and not exists (
    select 1 from public.memberships m where m.id = new.barber_membership_id and m.barbershop_id = new.barbershop_id) then
    raise exception 'Profissional não pertence a esta barbearia' using errcode = '23514';
  end if;
  return new;
end $function$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'expenses_barber_guard' and tgrelid = 'public.expenses'::regclass) then
    create trigger expenses_barber_guard before insert or update of barber_membership_id, barbershop_id on public.expenses
      for each row execute function app_private.expenses_barber_guard();
  end if;
end $$;

create or replace function app_private.barber_financials_range(p_barbershop_id uuid, p_membership_id uuid, p_start date, p_end date) returns jsonb
language plpgsql stable security definer set search_path to ''
as $function$
declare
  v_admin boolean := app_private.is_platform_admin() or app_private.has_shop_role(p_barbershop_id, array['admin'::public.shop_role]);
  v_tz text; v_from timestamptz; v_to timestamptz; v_start date; v_end date; v_now_month date; v_names text[]; v_tax numeric; v_fee numeric; v_comm numeric; v_settings boolean;
  v_months jsonb; v_services jsonb; v_clients int; v_has_entries boolean;
begin
  if not exists (select 1 from public.memberships m where m.id = p_membership_id and m.barbershop_id = p_barbershop_id) then
    raise exception 'Profissional não encontrado' using errcode = '42501'; end if;
  if not v_admin and not exists (select 1 from public.memberships m where m.id = p_membership_id and m.barbershop_id = p_barbershop_id and m.user_id = auth.uid() and m.active) then
    raise exception 'Acesso restrito' using errcode = '42501'; end if;
  select coalesce(s.timezone,'America/Sao_Paulo') into v_tz from public.barbershops s where s.id = p_barbershop_id;
  v_now_month := date_trunc('month', now() at time zone v_tz)::date;
  v_end := least(date_trunc('month', coalesce(p_end, v_now_month))::date, v_now_month);
  v_start := date_trunc('month', coalesce(p_start, v_end))::date;
  if v_start > v_end then v_start := v_end; end if;
  if v_start < (v_end - interval '35 months')::date then v_start := (v_end - interval '35 months')::date; end if;
  v_from := v_start::timestamp at time zone v_tz;
  v_to := (v_end + interval '1 month')::timestamp at time zone v_tz;
  v_names := app_private.member_names(p_membership_id);
  select fs.tax_pct, fs.payment_fee_pct, fs.service_commission_pct into v_tax, v_fee, v_comm from public.financial_settings fs where fs.barbershop_id = p_barbershop_id;
  v_settings := found;
  v_has_entries := exists (select 1 from public.commission_entries ce where ce.barbershop_id = p_barbershop_id and ce.barber_membership_id = p_membership_id);

  with months as (
    select generate_series(v_start::timestamp, v_end::timestamp, interval '1 month') m
  ), imported as (
    select date_trunc('month', p.paid_at at time zone v_tz) m,
      case when coalesce((r.payload->>'services')::numeric,0) + coalesce((r.payload->>'products')::numeric,0) > 0
        then floor(p.amount_cents * coalesce((r.payload->>'services')::numeric,0) / (coalesce((r.payload->>'services')::numeric,0) + coalesce((r.payload->>'products')::numeric,0)))
        else p.amount_cents end svc,
      case when coalesce((r.payload->>'services')::numeric,0) + coalesce((r.payload->>'products')::numeric,0) > 0
        then p.amount_cents - floor(p.amount_cents * coalesce((r.payload->>'services')::numeric,0) / (coalesce((r.payload->>'services')::numeric,0) + coalesce((r.payload->>'products')::numeric,0)))
        else 0 end prod
    from public.payments p
    join app_private.cashbarber_import_records r on r.barbershop_id = p.barbershop_id and r.dataset = 'payments' and r.projected_id = p.id
    where p.barbershop_id = p_barbershop_id and p.status = 'paid' and p.paid_at >= v_from and p.paid_at < v_to
      and app_private.norm_name(r.payload->'source_record'->>'profissional') = any(v_names)
  ), native as (
    select date_trunc('month', p.paid_at at time zone v_tz) m, p.amount_cents svc, 0 prod
    from public.payments p join public.appointments a on a.id = p.appointment_id
    where p.barbershop_id = p_barbershop_id and a.barber_membership_id = p_membership_id and p.status = 'paid' and p.paid_at >= v_from and p.paid_at < v_to
      and coalesce(p.provider,'') <> 'cashbarber'
  ), paid as (
    select m, sum(svc)::bigint svc, sum(prod)::bigint prod from (select * from imported union all select * from native) x group by m
  ), done as (
    select date_trunc('month', a.starts_at at time zone v_tz) m, a.id, a.client_id from public.appointments a
    where a.barbershop_id = p_barbershop_id and a.barber_membership_id = p_membership_id and a.status = 'completed' and a.starts_at >= v_from and a.starts_at < v_to
  ), items as (
    select d.m, coalesce(nullif(aps.price_cents,0), s.price_cents, 0) price,
      coalesce(ifp.direct_cost_cents, s.cost_cents, 0) + coalesce(ifp.extra_cost_cents, 0) cost
    from done d join public.appointment_services aps on aps.appointment_id = d.id
    left join public.services s on s.id = aps.service_id
    left join public.item_financial_profiles ifp on ifp.barbershop_id = p_barbershop_id and ifp.item_kind = 'service' and ifp.item_id = aps.service_id
  ), agg_items as (select m, sum(price)::bigint est, sum(cost)::bigint cost from items group by m),
  agg_done as (select m, count(*)::int n, count(distinct client_id)::int clients from done group by m),
  spent as (
    select date_trunc('month', e.occurred_on::timestamp) m, sum(e.amount_cents)::bigint total,
      sum(e.amount_cents) filter (where e.item_kind = 'accessory')::bigint accessories,
      sum(coalesce(e.quantity, 1)) filter (where e.item_kind = 'accessory')::int accessory_items
    from public.expenses e
    where v_admin and e.barbershop_id = p_barbershop_id and e.barber_membership_id = p_membership_id
      and e.occurred_on >= v_start and e.occurred_on < (v_end + interval '1 month')::date
    group by 1
  ), comm as (
    select date_trunc('month', ce.earned_at at time zone v_tz) m, sum(ce.amount_cents)::bigint amt from public.commission_entries ce
    where ce.barbershop_id = p_barbershop_id and ce.barber_membership_id = p_membership_id and ce.earned_at >= v_from and ce.earned_at < v_to group by 1
  )
  select jsonb_agg(jsonb_build_object(
      'month', to_char(mo.m, 'YYYY-MM'),
      'completed', coalesce(ad.n, 0),
      'clients', coalesce(ad.clients, 0),
      'revenue_services_cents', coalesce(pd.svc, 0),
      'revenue_products_cents', coalesce(pd.prod, 0),
      'estimated_revenue_cents', coalesce(ai.est, 0),
      'direct_costs_cents', coalesce(ai.cost, 0),
      'taxes_fees_cents', round((coalesce(pd.svc,0) + coalesce(pd.prod,0)) * (coalesce(v_tax,0) + coalesce(v_fee,0)) / 100)::bigint,
      'barber_expenses_cents', coalesce(sp.total, 0),
      'accessories_cents', coalesce(sp.accessories, 0),
      'accessory_items', coalesce(sp.accessory_items, 0),
      'commission_cents', case when v_has_entries then coalesce(cm.amt, 0) else round(coalesce(pd.svc,0) * coalesce(v_comm,0) / 100)::bigint end
    ) order by mo.m)
  into v_months
  from months mo left join paid pd on pd.m = mo.m left join agg_items ai on ai.m = mo.m left join agg_done ad on ad.m = mo.m left join comm cm on cm.m = mo.m left join spent sp on sp.m = mo.m;

  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'count', n) order by n desc), '[]') into v_services from (
    select coalesce(s.name, 'Serviço') name, count(*)::int n from public.appointments a
    join public.appointment_services aps on aps.appointment_id = a.id left join public.services s on s.id = aps.service_id
    where a.barbershop_id = p_barbershop_id and a.barber_membership_id = p_membership_id and a.status = 'completed' and a.starts_at >= v_from and a.starts_at < v_to
    group by 1 order by 2 desc limit 6) t;

  select count(distinct a.client_id)::int into v_clients from public.appointments a
    where a.barbershop_id = p_barbershop_id and a.barber_membership_id = p_membership_id and a.status = 'completed' and a.starts_at >= v_from and a.starts_at < v_to;

  return jsonb_build_object('months', coalesce(v_months, '[]'), 'top_services', v_services, 'clients_unique', v_clients,
    'settings', jsonb_build_object('configured', v_settings, 'tax_pct', v_tax, 'fee_pct', v_fee, 'commission_pct', v_comm,
      'commission_source', case when v_has_entries then 'entries' when coalesce(v_comm,0) > 0 then 'settings' else 'none' end),
    'matched_names', to_jsonb(v_names),
    'range', jsonb_build_object('start', to_char(v_start, 'YYYY-MM'), 'end', to_char(v_end, 'YYYY-MM')),
    'can_manage_expenses', v_admin);
end $function$;

grant execute on function app_private.barber_financials_range(uuid, uuid, date, date) to authenticated;

create or replace function public.barber_financials_range(p_barbershop_id uuid, p_membership_id uuid, p_start date, p_end date) returns jsonb
language sql stable set search_path to ''
as $function$ select app_private.barber_financials_range(p_barbershop_id, p_membership_id, p_start, p_end) $function$;
grant execute on function public.barber_financials_range(uuid, uuid, date, date) to authenticated;

-- Versão antiga (últimos N meses) continua funcionando sobre a nova.
create or replace function app_private.barber_financials(p_barbershop_id uuid, p_membership_id uuid, p_months integer default 12) returns jsonb
language plpgsql stable security definer set search_path to ''
as $function$
declare v_tz text; v_end date;
begin
  if p_months < 1 or p_months > 36 then p_months := 12; end if;
  select coalesce(s.timezone,'America/Sao_Paulo') into v_tz from public.barbershops s where s.id = p_barbershop_id;
  v_end := date_trunc('month', now() at time zone v_tz)::date;
  return app_private.barber_financials_range(p_barbershop_id, p_membership_id, (v_end - make_interval(months => p_months - 1))::date, v_end);
end $function$;
