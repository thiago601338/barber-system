-- Rendimentos por barbeiro: nomes alternativos, faturamento real (pagamentos) e painel financeiro.
create index if not exists cashbarber_import_records_projected_idx
  on app_private.cashbarber_import_records using btree (barbershop_id, dataset, projected_id) where (projected_id is not null);

create table if not exists app_private.member_name_aliases (
  membership_id uuid not null references public.memberships(id) on delete cascade,
  alias text not null,
  primary key (membership_id, alias)
);

create or replace function app_private.norm_name(p text) returns text
language sql immutable set search_path to ''
as $function$ select lower(regexp_replace(btrim(coalesce(p,'')), '\s+', ' ', 'g')) $function$;

create or replace function app_private.member_names(p_membership_id uuid) returns text[]
language sql stable security definer set search_path to ''
as $function$
  select coalesce(array_agg(distinct n) filter (where n <> ''), '{}') from (
    select app_private.norm_name(m.display_name) n from public.memberships m where m.id = p_membership_id
    union all select app_private.norm_name(r.payload->>'name') from app_private.cashbarber_import_records r where r.dataset = 'memberships' and r.projected_id = p_membership_id
    union all select app_private.norm_name(a.alias) from app_private.member_name_aliases a where a.membership_id = p_membership_id
  ) x
$function$;

create or replace function app_private.member_revenue_cents(p_barbershop_id uuid, p_membership_id uuid, p_from timestamptz, p_to timestamptz) returns bigint
language plpgsql stable security definer set search_path to ''
as $function$
declare v_names text[] := app_private.member_names(p_membership_id); v_a bigint; v_b bigint;
begin
  select coalesce(sum(p.amount_cents), 0) into v_a from public.payments p
    join app_private.cashbarber_import_records r on r.barbershop_id = p.barbershop_id and r.dataset = 'payments' and r.projected_id = p.id
    where p.barbershop_id = p_barbershop_id and p.status = 'paid' and p.paid_at >= p_from and p.paid_at < p_to
      and app_private.norm_name(r.payload->'source_record'->>'profissional') = any(v_names);
  select coalesce(sum(p.amount_cents), 0) into v_b from public.payments p join public.appointments a on a.id = p.appointment_id
    where p.barbershop_id = p_barbershop_id and a.barber_membership_id = p_membership_id and p.status = 'paid'
      and p.paid_at >= p_from and p.paid_at < p_to and coalesce(p.provider,'') <> 'cashbarber';
  return v_a + v_b;
