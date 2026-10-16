-- Foto automática por IA para produtos cadastrados sem imagem.
alter table public.products add column if not exists image_ai_status text;
alter table public.products add column if not exists image_ai_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'products_image_ai_status_check') then
    alter table public.products add constraint products_image_ai_status_check check (image_ai_status is null or image_ai_status in ('pending','done','failed'));
  end if;
end $$;
create index if not exists products_image_ai_at_idx on public.products (barbershop_id, image_ai_at) where image_ai_at is not null;
