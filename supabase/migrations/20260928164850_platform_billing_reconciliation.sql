-- Prioritize seat/price changes in the next SaaS billing reconciliation and
-- retain the amount that was in force when a past provider invoice was made.
create table public.platform_subscription_rates (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id),
  provider_subscription_id text not null
    check (length(btrim(provider_subscription_id)) > 0),
  seat_count integer not null check (seat_count >= 0),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  amount_cents integer not null check (amount_cents >= 0),
  observed_at timestamptz not null default now(),
  check (amount_cents::bigint = seat_count::bigint * unit_price_cents::bigint)
);
create index platform_subscription_rates_lookup_idx
  on public.platform_subscription_rates
  (barbershop_id, amount_cents, observed_at desc);
create index platform_subscription_rates_provider_idx
  on public.platform_subscription_rates
  (provider_subscription_id, observed_at desc);
alter table public.platform_subscription_rates enable row level security;
revoke all on public.platform_subscription_rates
  from anon, authenticated, service_role;
grant select on public.platform_subscription_rates to service_role;

-- Backfill the current amount. Earlier, unrecorded prices cannot be inferred.
insert into public.platform_subscription_rates (
  barbershop_id, provider_subscription_id, seat_count,
  unit_price_cents, amount_cents, observed_at
)
select s.barbershop_id, s.provider_subscription_id, s.seat_count,
       s.unit_price_cents, s.amount_cents, s.updated_at
from public.platform_subscriptions s
where s.provider_subscription_id is not null and s.amount_cents > 0;

create function app_private.record_platform_subscription_rate()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_changed boolean;
begin
  if tg_op = 'INSERT' then
    if new.provider_subscription_id is not null and new.amount_cents > 0 then
      insert into public.platform_subscription_rates (
        barbershop_id, provider_subscription_id, seat_count,
        unit_price_cents, amount_cents, observed_at
      ) values (
        new.barbershop_id, new.provider_subscription_id, new.seat_count,
        new.unit_price_cents, new.amount_cents, clock_timestamp()
      );
    end if;
    return new;
  end if;

  v_changed := old.seat_count is distinct from new.seat_count
    or old.unit_price_cents is distinct from new.unit_price_cents
    or old.amount_cents is distinct from new.amount_cents
    or old.provider_subscription_id is distinct from new.provider_subscription_id;
  if not v_changed then
    return new;
  end if;

  -- Existing subscriptions predating this migration might have no snapshot.
  if old.provider_subscription_id is not null and old.amount_cents > 0
    and not exists (
      select 1 from public.platform_subscription_rates r
      where r.barbershop_id = old.barbershop_id
        and r.provider_subscription_id = old.provider_subscription_id
        and r.seat_count = old.seat_count
        and r.unit_price_cents = old.unit_price_cents
        and r.amount_cents = old.amount_cents
    ) then
    insert into public.platform_subscription_rates (
      barbershop_id, provider_subscription_id, seat_count,
      unit_price_cents, amount_cents, observed_at
    ) values (
      old.barbershop_id, old.provider_subscription_id, old.seat_count,
      old.unit_price_cents, old.amount_cents, old.updated_at
    );
  end if;
  if new.provider_subscription_id is not null and new.amount_cents > 0 then
    insert into public.platform_subscription_rates (
      barbershop_id, provider_subscription_id, seat_count,
      unit_price_cents, amount_cents, observed_at
    ) values (
      new.barbershop_id, new.provider_subscription_id, new.seat_count,
      new.unit_price_cents, new.amount_cents, clock_timestamp()
    );
  end if;
  return new;
end;
$$;
revoke execute on function app_private.record_platform_subscription_rate()
  from public, anon, authenticated;
create trigger record_platform_subscription_rate
  after insert or update of seat_count, unit_price_cents,
    amount_cents, provider_subscription_id
  on public.platform_subscriptions
  for each row execute function app_private.record_platform_subscription_rate();

create function app_private.reject_platform_rate_mutation()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  raise exception 'Platform subscription rate history is append-only'
    using errcode = '23514';
end;
$$;
revoke execute on function app_private.reject_platform_rate_mutation()
  from public, anon, authenticated;
create trigger reject_platform_rate_mutation
  before update or delete on public.platform_subscription_rates
  for each row execute function app_private.reject_platform_rate_mutation();

create function app_private.queue_platform_reconciliation_for_membership()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_old_counted boolean;
  v_new_counted boolean;
begin
  if tg_op = 'INSERT' then
    if new.role = 'barber' and new.active then
      update public.platform_subscriptions s
      set last_reconciled_at = null
      where s.barbershop_id = new.barbershop_id
        and s.provider_subscription_id is not null
        and s.last_reconciled_at is not null;
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    if old.role = 'barber' and old.active then
      update public.platform_subscriptions s
      set last_reconciled_at = null
      where s.barbershop_id = old.barbershop_id
        and s.provider_subscription_id is not null
        and s.last_reconciled_at is not null;
    end if;
    return old;
  end if;

  v_old_counted := old.role = 'barber' and old.active;
  v_new_counted := new.role = 'barber' and new.active;
  if v_old_counted and (
    not v_new_counted or old.barbershop_id <> new.barbershop_id
  ) then
    update public.platform_subscriptions s
    set last_reconciled_at = null
    where s.barbershop_id = old.barbershop_id
      and s.provider_subscription_id is not null
      and s.last_reconciled_at is not null;
  end if;
  if v_new_counted and (
    not v_old_counted or old.barbershop_id <> new.barbershop_id
  ) then
    update public.platform_subscriptions s
    set last_reconciled_at = null
    where s.barbershop_id = new.barbershop_id
      and s.provider_subscription_id is not null
      and s.last_reconciled_at is not null;
  end if;
  return new;
end;
$$;
revoke execute on function app_private.queue_platform_reconciliation_for_membership()
  from public, anon, authenticated;
create trigger queue_platform_reconciliation_for_membership
  after insert or update or delete on public.memberships
  for each row execute function app_private.queue_platform_reconciliation_for_membership();

create function app_private.queue_platform_reconciliation_for_price()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.seat_price_cents is distinct from new.seat_price_cents
    or old.billing_enabled is distinct from new.billing_enabled then
    update public.platform_subscriptions s
    set last_reconciled_at = null
    where s.provider_subscription_id is not null
      and s.last_reconciled_at is not null;
  end if;
  return new;
end;
$$;
revoke execute on function app_private.queue_platform_reconciliation_for_price()
  from public, anon, authenticated;
create trigger queue_platform_reconciliation_for_price
  after update of seat_price_cents, billing_enabled
  on public.platform_settings
  for each row execute function app_private.queue_platform_reconciliation_for_price();

create function app_private.queue_platform_reconciliation_for_shop()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.active is distinct from new.active then
    update public.platform_subscriptions s
    set last_reconciled_at = null
    where s.barbershop_id = new.id
      and s.provider_subscription_id is not null
      and s.last_reconciled_at is not null;
  end if;
  return new;
end;
$$;
revoke execute on function app_private.queue_platform_reconciliation_for_shop()
  from public, anon, authenticated;
create trigger queue_platform_reconciliation_for_shop
  after update of active on public.barbershops
  for each row execute function app_private.queue_platform_reconciliation_for_shop();
