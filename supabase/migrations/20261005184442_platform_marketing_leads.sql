-- Requests from the public marketing site. These records are never client fichas.
create table public.platform_leads (
 id uuid primary key default gen_random_uuid(),
 full_name text not null check(length(full_name) between 2 and 100),
 email text not null unique check(length(email)<=254),
 phone text not null check(phone ~ '^[0-9]{10,15}$'),
 business_name text not null check(length(business_name) between 2 and 120),
 profile_type text not null check(profile_type in ('shop_owner','independent')),
 team_size integer not null check(team_size between 1 and 500),
 source_path text not null check(length(source_path)<=100),
 status text not null default 'new' check(status in ('new','contacted','qualified','converted','archived')),
 notes text not null default '' check(length(notes)<=2000),
 consented_at timestamptz not null default now(),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 revision integer not null default 1
);
create index platform_leads_status_created on public.platform_leads(status,created_at desc);
create table app_private.platform_lead_limits (
 bucket_hash text not null check(bucket_hash ~ '^[a-f0-9]{64}$'),
 bucket_start timestamptz not null,
 attempts integer not null default 1,
 primary key(bucket_hash,bucket_start)
);
alter table public.platform_leads enable row level security;
revoke all on public.platform_leads from public,anon,authenticated;
grant select,insert,update on public.platform_leads to service_role;
create function public.capture_platform_lead(p_name text,p_email text,p_phone text,p_business text,p_profile text,p_team integer,p_source text,p_bucket text)
returns void language plpgsql security definer set search_path='' as $$
declare n integer; window_start timestamptz:=date_trunc('hour',now());
begin
 if p_name is null or length(btrim(p_name)) not between 2 and 100
  or p_email is null or length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  or p_phone is null or p_phone !~ '^[0-9]{10,15}$'
  or p_business is null or length(btrim(p_business)) not between 2 and 120
  or p_profile is null or p_profile not in ('shop_owner','independent')
  or p_team is null or p_team not between 1 and 500
  or p_source is null or p_source not in ('/','/agenda-online-para-barbearia','/sistema-barbearia-por-assinatura','/controle-financeiro-barbearia','/site-para-barbearia','/sistema-para-barbeiro-autonomo','/aplicativo-cliente-barbearia','/precos','/blog')
  or p_bucket is null or p_bucket !~ '^[a-f0-9]{64}$'
 then raise exception 'Confira os dados da solicitação' using errcode='22023';end if;
 insert into app_private.platform_lead_limits(bucket_hash,bucket_start) values(p_bucket,window_start)
 on conflict(bucket_hash,bucket_start) do update set attempts=platform_lead_limits.attempts+1 returning attempts into n;
 if n>10 then raise exception 'Aguarde antes de tentar novamente' using errcode='P0001';end if;
 delete from app_private.platform_lead_limits where bucket_start<now()-interval '2 days';
 insert into public.platform_leads(full_name,email,phone,business_name,profile_type,team_size,source_path)
 values(btrim(p_name),lower(btrim(p_email)),p_phone,btrim(p_business),p_profile,p_team,p_source)
 on conflict(email) do nothing;
end $$;
revoke all on function public.capture_platform_lead(text,text,text,text,text,integer,text,text) from public,anon,authenticated;
grant execute on function public.capture_platform_lead(text,text,text,text,text,integer,text,text) to service_role;
-- A request does not create an account, a shop or a bill. The master reviews it
-- and uses the existing shop/admin invitation flow. Independent professionals
-- receive a shop administrator role; employee professionals remain barbers.
