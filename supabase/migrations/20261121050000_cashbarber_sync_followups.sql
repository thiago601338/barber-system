-- Aplicadas direto no projeto em 21/11/2026 (registro):
-- * barbeiros: ativos = os 10 ativos no CashBarber (Philipe e Melke ativados com seus serviços; "tt" desativado)
-- * public.reconcile_subscription_entitlement: assinaturas provider=cashbarber têm status vindo da sincronização
-- * app_private.enforce_appointment_status / guard_cashbarber_blocked_slot: a sincronização (dono do banco) pode reabrir/remarcar agendamentos do CashBarber
-- * public.agenda_day_blocks(p_shop, p_from, p_to): bloqueios/intervalos/folgas do dia para a agenda
-- * subscription_plans.listed + sincronização de preço/visibilidade dos planos (protect_sold_plan libera só durante a sincronização)
-- * cashbarber_sync_dataset: conjuntos clients, appointments, order_payments, expenses, plans
alter table public.subscription_plans add column if not exists listed boolean not null default true;
alter table public.barbershops add column if not exists payment_methods text[];
grant execute on function app_private.public_barber_profiles(uuid) to service_role;
