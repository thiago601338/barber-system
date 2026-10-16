alter table public.barbershops add column if not exists onboarding_completed_at timestamptz;
alter table public.barbershops add column if not exists created_via text not null default 'master' check (created_via in ('master','self_service'));
update public.barbershops set onboarding_completed_at = coalesce(onboarding_completed_at, now()) where created_via = 'master';
comment on column public.barbershops.onboarding_completed_at is 'Quando o dono concluiu o passo a passo de configuração (/comecar).';
grant select (created_via, onboarding_completed_at) on public.barbershops to authenticated;
comment on column public.barbershops.created_via is 'master = criada pelo administrador; self_service = criada pela inscrição pública.';

-- barber_profiles_without_login: o dono que atende vira um profissional sem login.
alter table public.memberships drop constraint if exists archived_staff_has_no_access;
alter table public.memberships add constraint staff_without_login_is_barber_only check (
  user_id is not null
  or role = 'barber'
  or (import_source = 'cashbarber' and source_id is not null and not active)
);
