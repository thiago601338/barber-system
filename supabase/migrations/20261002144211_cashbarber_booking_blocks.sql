-- Preserve source breaks, days off and explicitly blocked slots in public booking and staff scheduling.
create index cashbarber_block_staff_idx on app_private.cashbarber_import_records(barbershop_id,(payload->>'id_barbeiro')) where dataset='availability_blocks';
create function app_private.cashbarber_slot_blocked(p_shop uuid,p_barber uuid,p_start timestamptz,p_end timestamptz) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from app_private.cashbarber_import_records r
    join public.memberships m on m.barbershop_id=r.barbershop_id and m.import_source='cashbarber' and m.source_id=r.payload->>'id_barbeiro'
    join public.barbershops b on b.id=r.barbershop_id
    where r.barbershop_id=p_shop and r.dataset='availability_blocks' and m.id=p_barber
      and tstzrange((r.payload->>'start')::timestamp at time zone b.timezone,(r.payload->>'end')::timestamp at time zone b.timezone,'[)') && tstzrange(p_start,p_end,'[)')
  );
$$;
revoke all on function app_private.cashbarber_slot_blocked(uuid,uuid,timestamptz,timestamptz) from public,anon,authenticated;

do $$ declare body text; original text; begin
  select pg_get_functiondef('app_private.available_slots(uuid,uuid,uuid[],date)'::regprocedure) into original;
  body:=replace(original,'if v_slot >= now()',
    'if v_slot >= now() and not app_private.cashbarber_slot_blocked(p_barbershop_id,p_barber_membership_id,v_slot,v_slot+make_interval(mins=>v_duration_minutes))');
  if body=original then raise exception 'Slot function changed; review required';end if;
  execute body;
end $$;

create function app_private.guard_cashbarber_blocked_slot() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.status='cancelled' then return new;end if;
  if (tg_op='INSERT' and new.import_source is distinct from 'cashbarber') or
     (tg_op='UPDATE' and (new.starts_at,new.ends_at,new.barber_membership_id) is distinct from (old.starts_at,old.ends_at,old.barber_membership_id)) then
    if app_private.cashbarber_slot_blocked(new.barbershop_id,new.barber_membership_id,new.starts_at,new.ends_at) then
      raise exception 'Horário bloqueado na agenda importada. Escolha outro horário.' using errcode='23514';
    end if;
  end if;
  return new;
end $$;
revoke all on function app_private.guard_cashbarber_blocked_slot() from public,anon,authenticated;
create trigger guard_cashbarber_blocked_slot before insert or update on public.appointments for each row execute function app_private.guard_cashbarber_blocked_slot();
