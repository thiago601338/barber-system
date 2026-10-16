-- NULL shop values inherit the master defaults; zero cap explicitly means no cap.
alter table public.platform_settings
  add column base_monthly_cents integer not null default 2990 check (base_monthly_cents >= 0),
  add column monthly_cap_cents integer not null default 9690 check (monthly_cap_cents >= 0);
alter table public.barbershops
  alter column base_monthly_cents drop not null,
  alter column base_monthly_cents drop default,
  add column monthly_cap_cents integer check (monthly_cap_cents >= 0);

-- Preserve the full price breakdown on subscriptions, historical rates and invoices.
alter table public.platform_subscriptions
  add column discount_cents integer not null default 0 check (discount_cents >= 0),
  drop constraint platform_subscriptions_amount_breakdown_check,
  add constraint platform_subscriptions_amount_breakdown_check check (
    amount_cents::bigint = base_fee_cents::bigint + seat_count::bigint * unit_price_cents::bigint - discount_cents::bigint
    and discount_cents::bigint <= base_fee_cents::bigint + seat_count::bigint * unit_price_cents::bigint);
alter table public.platform_invoices
  add column discount_cents integer not null default 0 check (discount_cents >= 0),
  drop constraint platform_invoices_amount_breakdown_check,
  add constraint platform_invoices_amount_breakdown_check check (
    amount_cents::bigint = base_fee_cents::bigint + seat_count::bigint * unit_price_cents::bigint - discount_cents::bigint
    and discount_cents::bigint <= base_fee_cents::bigint + seat_count::bigint * unit_price_cents::bigint);
alter table public.platform_subscription_rates
  add column discount_cents integer not null default 0 check (discount_cents >= 0),
  drop constraint platform_subscription_rates_amount_breakdown_check,
  add constraint platform_subscription_rates_amount_breakdown_check check (
    amount_cents::bigint = base_fee_cents::bigint + seat_count::bigint * unit_price_cents::bigint - discount_cents::bigint
    and discount_cents::bigint <= base_fee_cents::bigint + seat_count::bigint * unit_price_cents::bigint);

create or replace function app_private.record_platform_subscription_rate()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_changed boolean;
begin
  if tg_op = 'UPDATE' then
    v_changed := old.seat_count is distinct from new.seat_count
      or old.base_fee_cents is distinct from new.base_fee_cents
      or old.unit_price_cents is distinct from new.unit_price_cents
      or old.discount_cents is distinct from new.discount_cents
      or old.amount_cents is distinct from new.amount_cents
      or old.provider_subscription_id is distinct from new.provider_subscription_id;
    if not v_changed then return new; end if;
    if old.provider_subscription_id is not null and old.amount_cents > 0 and not exists (
      select 1 from public.platform_subscription_rates r
      where r.barbershop_id=old.barbershop_id and r.provider_subscription_id=old.provider_subscription_id
        and r.seat_count=old.seat_count and r.base_fee_cents=old.base_fee_cents
        and r.unit_price_cents=old.unit_price_cents and r.discount_cents=old.discount_cents and r.amount_cents=old.amount_cents
    ) then
      insert into public.platform_subscription_rates (barbershop_id,provider_subscription_id,seat_count,base_fee_cents,unit_price_cents,discount_cents,amount_cents,observed_at)
      values (old.barbershop_id,old.provider_subscription_id,old.seat_count,old.base_fee_cents,old.unit_price_cents,old.discount_cents,old.amount_cents,old.updated_at);
    end if;
  end if;
  if new.provider_subscription_id is not null and new.amount_cents > 0 then
    insert into public.platform_subscription_rates (barbershop_id,provider_subscription_id,seat_count,base_fee_cents,unit_price_cents,discount_cents,amount_cents,observed_at)
    values (new.barbershop_id,new.provider_subscription_id,new.seat_count,new.base_fee_cents,new.unit_price_cents,new.discount_cents,new.amount_cents,clock_timestamp());
  end if;
  return new;
end; $$;
revoke execute on function app_private.record_platform_subscription_rate() from public,anon,authenticated;
drop trigger record_platform_subscription_rate on public.platform_subscriptions;
create trigger record_platform_subscription_rate after insert or update of seat_count,base_fee_cents,unit_price_cents,discount_cents,amount_cents,provider_subscription_id
  on public.platform_subscriptions for each row execute function app_private.record_platform_subscription_rate();

create or replace function app_private.queue_platform_reconciliation_for_price()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.seat_price_cents is distinct from new.seat_price_cents
    or old.base_monthly_cents is distinct from new.base_monthly_cents
    or old.monthly_cap_cents is distinct from new.monthly_cap_cents
    or old.billing_enabled is distinct from new.billing_enabled then
    update public.platform_subscriptions set last_reconciled_at=null
      where provider_subscription_id is not null and last_reconciled_at is not null;
  end if;
  return new;
end; $$;
revoke execute on function app_private.queue_platform_reconciliation_for_price() from public,anon,authenticated;
drop trigger queue_platform_reconciliation_for_price on public.platform_settings;
create trigger queue_platform_reconciliation_for_price after update of seat_price_cents,base_monthly_cents,monthly_cap_cents,billing_enabled
  on public.platform_settings for each row execute function app_private.queue_platform_reconciliation_for_price();

create or replace function app_private.queue_platform_reconciliation_for_shop()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.active is distinct from new.active
    or old.base_monthly_cents is distinct from new.base_monthly_cents
    or old.per_barber_monthly_cents is distinct from new.per_barber_monthly_cents
    or old.monthly_cap_cents is distinct from new.monthly_cap_cents then
    update public.platform_subscriptions set last_reconciled_at=null
      where barbershop_id=new.id and provider_subscription_id is not null and last_reconciled_at is not null;
  end if;
  return new;
end; $$;
revoke execute on function app_private.queue_platform_reconciliation_for_shop() from public,anon,authenticated;
drop trigger queue_platform_reconciliation_for_shop on public.barbershops;
create trigger queue_platform_reconciliation_for_shop after update of active,base_monthly_cents,per_barber_monthly_cents,monthly_cap_cents
  on public.barbershops for each row execute function app_private.queue_platform_reconciliation_for_shop();
