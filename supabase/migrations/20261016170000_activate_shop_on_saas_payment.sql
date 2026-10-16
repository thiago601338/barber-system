-- Barbearia criada pela inscrição só é liberada quando a assinatura do Barber System for aprovada.
create or replace function app_private.activate_shop_on_saas_payment() returns trigger
language plpgsql security definer set search_path to ''
as $function$
begin
  if new.status = 'authorized' and (tg_op = 'INSERT' or old.status is distinct from 'authorized') then
    update public.barbershops set active = true, updated_at = now()
      where id = new.barbershop_id and created_via = 'self_service' and not active;
  end if;
  return new;
end $function$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'activate_shop_on_saas_payment' and tgrelid = 'public.platform_subscriptions'::regclass) then
    create trigger activate_shop_on_saas_payment after insert or update of status on public.platform_subscriptions
      for each row execute function app_private.activate_shop_on_saas_payment();
  end if;
end $$;
update public.barbershops b set active = false, updated_at = now()
  where b.created_via = 'self_service' and b.active and b.onboarding_completed_at is null
    and not exists (select 1 from public.platform_subscriptions ps where ps.barbershop_id = b.id and ps.status = 'authorized');
