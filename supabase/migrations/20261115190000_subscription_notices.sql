-- Avisos automáticos de assinatura por WhatsApp: fila preenchida pelo banco quando o contrato ou a
-- cobrança muda, e esvaziada por uma função agendada que envia modelos aprovados pela Meta.
-- Momentos: assinatura confirmada, cobrança recusada (na hora e um lembrete dias depois, se seguir
-- em aberto) e assinatura cancelada depois de cobrança recusada. Só contratos do Mercado Pago.
create table public.subscription_notices (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  kind text not null check (kind in ('welcome','payment_failed','payment_reminder','cancelled')),
  -- Impede o mesmo aviso duas vezes para o mesmo fato.
  dedupe_key text not null unique,
  status text not null default 'pending' check (status in ('pending','sending','sent','failed','skipped','expired')),
  send_after timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  provider_message_id text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now()
);
create index subscription_notices_queue_idx on public.subscription_notices (send_after) where status = 'pending';
create index subscription_notices_shop_idx on public.subscription_notices (barbershop_id, created_at desc);

alter table public.subscription_notices enable row level security;
revoke all on public.subscription_notices from public, anon, authenticated;
grant select on public.subscription_notices to authenticated;
create policy subscription_notices_admin_read on public.subscription_notices
  for select to authenticated using (app_private.has_shop_role(barbershop_id, array['admin'::public.shop_role]));

create or replace function app_private.enqueue_subscription_notice(p_shop uuid, p_subscription uuid, p_kind text, p_key text, p_send_after timestamptz default now())
returns void language plpgsql security definer set search_path to ''
as $function$
begin
  insert into public.subscription_notices (barbershop_id, subscription_id, kind, dedupe_key, send_after)
  values (p_shop, p_subscription, p_kind, p_key, p_send_after)
  on conflict (dedupe_key) do nothing;
exception when others then
  -- O aviso nunca pode impedir a gravação do contrato ou do pagamento.
  raise warning 'subscription notice not queued: %', sqlerrm;
end $function$;
revoke all on function app_private.enqueue_subscription_notice(uuid, uuid, text, text, timestamptz) from public, anon, authenticated;

-- Contrato: boas-vindas na primeira ativação; aviso final quando cai depois de cobrança recusada.
create or replace function app_private.subscription_notice_on_status()
returns trigger language plpgsql security definer set search_path to ''
as $function$
declare v_last text;
begin
  if new.provider <> 'mercadopago' or new.status is not distinct from old.status then return new; end if;
  if new.status = 'active' then
    perform app_private.enqueue_subscription_notice(new.barbershop_id, new.id, 'welcome', 'welcome:' || new.id);
  elsif new.status = 'cancelled' then
    select p.status into v_last from public.payments p
      where p.subscription_id = new.id and p.status in ('paid','rejected')
      order by coalesce(p.paid_at, p.updated_at) desc limit 1;
    if v_last = 'rejected' or old.status = 'past_due' then
      perform app_private.enqueue_subscription_notice(new.barbershop_id, new.id, 'cancelled', 'cancelled:' || new.id);
    end if;
  end if;
  return new;
end $function$;
revoke all on function app_private.subscription_notice_on_status() from public, anon, authenticated;
create trigger subscription_notice_on_status after update of status on public.subscriptions
  for each row execute function app_private.subscription_notice_on_status();

-- Cobrança recusada: um aviso por sequência de tentativas (o Mercado Pago tenta de novo por até 10 dias)
-- e um lembrete 6 dias depois, que a função de envio descarta se a mensalidade já tiver sido paga.
create or replace function app_private.subscription_notice_on_payment()
returns trigger language plpgsql security definer set search_path to ''
as $function$
declare v_provider text; v_open timestamptz;
begin
  if new.subscription_id is null or new.status <> 'rejected' or (tg_op = 'UPDATE' and old.status = 'rejected') then return new; end if;
  select s.provider into v_provider from public.subscriptions s where s.id = new.subscription_id;
  if v_provider is distinct from 'mercadopago' then return new; end if;
  -- Já existe aviso desta sequência se houve um nos últimos 12 dias sem pagamento aprovado depois dele.
  select max(n.created_at) into v_open from public.subscription_notices n
    where n.subscription_id = new.subscription_id and n.kind = 'payment_failed' and n.created_at > now() - interval '12 days';
  if v_open is not null and not exists (
    select 1 from public.payments p where p.subscription_id = new.subscription_id and p.status = 'paid' and p.paid_at > v_open
  ) then return new; end if;
  perform app_private.enqueue_subscription_notice(new.barbershop_id, new.subscription_id, 'payment_failed', 'failed:' || new.id);
  perform app_private.enqueue_subscription_notice(new.barbershop_id, new.subscription_id, 'payment_reminder', 'reminder:' || new.id, now() + interval '6 days');
  return new;
end $function$;
revoke all on function app_private.subscription_notice_on_payment() from public, anon, authenticated;
create trigger subscription_notice_on_payment after insert or update of status on public.payments
  for each row execute function app_private.subscription_notice_on_payment();
