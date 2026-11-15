-- Cadastro: captação do cliente, categorias livres de serviço e produto, prazo de recompra do produto
-- e trilha de auditoria de alterações.
alter table public.clients
  add column if not exists acquisition_source text check (acquisition_source is null or length(btrim(acquisition_source)) between 1 and 60),
  add column if not exists referred_by text check (referred_by is null or length(btrim(referred_by)) between 1 and 160);
-- A data de nascimento entrou depois da concessão original e não podia ser salva pela tela de edição.
grant update (birth_date, acquisition_source, referred_by) on public.clients to authenticated;

alter table public.services
  add column if not exists category text check (category is null or length(btrim(category)) between 1 and 60);
grant select (category) on public.services to authenticated, anon;

alter table public.products
  add column if not exists product_group text check (product_group is null or length(btrim(product_group)) between 1 and 60),
  add column if not exists repurchase_days integer check (repurchase_days is null or repurchase_days between 1 and 730);

create or replace function app_private.product_save(p_shop uuid, p_product uuid, p_values jsonb)
returns uuid language plpgsql security definer set search_path to ''
as $function$
begin
 if not app_private.has_shop_role(p_shop,array['admin']::public.shop_role[]) then raise exception 'Apenas administrador altera produto' using errcode='42501'; end if;
 perform set_config('app.inventory_reason','cost_review',true);
 update public.products set name=p_values->>'name',sku=nullif(p_values->>'sku',''),description=nullif(p_values->>'description',''),category=p_values->>'category',price_cents=(p_values->>'price_cents')::integer,cost_cents=(p_values->>'cost_cents')::integer,active=(p_values->>'active')::boolean,image_path=nullif(p_values->>'image_path',''),minimum_stock=(p_values->>'minimum_stock')::integer,
   product_group=case when p_values ? 'product_group' then nullif(btrim(coalesce(p_values->>'product_group','')),'') else product_group end,
   repurchase_days=case when p_values ? 'repurchase_days' then nullif(p_values->>'repurchase_days','')::integer else repurchase_days end
   where id=p_product and barbershop_id=p_shop;
 if not found then raise exception 'Produto não encontrado'; end if;
 return p_product;
end $function$;

-- Recompra: clientes cuja última compra de um produto com prazo definido já venceu ou vence nos próximos dias.
create or replace function public.repurchase_due(p_barbershop_id uuid, p_window integer default 7)
returns jsonb language plpgsql stable security definer set search_path to ''
as $function$
declare v_tz text; v_today date; v_admin boolean; v_own uuid; v_rows jsonb;
begin
  if (select auth.uid()) is null or not app_private.has_module(p_barbershop_id, 'products') then
    raise exception 'Seu acesso não permite ver a recompra.' using errcode = '42501';
  end if;
  select b.timezone into v_tz from public.barbershops b where b.id = p_barbershop_id;
  if v_tz is null then raise exception 'Barbearia não encontrada.' using errcode = '22023'; end if;
  v_today := (now() at time zone v_tz)::date;
  v_admin := app_private.has_shop_role(p_barbershop_id, array['admin']::public.shop_role[]);
  if not v_admin then
    select m.id into v_own from public.memberships m
      where m.barbershop_id = p_barbershop_id and m.user_id = (select auth.uid()) and m.role = 'barber' and m.active;
  end if;
  with purchases as (
    select s.client_id, i.product_id, max((s.created_at at time zone v_tz)::date) as last_day, sum(i.quantity) as quantity
    from public.sale_items i join public.sales s on s.barbershop_id = i.barbershop_id and s.id = i.sale_id
    where i.barbershop_id = p_barbershop_id and s.status = 'paid' and s.client_id is not null and i.product_id is not null
    group by 1, 2
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', pu.client_id::text || ':' || pu.product_id::text, 'client_id', c.id, 'client_name', c.full_name, 'phone', c.phone,
      'product_id', p.id, 'product_name', p.name, 'last_purchase', pu.last_day, 'due_on', pu.last_day + p.repurchase_days,
      'days_late', v_today - (pu.last_day + p.repurchase_days), 'quantity', pu.quantity
    ) order by pu.last_day + p.repurchase_days desc, c.full_name), '[]'::jsonb) into v_rows
  from purchases pu
    join public.products p on p.barbershop_id = p_barbershop_id and p.id = pu.product_id and p.repurchase_days is not null and p.active
    join public.clients c on c.barbershop_id = p_barbershop_id and c.id = pu.client_id
  where pu.last_day + p.repurchase_days <= v_today + greatest(0, least(coalesce(p_window, 7), 60))
    and pu.last_day + p.repurchase_days >= v_today - 120
    and (v_admin or exists (select 1 from public.client_barbers cb
      where cb.barbershop_id = p_barbershop_id and cb.client_id = c.id and cb.barber_membership_id = v_own));
  return v_rows;
end $function$;
revoke all on function public.repurchase_due(uuid, integer) from public, anon, authenticated;
grant execute on function public.repurchase_due(uuid, integer) to authenticated;

-- Auditoria: quem alterou preços, comandas, pagamentos, planos, contratos e regras, e quando.
create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  entity text not null,
  entity_id uuid,
  label text,
  action text not null check (action in ('insert', 'update', 'delete')),
  changes jsonb not null default '{}'::jsonb,
  actor_id uuid,
  actor_name text,
  created_at timestamptz not null default now()
);
create index if not exists audit_events_shop_time_idx on public.audit_events (barbershop_id, created_at desc);
alter table public.audit_events enable row level security;
revoke all on public.audit_events from public, anon, authenticated;
grant select on public.audit_events to authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'audit_events' and policyname = 'audit_events_admin_read') then
    create policy audit_events_admin_read on public.audit_events for select to authenticated
      using (app_private.has_shop_role(barbershop_id, array['admin']::public.shop_role[]));
  end if;
