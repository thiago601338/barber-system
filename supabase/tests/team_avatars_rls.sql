-- Run after team_avatars. Fixtures and object metadata are rolled back.
begin;

insert into auth.users (id, email, aud, role, created_at, updated_at) values
  ('75000000-0000-4000-8000-000000000001', 'team-admin-a@example.invalid', 'authenticated', 'authenticated', now(), now()),
  ('75000000-0000-4000-8000-000000000002', 'team-admin-b@example.invalid', 'authenticated', 'authenticated', now(), now()),
  ('75000000-0000-4000-8000-000000000003', 'team-barber-a@example.invalid', 'authenticated', 'authenticated', now(), now()),
  ('75000000-0000-4000-8000-000000000004', 'team-barber-inactive@example.invalid', 'authenticated', 'authenticated', now(), now());
insert into public.barbershops (id, name, slug) values
  ('97000000-0000-4000-8000-000000000021', 'Team A', 'team-fixture-a'),
  ('97000000-0000-4000-8000-000000000022', 'Team B', 'team-fixture-b');
insert into public.memberships (id, barbershop_id, user_id, role, display_name, active) values
  ('76000000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000021', '75000000-0000-4000-8000-000000000001', 'admin', 'Admin A', true),
  ('76000000-0000-4000-8000-000000000002', '97000000-0000-4000-8000-000000000022', '75000000-0000-4000-8000-000000000002', 'admin', 'Admin B', true),
  ('76000000-0000-4000-8000-000000000003', '97000000-0000-4000-8000-000000000021', '75000000-0000-4000-8000-000000000003', 'barber', 'Barbeiro A', true),
  ('76000000-0000-4000-8000-000000000004', '97000000-0000-4000-8000-000000000021', '75000000-0000-4000-8000-000000000004', 'barber', 'Barbeiro inativo', false);

do $$
begin
  if not has_column_privilege('authenticated', 'public.memberships', 'avatar_path', 'UPDATE')
    or has_table_privilege('anon', 'public.memberships', 'SELECT') then
    raise exception 'Team photo column grants are incorrect';
  end if;
  begin
    update public.memberships set avatar_path =
      '97000000-0000-4000-8000-000000000022/team/76000000-0000-4000-8000-000000000003/77000000-0000-4000-8000-000000000001.jpg'
    where id = '76000000-0000-4000-8000-000000000003';
    raise exception 'Cross-shop avatar path was accepted';
  exception when check_violation then null;
  end;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '75000000-0000-4000-8000-000000000001', true);
insert into storage.objects (bucket_id, name)
values ('shop-assets', '97000000-0000-4000-8000-000000000021/team/76000000-0000-4000-8000-000000000003/77000000-0000-4000-8000-000000000001.jpg');
update public.memberships set avatar_path =
  '97000000-0000-4000-8000-000000000021/team/76000000-0000-4000-8000-000000000003/77000000-0000-4000-8000-000000000001.jpg'
where id = '76000000-0000-4000-8000-000000000003';
do $$
begin
  begin
    insert into storage.objects (bucket_id, name)
    values ('shop-assets', '97000000-0000-4000-8000-000000000022/team/76000000-0000-4000-8000-000000000002/77000000-0000-4000-8000-000000000002.png');
    raise exception 'Admin uploaded into another shop';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into storage.objects (bucket_id, name)
    values ('shop-assets', '97000000-0000-4000-8000-000000000021/team/76000000-0000-4000-8000-000000000002/77000000-0000-4000-8000-000000000003.webp');
    raise exception 'Admin uploaded into a different shop member folder';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '75000000-0000-4000-8000-000000000002', true);
do $$
begin
  if exists (select 1 from storage.objects where bucket_id = 'shop-assets') then
    raise exception 'Another shop listed team image metadata';
  end if;
  if exists (select 1 from public.memberships where id = '76000000-0000-4000-8000-000000000003') then
    raise exception 'Another shop read team membership';
  end if;
end;
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '75000000-0000-4000-8000-000000000003', true);
do $$
begin
  begin
    insert into storage.objects (bucket_id, name)
    values ('shop-assets', '97000000-0000-4000-8000-000000000021/team/76000000-0000-4000-8000-000000000003/77000000-0000-4000-8000-000000000004.jpg');
    raise exception 'Barber uploaded without admin role';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

set local role anon;
do $$
declare
  v_count integer;
  v_path text;
begin
  select count(*), max(avatar_path) into v_count, v_path
  from public.public_barber_profiles('97000000-0000-4000-8000-000000000021');
  if v_count <> 1 or v_path <> '97000000-0000-4000-8000-000000000021/team/76000000-0000-4000-8000-000000000003/77000000-0000-4000-8000-000000000001.jpg' then
    raise exception 'Public barber profile exposes wrong team members or photo';
  end if;
end;
$$;
reset role;

rollback;