end $function$;
revoke all on function app_private.member_revenue_cents(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;

create or replace function app_private.team_overview(p_barbershop_id uuid)
returns table(membership_id uuid, role text, display_name text, active boolean, avatar_path text, has_login boolean, email text, invite_pending boolean, last_sign_in_at timestamptz, imported boolean, created_at timestamptz, completed_month integer, completed_total integer, revenue_month_cents bigint, upcoming_today integer, work_days smallint[])
language plpgsql stable security definer set search_path to ''
as $function$
declare
  v_admin boolean := app_private.is_platform_admin() or app_private.has_shop_role(p_barbershop_id, array['admin'::public.shop_role]);
  v_self uuid;
  v_tz text;
  v_month_start timestamptz;
  v_day_start timestamptz;
begin
  if not v_admin then
    select m.id into v_self from public.memberships m
      where m.barbershop_id = p_barbershop_id and m.user_id = auth.uid() and m.active and m.role = 'barber';
    if v_self is null then raise exception 'Acesso restrito à equipe da barbearia' using errcode = '42501'; end if;
  end if;
  select coalesce(s.timezone, 'America/Sao_Paulo') into v_tz from public.barbershops s where s.id = p_barbershop_id;
  v_month_start := date_trunc('month', now() at time zone v_tz) at time zone v_tz;
  v_day_start := date_trunc('day', now() at time zone v_tz) at time zone v_tz;
  return query
  select m.id, m.role::text, coalesce(nullif(btrim(m.display_name), ''), pr.full_name, 'Profissional'), m.active, m.avatar_path,
    m.user_id is not null,
    case when v_admin then coalesce(u.email::text, pr.email, (select r.payload->>'email' from app_private.cashbarber_import_records r
      where r.barbershop_id = p_barbershop_id and r.dataset = 'memberships' and r.projected_id = m.id limit 1)) else u.email::text end,
    (m.user_id is not null and u.last_sign_in_at is null),
    u.last_sign_in_at,
    m.import_source = 'cashbarber',
    m.created_at,
    (select count(*)::int from public.appointments a where a.barbershop_id = p_barbershop_id and a.barber_membership_id = m.id and a.status = 'completed' and a.starts_at >= v_month_start),
    (select count(*)::int from public.appointments a where a.barbershop_id = p_barbershop_id and a.barber_membership_id = m.id and a.status = 'completed'),
    case when m.role = 'barber' then app_private.member_revenue_cents(p_barbershop_id, m.id, v_month_start, now() + interval '1 day') else 0::bigint end,
    (select count(*)::int from public.appointments a where a.barbershop_id = p_barbershop_id and a.barber_membership_id = m.id and a.status = 'confirmed' and a.starts_at >= v_day_start and a.starts_at < v_day_start + interval '1 day'),
    (select coalesce(array_agg(distinct ar.weekday order by ar.weekday), '{}'::smallint[]) from public.availability_rules ar where ar.barbershop_id = p_barbershop_id and ar.barber_membership_id = m.id and ar.active)
  from public.memberships m
  left join auth.users u on u.id = m.user_id
  left join public.profiles pr on pr.user_id = m.user_id
  where m.barbershop_id = p_barbershop_id
    and (v_admin or m.id = v_self)
  order by m.active desc, (m.role = 'barber') desc, 2, 3;
end $function$;

create or replace function app_private.barber_financials(p_barbershop_id uuid, p_membership_id uuid, p_months integer default 12) returns jsonb
language plpgsql stable security definer set search_path to ''
as $function$
declare
  v_admin boolean := app_private.is_platform_admin() or app_private.has_shop_role(p_barbershop_id, array['admin'::public.shop_role]);
  v_tz text; v_from timestamptz; v_names text[]; v_tax numeric; v_fee numeric; v_comm numeric; v_settings boolean;
  v_months jsonb; v_services jsonb; v_clients int; v_has_entries boolean;
begin
  if p_months < 1 or p_months > 36 then p_months := 12; end if;
  if not exists (select 1 from public.memberships m where m.id = p_membership_id and m.barbershop_id = p_barbershop_id) then
    raise exception 'Profissional não encontrado' using errcode = '42501'; end if;
  if not v_admin and not exists (select 1 from public.memberships m where m.id = p_membership_id and m.barbershop_id = p_barbershop_id and m.user_id = auth.uid() and m.active) then
    raise exception 'Acesso restrito' using errcode = '42501'; end if;
  select coalesce(s.timezone,'America/Sao_Paulo') into v_tz from public.barbershops s where s.id = p_barbershop_id;
  v_from := (date_trunc('month', now() at time zone v_tz) - make_interval(months => p_months - 1)) at time zone v_tz;
  v_names := app_private.member_names(p_membership_id);
  select fs.tax_pct, fs.payment_fee_pct, fs.service_commission_pct into v_tax, v_fee, v_comm from public.financial_settings fs where fs.barbershop_id = p_barbershop_id;
  v_settings := found;
  v_has_entries := exists (select 1 from public.commission_entries ce where ce.barbershop_id = p_barbershop_id and ce.barber_membership_id = p_membership_id);

  with months as (
    select generate_series(date_trunc('month', v_from at time zone v_tz), date_trunc('month', now() at time zone v_tz), interval '1 month') m
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
    where p.barbershop_id = p_barbershop_id and p.status = 'paid' and p.paid_at >= v_from
      and app_private.norm_name(r.payload->'source_record'->>'profissional') = any(v_names)
  ), native as (
    select date_trunc('month', p.paid_at at time zone v_tz) m, p.amount_cents svc, 0 prod
    from public.payments p join public.appointments a on a.id = p.appointment_id
    where p.barbershop_id = p_barbershop_id and a.barber_membership_id = p_membership_id and p.status = 'paid' and p.paid_at >= v_from
      and coalesce(p.provider,'') <> 'cashbarber'
  ), paid as (
    select m, sum(svc)::bigint svc, sum(prod)::bigint prod from (select * from imported union all select * from native) x group by m
  ), done as (
    select date_trunc('month', a.starts_at at time zone v_tz) m, a.id, a.client_id from public.appointments a
    where a.barbershop_id = p_barbershop_id and a.barber_membership_id = p_membership_id and a.status = 'completed' and a.starts_at >= v_from
  ), items as (
    select d.m, coalesce(nullif(aps.price_cents,0), s.price_cents, 0) price,
      coalesce(ifp.direct_cost_cents, s.cost_cents, 0) + coalesce(ifp.extra_cost_cents, 0) cost
    from done d join public.appointment_services aps on aps.appointment_id = d.id
    left join public.services s on s.id = aps.service_id
    left join public.item_financial_profiles ifp on ifp.barbershop_id = p_barbershop_id and ifp.item_kind = 'service' and ifp.item_id = aps.service_id
  ), agg_items as (select m, sum(price)::bigint est, sum(cost)::bigint cost from items group by m),
  agg_done as (select m, count(*)::int n, count(distinct client_id)::int clients from done group by m),
  comm as (
    select date_trunc('month', ce.earned_at at time zone v_tz) m, sum(ce.amount_cents)::bigint amt from public.commission_entries ce
    where ce.barbershop_id = p_barbershop_id and ce.barber_membership_id = p_membership_id and ce.earned_at >= v_from group by 1
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
      'commission_cents', case when v_has_entries then coalesce(cm.amt, 0) else round(coalesce(pd.svc,0) * coalesce(v_comm,0) / 100)::bigint end
    ) order by mo.m)
  into v_months
  from months mo left join paid pd on pd.m = mo.m left join agg_items ai on ai.m = mo.m left join agg_done ad on ad.m = mo.m left join comm cm on cm.m = mo.m;

  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'count', n) order by n desc), '[]') into v_services from (
    select coalesce(s.name, 'Serviço') name, count(*)::int n from public.appointments a
    join public.appointment_services aps on aps.appointment_id = a.id left join public.services s on s.id = aps.service_id
    where a.barbershop_id = p_barbershop_id and a.barber_membership_id = p_membership_id and a.status = 'completed' and a.starts_at >= v_from
    group by 1 order by 2 desc limit 6) t;

  select count(distinct a.client_id)::int into v_clients from public.appointments a
    where a.barbershop_id = p_barbershop_id and a.barber_membership_id = p_membership_id and a.status = 'completed' and a.starts_at >= v_from;

  return jsonb_build_object('months', coalesce(v_months, '[]'), 'top_services', v_services, 'clients_unique', v_clients,
    'settings', jsonb_build_object('configured', v_settings, 'tax_pct', v_tax, 'fee_pct', v_fee, 'commission_pct', v_comm,
      'commission_source', case when v_has_entries then 'entries' when coalesce(v_comm,0) > 0 then 'settings' else 'none' end),
    'matched_names', to_jsonb(v_names));
end $function$;

create or replace function public.barber_financials(p_barbershop_id uuid, p_membership_id uuid, p_months integer default 12) returns jsonb
language sql stable set search_path to ''
as $function$ select app_private.barber_financials(p_barbershop_id, p_membership_id, p_months) $function$;
revoke all on function public.barber_financials(uuid, uuid, integer) from public, anon;
grant execute on function public.barber_financials(uuid, uuid, integer) to authenticated;
grant execute on function app_private.barber_financials(uuid, uuid, integer) to authenticated;
