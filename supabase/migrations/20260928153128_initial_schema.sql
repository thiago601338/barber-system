-- Barber System: first schema. Apply only after review and a dry run.
-- All monetary values are integer cents. All operational rows carry barbershop_id.
-- The user's project already has ensure_rls; explicitly enable RLS regardless.

create schema if not exists extensions;
create schema if not exists app_private;
set search_path = public, extensions, pg_catalog;
revoke all on schema app_private from public, anon, authenticated;
grant usage on schema app_private to authenticated;
create extension if not exists btree_gist with schema extensions;

-- The existing event-trigger function must never be an executable Data API RPC.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end;
$$;

create type public.shop_role as enum ('admin', 'barber');
create type public.appointment_status as enum
  ('pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show');
create type public.usage_status as enum ('reserved', 'used', 'released');

create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.platform_settings (
  id smallint primary key default 1 check (id = 1),
  seat_price_cents integer not null default 0 check (seat_price_cents >= 0),
  billing_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  check (not billing_enabled or seat_price_cents > 0)
);
insert into public.platform_settings (id) values (1);

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(btrim(email)) > 3)
);
create unique index profiles_email_lower_uq on public.profiles (lower(email));

create table public.barbershops (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 160),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  timezone text not null default 'America/Sao_Paulo',
  phone text,
  whatsapp text,
  instagram_url text,
  pix_key text,
  address text,
  bio_title text,
  bio_description text,
  logo_url text,
  structure_monthly_cost_cents integer not null default 0
    check (structure_monthly_cost_cents >= 0),
  target_profit_pct numeric(5,2) check (target_profit_pct between 0 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.shop_role not null,
  display_name text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (barbershop_id, id),
  unique (barbershop_id, user_id)
);
create index memberships_user_active_idx on public.memberships (user_id, barbershop_id)
  where active;
create index memberships_shop_role_active_idx on public.memberships (barbershop_id, role)
  where active;

create table public.module_permissions (
  barbershop_id uuid not null,
  user_id uuid not null,
  module text not null check (module in
    ('dashboard','reports','clients','services','appointments','availability','procedures',
     'subscriptions','products','bar','marketing','partners','goals','ai','bio',
     'finance','settings')),
  allowed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (barbershop_id, user_id, module),
  foreign key (barbershop_id, user_id)
    references public.memberships(barbershop_id, user_id) on delete cascade
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  full_name text not null check (length(btrim(full_name)) between 2 and 160),
  email text,
  phone text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (barbershop_id, id)
);
create unique index clients_shop_user_uq on public.clients (barbershop_id, user_id)
  where user_id is not null;
create index clients_shop_name_idx on public.clients (barbershop_id, lower(full_name));
create index clients_shop_created_idx on public.clients (barbershop_id, created_at);
create index clients_shop_email_idx on public.clients (barbershop_id, lower(email))
  where email is not null;

create table public.client_barbers (
  barbershop_id uuid not null,
  client_id uuid not null,
  barber_membership_id uuid not null,
  assigned_at timestamptz not null default now(),
  primary key (barbershop_id, client_id, barber_membership_id),
  foreign key (barbershop_id, client_id)
    references public.clients(barbershop_id, id) on delete cascade,
  foreign key (barbershop_id, barber_membership_id)
    references public.memberships(barbershop_id, id) on delete cascade
);
create index client_barbers_barber_idx
  on public.client_barbers (barbershop_id, barber_membership_id, client_id);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 160),
  description text,
  duration_minutes integer not null check (duration_minutes between 5 and 480),
  price_cents integer not null check (price_cents >= 0),
  cost_cents integer not null default 0 check (cost_cents >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (barbershop_id, id)
);
create index services_shop_active_idx on public.services (barbershop_id, active);

create table public.barber_services (
  barbershop_id uuid not null,
  barber_membership_id uuid not null,
  service_id uuid not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (barbershop_id, barber_membership_id, service_id),
  foreign key (barbershop_id, barber_membership_id)
    references public.memberships(barbershop_id, id) on delete cascade,
  foreign key (barbershop_id, service_id)
    references public.services(barbershop_id, id) on delete cascade
);
create index barber_services_service_idx
  on public.barber_services (barbershop_id, service_id, barber_membership_id)
  where active;

create table public.availability_rules (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null,
  barber_membership_id uuid not null,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time > start_time),
  unique (barbershop_id, id),
  foreign key (barbershop_id, barber_membership_id)
    references public.memberships(barbershop_id, id) on delete cascade
);
create index availability_rules_barber_day_idx
  on public.availability_rules (barbershop_id, barber_membership_id, weekday)
  where active;

create table public.availability_exceptions (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null,
  barber_membership_id uuid not null,
  day date not null,
  unavailable boolean not null default true,
  start_time time,
  end_time time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (barbershop_id, id),
  unique (barbershop_id, barber_membership_id, day),
  check (
    (unavailable and start_time is null and end_time is null) or
    (not unavailable and start_time is not null and end_time is not null
      and end_time > start_time)
  ),
  foreign key (barbershop_id, barber_membership_id)
    references public.memberships(barbershop_id, id) on delete cascade
);

create table public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 160),
  description text,
  price_cents integer not null check (price_cents >= 0),
  frequency_months integer not null default 1 check (frequency_months between 1 and 12),
  visits_per_cycle integer not null check (visits_per_cycle between 1 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (barbershop_id, id)
);

create table public.subscription_plan_services (
  barbershop_id uuid not null,
  plan_id uuid not null,
  service_id uuid not null,
  primary key (barbershop_id, plan_id, service_id),
  foreign key (barbershop_id, plan_id)
    references public.subscription_plans(barbershop_id, id) on delete cascade,
  foreign key (barbershop_id, service_id)
    references public.services(barbershop_id, id) on delete cascade
);
create index subscription_plan_services_service_idx
  on public.subscription_plan_services (barbershop_id, service_id);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null,
  client_id uuid not null,
  plan_id uuid not null,
  status text not null default 'pending'
    check (status in ('pending','authorized','active','paused','past_due','cancelled','expired')),
  provider text not null default 'mercadopago',
  provider_subscription_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (barbershop_id, id),
  check (current_period_end is null or
    (current_period_start is not null and current_period_end > current_period_start)),
  foreign key (barbershop_id, client_id)
    references public.clients(barbershop_id, id) on delete cascade,
  foreign key (barbershop_id, plan_id)
    references public.subscription_plans(barbershop_id, id)
);
create unique index subscriptions_provider_id_uq
  on public.subscriptions (provider, provider_subscription_id)
  where provider_subscription_id is not null;
create index subscriptions_client_status_idx
  on public.subscriptions (barbershop_id, client_id, status);
create unique index subscriptions_one_live_plan_uq
  on public.subscriptions (barbershop_id, client_id, plan_id)
  where status in ('pending','authorized','active','paused','past_due');

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null,
  client_id uuid not null,
  barber_membership_id uuid not null,
  subscription_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status public.appointment_status not null default 'confirmed',
  source text not null default 'client' check (source in ('client','admin','barber')),
  total_price_cents integer not null default 0 check (total_price_cents >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (barbershop_id, id),
  foreign key (barbershop_id, client_id)
    references public.clients(barbershop_id, id),
  foreign key (barbershop_id, barber_membership_id)
    references public.memberships(barbershop_id, id),
  foreign key (barbershop_id, subscription_id)
    references public.subscriptions(barbershop_id, id)
);
alter table public.appointments add constraint appointments_no_barber_overlap
  exclude using gist (
    barber_membership_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('pending','confirmed','in_progress'));
create index appointments_shop_start_idx on public.appointments (barbershop_id, starts_at);
create index appointments_client_start_idx on public.appointments (barbershop_id, client_id, starts_at desc);
create index appointments_barber_start_idx
  on public.appointments (barbershop_id, barber_membership_id, starts_at);
create index appointments_first_completed_idx
  on public.appointments (barbershop_id, client_id, starts_at)
  where status = 'completed';

create table public.appointment_services (
  barbershop_id uuid not null,
  appointment_id uuid not null,
  service_id uuid not null,
  price_cents integer not null check (price_cents >= 0),
  duration_minutes integer not null check (duration_minutes between 5 and 480),
  primary key (barbershop_id, appointment_id, service_id),
  foreign key (barbershop_id, appointment_id)
    references public.appointments(barbershop_id, id) on delete cascade,
  foreign key (barbershop_id, service_id)
    references public.services(barbershop_id, id)
);
create index appointment_services_service_idx
  on public.appointment_services (barbershop_id, service_id);

create table public.procedure_records (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null,
  client_id uuid not null,
  barber_membership_id uuid not null,
  appointment_id uuid,
  service_id uuid,
  performed_at timestamptz not null default now(),
  description text not null check (length(btrim(description)) > 0),
  price_cents integer not null default 0 check (price_cents >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (barbershop_id, id),
  foreign key (barbershop_id, client_id)
    references public.clients(barbershop_id, id),
  foreign key (barbershop_id, barber_membership_id)
    references public.memberships(barbershop_id, id),
  foreign key (barbershop_id, appointment_id)
    references public.appointments(barbershop_id, id),
  foreign key (barbershop_id, service_id)
    references public.services(barbershop_id, id)
);
create index procedure_records_client_date_idx
  on public.procedure_records (barbershop_id, client_id, performed_at desc);

create table public.chemical_records (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null,
  client_id uuid not null,
  barber_membership_id uuid not null,
  procedure_record_id uuid,
  product_name text not null check (length(btrim(product_name)) > 0),
  formula text,
  patch_test boolean,
  performed_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (barbershop_id, client_id)
    references public.clients(barbershop_id, id),
  foreign key (barbershop_id, barber_membership_id)
    references public.memberships(barbershop_id, id),
  foreign key (barbershop_id, procedure_record_id)
    references public.procedure_records(barbershop_id, id)
);
create index chemical_records_client_date_idx
  on public.chemical_records (barbershop_id, client_id, performed_at desc);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 160),
  sku text,
  description text,
  category text not null default 'retail'
    check (category in ('retail','bar','kitchen','supply')),
  price_cents integer not null check (price_cents >= 0),
  cost_cents integer not null default 0 check (cost_cents >= 0),
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (barbershop_id, id)
);
create unique index products_shop_sku_uq on public.products (barbershop_id, lower(sku))
  where sku is not null;
