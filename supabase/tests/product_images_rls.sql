-- Run after product_images migration. All fixtures and object metadata roll back.
begin;

insert into auth.users (id, email, aud, role, created_at, updated_at) values
  ('74000000-0000-4000-8000-000000000001', 'product-admin-a@example.invalid', 'authenticated', 'authenticated', now(), now()),
  ('74000000-0000-4000-8000-000000000002', 'product-admin-b@example.invalid', 'authenticated', 'authenticated', now(), now()),
  ('74000000-0000-4000-8000-000000000003', 'product-barber-a@example.invalid', 'authenticated', 'authenticated', now(), now());
insert into public.barbershops (id, name, slug) values
  ('97000000-0000-4000-8000-000000000011', 'Product A', 'product-fixture-a'),
  ('97000000-0000-4000-8000-000000000012', 'Product B', 'product-fixture-b');
insert into public.memberships (barbershop_id, user_id, role, active) values
  ('97000000-0000-4000-8000-000000000011', '74000000-0000-4000-8000-000000000001', 'admin', true),
  ('97000000-0000-4000-8000-000000000012', '74000000-0000-4000-8000-000000000002', 'admin', true),
  ('97000000-0000-4000-8000-000000000011', '74000000-0000-4000-8000-000000000003', 'barber', true);

insert into public.products (barbershop_id, name, category, price_cents, image_path) values
  ('97000000-0000-4000-8000-000000000011', 'Pomada Premium', 'retail', 3900,
    '97000000-0000-4000-8000-000000000011/products/75000000-0000-4000-8000-000000000001.jpg'),
  ('97000000-0000-4000-8000-000000000011', 'Café Especial', 'bar', 900,
    '97000000-0000-4000-8000-000000000011/products/75000000-0000-4000-8000-000000000002.png');

do $$
begin
  if not exists (select 1 from storage.buckets where id = 'shop-assets' and public
                 and file_size_limit = 2097152)
     or not has_column_privilege('authenticated', 'public.products', 'image_path', 'SELECT')
     or has_column_privilege('anon', 'public.products', 'image_path', 'SELECT') then
    raise exception 'Product image bucket or column permissions are incorrect';
  end if;
  begin
    insert into public.products (barbershop_id, name, price_cents, image_path)
    values ('97000000-0000-4000-8000-000000000011', 'Cross-shop path', 100,
      '97000000-0000-4000-8000-000000000012/products/75000000-0000-4000-8000-000000000003.jpg');
    raise exception 'Cross-shop product image path was accepted';
  exception when check_violation then null;
  end;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '74000000-0000-4000-8000-000000000001', true);
insert into storage.objects (bucket_id, name)
values ('shop-assets', '97000000-0000-4000-8000-000000000011/products/75000000-0000-4000-8000-000000000001.jpg');
do $$
begin
  begin
    insert into storage.objects (bucket_id, name)
    values ('shop-assets', '97000000-0000-4000-8000-000000000012/products/75000000-0000-4000-8000-000000000003.jpg');
    raise exception 'Admin uploaded into another shop';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into storage.objects (bucket_id, name)
    values ('shop-assets', 'not-a-uuid/products/75000000-0000-4000-8000-000000000004.jpg');
    raise exception 'Malformed path was accepted';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '74000000-0000-4000-8000-000000000002', true);
do $$
begin
  if exists (select 1 from storage.objects where bucket_id = 'shop-assets') then
    raise exception 'Another shop can list image object metadata';
  end if;
end;
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '74000000-0000-4000-8000-000000000003', true);
do $$
begin
  begin
    insert into storage.objects (bucket_id, name)
    values ('shop-assets', '97000000-0000-4000-8000-000000000011/products/75000000-0000-4000-8000-000000000005.webp');
    raise exception 'Barber uploaded product image without admin role';
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
  select count(*), max(image_path) into v_count, v_path
  from public.public_products('97000000-0000-4000-8000-000000000011');
  if v_count <> 1 or v_path <> '97000000-0000-4000-8000-000000000011/products/75000000-0000-4000-8000-000000000001.jpg' then
    raise exception 'Public catalog image is missing or internal bar item leaked';
  end if;
end;
$$;
reset role;

rollback;
