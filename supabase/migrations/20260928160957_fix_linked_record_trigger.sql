-- A trigger shared by several tables must branch before touching fields that
-- do not exist in every table's NEW record.
create or replace function app_private.validate_linked_records()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_table_name = 'appointments' then
    if new.subscription_id is not null and not exists (
      select 1 from public.subscriptions s
      where s.barbershop_id = new.barbershop_id
        and s.id = new.subscription_id
        and s.client_id = new.client_id
    ) then
      raise exception 'Appointment subscription belongs to another client'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'procedure_records' then
    if new.appointment_id is not null and not exists (
      select 1 from public.appointments a
      where a.barbershop_id = new.barbershop_id
        and a.id = new.appointment_id
        and a.client_id = new.client_id
        and a.barber_membership_id = new.barber_membership_id
    ) then
      raise exception 'Procedure appointment and client/barber do not match'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'chemical_records' then
    if new.procedure_record_id is not null and not exists (
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
  elsif tg_table_name = 'bar_orders' then
    if new.appointment_id is not null and not exists (
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
