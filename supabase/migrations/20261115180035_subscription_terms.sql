-- Termo de aceite da assinatura, por barbearia e por versão. O cliente lê o texto vigente antes de assinar;
-- a versão aceita é enviada na criação do contrato e gravada nele (legal_acceptance) pelo gatilho que
-- captura as condições contratadas. Só existe uma versão vigente por barbearia.
-- O texto de cada barbearia é dado dela e entra direto no banco, não por este arquivo.
create table public.subscription_terms (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  version text not null check (version ~ '^[a-z0-9_]{3,80}$'),
  title text not null check (length(btrim(title)) between 3 and 160),
  -- Frase que o cliente marca para aceitar. Deve ser a mesma registrada no contrato.
  statement text not null check (length(btrim(statement)) between 10 and 300),
  -- Texto integral, em parágrafos separados por linha em branco.
  body text not null check (length(btrim(body)) between 50 and 60000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (barbershop_id, version)
);
create unique index subscription_terms_one_active_uq on public.subscription_terms (barbershop_id) where active;

alter table public.subscription_terms enable row level security;
revoke all on public.subscription_terms from public, anon, authenticated;
grant select on public.subscription_terms to anon, authenticated;

-- Quem vai assinar precisa ler o termo antes de ter conta: a versão vigente de uma barbearia ativa é pública.
create policy subscription_terms_public_read on public.subscription_terms
  for select to anon, authenticated
  using (active and exists (select 1 from public.barbershops s where s.id = subscription_terms.barbershop_id and s.active));

-- Depois do primeiro aceite, o texto de uma versão é prova do que foi contratado: não muda nem some.
-- Correção de texto passa a exigir uma versão nova. Tirar a versão de vigência continua permitido.
create or replace function app_private.guard_subscription_terms()
returns trigger language plpgsql security definer set search_path to ''
as $function$
begin
  if tg_op = 'UPDATE' and new.barbershop_id = old.barbershop_id and new.version = old.version
     and new.title = old.title and new.statement = old.statement and new.body = old.body then
    return new;
  end if;
  if exists (
    select 1 from public.subscriptions s
    where s.barbershop_id = old.barbershop_id
      and s.contract_snapshot->'legal_acceptance'->>'terms_version' = old.version
  ) then
    raise exception 'Este termo já foi aceito em contratos e não pode ser alterado. Publique uma nova versão.' using errcode = '22023';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $function$;
revoke all on function app_private.guard_subscription_terms() from public, anon, authenticated;

create trigger guard_subscription_terms
  before update or delete on public.subscription_terms
  for each row execute function app_private.guard_subscription_terms();