end $$;

-- tg_argv[0] = entidade; tg_argv[1] = colunas acompanhadas. Só registra ações de pessoas logadas
-- (importações e integrações ficam fora) e nunca interrompe a operação original.
create or replace function app_private.audit_row()
returns trigger language plpgsql security definer set search_path to ''
as $function$
declare
  v_cols text[] := string_to_array(tg_argv[1], ',');
  v_old jsonb; v_new jsonb; v_row jsonb; v_changes jsonb := '{}'::jsonb;
  v_col text; v_actor uuid := (select auth.uid()); v_name text; v_shop uuid;
begin
  if v_actor is null then return null; end if;
  begin
    if tg_op in ('UPDATE', 'DELETE') then v_old := to_jsonb(old); end if;
    if tg_op in ('UPDATE', 'INSERT') then v_new := to_jsonb(new); end if;
    v_row := coalesce(v_new, v_old);
    v_shop := (v_row->>'barbershop_id')::uuid;
    foreach v_col in array v_cols loop
      if tg_op <> 'UPDATE' or (v_old->v_col) is distinct from (v_new->v_col) then
        v_changes := v_changes || jsonb_build_object(v_col, jsonb_build_array(v_old->v_col, v_new->v_col));
      end if;
    end loop;
    if tg_op = 'UPDATE' and v_changes = '{}'::jsonb then return null; end if;
    select coalesce(nullif(btrim(m.display_name), ''), pr.full_name) into v_name
      from public.memberships m left join public.profiles pr on pr.user_id = m.user_id
      where m.barbershop_id = v_shop and m.user_id = v_actor and m.active order by (m.role = 'admin') desc limit 1;
    if v_name is null then
      select coalesce(nullif(btrim(pr.full_name), ''), 'Administração da plataforma') into v_name from public.profiles pr where pr.user_id = v_actor;
    end if;
    insert into public.audit_events (barbershop_id, entity, entity_id, label, action, changes, actor_id, actor_name)
      values (v_shop, tg_argv[0], nullif(v_row->>'id', '')::uuid,
        left(coalesce(v_row->>'name', v_row->>'description',
          (select c.full_name from public.clients c where c.id = nullif(v_row->>'client_id', '')::uuid)), 160),
        lower(tg_op), v_changes, v_actor, coalesce(v_name, 'Usuário'));
  exception when others then
    raise warning 'audit_row: %', sqlerrm;
  end;
  return null;
end $function$;
revoke all on function app_private.audit_row() from public, anon, authenticated;

create or replace trigger audit_services_change after update or delete on public.services
  for each row execute function app_private.audit_row('service', 'name,price_cents,duration_minutes,active,category');
create or replace trigger audit_products_change after update or delete on public.products
  for each row execute function app_private.audit_row('product', 'name,price_cents,cost_cents,active');
create or replace trigger audit_plans_change after insert or update or delete on public.subscription_plans
  for each row execute function app_private.audit_row('plan', 'name,price_cents,frequency_months,visits_per_cycle,active');
create or replace trigger audit_commission_rules_change after insert or update on public.commission_rules
  for each row execute function app_private.audit_row('commission_rule', 'barber_membership_id,item_kind,item_id,mode,rate,active');
create or replace trigger audit_expenses_change after update or delete on public.expenses
  for each row execute function app_private.audit_row('expense', 'description,amount_cents,occurred_on,category');
create or replace trigger audit_subscriptions_change after update on public.subscriptions
  for each row when (old.cancel_at_period_end is distinct from new.cancel_at_period_end or old.plan_id is distinct from new.plan_id
    or (old.status is distinct from new.status and new.status in ('cancelled', 'paused', 'expired')))
  execute function app_private.audit_row('subscription', 'status,cancel_at_period_end,cancel_reason,plan_id');
create or replace trigger audit_sales_change after update on public.sales
  for each row when (old.total_cents is distinct from new.total_cents or old.client_id is distinct from new.client_id
    or old.barber_membership_id is distinct from new.barber_membership_id
    or (old.status is distinct from new.status and new.status in ('cancelled', 'refunded')))
  execute function app_private.audit_row('sale', 'status,total_cents,client_id,barber_membership_id');
create or replace trigger audit_sales_delete after delete on public.sales
  for each row execute function app_private.audit_row('sale', 'status,total_cents');
create or replace trigger audit_sale_items_change after update or delete on public.sale_items
  for each row execute function app_private.audit_row('sale_item', 'description,quantity,unit_price_cents,total_cents');
create or replace trigger audit_payments_change after update on public.payments
  for each row when (old.amount_cents is distinct from new.amount_cents or old.method is distinct from new.method
    or (old.status is distinct from new.status and new.status in ('refunded', 'charged_back', 'cancelled')))
  execute function app_private.audit_row('payment', 'status,amount_cents,method');
create or replace trigger audit_payments_delete after delete on public.payments
  for each row execute function app_private.audit_row('payment', 'status,amount_cents,method');
create or replace trigger audit_appointments_value after update on public.appointments
  for each row when (old.total_price_cents is distinct from new.total_price_cents or old.starts_at is distinct from new.starts_at
    or old.barber_membership_id is distinct from new.barber_membership_id
    or (old.status is distinct from new.status and new.status in ('cancelled', 'no_show')))
  execute function app_private.audit_row('appointment', 'status,total_price_cents,starts_at,barber_membership_id,cancellation_reason');
