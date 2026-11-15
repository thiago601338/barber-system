-- Convite de assinatura: a página pública e a tela de Assinaturas precisam saber se a barbearia
-- já recebe pagamentos online, sem ler nada da integração. A função só responde sim ou não.
create or replace function public.subscription_checkout_ready(p_barbershop_id uuid)
returns boolean language sql stable security definer set search_path to ''
as $function$
  select exists (
    select 1
    from public.integration_credentials c
    join public.barbershops s on s.id = c.barbershop_id
    where c.barbershop_id = p_barbershop_id
      and c.provider = 'mercadopago'
      and c.provider_account_id is not null
      and s.active
  );
$function$;

revoke all on function public.subscription_checkout_ready(uuid) from public, anon, authenticated;
grant execute on function public.subscription_checkout_ready(uuid) to anon, authenticated;
