-- Public product photos are stored under the owning shop's UUID. Only shop
-- administrators can upload or remove files; the public catalog receives
-- the approved path without supplier costs or internal stock details.
alter table public.products add column image_path text;
alter table public.products add constraint products_image_path_shop_check
  check (
    image_path is null or image_path ~ (
      '^' || barbershop_id::text ||
      '/products/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|png|webp)$'
    )
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shop-assets', 'shop-assets', true, 2097152,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy shop_product_image_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'shop-assets'
    and case when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/products/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|png|webp)$'
      then app_private.has_shop_role(split_part(name, '/', 1)::uuid, array['admin']::public.shop_role[])
      else false end
  );
create policy shop_product_image_select on storage.objects
  for select to authenticated using (
    bucket_id = 'shop-assets'
    and case when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/products/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|png|webp)$'
      then app_private.has_shop_role(split_part(name, '/', 1)::uuid, array['admin']::public.shop_role[])
      else false end
  );
create policy shop_product_image_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'shop-assets'
    and case when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/products/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|png|webp)$'
      then app_private.has_shop_role(split_part(name, '/', 1)::uuid, array['admin']::public.shop_role[])
      else false end
  );

drop function public.public_products(uuid);
create function public.public_products(p_barbershop_id uuid)
returns table (
  id uuid,
  name text,
  description text,
  category text,
  price_cents integer,
  in_stock boolean,
  image_path text
)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.name, p.description, p.category, p.price_cents,
         p.stock_quantity > 0 as in_stock, p.image_path
  from public.products p
  join public.barbershops s on s.id = p.barbershop_id
  where p.barbershop_id = p_barbershop_id
    and p.active and p.category = 'retail' and s.active
  order by p.name;
$$;
revoke execute on function public.public_products(uuid)
  from public, anon, authenticated;
grant execute on function public.public_products(uuid)
  to anon, authenticated;
