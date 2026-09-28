-- Run after tenant_branding migration. Fixtures are rolled back.
begin;

insert into auth.users (id, email, aud, role, created_at, updated_at) values
  ('73000000-0000-4000-8000-000000000001', 'brand-admin-a@example.invalid', 'authenticated', 'authenticated', now(), now()),
  ('73000000-0000-4000-8000-000000000002', 'brand-admin-b@example.invalid', 'authenticated', 'authenticated', now(), now()),
  ('73000000-0000-4000-8000-000000000003', 'brand-barber-a@example.invalid', 'authenticated', 'authenticated', now(), now());
insert into public.barbershops (id, name, slug, instagram_url) values
  ('97000000-0000-4000-8000-000000000001', 'Brand A', 'brand-fixture-a', 'https://www.instagram.com/brand_a/'),
  ('97000000-0000-4000-8000-000000000002', 'Brand B', 'brand-fixture-b', 'https://www.instagram.com/brand_b/');
insert into public.memberships (barbershop_id, user_id, role, active) values
  ('97000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000001', 'admin', true),
  ('97000000-0000-4000-8000-000000000002', '73000000-0000-4000-8000-000000000002', 'admin', true),
  ('97000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000003', 'barber', true);

insert into public.brand_proposals (
  id, barbershop_id, instagram_url, source_status, source_evidence,
  proposed_theme, rationale, generated_by
) values (
  '98000000-0000-4000-8000-000000000001',
  '97000000-0000-4000-8000-000000000001',
  'https://www.instagram.com/brand_a/',
  'admin_notes_only',
  '[{"source":"administrator_notes","text":"Wood and copper"}]'::jsonb,
  '{"palette":{"background":"#111111","surface":"#202020","sidebar":"#111111","text":"#FFFFFF","muted":"#BBBBBB","accent":"#D5AA68","accentText":"#111111","border":"#666666"},"headingFont":"cinzel","bodyFont":"sans","tagline":"Cuidado com assinatura própria","heroImageUrl":"/brands/test.webp","logoUrl":null}'::jsonb,
  'Proposta inspirada nas notas do administrador.',
  '73000000-0000-4000-8000-000000000001'
);

do $$
begin
  if not has_column_privilege('anon', 'public.barbershops', 'brand_theme', 'SELECT')
    or has_column_privilege('authenticated', 'public.barbershops', 'brand_theme', 'UPDATE')
    or has_table_privilege('anon', 'public.brand_proposals', 'SELECT')
    or has_table_privilege('authenticated', 'public.brand_proposals', 'INSERT')
    or has_function_privilege('authenticated', 'public.publish_brand_proposal(uuid,uuid,uuid)', 'EXECUTE') then
    raise exception 'Branding grants are too broad or public theme is unreadable';
  end if;
end;
$$;

set local role anon;
do $$
begin
  if (select brand_theme from public.barbershops where slug = 'brand-fixture-a') <> '{}'::jsonb then
    raise exception 'Draft theme leaked to anonymous visitor';
  end if;
end;
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '73000000-0000-4000-8000-000000000001', true);
do $$
begin
  if (select count(*) from public.brand_proposals) <> 1 then
    raise exception 'Shop administrator cannot read own proposal';
  end if;
  begin
    update public.barbershops set brand_theme = '{"tagline":"bypass"}'::jsonb
    where slug = 'brand-fixture-a';
    raise exception 'Shop administrator bypassed review';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '73000000-0000-4000-8000-000000000002', true);
do $$
begin
  if (select count(*) from public.brand_proposals) <> 0 then
    raise exception 'Cross-shop proposal leak';
  end if;
end;
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '73000000-0000-4000-8000-000000000003', true);
do $$
begin
  if (select count(*) from public.brand_proposals) <> 0 then
    raise exception 'Barber can read private brand proposal';
  end if;
end;
$$;
reset role;

set local role service_role;
do $$
begin
  begin
    perform public.publish_brand_proposal(
      '97000000-0000-4000-8000-000000000001',
      '98000000-0000-4000-8000-000000000001',
      '73000000-0000-4000-8000-000000000002'
    );
    raise exception 'Another shop administrator published a proposal';
  exception when insufficient_privilege then null;
  end;
  perform public.publish_brand_proposal(
    '97000000-0000-4000-8000-000000000001',
    '98000000-0000-4000-8000-000000000001',
    '73000000-0000-4000-8000-000000000001'
  );
  if (select status from public.brand_proposals where id = '98000000-0000-4000-8000-000000000001') <> 'published'
    or (select brand_theme ->> 'tagline' from public.barbershops where slug = 'brand-fixture-a') <> 'Cuidado com assinatura própria' then
    raise exception 'Reviewed theme was not published atomically';
  end if;
end;
$$;
reset role;

set local role anon;
do $$
begin
  if (select brand_theme ->> 'headingFont' from public.barbershops where slug = 'brand-fixture-a') <> 'cinzel' then
    raise exception 'Published theme is not visible on public shop';
  end if;
end;
$$;
reset role;

rollback;