create index products_shop_category_idx on public.products (barbershop_id, category, active);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  client_id uuid,
  status text not null default 'open'
    check (status in ('open','delivered','paid','cancelled','refunded')),
  total_cents integer not null default 0 check (total_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (barbershop_id, id),
  foreign key (barbershop_id, client_id)
    references public.clients(barbershop_id, id)
);
create index sales_shop_date_idx on public.sales (barbershop_id, created_at desc);

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null,
  sale_id uuid not null,
  product_id uuid,
  description text not null,
  quantity integer not null check (quantity between 1 and 1000),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  total_cents integer generated always as (quantity * unit_price_cents) stored,
  created_at timestamptz not null default now(),
  foreign key (barbershop_id, sale_id)
    references public.sales(barbershop_id, id) on delete cascade,
  foreign key (barbershop_id, product_id)
    references public.products(barbershop_id, id)
);
create index sale_items_sale_idx on public.sale_items (barbershop_id, sale_id);

create table public.bar_orders (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  client_id uuid,
  appointment_id uuid,
  status text not null default 'open'
    check (status in ('open','preparing','ready','served','closed','cancelled')),
  total_cents integer not null default 0 check (total_cents >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (barbershop_id, id),
  foreign key (barbershop_id, client_id)
    references public.clients(barbershop_id, id),
  foreign key (barbershop_id, appointment_id)
    references public.appointments(barbershop_id, id)
);
create index bar_orders_shop_status_idx on public.bar_orders (barbershop_id, status, created_at);

create table public.bar_order_items (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null,
  bar_order_id uuid not null,
  product_id uuid not null,
  quantity integer not null check (quantity between 1 and 1000),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  total_cents integer generated always as (quantity * unit_price_cents) stored,
  notes text,
  created_at timestamptz not null default now(),
  foreign key (barbershop_id, bar_order_id)
    references public.bar_orders(barbershop_id, id) on delete cascade,
  foreign key (barbershop_id, product_id)
    references public.products(barbershop_id, id)
);
create index bar_order_items_order_idx
  on public.bar_order_items (barbershop_id, bar_order_id);

create table public.subscription_usages (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null,
  subscription_id uuid not null,
  appointment_id uuid not null unique,
  status public.usage_status not null default 'reserved',
  used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (barbershop_id, subscription_id)
    references public.subscriptions(barbershop_id, id),
  foreign key (barbershop_id, appointment_id)
    references public.appointments(barbershop_id, id)
);
create index subscription_usages_subscription_idx
  on public.subscription_usages (barbershop_id, subscription_id, status);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  client_id uuid not null,
  subscription_id uuid,
  appointment_id uuid,
  sale_id uuid,
  provider text not null default 'mercadopago',
  provider_payment_id text,
  amount_cents integer not null check (amount_cents >= 0),
  status text not null default 'pending'
    check (status in ('pending','authorized','approved','paid','rejected','cancelled','refunded','charged_back')),
  method text check (method in ('card','pix','cash','other')),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (barbershop_id, client_id)
    references public.clients(barbershop_id, id),
  foreign key (barbershop_id, subscription_id)
    references public.subscriptions(barbershop_id, id),
  foreign key (barbershop_id, appointment_id)
    references public.appointments(barbershop_id, id),
  foreign key (barbershop_id, sale_id)
    references public.sales(barbershop_id, id)
);
create unique index payments_provider_id_uq
  on public.payments (provider, provider_payment_id)
  where provider_payment_id is not null;
create index payments_client_date_idx
  on public.payments (barbershop_id, client_id, created_at desc);
create index payments_shop_status_date_idx
  on public.payments (barbershop_id, status, created_at desc);
create index payments_paid_shop_date_idx
  on public.payments (barbershop_id, paid_at)
  where status = 'paid';

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  category text not null check (length(btrim(category)) > 0),
  description text not null check (length(btrim(description)) > 0),
  amount_cents integer not null check (amount_cents >= 0),
  occurred_on date not null default current_date,
  recurring boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index expenses_shop_date_idx on public.expenses (barbershop_id, occurred_on desc);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  barber_membership_id uuid,
  title text not null check (length(btrim(title)) > 0),
  metric text not null check (metric in
    ('revenue','appointments','new_clients','client_return_pct','profit_pct')),
  target_value numeric(14,2) not null check (target_value >= 0),
  period_start date not null,
  period_end date not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start),
  foreign key (barbershop_id, barber_membership_id)
    references public.memberships(barbershop_id, id)
);
create index goals_shop_period_idx on public.goals (barbershop_id, period_start, period_end);
create index goals_barber_period_idx
  on public.goals (barbershop_id, barber_membership_id, period_start)
  where barber_membership_id is not null;

create table public.partners (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  kind text,
  contact text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.marketing_guides (
  id uuid primary key default gen_random_uuid(),
  step_number integer not null check (step_number > 0),
  title text not null,
  channel text not null check (channel in ('organic','paid')),
  content text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel, step_number)
);

create table public.marketing_tasks (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  assignee_user_id uuid default auth.uid() references auth.users(id),
  title text not null check (length(btrim(title)) > 0),
  channel text not null check (channel in ('organic','paid')),
  status text not null default 'open' check (status in ('open','doing','done')),
  due_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index marketing_tasks_shop_status_idx
  on public.marketing_tasks (barbershop_id, status, due_on);

create table public.ai_requests (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  requester_user_id uuid not null references auth.users(id),
  request_type text not null check (request_type in
    ('finance','pricing','marketing','instagram','general')),
  prompt text not null check (length(btrim(prompt)) between 3 and 10000),
  response text,
  status text not null default 'pending'
    check (status in ('pending','processing','completed','failed')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ai_requests_shop_date_idx
  on public.ai_requests (barbershop_id, created_at desc);
create index ai_requests_user_date_idx
  on public.ai_requests (requester_user_id, created_at desc);

create table public.bio_links (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  label text not null check (length(btrim(label)) > 0),
  url text not null check (url ~ '^https://'),
  kind text not null default 'custom'
    check (kind in ('products','subscription','whatsapp','booking','custom')),
  position integer not null default 0 check (position >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bio_links_shop_position_idx
  on public.bio_links (barbershop_id, position) where active;

-- Only the server's service_role may access encrypted integration material.
-- Each encrypted token is an AES-GCM envelope (IV, tag, ciphertext), never plaintext.
create table public.integration_credentials (
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  provider text not null check (provider in ('mercadopago','meta')),
  access_token_encrypted text not null,
  refresh_token_encrypted text,
  provider_account_id text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (barbershop_id, provider)
);

-- Publicly safe connection metadata. OAuth tokens remain in integration_credentials.
create table public.social_connections (
  barbershop_id uuid primary key references public.barbershops(id) on delete cascade,
  instagram_user_id text,
  username text,
  ad_account_id text,
  status text not null default 'disconnected'
    check (status in ('disconnected','connected','expired','error')),
  updated_at timestamptz not null default now()
);

-- Central SaaS billing is separate from barbershop customer payments.
create table public.platform_subscriptions (
  barbershop_id uuid primary key references public.barbershops(id) on delete cascade,
  payer_email text,
  provider_subscription_id text unique,
  status text not null default 'pending',
  seat_count integer not null default 0 check (seat_count >= 0),
  unit_price_cents integer not null default 0 check (unit_price_cents >= 0),
  amount_cents integer not null default 0 check (amount_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (amount_cents = seat_count * unit_price_cents)
);

create table public.platform_invoices (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  seat_count integer not null check (seat_count >= 0),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  amount_cents integer not null check (amount_cents >= 0),
  status text not null default 'pending',
  provider_payment_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (barbershop_id, period_start, period_end),
  check (period_end >= period_start),
  check (amount_cents = seat_count * unit_price_cents)
);
create unique index platform_invoices_provider_id_uq
  on public.platform_invoices (provider_payment_id)
  where provider_payment_id is not null;
alter table public.platform_invoices add constraint platform_invoices_no_overlap
  exclude using gist (
    barbershop_id with =,
    daterange(period_start, period_end + 1, '[)') with &&
  );
create index platform_invoices_shop_status_idx
  on public.platform_invoices (barbershop_id, status, period_start desc);

create table public.provider_events (
  provider text not null,
  event_id text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  primary key (provider, event_id)
);

-- Keep Auth email as the source of truth; user metadata is presentation only.
create function app_private.sync_profile_from_auth()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.email is null then
    return new;
  end if;
  insert into public.profiles (user_id, email, full_name)
  values (
    new.id,
    new.email,
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), '')
  )
  on conflict (user_id) do update
    set email = excluded.email,
        updated_at = now();
  return new;
end;
$$;
revoke execute on function app_private.sync_profile_from_auth() from public, anon, authenticated;
create trigger sync_profile_after_auth
  after insert or update of email on auth.users
  for each row execute function app_private.sync_profile_from_auth();
insert into public.profiles (user_id, email, full_name)
select id, email, nullif(btrim(raw_user_meta_data ->> 'full_name'), '')
from auth.users
where email is not null
on conflict (user_id) do update set email = excluded.email;

create function app_private.touch_updated_at()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function app_private.touch_updated_at() from public, anon, authenticated;
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'platform_settings','profiles','barbershops','memberships','module_permissions',
    'clients','services','availability_rules','availability_exceptions',
    'subscription_plans','subscriptions','appointments','procedure_records',
    'chemical_records','products','sales','bar_orders','subscription_usages',
    'payments','expenses','goals','partners','marketing_guides','marketing_tasks',
    'ai_requests','bio_links','integration_credentials','social_connections',
    'platform_subscriptions','platform_invoices'
  ] loop
    execute format(
      'create trigger set_updated_at before update on public.%I for each row execute function app_private.touch_updated_at()',
      table_name
    );
  end loop;
end;
$$;

create function app_private.require_barber_membership()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.memberships m
    where m.id = new.barber_membership_id
      and m.barbershop_id = new.barbershop_id
      and m.role = 'barber'
      and m.active
  ) then
    raise exception 'Barber membership is not active in this barbershop'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function app_private.require_barber_membership()
  from public, anon, authenticated;
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'client_barbers','barber_services','availability_rules',
    'availability_exceptions','appointments','procedure_records','chemical_records'
  ] loop
    execute format(
      'create trigger require_barber before insert or update of barber_membership_id, barbershop_id on public.%I for each row execute function app_private.require_barber_membership()',
      table_name
    );
  end loop;
end;
$$;

-- Private, fixed-purpose authorization helpers. Every decision uses auth.uid().
create function app_private.is_platform_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1 from public.platform_admins p
      where p.user_id = (select auth.uid())
    );
