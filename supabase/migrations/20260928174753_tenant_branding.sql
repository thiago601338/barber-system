-- Only the approved visual tokens are exposed with the public shop profile.
-- Drafts, source excerpts and admin notes live in a separate, private table.
alter table public.barbershops
  add column brand_theme jsonb not null default '{}'::jsonb
    check (jsonb_typeof(brand_theme) = 'object' and octet_length(brand_theme::text) <= 16000);

grant select (brand_theme) on public.barbershops to anon, authenticated;

create table public.brand_proposals (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  instagram_url text not null,
  source_status text not null
    check (source_status in ('public_metadata', 'admin_notes_only')),
  source_evidence jsonb not null default '[]'::jsonb
    check (jsonb_typeof(source_evidence) = 'array' and octet_length(source_evidence::text) <= 16000),
  operator_notes text,
  proposed_theme jsonb not null
    check (jsonb_typeof(proposed_theme) = 'object' and octet_length(proposed_theme::text) <= 16000),
  rationale text not null check (length(rationale) between 1 and 3000),
  limitations text[] not null default '{}',
  status text not null default 'pending'
    check (status in ('pending', 'published', 'superseded')),
  generated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  published_by uuid references auth.users(id),
  check ((status = 'published' and published_at is not null and published_by is not null)
    or status <> 'published')
);

create index brand_proposals_shop_created_idx
  on public.brand_proposals (barbershop_id, created_at desc);

alter table public.brand_proposals enable row level security;
revoke all on public.brand_proposals from public, anon, authenticated;
grant select on public.brand_proposals to authenticated;

create policy brand_proposals_admin_read on public.brand_proposals
  for select to authenticated using (
    app_private.has_shop_role(barbershop_id, array['admin']::public.shop_role[])
  );

-- One transaction replaces the approved theme and marks its source proposal.
-- It is callable only with the server's service key; it is SECURITY INVOKER.
create function public.publish_brand_proposal(
  p_barbershop_id uuid, p_proposal_id uuid, p_actor_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_proposal public.brand_proposals%rowtype;
  v_shop public.barbershops%rowtype;
begin
  if not exists (
    select 1 from public.platform_admins p where p.user_id = p_actor_id
  ) and not exists (
    select 1 from public.memberships m
    where m.barbershop_id = p_barbershop_id
      and m.user_id = p_actor_id
      and m.role = 'admin'::public.shop_role and m.active
  ) then
    raise exception 'Brand publication requires an active shop administrator'
      using errcode = '42501';
  end if;

  select * into v_proposal from public.brand_proposals
  where id = p_proposal_id and barbershop_id = p_barbershop_id and status = 'pending'
  for update;
  if not found then
    raise exception 'Brand proposal not found or already published'
      using errcode = 'P0002';
  end if;

  select * into v_shop from public.barbershops
  where id = p_barbershop_id and active for update;
  if not found then
    raise exception 'Barbershop is not active' using errcode = 'P0002';
  end if;

  if v_shop.instagram_url is distinct from v_proposal.instagram_url then
    raise exception 'Instagram link changed; run the analysis again'
      using errcode = '23514';
  end if;

  update public.brand_proposals set status = 'superseded'
  where barbershop_id = p_barbershop_id and status = 'published';

  update public.barbershops
  set brand_theme = v_proposal.proposed_theme, updated_at = now()
  where id = p_barbershop_id;

  update public.brand_proposals
  set status = 'published', published_at = now(), published_by = p_actor_id
  where id = p_proposal_id;

  return jsonb_build_object(
    'id', p_proposal_id,
    'barbershop_id', p_barbershop_id,
    'status', 'published'
  );
end;
$$;

revoke execute on function public.publish_brand_proposal(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.publish_brand_proposal(uuid, uuid, uuid)
  to service_role;
