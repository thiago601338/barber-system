-- A shop may receive a late invoice for an old SaaS preapproval after its
-- seat price changed. Provider invoice identity, not calendar month, is the
-- unique billing event. Existing rows remain intact with NULL provider IDs.
alter table public.platform_invoices
  add column provider_invoice_id text,
  add column provider_subscription_id text,
  add constraint platform_invoices_provider_invoice_id_nonempty
    check (provider_invoice_id is null or length(btrim(provider_invoice_id)) > 0),
  add constraint platform_invoices_provider_subscription_id_nonempty
    check (provider_subscription_id is null or length(btrim(provider_subscription_id)) > 0);

alter table public.platform_invoices
  drop constraint platform_invoices_barbershop_id_period_start_period_end_key,
  drop constraint platform_invoices_no_overlap;

create unique index platform_invoices_provider_invoice_id_uq
  on public.platform_invoices (provider_invoice_id)
  where provider_invoice_id is not null;
create index platform_invoices_subscription_period_idx
  on public.platform_invoices (provider_subscription_id, period_start desc)
  where provider_subscription_id is not null;

-- Keep platform_invoices_provider_id_uq on provider_payment_id unchanged.
