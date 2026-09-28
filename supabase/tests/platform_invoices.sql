-- Multiple legitimate SaaS invoices can share a shop/month. Roll back fixtures.
begin;

insert into public.barbershops (id, name, slug)
values ('96000000-0000-4000-8000-000000000001',
        'Invoice Fixture Shop', 'invoice-fixture-shop');

insert into public.platform_invoices (
  id, barbershop_id, period_start, period_end,
  seat_count, unit_price_cents, amount_cents, status,
  provider_invoice_id, provider_subscription_id, provider_payment_id
) values
  ('97000000-0000-4000-8000-000000000001',
   '96000000-0000-4000-8000-000000000001',
   date '2026-09-01', date '2026-09-30',
   2, 1000, 2000, 'paid',
   'invoice-fixture-old', 'preapproval-fixture-old', 'payment-fixture-old'),
  ('97000000-0000-4000-8000-000000000002',
   '96000000-0000-4000-8000-000000000001',
   date '2026-09-01', date '2026-09-30',
   3, 1000, 3000, 'paid',
   'invoice-fixture-new', 'preapproval-fixture-new', 'payment-fixture-new');

do $$
begin
  if (select count(*) from public.platform_invoices
      where barbershop_id = '96000000-0000-4000-8000-000000000001'
        and period_start = date '2026-09-01') <> 2 then
    raise exception 'Same-month provider invoices did not coexist';
  end if;
  if has_table_privilege('authenticated', 'public.platform_invoices', 'SELECT') then
    raise exception 'Browser role can read platform billing';
  end if;
  begin
    insert into public.platform_invoices (
      barbershop_id, period_start, period_end,
      seat_count, unit_price_cents, amount_cents,
      provider_invoice_id, provider_subscription_id
    ) values (
      '96000000-0000-4000-8000-000000000001',
      date '2026-09-01', date '2026-09-30',
      2, 1000, 2000,
      'invoice-fixture-old', 'preapproval-fixture-old'
    );
    raise exception 'Duplicate provider invoice ID was accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into public.platform_invoices (
      barbershop_id, period_start, period_end,
      seat_count, unit_price_cents, amount_cents,
      provider_invoice_id, provider_payment_id
    ) values (
      '96000000-0000-4000-8000-000000000001',
      date '2026-09-01', date '2026-09-30',
      2, 1000, 2000,
      'invoice-fixture-third', 'payment-fixture-old'
    );
    raise exception 'Duplicate provider payment ID was accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into public.platform_invoices (
      barbershop_id, period_start, period_end,
      seat_count, unit_price_cents, amount_cents,
      provider_invoice_id
    ) values (
      '96000000-0000-4000-8000-000000000001',
      date '2026-09-01', date '2026-09-30',
      2, 1000, 2000, ' '
    );
    raise exception 'Blank provider invoice ID was accepted';
  exception when check_violation then null;
  end;
end;
$$;

rollback;