$$;

create function app_private.has_shop_role(
  p_barbershop_id uuid, p_roles public.shop_role[]
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null
    and (
      app_private.is_platform_admin()
      or exists (
        select 1 from public.memberships m
        where m.barbershop_id = p_barbershop_id
          and m.user_id = (select auth.uid())
          and m.active
          and m.role = any(p_roles)
      )
    );
$$;

create function app_private.has_module(p_barbershop_id uuid, p_module text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null
    and (
      app_private.is_platform_admin()
      or exists (
        select 1 from public.memberships m
        where m.barbershop_id = p_barbershop_id
          and m.user_id = (select auth.uid())
          and m.active
          and (
            m.role = 'admin'
            or (
              m.role = 'barber'
              and exists (
                select 1 from public.module_permissions mp
                where mp.barbershop_id = m.barbershop_id
                  and mp.user_id = m.user_id
                  and mp.module = p_module
                  and mp.allowed
              )
            )
          )
      )
    );
$$;

create function app_private.is_own_barber(
  p_barbershop_id uuid, p_barber_membership_id uuid
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1 from public.memberships m
      where m.barbershop_id = p_barbershop_id
        and m.id = p_barber_membership_id
        and m.user_id = (select auth.uid())
        and m.role = 'barber'
        and m.active
    );
$$;

create function app_private.is_own_client(p_barbershop_id uuid, p_client_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1 from public.clients c
      where c.barbershop_id = p_barbershop_id
        and c.id = p_client_id
        and c.user_id = (select auth.uid())
    );
$$;

create function app_private.is_assigned_client(
  p_barbershop_id uuid, p_client_id uuid
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.client_barbers cb
      join public.memberships m
        on m.barbershop_id = cb.barbershop_id
       and m.id = cb.barber_membership_id
      where cb.barbershop_id = p_barbershop_id
        and cb.client_id = p_client_id
        and m.user_id = (select auth.uid())
        and m.role = 'barber'
        and m.active
    );
$$;

create function app_private.can_read_client(
  p_barbershop_id uuid, p_client_id uuid, p_module text default 'clients'
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select app_private.is_own_client(p_barbershop_id, p_client_id)
    or app_private.has_shop_role(p_barbershop_id, array['admin']::public.shop_role[])
    or (
      app_private.has_module(p_barbershop_id, p_module)
      and app_private.is_assigned_client(p_barbershop_id, p_client_id)
    );
$$;

create function app_private.can_manage_client(
  p_barbershop_id uuid, p_client_id uuid, p_module text default 'clients'
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select app_private.has_shop_role(p_barbershop_id, array['admin']::public.shop_role[])
    or (
      app_private.has_module(p_barbershop_id, p_module)
      and app_private.is_assigned_client(p_barbershop_id, p_client_id)
    );
$$;

create function app_private.can_read_appointment(
  p_barbershop_id uuid, p_appointment_id uuid
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.appointments a
    where a.barbershop_id = p_barbershop_id
      and a.id = p_appointment_id
      and (
        app_private.is_own_client(a.barbershop_id, a.client_id)
        or app_private.has_shop_role(a.barbershop_id, array['admin']::public.shop_role[])
        or (
          app_private.has_module(a.barbershop_id, 'appointments')
          and app_private.is_own_barber(a.barbershop_id, a.barber_membership_id)
        )
      )
  );
$$;

create function app_private.can_see_profile(p_user_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_user_id = (select auth.uid())
    or app_private.is_platform_admin()
    or exists (
      select 1 from public.memberships m
      where m.user_id = p_user_id
        and app_private.has_shop_role(
          m.barbershop_id, array['admin']::public.shop_role[]
        )
    );
$$;

create function app_private.public_barber_service_visible(
  p_barbershop_id uuid, p_barber_membership_id uuid, p_service_id uuid
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.barber_services bs
    join public.barbershops sh on sh.id = bs.barbershop_id
    join public.memberships m
      on m.barbershop_id = bs.barbershop_id
     and m.id = bs.barber_membership_id
    join public.services sv
      on sv.barbershop_id = bs.barbershop_id
     and sv.id = bs.service_id
    where bs.barbershop_id = p_barbershop_id
      and bs.barber_membership_id = p_barber_membership_id
      and bs.service_id = p_service_id
      and bs.active and sh.active and m.active and sv.active
      and m.role = 'barber'
  );
$$;
revoke execute on function app_private.public_barber_service_visible(uuid,uuid,uuid)
  from public, anon, authenticated;
grant usage on schema app_private to anon;
grant execute on function app_private.public_barber_service_visible(uuid,uuid,uuid)
  to anon, authenticated;

do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure::text as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app_private'
      and p.proname in (
        'is_platform_admin','has_shop_role','has_module','is_own_barber',
        'is_own_client','is_assigned_client','can_read_client',
        'can_manage_client','can_read_appointment','can_see_profile'
      )
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn.signature);
    execute format('grant execute on function %s to authenticated', fn.signature);
  end loop;
end;
$$;

create function public.is_platform_admin()
returns boolean
language sql stable security invoker set search_path = ''
as $$ select app_private.is_platform_admin(); $$;
revoke execute on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated;

-- Explicit RLS and least-privilege API grants. service_role retains its bypass.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'platform_admins','platform_settings','profiles','barbershops',
    'memberships','module_permissions','clients','client_barbers','services',
    'barber_services','availability_rules','availability_exceptions',
    'subscription_plans','subscription_plan_services','subscriptions',
    'appointments','appointment_services','procedure_records','chemical_records',
    'products','sales','sale_items','bar_orders','bar_order_items',
    'subscription_usages','payments','expenses','goals','partners',
    'marketing_guides','marketing_tasks','ai_requests','bio_links',
    'integration_credentials','social_connections','platform_subscriptions',
    'platform_invoices','provider_events'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from anon, authenticated', table_name);
    execute format('grant all on public.%I to service_role', table_name);
  end loop;
end;
$$;

grant select on public.profiles, public.memberships,
  public.module_permissions, public.clients, public.client_barbers,
  public.barber_services, public.availability_rules,
  public.availability_exceptions, public.subscription_plans,
  public.subscription_plan_services, public.subscriptions,
  public.appointments, public.appointment_services,
  public.procedure_records, public.chemical_records, public.products,
  public.sales, public.sale_items, public.bar_orders, public.bar_order_items,
  public.subscription_usages, public.payments, public.expenses, public.goals,
  public.partners, public.marketing_guides, public.marketing_tasks,
  public.ai_requests, public.bio_links, public.social_connections
to authenticated;
grant select on public.barber_services,
  public.subscription_plans, public.subscription_plan_services,
  public.bio_links
to anon;

-- Public catalog fields are granted by column. Shop operating costs and
-- service costs must not leak through SELECT * to anonymous customers.
grant select (
  id, name, slug, timezone, phone, whatsapp, instagram_url, address,
  bio_title, bio_description, logo_url, active, created_at, updated_at
) on public.barbershops to anon, authenticated;
grant select (
  id, barbershop_id, name, description, duration_minutes, price_cents,
  active, created_at, updated_at
) on public.services to anon, authenticated;

grant update (full_name) on public.profiles to authenticated;
grant update (
  name, timezone, phone, whatsapp, instagram_url, pix_key, address,
  bio_title, bio_description, logo_url,
  structure_monthly_cost_cents, target_profit_pct
) on public.barbershops to authenticated;
grant insert on public.clients to authenticated;
grant update (full_name, email, phone, notes) on public.clients to authenticated;
grant delete on public.clients to authenticated;
grant insert, delete on public.client_barbers to authenticated;
grant insert, update, delete on public.services, public.barber_services,
  public.availability_rules, public.availability_exceptions,
  public.subscription_plans, public.subscription_plan_services,
  public.procedure_records, public.chemical_records, public.products,
  public.sales, public.sale_items, public.bar_orders, public.bar_order_items,
  public.expenses, public.goals, public.partners, public.marketing_tasks,
  public.bio_links
to authenticated;
grant update (status, notes) on public.appointments to authenticated;
grant update (status) on public.sales to authenticated;
grant insert on public.ai_requests to authenticated;

-- Admins are scoped to their shop; the separately protected platform role
-- is deliberately recognized by the helper for global administration.
create policy barbershops_public_read on public.barbershops
  for select to anon using (active);
create policy barbershops_authenticated_read on public.barbershops
  for select to authenticated using (
    active or app_private.has_shop_role(id, array['admin','barber']::public.shop_role[])
  );
create policy barbershops_admin_update on public.barbershops
  for update to authenticated
  using (app_private.has_shop_role(id, array['admin']::public.shop_role[]))
  with check (app_private.has_shop_role(id, array['admin']::public.shop_role[]));

-- Explicitly privileged reads for the finance and service cost editors.
-- The main catalog has only public columns; these RPCs guard private costs.
create function public.shop_financial_settings(p_barbershop_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_settings jsonb;
begin
  if not app_private.has_shop_role(
    p_barbershop_id, array['admin']::public.shop_role[]
  ) then
    raise exception 'Finance settings access denied' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'structure_monthly_cost_cents', s.structure_monthly_cost_cents,
    'target_profit_pct', s.target_profit_pct,
    'pix_key', s.pix_key
  ) into v_settings
  from public.barbershops s
  where s.id = p_barbershop_id;
  if v_settings is null then
    raise exception 'Barbershop not found' using errcode = 'P0002';
  end if;
  return v_settings;
end;
$$;
revoke execute on function public.shop_financial_settings(uuid)
  from public, anon, authenticated;
grant execute on function public.shop_financial_settings(uuid)
  to authenticated;

create function public.service_costs(p_barbershop_id uuid)
returns table(service_id uuid, cost_cents integer)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not app_private.has_shop_role(
    p_barbershop_id, array['admin']::public.shop_role[]
  ) then
    raise exception 'Service costs access denied' using errcode = '42501';
  end if;
  return query
    select s.id, s.cost_cents from public.services s
    where s.barbershop_id = p_barbershop_id;
end;
$$;
revoke execute on function public.service_costs(uuid)
  from public, anon, authenticated;
grant execute on function public.service_costs(uuid)
  to authenticated;

create policy profiles_visible on public.profiles
  for select to authenticated using (app_private.can_see_profile(user_id));
create policy profiles_self_update on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'memberships','module_permissions','clients','client_barbers','services',
    'barber_services','availability_rules','availability_exceptions',
    'subscription_plans','subscription_plan_services','subscriptions',
    'appointments','appointment_services','procedure_records','chemical_records',
    'products','sales','sale_items','bar_orders','bar_order_items',
    'subscription_usages','payments','expenses','goals','partners',
    'marketing_tasks','bio_links','social_connections'
  ] loop
    execute format(
      'create policy %I on public.%I for all to authenticated using (app_private.has_shop_role(barbershop_id, array[''admin'']::public.shop_role[])) with check (app_private.has_shop_role(barbershop_id, array[''admin'']::public.shop_role[]))',
      table_name || '_tenant_admin', table_name
    );
  end loop;
end;
$$;

create policy memberships_self_read on public.memberships
  for select to authenticated using (user_id = (select auth.uid()));
create policy module_permissions_self_read on public.module_permissions
  for select to authenticated using (user_id = (select auth.uid()));

create policy clients_self_read on public.clients
  for select to authenticated using (user_id = (select auth.uid()));
create policy clients_barber_read on public.clients
  for select to authenticated using (
    app_private.has_module(barbershop_id, 'clients')
    and app_private.is_assigned_client(barbershop_id, id)
  );
create policy clients_self_insert on public.clients
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and notes is null
    and exists (
      select 1 from public.barbershops s
      where s.id = barbershop_id and s.active
    )
  );
create policy clients_barber_insert on public.clients
  for insert to authenticated with check (
    user_id is null
    and app_private.has_shop_role(barbershop_id, array['barber']::public.shop_role[])
    and app_private.has_module(barbershop_id, 'clients')
  );
create policy clients_barber_update on public.clients
  for update to authenticated
  using (
    app_private.has_module(barbershop_id, 'clients')
    and app_private.is_assigned_client(barbershop_id, id)
  )
  with check (
    app_private.has_module(barbershop_id, 'clients')
    and app_private.is_assigned_client(barbershop_id, id)
  );

create policy client_barbers_barber_read on public.client_barbers
  for select to authenticated using (
    app_private.has_module(barbershop_id, 'clients')
    and app_private.is_own_barber(barbershop_id, barber_membership_id)
  );
create policy client_barbers_client_read on public.client_barbers
  for select to authenticated using (
    app_private.is_own_client(barbershop_id, client_id)
  );

create function app_private.auto_assign_creator_barber()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_membership_id uuid;
begin
  if new.user_id is null and (select auth.uid()) is not null then
    select id into v_membership_id
    from public.memberships
    where barbershop_id = new.barbershop_id
      and user_id = (select auth.uid())
      and role = 'barber' and active;
    if v_membership_id is not null then
      insert into public.client_barbers (
        barbershop_id, client_id, barber_membership_id
      ) values (new.barbershop_id, new.id, v_membership_id);
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function app_private.auto_assign_creator_barber()
  from public, anon, authenticated;
create trigger auto_assign_creator_barber
  after insert on public.clients
  for each row execute function app_private.auto_assign_creator_barber();

create policy services_public_read on public.services
  for select to anon using (
    active and exists (
      select 1 from public.barbershops s
      where s.id = barbershop_id and s.active
    )
  );
create policy services_authenticated_read on public.services
  for select to authenticated using (
    active and exists (
      select 1 from public.barbershops s
      where s.id = barbershop_id and s.active
    )
  );
create policy barber_services_public_read on public.barber_services
  for select to anon using (
    app_private.public_barber_service_visible(
      barbershop_id, barber_membership_id, service_id
    )
  );
create policy barber_services_authenticated_read on public.barber_services
  for select to authenticated using (
    app_private.public_barber_service_visible(
      barbershop_id, barber_membership_id, service_id
    )
  );

create policy availability_rules_barber on public.availability_rules
  for all to authenticated
  using (
    app_private.has_module(barbershop_id, 'availability')
    and app_private.is_own_barber(barbershop_id, barber_membership_id)
  )
  with check (
    app_private.has_module(barbershop_id, 'availability')
    and app_private.is_own_barber(barbershop_id, barber_membership_id)
  );
create policy availability_exceptions_barber on public.availability_exceptions
  for all to authenticated
  using (
    app_private.has_module(barbershop_id, 'availability')
    and app_private.is_own_barber(barbershop_id, barber_membership_id)
  )
  with check (
    app_private.has_module(barbershop_id, 'availability')
    and app_private.is_own_barber(barbershop_id, barber_membership_id)
  );

create policy subscription_plans_public_read on public.subscription_plans
  for select to anon using (
    active and exists (
      select 1 from public.barbershops s
      where s.id = barbershop_id and s.active
    )
  );
create policy subscription_plans_authenticated_read on public.subscription_plans
  for select to authenticated using (
    active and exists (
      select 1 from public.barbershops s
      where s.id = barbershop_id and s.active
    )
  );
create policy subscription_plan_services_public_read
  on public.subscription_plan_services
  for select to anon using (
    exists (
      select 1 from public.subscription_plans p
      where p.barbershop_id = subscription_plan_services.barbershop_id
        and p.id = plan_id and p.active
    )
    and exists (
      select 1 from public.services s
      where s.barbershop_id = subscription_plan_services.barbershop_id
        and s.id = service_id and s.active
    )
  );
create policy subscription_plan_services_authenticated_read
  on public.subscription_plan_services
  for select to authenticated using (
    exists (
      select 1 from public.subscription_plans p
      where p.barbershop_id = subscription_plan_services.barbershop_id
        and p.id = plan_id and p.active
    )
    and exists (
      select 1 from public.services s
      where s.barbershop_id = subscription_plan_services.barbershop_id
        and s.id = service_id and s.active
    )
  );
create policy subscriptions_client_read on public.subscriptions
  for select to authenticated using (
    app_private.is_own_client(barbershop_id, client_id)
  );
create policy subscriptions_barber_read on public.subscriptions
  for select to authenticated using (
    app_private.has_module(barbershop_id, 'subscriptions')
    and app_private.is_assigned_client(barbershop_id, client_id)
  );
create policy subscription_usages_client_read on public.subscription_usages
  for select to authenticated using (
    exists (
      select 1 from public.subscriptions s
      where s.barbershop_id = subscription_usages.barbershop_id
        and s.id = subscription_id
        and app_private.is_own_client(s.barbershop_id, s.client_id)
    )
  );
create policy subscription_usages_barber_read on public.subscription_usages
  for select to authenticated using (
    app_private.has_module(barbershop_id, 'subscriptions')
    and exists (
      select 1 from public.subscriptions s
      where s.barbershop_id = subscription_usages.barbershop_id
        and s.id = subscription_id
        and app_private.is_assigned_client(s.barbershop_id, s.client_id)
    )
  );

create policy appointments_client_read on public.appointments
  for select to authenticated using (
    app_private.is_own_client(barbershop_id, client_id)
  );
create policy appointments_barber_read on public.appointments
  for select to authenticated using (
    app_private.has_module(barbershop_id, 'appointments')
    and app_private.is_own_barber(barbershop_id, barber_membership_id)
  );
create policy appointments_barber_update on public.appointments
  for update to authenticated
  using (
    app_private.has_module(barbershop_id, 'appointments')
    and app_private.is_own_barber(barbershop_id, barber_membership_id)
  )
  with check (
    app_private.has_module(barbershop_id, 'appointments')
    and app_private.is_own_barber(barbershop_id, barber_membership_id)
  );
create policy appointment_services_visible on public.appointment_services
  for select to authenticated using (
    app_private.can_read_appointment(barbershop_id, appointment_id)
  );

create policy procedure_records_client_read on public.procedure_records
  for select to authenticated using (
    app_private.is_own_client(barbershop_id, client_id)
  );
create policy procedure_records_barber_read on public.procedure_records
  for select to authenticated using (
    app_private.has_module(barbershop_id, 'procedures')
    and app_private.is_assigned_client(barbershop_id, client_id)
  );
create policy procedure_records_barber_write on public.procedure_records
  for all to authenticated
  using (
    app_private.has_module(barbershop_id, 'procedures')
    and app_private.is_assigned_client(barbershop_id, client_id)
    and app_private.is_own_barber(barbershop_id, barber_membership_id)
  )
  with check (
    app_private.has_module(barbershop_id, 'procedures')
    and app_private.is_assigned_client(barbershop_id, client_id)
    and app_private.is_own_barber(barbershop_id, barber_membership_id)
  );
create policy chemical_records_client_read on public.chemical_records
  for select to authenticated using (
    app_private.is_own_client(barbershop_id, client_id)
  );
create policy chemical_records_barber_read on public.chemical_records
  for select to authenticated using (
    app_private.has_module(barbershop_id, 'procedures')
    and app_private.is_assigned_client(barbershop_id, client_id)
  );
create policy chemical_records_barber_write on public.chemical_records
  for all to authenticated
  using (
    app_private.has_module(barbershop_id, 'procedures')
    and app_private.is_assigned_client(barbershop_id, client_id)
    and app_private.is_own_barber(barbershop_id, barber_membership_id)
  )
  with check (
    app_private.has_module(barbershop_id, 'procedures')
    and app_private.is_assigned_client(barbershop_id, client_id)
    and app_private.is_own_barber(barbershop_id, barber_membership_id)
  );

create policy products_staff_read on public.products
  for select to authenticated using (
    app_private.has_module(barbershop_id, 'products')
    or app_private.has_module(barbershop_id, 'bar')
  );
create policy sales_staff_read on public.sales
  for select to authenticated using (
    (
      app_private.has_module(barbershop_id, 'products')
      or app_private.has_module(barbershop_id, 'bar')
    )
    and (
      client_id is null
      or app_private.is_assigned_client(barbershop_id, client_id)
    )
  );
create policy sale_items_staff_read on public.sale_items
  for select to authenticated using (
    (
      app_private.has_module(barbershop_id, 'products')
      or app_private.has_module(barbershop_id, 'bar')
    )
    and exists (
      select 1 from public.sales s
      where s.barbershop_id = sale_items.barbershop_id
        and s.id = sale_id
        and (
          s.client_id is null
          or app_private.is_assigned_client(s.barbershop_id, s.client_id)
        )
    )
  );
create policy sales_staff_deliver on public.sales
  for update to authenticated
  using (
    status = 'open'
    and app_private.has_module(barbershop_id, 'bar')
    and (
      client_id is null
      or app_private.is_assigned_client(barbershop_id, client_id)
    )
  )
  with check (
    status = 'delivered'
    and app_private.has_module(barbershop_id, 'bar')
    and (
      client_id is null
      or app_private.is_assigned_client(barbershop_id, client_id)
    )
  );
create policy bar_orders_staff on public.bar_orders
  for all to authenticated
  using (
    app_private.has_module(barbershop_id, 'bar')
    and (
      client_id is null
      or app_private.is_assigned_client(barbershop_id, client_id)
    )
  )
  with check (
    app_private.has_module(barbershop_id, 'bar')
    and (
      client_id is null
      or app_private.is_assigned_client(barbershop_id, client_id)
    )
  );
create policy bar_order_items_staff on public.bar_order_items
  for all to authenticated
  using (
    exists (
      select 1 from public.bar_orders o
      where o.barbershop_id = bar_order_items.barbershop_id
        and o.id = bar_order_id
        and app_private.has_module(o.barbershop_id, 'bar')
        and (
          o.client_id is null
          or app_private.is_assigned_client(o.barbershop_id, o.client_id)
        )
    )
  )
  with check (
    exists (
      select 1 from public.bar_orders o
      where o.barbershop_id = bar_order_items.barbershop_id
        and o.id = bar_order_id
        and app_private.has_module(o.barbershop_id, 'bar')
        and (
          o.client_id is null
          or app_private.is_assigned_client(o.barbershop_id, o.client_id)
        )
    )
  );

create policy payments_client_read on public.payments
  for select to authenticated using (
    app_private.is_own_client(barbershop_id, client_id)
  );
create policy payments_barber_own_appointment_read on public.payments
  for select to authenticated using (
    app_private.has_module(barbershop_id, 'reports')
    and appointment_id is not null
    and exists (
      select 1 from public.appointments a
      where a.barbershop_id = payments.barbershop_id
        and a.id = appointment_id
        and app_private.is_own_barber(a.barbershop_id, a.barber_membership_id)
    )
  );

create policy goals_barber_read on public.goals
  for select to authenticated using (
    app_private.has_module(barbershop_id, 'goals')
    and (
      barber_membership_id is null
      or app_private.is_own_barber(barbershop_id, barber_membership_id)
    )
  );
create policy goals_barber_insert on public.goals
  for insert to authenticated with check (
    barber_membership_id is not null
    and app_private.has_module(barbershop_id, 'goals')
    and app_private.is_own_barber(barbershop_id, barber_membership_id)
    and created_by = (select auth.uid())
  );
create policy goals_barber_update on public.goals
  for update to authenticated
  using (
    barber_membership_id is not null
    and app_private.has_module(barbershop_id, 'goals')
    and app_private.is_own_barber(barbershop_id, barber_membership_id)
    and created_by = (select auth.uid())
  )
  with check (
    barber_membership_id is not null
    and app_private.has_module(barbershop_id, 'goals')
    and app_private.is_own_barber(barbershop_id, barber_membership_id)
    and created_by = (select auth.uid())
  );
create policy partners_staff_read on public.partners
  for select to authenticated using (
    app_private.has_module(barbershop_id, 'partners')
  );
create policy marketing_guides_read on public.marketing_guides
  for select to authenticated using (active);
create policy marketing_tasks_staff on public.marketing_tasks
  for all to authenticated
  using (
    app_private.has_module(barbershop_id, 'marketing')
    and (assignee_user_id is null or assignee_user_id = (select auth.uid()))
  )
  with check (
    app_private.has_module(barbershop_id, 'marketing')
    and assignee_user_id = (select auth.uid())
  );

create policy ai_requests_admin_read on public.ai_requests
  for select to authenticated using (
    app_private.has_shop_role(barbershop_id, array['admin']::public.shop_role[])
  );
create policy ai_requests_self_read on public.ai_requests
  for select to authenticated using (
    requester_user_id = (select auth.uid())
    and app_private.has_module(barbershop_id, 'ai')
  );
create policy ai_requests_submit on public.ai_requests
  for insert to authenticated with check (
    requester_user_id = (select auth.uid())
    and app_private.has_module(barbershop_id, 'ai')
    and status = 'pending' and response is null and error_message is null
    and (
      request_type not in ('finance','pricing')
      or app_private.has_shop_role(barbershop_id, array['admin']::public.shop_role[])
    )
  );

create policy bio_links_public_read on public.bio_links
  for select to anon using (
    active and exists (
      select 1 from public.barbershops s
      where s.id = barbershop_id and s.active
    )
  );
create policy bio_links_authenticated_read on public.bio_links
  for select to authenticated using (
    active and exists (
      select 1 from public.barbershops s
      where s.id = barbershop_id and s.active
    )
  );
create policy social_connections_staff_read on public.social_connections
  for select to authenticated using (
    app_private.has_module(barbershop_id, 'marketing')
  );

-- Public slot discovery reads only safe schedule facts and returns no client data.
create function app_private.available_slots(
  p_barbershop_id uuid,
  p_barber_membership_id uuid,
  p_service_ids uuid[],
  p_day date
)
returns table (starts_at timestamptz, ends_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_timezone text;
  v_service_count integer;
  v_duration_minutes integer;
  v_window record;
  v_window_start timestamptz;
  v_last_start timestamptz;
  v_slot timestamptz;
begin
  if p_day is null or coalesce(cardinality(p_service_ids), 0) not between 1 and 8
     or array_position(p_service_ids, null) is not null then
    return;
  end if;

  select sh.timezone into v_timezone
  from public.barbershops sh
  where sh.id = p_barbershop_id and sh.active;
  if not found then
    return;
  end if;

  select count(*), sum(s.duration_minutes)::integer
  into v_service_count, v_duration_minutes
  from public.services s
  where s.barbershop_id = p_barbershop_id
    and s.id = any(p_service_ids)
    and app_private.public_barber_service_visible(
      p_barbershop_id, p_barber_membership_id, s.id
    );
  if v_service_count <> cardinality(p_service_ids) then
    return;
  end if;

  for v_window in
    select w.start_time, w.end_time
    from (
      select e.start_time, e.end_time
      from public.availability_exceptions e
      where e.barbershop_id = p_barbershop_id
        and e.barber_membership_id = p_barber_membership_id
        and e.day = p_day
        and not e.unavailable
      union all
      select r.start_time, r.end_time
      from public.availability_rules r
      where r.barbershop_id = p_barbershop_id
        and r.barber_membership_id = p_barber_membership_id
        and r.weekday = extract(dow from p_day)::smallint
        and r.active
        and not exists (
          select 1 from public.availability_exceptions e
          where e.barbershop_id = p_barbershop_id
            and e.barber_membership_id = p_barber_membership_id
            and e.day = p_day
        )
    ) w
    order by w.start_time
  loop
    v_window_start := (p_day + v_window.start_time) at time zone v_timezone;
    v_last_start :=
      (p_day + v_window.end_time) at time zone v_timezone
      - make_interval(mins => v_duration_minutes);
    for v_slot in
      select generate_series(v_window_start, v_last_start, interval '15 minutes')
    loop
      if v_slot >= now()
         and not exists (
           select 1 from public.appointments a
           where a.barbershop_id = p_barbershop_id
             and a.barber_membership_id = p_barber_membership_id
             and a.status in ('pending','confirmed','in_progress')
             and tstzrange(a.starts_at, a.ends_at, '[)')
               && tstzrange(
                 v_slot,
                 v_slot + make_interval(mins => v_duration_minutes),
                 '[)'
               )
         ) then
        starts_at := v_slot;
        ends_at := v_slot + make_interval(mins => v_duration_minutes);
        return next;
      end if;
    end loop;
  end loop;
end;
$$;
revoke execute on function app_private.available_slots(uuid,uuid,uuid[],date)
  from public, anon, authenticated;
grant execute on function app_private.available_slots(uuid,uuid,uuid[],date)
  to anon, authenticated;

create function public.available_slots(
  p_barbershop_id uuid,
  p_barber_membership_id uuid,
  p_service_ids uuid[],
  p_day date
)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql stable security invoker set search_path = ''
as $$
  select s.starts_at, s.ends_at
  from app_private.available_slots(
    p_barbershop_id, p_barber_membership_id, p_service_ids, p_day
  ) s
  order by s.starts_at;
$$;
revoke execute on function public.available_slots(uuid,uuid,uuid[],date)
  from public, anon, authenticated;
grant execute on function public.available_slots(uuid,uuid,uuid[],date)
  to anon, authenticated;

create function app_private.public_barbers(p_barbershop_id uuid)
returns table (id uuid, display_name text)
language sql stable security definer set search_path = ''
as $$
  select m.id, coalesce(nullif(btrim(m.display_name), ''), pr.full_name, 'Barbeiro')
  from public.memberships m
  join public.barbershops sh on sh.id = m.barbershop_id
  left join public.profiles pr on pr.user_id = m.user_id
  where m.barbershop_id = p_barbershop_id
    and m.role = 'barber' and m.active and sh.active
  order by 2, 1;
$$;
revoke execute on function app_private.public_barbers(uuid)
  from public, anon, authenticated;
grant execute on function app_private.public_barbers(uuid)
  to anon, authenticated;
create function public.public_barbers(p_barbershop_id uuid)
returns table (id uuid, display_name text)
language sql stable security invoker set search_path = ''
as $$
  select b.id, b.display_name
  from app_private.public_barbers(p_barbershop_id) b;
$$;
revoke execute on function public.public_barbers(uuid)
  from public, anon, authenticated;
grant execute on function public.public_barbers(uuid)
  to anon, authenticated;

-- Appointment creation, subscription allocation, and client assignment are
-- one database transaction. A barber row lock plus exclusion constraint stops
-- double booking even when two clients submit the same slot concurrently.
create function app_private.book_appointment(
  p_barbershop_id uuid,
  p_client_id uuid,
  p_barber_membership_id uuid,
  p_service_ids uuid[],
  p_starts_at timestamptz,
  p_subscription_id uuid default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_timezone text;
  v_day date;
  v_duration_minutes integer;
  v_price_cents integer;
  v_appointment_id uuid;
  v_source text;
  v_plan_id uuid;
  v_visits_per_cycle integer;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_used integer;
  v_allowed_services integer;
begin
  if v_user_id is null then
    raise exception 'Sign in to book an appointment' using errcode = '42501';
  end if;

  select sh.timezone into v_timezone
  from public.barbershops sh
  where sh.id = p_barbershop_id and sh.active;
  if not found then
    raise exception 'Barbershop is unavailable' using errcode = '22023';
  end if;

  -- Serializes requests for this barber; the exclusion constraint is a second guard.
  perform 1 from public.memberships m
  where m.barbershop_id = p_barbershop_id
    and m.id = p_barber_membership_id
    and m.role = 'barber' and m.active
  for update;
  if not found then
    raise exception 'Barber is unavailable' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.clients c
    where c.barbershop_id = p_barbershop_id and c.id = p_client_id
  ) then
    raise exception 'Client does not belong to this barbershop'
      using errcode = '22023';
  end if;

  if app_private.is_own_client(p_barbershop_id, p_client_id) then
    v_source := 'client';
  elsif app_private.has_shop_role(
    p_barbershop_id, array['admin']::public.shop_role[]
  ) then
    v_source := 'admin';
  elsif app_private.is_own_barber(p_barbershop_id, p_barber_membership_id)
    and app_private.is_assigned_client(p_barbershop_id, p_client_id)
    and app_private.has_module(p_barbershop_id, 'appointments') then
    v_source := 'barber';
  else
    raise exception 'Booking is not permitted for this client'
      using errcode = '42501';
  end if;

  v_day := (p_starts_at at time zone v_timezone)::date;
  if not exists (
    select 1 from app_private.available_slots(
      p_barbershop_id, p_barber_membership_id, p_service_ids, v_day
    ) slot
    where slot.starts_at = p_starts_at
  ) then
    raise exception 'Requested slot is unavailable' using errcode = '22023';
  end if;

  select sum(s.duration_minutes)::integer, sum(s.price_cents)::integer
  into v_duration_minutes, v_price_cents
  from public.services s
  where s.barbershop_id = p_barbershop_id
    and s.id = any(p_service_ids);

  if p_subscription_id is not null then
    select s.plan_id, p.visits_per_cycle,
           s.current_period_start, s.current_period_end
    into v_plan_id, v_visits_per_cycle, v_period_start, v_period_end
    from public.subscriptions s
    join public.subscription_plans p
      on p.barbershop_id = s.barbershop_id and p.id = s.plan_id
    where s.barbershop_id = p_barbershop_id
      and s.id = p_subscription_id
      and s.client_id = p_client_id
      and s.status = 'active'
      and p_starts_at >= s.current_period_start
      and p_starts_at < s.current_period_end
    for update of s;
    if not found then
      raise exception 'Subscription is not active for this appointment'
        using errcode = '22023';
    end if;

    select count(*) into v_allowed_services
    from public.subscription_plan_services ps
    where ps.barbershop_id = p_barbershop_id
      and ps.plan_id = v_plan_id
      and ps.service_id = any(p_service_ids);
    if v_allowed_services <> cardinality(p_service_ids) then
      raise exception 'Service is not included in the subscription'
        using errcode = '22023';
    end if;

    select count(*) into v_used
    from public.subscription_usages u
    join public.appointments a
      on a.barbershop_id = u.barbershop_id and a.id = u.appointment_id
    where u.barbershop_id = p_barbershop_id
      and u.subscription_id = p_subscription_id
      and u.status in ('reserved','used')
      and a.starts_at >= v_period_start
      and a.starts_at < v_period_end;
    if v_used >= v_visits_per_cycle then
      raise exception 'Subscription has no visits remaining'
        using errcode = '22023';
    end if;
  end if;

  insert into public.appointments (
    barbershop_id, client_id, barber_membership_id, subscription_id,
    starts_at, ends_at, status, source, total_price_cents
  ) values (
    p_barbershop_id, p_client_id, p_barber_membership_id, p_subscription_id,
    p_starts_at, p_starts_at + make_interval(mins => v_duration_minutes),
    'confirmed', v_source,
    case when p_subscription_id is null then v_price_cents else 0 end
  )
  returning id into v_appointment_id;

  insert into public.appointment_services (
    barbershop_id, appointment_id, service_id, price_cents, duration_minutes
  )
  select p_barbershop_id, v_appointment_id, s.id, s.price_cents, s.duration_minutes
  from public.services s
  where s.barbershop_id = p_barbershop_id and s.id = any(p_service_ids);

  insert into public.client_barbers (
    barbershop_id, client_id, barber_membership_id
  ) values (
    p_barbershop_id, p_client_id, p_barber_membership_id
  ) on conflict do nothing;

  if p_subscription_id is not null then
    insert into public.subscription_usages (
      barbershop_id, subscription_id, appointment_id, status
    ) values (
      p_barbershop_id, p_subscription_id, v_appointment_id, 'reserved'
    );
  end if;
  return v_appointment_id;
end;
$$;
revoke execute on function app_private.book_appointment(uuid,uuid,uuid,uuid[],timestamptz,uuid)
  from public, anon, authenticated;
grant execute on function app_private.book_appointment(uuid,uuid,uuid,uuid[],timestamptz,uuid)
  to authenticated;

create function public.book_appointment(
  p_barbershop_id uuid,
  p_client_id uuid,
  p_barber_membership_id uuid,
  p_service_ids uuid[],
  p_starts_at timestamptz,
  p_subscription_id uuid default null
)
returns uuid
language sql volatile security invoker set search_path = ''
as $$
  select app_private.book_appointment(
    p_barbershop_id, p_client_id, p_barber_membership_id, p_service_ids,
    p_starts_at, p_subscription_id
  );
$$;
revoke execute on function public.book_appointment(uuid,uuid,uuid,uuid[],timestamptz,uuid)
  from public, anon, authenticated;
grant execute on function public.book_appointment(uuid,uuid,uuid,uuid[],timestamptz,uuid)
  to authenticated;

create function app_private.sync_subscription_usage()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.subscription_id is not null and new.status is distinct from old.status then
    if new.status = 'completed' then
      update public.subscription_usages
      set status = 'used', used_at = now()
      where appointment_id = new.id and status = 'reserved';
    elsif new.status in ('cancelled','no_show') then
      update public.subscription_usages
      set status = 'released'
      where appointment_id = new.id and status = 'reserved';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function app_private.sync_subscription_usage()
  from public, anon, authenticated;
create trigger sync_subscription_usage_after_status
  after update of status on public.appointments
  for each row execute function app_private.sync_subscription_usage();

-- Product sales reserve inventory and snapshot prices atomically.
revoke insert, delete on public.sales, public.sale_items from authenticated;
revoke update on public.sales from authenticated;
grant update (status) on public.sales to authenticated;
revoke update on public.sale_items from authenticated;
create function app_private.create_sale(
  p_barbershop_id uuid,
  p_client_id uuid,
  p_items jsonb
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_sale_id uuid;
  v_item record;
  v_product record;
  v_item_count integer;
  v_distinct_count integer;
  v_total bigint := 0;
begin
  if (select auth.uid()) is null
     or not (
       app_private.has_module(p_barbershop_id, 'products')
       or app_private.has_module(p_barbershop_id, 'bar')
     ) then
    raise exception 'Sale is not permitted' using errcode = '42501';
  end if;
  if p_client_id is not null
     and not (
       app_private.has_shop_role(
         p_barbershop_id, array['admin']::public.shop_role[]
       )
       or app_private.is_assigned_client(p_barbershop_id, p_client_id)
     ) then
    raise exception 'Client is not assigned to this barber'
      using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Items must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) not between 1 and 50 then
    raise exception 'Items must be a non-empty array of up to 50 products'
      using errcode = '22023';
  end if;

  select count(*), count(distinct (item ->> 'product_id')::uuid)
  into v_item_count, v_distinct_count
  from jsonb_array_elements(p_items) item;
  if v_distinct_count <> v_item_count then
    raise exception 'Each product may appear only once per sale'
      using errcode = '22023';
  end if;

  insert into public.sales (barbershop_id, client_id)
  values (p_barbershop_id, p_client_id)
  returning id into v_sale_id;

  for v_item in
    select (item ->> 'product_id')::uuid as product_id,
           (item ->> 'quantity')::integer as quantity
    from jsonb_array_elements(p_items) item
    order by (item ->> 'product_id')::uuid
  loop
    if v_item.product_id is null or v_item.quantity is null
       or v_item.quantity not between 1 and 1000 then
      raise exception 'Invalid product or quantity' using errcode = '22023';
    end if;
    select p.id, p.name, p.price_cents, p.stock_quantity, p.category
    into v_product
    from public.products p
    where p.barbershop_id = p_barbershop_id
      and p.id = v_item.product_id and p.active
    for update;
    if not found or v_product.stock_quantity < v_item.quantity then
      raise exception 'Product is unavailable or stock is insufficient'
        using errcode = '22023';
    end if;
    if not app_private.has_module(p_barbershop_id, 'products')
       and v_product.category not in ('bar','kitchen') then
      raise exception 'This item is not in the bar/kitchen menu'
        using errcode = '42501';
    end if;
    insert into public.sale_items (
      barbershop_id, sale_id, product_id, description, quantity, unit_price_cents
    ) values (
      p_barbershop_id, v_sale_id, v_product.id, v_product.name,
      v_item.quantity, v_product.price_cents
    );
    update public.products
    set stock_quantity = stock_quantity - v_item.quantity
    where barbershop_id = p_barbershop_id and id = v_product.id;
    v_total := v_total + v_item.quantity::bigint * v_product.price_cents;
  end loop;
  if v_total > 2147483647 then
    raise exception 'Sale total exceeds allowed maximum' using errcode = '22003';
  end if;
  update public.sales set total_cents = v_total::integer where id = v_sale_id;
  return v_sale_id;
end;
$$;
revoke execute on function app_private.create_sale(uuid,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function app_private.create_sale(uuid,uuid,jsonb)
  to authenticated;
create function public.create_sale(
  p_barbershop_id uuid,
  p_client_id uuid,
  p_items jsonb
)
returns uuid
language sql volatile security invoker set search_path = ''
as $$
  select app_private.create_sale(p_barbershop_id, p_client_id, p_items);
$$;
revoke execute on function public.create_sale(uuid,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.create_sale(uuid,uuid,jsonb)
  to authenticated;

-- The dashboard is a single RLS-aware aggregate: a barber receives only their
-- own appointments, revenue tied to them, and their own client cohort.
create function app_private.dashboard_metrics(
  p_barbershop_id uuid,
  p_from date,
  p_to date
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_barber_id uuid;
  v_revenue_cents bigint;
  v_paid_transactions bigint;
  v_ticket_average_cents bigint;
  v_completed_appointments bigint;
  v_new_clients bigint;
  v_first_time_clients bigint;
  v_retention jsonb;
  v_timezone text;
  v_range_start timestamptz;
  v_range_end timestamptz;
begin
  if (select auth.uid()) is null
     or not app_private.has_module(p_barbershop_id, 'reports') then
    raise exception 'Report access denied' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from
     or p_to - p_from > 730 then
    raise exception 'Invalid report period' using errcode = '22023';
  end if;
  select timezone into v_timezone
  from public.barbershops where id = p_barbershop_id;
  if not found then
    raise exception 'Barbershop not found' using errcode = '22023';
  end if;
  v_range_start := p_from::timestamp at time zone v_timezone;
  v_range_end := (p_to + 1)::timestamp at time zone v_timezone;

  if not app_private.has_shop_role(
    p_barbershop_id, array['admin']::public.shop_role[]
  ) then
    select m.id into v_barber_id from public.memberships m
    where m.barbershop_id = p_barbershop_id
      and m.user_id = (select auth.uid())
      and m.role = 'barber' and m.active;
    if not found then
      raise exception 'Report access denied' using errcode = '42501';
    end if;
  end if;

  select coalesce(sum(p.amount_cents), 0), count(*)
  into v_revenue_cents, v_paid_transactions
  from public.payments p
  left join public.appointments a
    on a.barbershop_id = p.barbershop_id and a.id = p.appointment_id
  where p.barbershop_id = p_barbershop_id
    and p.status = 'paid'
    and p.paid_at >= v_range_start
    and p.paid_at < v_range_end
    and (v_barber_id is null or a.barber_membership_id = v_barber_id);
  v_ticket_average_cents :=
    case when v_paid_transactions = 0 then 0
      else round(v_revenue_cents::numeric / v_paid_transactions)::bigint end;

  select count(*) into v_completed_appointments
  from public.appointments a
  where a.barbershop_id = p_barbershop_id
    and a.status = 'completed'
    and a.starts_at >= v_range_start
    and a.starts_at < v_range_end
    and (v_barber_id is null or a.barber_membership_id = v_barber_id);

  select count(*) into v_new_clients
  from public.clients c
  where c.barbershop_id = p_barbershop_id
    and c.created_at >= v_range_start
    and c.created_at < v_range_end
    and (
      v_barber_id is null
      or exists (
        select 1 from public.client_barbers cb
        where cb.barbershop_id = c.barbershop_id
          and cb.client_id = c.id
          and cb.barber_membership_id = v_barber_id
      )
    );

  select count(*) into v_first_time_clients
  from (
    select distinct on (a.client_id)
      a.client_id, a.barber_membership_id, a.starts_at as first_visit_at
    from public.appointments a
    where a.barbershop_id = p_barbershop_id
      and a.status = 'completed'
    order by a.client_id, a.starts_at
  ) first_visit
  where first_visit.first_visit_at >= v_range_start
    and first_visit.first_visit_at < v_range_end
    and (
      v_barber_id is null
      or first_visit.barber_membership_id = v_barber_id
    );

  with all_first_visits as (
    select distinct on (a.client_id)
      a.client_id, a.barber_membership_id, a.starts_at as first_visit_at
    from public.appointments a
    where a.barbershop_id = p_barbershop_id
      and a.status = 'completed'
    order by a.client_id, a.starts_at
  ),
  first_visits as (
    select * from all_first_visits f
    where f.first_visit_at >= v_range_start
      and f.first_visit_at < v_range_end
  ),
  by_barber as (
    select
      m.id as barber_membership_id,
      coalesce(m.display_name, pr.full_name, pr.email, 'Barbeiro') as barber_name,
      count(f.client_id) as first_time_clients,
      count(f.client_id) filter (
        where f.first_visit_at <= now() - interval '30 days'
      ) as eligible_for_30d,
      count(f.client_id) filter (
        where f.first_visit_at <= now() - interval '30 days'
          and not exists (
            select 1 from public.appointments followup
            where followup.barbershop_id = p_barbershop_id
              and followup.client_id = f.client_id
              and followup.status = 'completed'
              and followup.starts_at > f.first_visit_at
              and followup.starts_at <= f.first_visit_at + interval '30 days'
          )
      ) as no_return_30d
    from public.memberships m
    left join public.profiles pr on pr.user_id = m.user_id
    left join first_visits f on f.barber_membership_id = m.id
    where m.barbershop_id = p_barbershop_id
      and m.role = 'barber'
      and (v_barber_id is null or m.id = v_barber_id)
    group by m.id, m.display_name, pr.full_name, pr.email
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'barber_membership_id', b.barber_membership_id,
        'barber_name', b.barber_name,
        'first_time_clients', b.first_time_clients,
        'eligible_for_30d', b.eligible_for_30d,
        'no_return_30d', b.no_return_30d
      )
      order by b.barber_name
    ),
    '[]'::jsonb
  )
  into v_retention
  from by_barber b;

  return jsonb_build_object(
    'barbershop_id', p_barbershop_id,
    'period_from', p_from,
    'period_to', p_to,
    'revenue_cents', v_revenue_cents,
    'paid_transactions', v_paid_transactions,
    'ticket_average_cents', v_ticket_average_cents,
    'completed_appointments', v_completed_appointments,
    'new_clients', v_new_clients,
    'first_time_clients', v_first_time_clients,
    'barber_retention', v_retention
  );
end;
$$;
revoke execute on function app_private.dashboard_metrics(uuid,date,date)
  from public, anon, authenticated;
grant execute on function app_private.dashboard_metrics(uuid,date,date)
  to authenticated;
create function public.dashboard_metrics(
  p_barbershop_id uuid,
  p_from date,
  p_to date
)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select app_private.dashboard_metrics(p_barbershop_id, p_from, p_to);
$$;
revoke execute on function public.dashboard_metrics(uuid,date,date)
  from public, anon, authenticated;
grant execute on function public.dashboard_metrics(uuid,date,date)
  to authenticated;

-- Guide steps are editable by the platform backend, but readable in every
-- logged-in barbershop. The content is operational guidance, not account data.
insert into public.marketing_guides
  (step_number, channel, title, content)
values
  (1, 'organic', 'Arrume o perfil',
   'Use foto de perfil legível, localização, horário, serviços principais e um link de agendamento. Destaque endereço, preços iniciais e trabalhos reais.'),
  (2, 'organic', 'Defina os temas',
   'Separe exemplos de cortes, bastidores, transformação, dúvidas frequentes e avaliações autorizadas de clientes. Registre as perguntas que aparecem no atendimento.'),
  (3, 'organic', 'Planeje a semana',
   'Escolha dias e responsáveis para Reels, fotos, Stories e respostas. Faça imagens reais com boa luz e peça autorização antes de mostrar um cliente.'),
  (4, 'organic', 'Publique com chamada clara',
   'Cada publicação deve mostrar o resultado, a localização e o próximo passo: agendar, consultar serviço ou falar no WhatsApp. Responda comentários e mensagens.'),
  (5, 'organic', 'Meça retorno',
   'Anote alcance, visitas ao perfil, cliques, conversas iniciadas, agendamentos e clientes que compareceram. Compare semanas equivalentes e ajuste os temas.'),
  (1, 'paid', 'Prepare a conta de anúncios',
   'Conecte a conta profissional e a página vinculada, confirme permissões, forma de pagamento, política de privacidade e destino de agendamento antes de investir.'),
  (2, 'paid', 'Escolha o objetivo',
   'No Gerenciador de Anúncios, crie uma campanha com objetivo compatível com o resultado desejado, como mensagens ou conversões no agendamento, conforme os recursos disponíveis na conta.'),
  (3, 'paid', 'Configure público e orçamento',
   'Defina a área atendida pela barbearia, calendário, orçamento e limite de teste. Evite público amplo demais para um serviço local. Registre o custo planejado.'),
  (4, 'paid', 'Crie os anúncios',
   'Monte variações com foto ou vídeo real, serviço e preço corretos, endereço, benefício concreto e chamada para agendar. Confira prévia, texto e destino em cada posicionamento.'),
  (5, 'paid', 'Publique e acompanhe',
   'Revise a campanha antes de publicar. Depois acompanhe gasto, contatos úteis, agendamentos e comparecimento; pause variações que consomem verba sem resultado.'),
  (6, 'paid', 'Ajuste com dados',
   'Mude uma variável por vez, registre a data e compare custo por agendamento efetivo. Aumente orçamento apenas quando a operação consegue atender a demanda.');

-- Validate references that composite tenant FKs alone cannot match by client.
create function app_private.validate_linked_records()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_table_name = 'appointments' and new.subscription_id is not null then
    if not exists (
      select 1 from public.subscriptions s
      where s.barbershop_id = new.barbershop_id
        and s.id = new.subscription_id
        and s.client_id = new.client_id
    ) then
      raise exception 'Appointment subscription belongs to another client'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'procedure_records' and new.appointment_id is not null then
    if not exists (
      select 1 from public.appointments a
      where a.barbershop_id = new.barbershop_id
        and a.id = new.appointment_id
        and a.client_id = new.client_id
        and a.barber_membership_id = new.barber_membership_id
    ) then
      raise exception 'Procedure appointment and client/barber do not match'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'chemical_records'
    and new.procedure_record_id is not null then
    if not exists (
      select 1 from public.procedure_records p
      where p.barbershop_id = new.barbershop_id
        and p.id = new.procedure_record_id
        and p.client_id = new.client_id
        and p.barber_membership_id = new.barber_membership_id
    ) then
      raise exception 'Chemical record procedure and client/barber do not match'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'subscription_usages' then
    if not exists (
      select 1
      from public.subscriptions s
      join public.appointments a
        on a.barbershop_id = s.barbershop_id
       and a.subscription_id = s.id
      where s.barbershop_id = new.barbershop_id
        and s.id = new.subscription_id
        and a.id = new.appointment_id
        and a.client_id = s.client_id
    ) then
      raise exception 'Subscription usage and appointment do not match'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'payments' then
    if new.subscription_id is not null and not exists (
      select 1 from public.subscriptions s
      where s.barbershop_id = new.barbershop_id
        and s.id = new.subscription_id
        and s.client_id = new.client_id
    ) then
      raise exception 'Payment subscription belongs to another client'
        using errcode = '23514';
    end if;
    if new.appointment_id is not null and not exists (
      select 1 from public.appointments a
      where a.barbershop_id = new.barbershop_id
        and a.id = new.appointment_id
        and a.client_id = new.client_id
    ) then
      raise exception 'Payment appointment belongs to another client'
        using errcode = '23514';
    end if;
    if new.sale_id is not null and not exists (
      select 1 from public.sales s
      where s.barbershop_id = new.barbershop_id
        and s.id = new.sale_id
        and (s.client_id is null or s.client_id = new.client_id)
    ) then
      raise exception 'Payment sale belongs to another client'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'bar_orders'
    and new.appointment_id is not null then
    if not exists (
      select 1 from public.appointments a
      where a.barbershop_id = new.barbershop_id
        and a.id = new.appointment_id
        and (new.client_id is null or a.client_id = new.client_id)
    ) then
      raise exception 'Bar order appointment and client do not match'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function app_private.validate_linked_records()
  from public, anon, authenticated;
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'appointments','procedure_records','chemical_records',
    'subscription_usages','payments','bar_orders'
  ] loop
    execute format(
      'create trigger validate_linked_records before insert or update on public.%I for each row execute function app_private.validate_linked_records()',
      table_name
    );
  end loop;
end;
$$;

create function app_private.validate_barbershop_timezone()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if not exists (
    select 1 from pg_catalog.pg_timezone_names
    where name = new.timezone
  ) then
    raise exception 'Invalid IANA timezone' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke execute on function app_private.validate_barbershop_timezone()
  from public, anon, authenticated;
create trigger validate_barbershop_timezone
  before insert or update of timezone on public.barbershops
  for each row execute function app_private.validate_barbershop_timezone();

-- Historic procedures and chemical records may be corrected but not erased
-- from a browser session; administrator/backend deletion remains an audited task.
revoke delete on public.procedure_records, public.chemical_records
  from authenticated;

-- Sales in the UI are bar/kitchen comandas. Their line items are written only
-- through create_sale; cancelling an unpaid comanda returns its reserved stock.
revoke insert, update, delete on public.bar_orders, public.bar_order_items
  from authenticated;
create function app_private.enforce_sale_status()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = old.status then
    return new;
  end if;
  if old.status in ('cancelled','refunded') then
    raise exception 'Final sale status cannot be changed'
      using errcode = '23514';
  end if;
  if new.status = 'cancelled' then
    if old.status not in ('open','delivered') then
      raise exception 'A paid sale must be refunded, not cancelled'
        using errcode = '23514';
    end if;
    update public.products p
    set stock_quantity = p.stock_quantity + i.quantity
    from public.sale_items i
    where i.barbershop_id = old.barbershop_id
      and i.sale_id = old.id
      and i.product_id = p.id
      and p.barbershop_id = old.barbershop_id;
  elsif new.status = 'delivered' and old.status <> 'open' then
    raise exception 'Only an open order can be delivered'
      using errcode = '23514';
  elsif new.status = 'paid' and old.status not in ('open','delivered') then
    raise exception 'Sale cannot be marked paid from this status'
      using errcode = '23514';
  elsif new.status = 'refunded' and old.status <> 'paid' then
    raise exception 'Only a paid sale can be refunded'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function app_private.enforce_sale_status()
  from public, anon, authenticated;
create trigger enforce_sale_status
  before update of status on public.sales
  for each row execute function app_private.enforce_sale_status();

create function app_private.enforce_appointment_status()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.status = old.status then
    return new;
  end if;
  if old.status in ('completed','cancelled','no_show') then
    raise exception 'Final appointment status cannot be changed'
      using errcode = '23514';
  end if;
  if new.status = 'pending' then
    raise exception 'Appointment cannot return to pending'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function app_private.enforce_appointment_status()
  from public, anon, authenticated;
create trigger enforce_appointment_status
  before update of status on public.appointments
  for each row execute function app_private.enforce_appointment_status();

-- A sold plan is a contract. Create a new plan/version rather than changing
-- its price, visit allowance, period, or included services in place.
create function app_private.protect_sold_plan()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (
    new.price_cents is distinct from old.price_cents
    or new.frequency_months is distinct from old.frequency_months
    or new.visits_per_cycle is distinct from old.visits_per_cycle
  ) and exists (
    select 1 from public.subscriptions s
    where s.barbershop_id = old.barbershop_id
      and s.plan_id = old.id
      and s.status in ('pending','authorized','active','paused','past_due')
  ) then
    raise exception 'Create a new plan to change terms for future customers'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function app_private.protect_sold_plan()
  from public, anon, authenticated;
create trigger protect_sold_plan
  before update of price_cents, frequency_months, visits_per_cycle
  on public.subscription_plans
  for each row execute function app_private.protect_sold_plan();

revoke insert, update, delete on public.subscription_plan_services
  from authenticated;
create function app_private.save_subscription_plan_services(
  p_barbershop_id uuid,
  p_plan_id uuid,
  p_service_ids uuid[]
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_plan_active boolean;
  v_count integer;
begin
  if (select auth.uid()) is null or not app_private.has_shop_role(
    p_barbershop_id, array['admin']::public.shop_role[]
  ) then
    raise exception 'Plan management denied' using errcode = '42501';
  end if;
  if p_service_ids is null or cardinality(p_service_ids) > 50
     or array_position(p_service_ids, null) is not null then
    raise exception 'Invalid service list' using errcode = '22023';
  end if;
  select p.active into v_plan_active
  from public.subscription_plans p
  where p.barbershop_id = p_barbershop_id and p.id = p_plan_id
  for update;
  if not found then
    raise exception 'Plan not found' using errcode = '22023';
  end if;
  if cardinality(p_service_ids) = 0 and v_plan_active then
    raise exception 'An active plan must include at least one service'
      using errcode = '22023';
  end if;
  if exists (
    select 1 from public.subscriptions s
    where s.barbershop_id = p_barbershop_id
      and s.plan_id = p_plan_id
      and s.status in ('pending','authorized','active','paused','past_due')
  ) then
    raise exception 'Create a new plan to change covered services'
      using errcode = '23514';
  end if;
  select count(*) into v_count
  from public.services s
  where s.barbershop_id = p_barbershop_id
    and s.id = any(p_service_ids)
    and s.active;
  if v_count <> cardinality(p_service_ids) then
    raise exception 'Services must be unique, active, and in this barbershop'
      using errcode = '22023';
  end if;
  delete from public.subscription_plan_services
  where barbershop_id = p_barbershop_id and plan_id = p_plan_id;
  insert into public.subscription_plan_services (
    barbershop_id, plan_id, service_id
  )
  select p_barbershop_id, p_plan_id, s.id
  from public.services s
  where s.barbershop_id = p_barbershop_id and s.id = any(p_service_ids);
end;
$$;
revoke execute on function app_private.save_subscription_plan_services(uuid,uuid,uuid[])
  from public, anon, authenticated;
grant execute on function app_private.save_subscription_plan_services(uuid,uuid,uuid[])
  to authenticated;
create function public.save_subscription_plan_services(
  p_barbershop_id uuid,
  p_plan_id uuid,
  p_service_ids uuid[]
)
returns void
language sql volatile security invoker set search_path = ''
as $$
  select app_private.save_subscription_plan_services(
    p_barbershop_id, p_plan_id, p_service_ids
  );
$$;
revoke execute on function public.save_subscription_plan_services(uuid,uuid,uuid[])
  from public, anon, authenticated;
grant execute on function public.save_subscription_plan_services(uuid,uuid,uuid[])
  to authenticated;

-- Provider reversals revoke the booking entitlement in the same transaction
-- as the payment change. Only the trusted backend can call this RPC directly.
create function public.reconcile_subscription_entitlement(p_subscription_id uuid)
returns text
language plpgsql security invoker set search_path = ''
as $$
declare
  v_subscription public.subscriptions%rowtype;
begin
  select * into v_subscription
  from public.subscriptions s
  where s.id = p_subscription_id
  for update;
  if not found then
    raise exception 'Subscription not found' using errcode = 'P0002';
  end if;

  if v_subscription.status = 'active'
    and v_subscription.current_period_start is not null
    and v_subscription.current_period_end is not null
    and not exists (
      select 1
      from public.payments p
      join public.subscription_plans plan
        on plan.barbershop_id = v_subscription.barbershop_id
       and plan.id = v_subscription.plan_id
      where p.barbershop_id = v_subscription.barbershop_id
        and p.subscription_id = v_subscription.id
        and p.provider = 'mercadopago'
        and p.status = 'paid'
        and p.amount_cents = plan.price_cents
        and p.paid_at >= v_subscription.current_period_start
        and p.paid_at < v_subscription.current_period_end
    ) then
    update public.subscriptions s
    set status = 'past_due'
    where s.id = v_subscription.id;
    return 'past_due';
  end if;
  return v_subscription.status;
end;
$$;
revoke execute on function public.reconcile_subscription_entitlement(uuid)
  from public, anon, authenticated;
grant execute on function public.reconcile_subscription_entitlement(uuid)
  to service_role;

-- A delayed approval notification cannot reopen a refunded or disputed
-- payment. Terminal statuses may be corrected to another terminal status.
create function app_private.prevent_payment_reactivation()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if old.provider = 'mercadopago'
    and old.status in ('refunded','charged_back','cancelled')
    and new.status not in ('refunded','charged_back','cancelled') then
    raise exception 'Terminal provider payment cannot be reactivated'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke execute on function app_private.prevent_payment_reactivation()
  from public, anon, authenticated;
create trigger prevent_payment_reactivation
  before update of status on public.payments
  for each row execute function app_private.prevent_payment_reactivation();

create function app_private.reconcile_payment_entitlement()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if old.subscription_id is distinct from new.subscription_id
      and old.subscription_id is not null then
      perform public.reconcile_subscription_entitlement(old.subscription_id);
    end if;
  end if;
  if new.subscription_id is not null then
    perform public.reconcile_subscription_entitlement(new.subscription_id);
  end if;
  return new;
end;
$$;
revoke execute on function app_private.reconcile_payment_entitlement()
  from public, anon, authenticated;
create trigger reconcile_payment_entitlement
  after insert or update of status, paid_at, subscription_id on public.payments
  for each row execute function app_private.reconcile_payment_entitlement();
