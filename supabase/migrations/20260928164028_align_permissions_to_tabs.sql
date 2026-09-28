-- The visible Clientes tab contains procedure and chemical histories. The
-- Serviços tab contains each barber's availability editor. Keep their RLS
-- module checks aligned with the switches shown to the shop administrator.
alter policy procedure_records_barber_read on public.procedure_records
  using (
    app_private.has_module(barbershop_id, 'clients')
    and app_private.is_assigned_client(barbershop_id, client_id)
  );
alter policy procedure_records_barber_write on public.procedure_records
  using (
    app_private.has_module(barbershop_id, 'clients')
    and app_private.is_assigned_client(barbershop_id, client_id)
    and app_private.is_own_barber(barbershop_id, barber_membership_id)
  )
  with check (
    app_private.has_module(barbershop_id, 'clients')
    and app_private.is_assigned_client(barbershop_id, client_id)
    and app_private.is_own_barber(barbershop_id, barber_membership_id)
  );
alter policy chemical_records_barber_read on public.chemical_records
  using (
    app_private.has_module(barbershop_id, 'clients')
    and app_private.is_assigned_client(barbershop_id, client_id)
  );
alter policy chemical_records_barber_write on public.chemical_records
  using (
    app_private.has_module(barbershop_id, 'clients')
    and app_private.is_assigned_client(barbershop_id, client_id)
    and app_private.is_own_barber(barbershop_id, barber_membership_id)
  )
  with check (
    app_private.has_module(barbershop_id, 'clients')
    and app_private.is_assigned_client(barbershop_id, client_id)
    and app_private.is_own_barber(barbershop_id, barber_membership_id)
  );

alter policy availability_rules_barber on public.availability_rules
  using (
    app_private.has_module(barbershop_id, 'services')
    and app_private.is_own_barber(barbershop_id, barber_membership_id)
  )
  with check (
    app_private.has_module(barbershop_id, 'services')
    and app_private.is_own_barber(barbershop_id, barber_membership_id)
  );
alter policy availability_exceptions_barber on public.availability_exceptions
  using (
    app_private.has_module(barbershop_id, 'services')
    and app_private.is_own_barber(barbershop_id, barber_membership_id)
  )
  with check (
    app_private.has_module(barbershop_id, 'services')
    and app_private.is_own_barber(barbershop_id, barber_membership_id)
  );

-- The public mini bio may show a small retail catalog without disclosing
-- supplier costs, exact stock, SKUs, or internal kitchen/supply items.
create function public.public_products(p_barbershop_id uuid)
returns table (
  id uuid,
  name text,
  description text,
  category text,
  price_cents integer,
  in_stock boolean
)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.name, p.description, p.category, p.price_cents,
         p.stock_quantity > 0 as in_stock
  from public.products p
  join public.barbershops s on s.id = p.barbershop_id
  where p.barbershop_id = p_barbershop_id
    and p.active and p.category = 'retail' and s.active
  order by p.name;
$$;
revoke execute on function public.public_products(uuid)
  from public, anon, authenticated;
grant execute on function public.public_products(uuid)
  to anon, authenticated;

-- Server-side SaaS billing reconciliation is batched by least recently
-- checked subscription; this field remains inaccessible to browser roles.
alter table public.platform_subscriptions
  add column last_reconciled_at timestamptz,
  add column auto_paused boolean not null default false;
create index platform_subscriptions_reconcile_idx
  on public.platform_subscriptions (last_reconciled_at asc nulls first);
