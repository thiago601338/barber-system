-- Correct source field mapping without changing dates or inventing cancellations.
-- These repair helpers are server-only and never exposed through public RPC.
create function app_private.reconcile_cashbarber_appointments(p_shop uuid,p_rows jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare r jsonb; v_count integer:=0;
begin
  if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>1000 then raise exception 'Invalid repair batch' using errcode='22023'; end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    if coalesce(r->>'source_status','') not in ('Finalizado','Cancelado','Agendado') or coalesce(r->>'status','') <> (case r->>'source_status' when 'Finalizado' then 'completed' when 'Cancelado' then 'cancelled' when 'Agendado' then 'confirmed' end) then
      raise exception 'Unverified appointment status' using errcode='22023';
    end if;
    update app_private.cashbarber_import_records set payload=payload||r where barbershop_id=p_shop and dataset='appointments' and source_id=r->>'id';
    if not found then raise exception 'Source appointment not archived' using errcode='22023'; end if;
    update public.appointments set status=(r->>'status')::public.appointment_status,notes=nullif(r->>'notes','')
      where barbershop_id=p_shop and import_source='cashbarber' and source_id=r->>'id';
    v_count:=v_count+1;
  end loop;
  return v_count;
end $$;
revoke all on function app_private.reconcile_cashbarber_appointments(uuid,jsonb) from public,anon,authenticated;
grant execute on function app_private.reconcile_cashbarber_appointments(uuid,jsonb) to service_role;

create function app_private.finish_cashbarber_procedure_history(p_shop uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r record; a public.appointments; s public.services; v_recovered integer:=0; v_procedures integer:=0; v_batch jsonb;
begin
  if exists(select 1 from app_private.cashbarber_import_records where barbershop_id=p_shop and dataset='appointments' and payload->>'source_status' is null) then
    raise exception 'Complete the status repair before rebuilding history' using errcode='22023';
  end if;
  -- Retry only unprojected appointments after verified cancellations release their slots.
  for v_batch in select jsonb_agg(payload order by source_id) from (
    select payload,source_id,(row_number() over(order by source_id)-1)/500 as batch
    from app_private.cashbarber_import_records where barbershop_id=p_shop and dataset='appointments' and projected_id is null
  ) q group by batch loop
    v_recovered:=v_recovered+coalesce((app_private.import_cashbarber_entities(p_shop,'appointments',v_batch)->>'imported')::integer,0);
  end loop;
  -- Reconcile links by original IDs; procedure amounts remain explicitly unknown.
  for r in select source_id,payload from app_private.cashbarber_import_records where barbershop_id=p_shop and dataset='appointment_services' loop
    select * into a from public.appointments where barbershop_id=p_shop and import_source='cashbarber' and source_id=r.payload->>'appointment';
    select * into s from public.services where barbershop_id=p_shop and import_source='cashbarber' and source_id=r.payload->>'service';
    if a.id is not null and s.id is not null then
      insert into public.appointment_services(barbershop_id,appointment_id,service_id,price_cents,duration_minutes)
        values(p_shop,a.id,s.id,0,s.duration_minutes) on conflict do nothing;
      if a.status='completed' then
        insert into public.procedure_records(barbershop_id,client_id,barber_membership_id,appointment_id,service_id,performed_at,description,price_cents,notes,import_source,source_id,import_price_known)
          values(p_shop,a.client_id,a.barber_membership_id,a.id,s.id,a.starts_at,s.name,0,'Histórico Cashbarber. Valor por procedimento não informado na origem.','cashbarber',r.source_id,false)
          on conflict(barbershop_id,import_source,source_id) where import_source is not null do nothing;
        if found then v_procedures:=v_procedures+1;end if;
      end if;
      update app_private.cashbarber_import_records set projected_id=a.id,issue=null where barbershop_id=p_shop and dataset='appointment_services' and source_id=r.source_id;
    end if;
  end loop;
  return jsonb_build_object('recovered_appointments',v_recovered,'created_procedures',v_procedures);
end $$;
revoke all on function app_private.finish_cashbarber_procedure_history(uuid) from public,anon,authenticated;
grant execute on function app_private.finish_cashbarber_procedure_history(uuid) to service_role;
