-- Dados vindos do CashBarber que agora têm lugar no cadastro (vale para qualquer barbearia importada).
update public.appointments a set booking_origin = case r.payload->>'source_origin' when 'PWA' then 'app' when 'RECEPCAO' then 'reception' end
  from app_private.cashbarber_import_records r
  where r.barbershop_id = a.barbershop_id and r.dataset = 'appointments' and r.projected_id = a.id
    and a.booking_origin is null and r.payload->>'source_origin' in ('PWA', 'RECEPCAO');
update public.appointments a set client_confirmed_at = coalesce(nullif(r.payload->>'source_updated', '')::timestamptz, now())
  from app_private.cashbarber_import_records r
  where r.barbershop_id = a.barbershop_id and r.dataset = 'appointments' and r.projected_id = a.id
    and a.client_confirmed_at is null and a.status in ('pending', 'confirmed') and a.starts_at >= now()
    and r.payload->>'source_client_status' in ('Confirmado', 'Confirmado_Whatsapp');
update public.appointments a set reminder_sent_at = coalesce(nullif(r.payload->>'source_updated', '')::timestamptz, now())
  from app_private.cashbarber_import_records r
  where r.barbershop_id = a.barbershop_id and r.dataset = 'appointments' and r.projected_id = a.id
    and a.reminder_sent_at is null and a.status in ('pending', 'confirmed') and a.starts_at >= now()
    and r.payload->>'source_client_status' = 'Enviado_Whatsapp';
update public.clients c set
    acquisition_source = coalesce(c.acquisition_source, nullif(btrim(r.payload->'source_profile'->>'how_met'), '')),
    referred_by = coalesce(c.referred_by, nullif(btrim(r.payload->'source_profile'->>'referred_by'), ''))
  from app_private.cashbarber_import_records r
  where r.barbershop_id = c.barbershop_id and r.dataset = 'clients' and r.projected_id = c.id
    and (nullif(btrim(r.payload->'source_profile'->>'how_met'), '') is not null or nullif(btrim(r.payload->'source_profile'->>'referred_by'), '') is not null)
    and (c.acquisition_source is null or c.referred_by is null);
-- Categorias do cadastro da Kingsman no CashBarber (ids da origem).
update public.services s set category = m.name
  from app_private.cashbarber_import_records r join (values ('14010', 'Barbearia'), ('14011', 'Serviços extras')) m(id, name) on m.id = r.payload->>'category_id'
  where r.barbershop_id = s.barbershop_id and r.dataset = 'services' and r.projected_id = s.id and s.category is null;
update public.products p set product_group = m.name
  from app_private.cashbarber_import_records r join (values ('14012', 'Cosméticos'), ('14013', 'Bar/cozinha')) m(id, name) on m.id = r.payload->>'category_id'
  where r.barbershop_id = p.barbershop_id and r.dataset = 'products' and r.projected_id = p.id and p.product_group is null;
