-- Staff photos use the shared shop-assets bucket, with a folder bound to the
-- shop and membership. Only a shop administrator can upload or change them.
alter table public.memberships add column avatar_path text;
alter table public.memberships add constraint memberships_avatar_path_shop_check
  check (
    avatar_path is null or avatar_path ~ (
      '^' || barbershop_id::text || '/team/' || id::text ||
      '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|png|webp)$'
    )
  );

grant update (avatar_path) on public.memberships to authenticated;

create policy shop_team_image_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'shop-assets'
    and case when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/team/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|png|webp)$'
      then app_private.has_shop_role(split_part(name, '/', 1)::uuid, array['admin']::public.shop_role[])
        and exists (
          select 1 from public.memberships m
          where m.barbershop_id = split_part(name, '/', 1)::uuid
            and m.id = split_part(name, '/', 3)::uuid
            and m.active
        )
      else false end
  );

create policy shop_team_image_select on storage.objects
  for select to authenticated using (
    bucket_id = 'shop-assets'
    and case when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/team/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|png|webp)$'
      then app_private.has_shop_role(split_part(name, '/', 1)::uuid, array['admin']::public.shop_role[])
      else false end
  );

create policy shop_team_image_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'shop-assets'
    and case when name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/team/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|png|webp)$'
      then app_private.has_shop_role(split_part(name, '/', 1)::uuid, array['admin']::public.shop_role[])
      else false end
  );

-- The public booking page receives only active barbers and their approved
-- photo path. Internal staff profiles and membership metadata remain private.
create function app_private.public_barber_profiles(p_barbershop_id uuid)
returns table (id uuid, display_name text, avatar_path text)
language sql stable security definer set search_path = ''
as $$
  select m.id,
    coalesce(nullif(btrim(m.display_name), ''), pr.full_name, 'Barbeiro'),
    m.avatar_path
  from public.memberships m
  join public.barbershops sh on sh.id = m.barbershop_id
  left join public.profiles pr on pr.user_id = m.user_id
  where m.barbershop_id = p_barbershop_id
    and m.role = 'barber' and m.active and sh.active
  order by 2, 1;
$$;
revoke execute on function app_private.public_barber_profiles(uuid)
  from public, anon, authenticated;
grant execute on function app_private.public_barber_profiles(uuid)
  to anon, authenticated;

create function public.public_barber_profiles(p_barbershop_id uuid)
returns table (id uuid, display_name text, avatar_path text)
language sql stable security invoker set search_path = ''
as $$
  select b.id, b.display_name, b.avatar_path
  from app_private.public_barber_profiles(p_barbershop_id) b;
$$;
revoke execute on function public.public_barber_profiles(uuid)
  from public, anon, authenticated;
grant execute on function public.public_barber_profiles(uuid)
  to anon, authenticated;
