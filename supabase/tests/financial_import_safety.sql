begin;
-- The migration audit runs as the database operator; application roles cannot read the private archive.
do $$ begin
  if exists(select 1 from public.appointments a join app_private.cashbarber_import_records r on r.barbershop_id=a.barbershop_id and r.dataset='appointments' and r.source_id=a.source_id where a.import_source='cashbarber' and a.status::text <> r.payload->>'status') then raise exception 'Source appointment statuses diverged';end if;
end $$;
do $$ declare r record;begin
  select b.id shop,m.id barber,a.client_id,(ir.payload->>'start')::timestamp at time zone b.timezone slot_start,(ir.payload->>'end')::timestamp at time zone b.timezone slot_end into r
  from app_private.cashbarber_import_records ir join public.memberships m on m.barbershop_id=ir.barbershop_id and m.source_id=ir.payload->>'id_barbeiro' and m.import_source='cashbarber'
  join public.barbershops b on b.id=ir.barbershop_id join public.appointments a on a.barber_membership_id=m.id
  where ir.dataset='availability_blocks' and ir.payload->>'source_kind'='blocked_slot' limit 1;
  if not found or not app_private.cashbarber_slot_blocked(r.shop,r.barber,r.slot_start,r.slot_end) then raise exception 'Source blocked slot missing';end if;
  begin
    insert into public.appointments(barbershop_id,client_id,barber_membership_id,starts_at,ends_at,status,source) values(r.shop,r.client_id,r.barber,r.slot_start,r.slot_end,'confirmed','admin');
    raise exception 'Scheduling accepted a source blocked slot';
  exception when check_violation then
    if sqlerrm not like 'Horário bloqueado na agenda importada.%' then raise;end if;
  end;
end $$;
select set_config('request.jwt.claims','{"sub":"46c3ac05-b81a-4826-a25a-26f69f327d37","role":"authenticated"}',true);
set local role authenticated;
do $$ declare shop uuid:='4fe40cd6-e636-4b7e-a99c-67e887886e80'; c uuid; r uuid; p1 uuid; p2 uuid; before_count integer; v jsonb;
begin
  v:=public.management_dashboard(shop,'2026-10-01','2026-10-02');
  if (v->>'active_plans')::integer<>171 or (v->>'revenue_cents')::bigint<>468922 or (v->>'occupancy_pct')::numeric not between 0 and 100 then raise exception 'Dashboard reconciliation failed';end if;
  v:=public.profitability_data(shop,'2026-09-01','2026-09-30');
  if (select sum((l->>'revenue_cents')::numeric) from jsonb_array_elements(v->'lines')l)<>(select sum(amount_cents) from public.payments where barbershop_id=shop and status='paid' and paid_at>='2026-09-01 00:00:00-03' and paid_at<'2026-10-01 00:00:00-03') then raise exception 'Profit revenue duplicated or missing';end if;
  select count(*) into before_count from public.payments where barbershop_id=shop;
  insert into public.clients(barbershop_id,full_name) values(shop,'Teste de segurança com rollback') returning id into c;
  insert into public.receivables(barbershop_id,client_id,description,amount_cents,due_on) values(shop,c,'Teste de quitação',1234,'2026-10-01') returning id into r;
  p1:=public.settle_receivable(shop,r);p2:=public.settle_receivable(shop,r);
  if p1<>p2 or (select count(*) from public.payments where barbershop_id=shop)<>before_count+1 or (select status from public.receivables where id=r)<>'paid' then raise exception 'Receipt is not atomic/idempotent';end if;
end $$;
select set_config('request.jwt.claims','{"sub":"d0b273e9-a48a-44f3-804a-24a696de27b3","role":"authenticated"}',true);
do $$ begin
  begin perform public.profitability_data('4fe40cd6-e636-4b7e-a99c-67e887886e80','2026-10-01','2026-10-02');raise exception 'Barber read profit';exception when insufficient_privilege then null;end;
  begin perform public.cashbarber_history_page('4fe40cd6-e636-4b7e-a99c-67e887886e80','receivables',0);raise exception 'Barber read admin archive';exception when insufficient_privilege then null;end;
  begin perform public.import_cashbarber_batch('4fe40cd6-e636-4b7e-a99c-67e887886e80','clients','[]');raise exception 'Barber invoked migration';exception when insufficient_privilege then null;end;
  if exists(select 1 from public.receivables where description='Teste de quitação') then raise exception 'Barber saw admin debt';end if;
end $$;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
do $$ begin
  begin perform public.profitability_data('4fe40cd6-e636-4b7e-a99c-67e887886e80','2026-10-01','2026-10-02');raise exception 'Anonymous read profit';exception when insufficient_privilege then null;end;
  begin perform public.cashbarber_legacy_data('4fe40cd6-e636-4b7e-a99c-67e887886e80',null,null);raise exception 'Anonymous read contracts';exception when insufficient_privilege then null;end;
end $$;
select 'Financial reconciliation, permissions and receipt retry passed' as result;
rollback;
