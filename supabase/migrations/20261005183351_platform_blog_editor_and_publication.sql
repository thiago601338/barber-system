-- Global editorial content, separate from tenant/client data and mini-bio pages.
create table public.platform_blog_categories (
 id uuid primary key default gen_random_uuid(),slug text not null unique check(slug~'^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug)<=100),
 name text not null check(length(btrim(name)) between 2 and 100),description text not null default '' check(length(description)<=400),
 position integer not null default 0 check(position between 0 and 1000),active boolean not null default true,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.platform_blog_posts (
 id uuid primary key default gen_random_uuid(),slug text not null unique check(slug~'^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug)<=160),
 title text not null check(length(btrim(title)) between 4 and 180),excerpt text not null default '' check(length(excerpt)<=500),
 body_md text not null check(length(body_md) between 1 and 120000),category_id uuid references public.platform_blog_categories(id),
 tags text[] not null default '{}' check(cardinality(tags)<=12),
 status text not null default 'draft' check(status in ('draft','scheduled','published')),
 scheduled_at timestamptz,published_at timestamptz,ever_public boolean not null default false,
 seo_title text check(length(seo_title)<=160),seo_description text check(length(seo_description)<=320),
 cover_url text check(length(cover_url)<=2048),cover_alt text not null default '' check(length(cover_alt)<=240),
 author_name text not null default 'Equipe Barber System' check(length(btrim(author_name)) between 2 and 120),
 revision integer not null default 1 check(revision>0),created_by uuid not null references auth.users(id),updated_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 search_document tsvector generated always as (setweight(to_tsvector('portuguese',coalesce(title,'')),'A')||setweight(to_tsvector('portuguese',coalesce(excerpt,'')),'B')||setweight(to_tsvector('portuguese',coalesce(body_md,'')),'C')) stored,
 check(status<>'scheduled' or scheduled_at is not null),check(status<>'published' or published_at is not null)
);
create index platform_blog_search on public.platform_blog_posts using gin(search_document);
create index platform_blog_category on public.platform_blog_posts(category_id,status);
create index platform_blog_published on public.platform_blog_posts(published_at desc) where status='published';
create index platform_blog_scheduled on public.platform_blog_posts(scheduled_at) where status='scheduled';
create table public.platform_blog_audit (
 id uuid primary key default gen_random_uuid(),record_type text not null check(record_type in ('post','category')),record_id uuid not null,
 actor_id uuid not null references auth.users(id),action text not null,status_before text,status_after text,revision integer,
 changed_fields text[] not null,created_at timestamptz not null default now()
);
create index platform_blog_audit_record on public.platform_blog_audit(record_type,record_id,created_at desc);

create function app_private.platform_blog_post_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from unnest(new.tags)t where t is null or length(btrim(t)) not between 1 and 40) then raise exception 'Marcadores inválidos' using errcode='22023';end if;
 if tg_op='UPDATE' then
  if (old.ever_public or old.status='published' or (old.status='scheduled' and old.scheduled_at<=now())) and new.slug is distinct from old.slug then
   raise exception 'O endereço de um artigo publicado permanece fixo. Crie outro artigo para usar um novo endereço.' using errcode='22023';end if;
  new.ever_public:=old.ever_public or old.status='published' or (old.status='scheduled' and old.scheduled_at<=now());
  new.revision:=old.revision+1;new.created_by:=old.created_by;new.created_at:=old.created_at;
 end if;
 if new.status='published' then new.published_at:=coalesce(new.published_at,case when tg_op='UPDATE' and old.status='scheduled' and old.scheduled_at<=now() then old.scheduled_at else now() end);new.ever_public:=true;end if;
 new.updated_at:=now();return new;
end $$;
revoke all on function app_private.platform_blog_post_guard() from public,anon,authenticated;
create trigger platform_blog_guard before insert or update on public.platform_blog_posts for each row execute function app_private.platform_blog_post_guard();
create trigger platform_blog_category_updated before update on public.platform_blog_categories for each row execute function app_private.touch_updated_at();

alter table public.platform_blog_posts enable row level security;
alter table public.platform_blog_categories enable row level security;
alter table public.platform_blog_audit enable row level security;
revoke all on public.platform_blog_posts,public.platform_blog_categories,public.platform_blog_audit from public,anon,authenticated;
grant all on public.platform_blog_posts,public.platform_blog_categories,public.platform_blog_audit to service_role;
grant select on public.platform_blog_categories to anon,authenticated;
grant select(id,slug,title,excerpt,body_md,category_id,tags,status,scheduled_at,published_at,seo_title,seo_description,cover_url,cover_alt,author_name,created_at,updated_at,search_document) on public.platform_blog_posts to anon,authenticated;
grant select on public.platform_blog_audit to authenticated;
create policy blog_category_visible on public.platform_blog_categories for select to anon,authenticated using(active);
create policy blog_category_master on public.platform_blog_categories for select to authenticated using((select app_private.is_platform_admin()));
create policy blog_post_visible on public.platform_blog_posts for select to anon,authenticated using(
 ((status='published' and published_at<=now()) or (status='scheduled' and scheduled_at<=now()))
 and (category_id is null or exists(select 1 from public.platform_blog_categories c where c.id=category_id and c.active))
);
create policy blog_post_master on public.platform_blog_posts for select to authenticated using((select app_private.is_platform_admin()));
create policy blog_audit_master on public.platform_blog_audit for select to authenticated using((select app_private.is_platform_admin()));

-- The explicit visibility predicate is necessary even when the SSR caller is a service role.
create function public.blog_public_index(p_search text default '',p_category text default null,p_page integer default 1,p_size integer default 12) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;total bigint;cat jsonb;
begin
 if length(coalesce(p_search,''))>100 or p_page is null or p_size is null or p_page not between 1 and 10000 or p_size not between 1 and 24 then raise exception 'Filtro inválido' using errcode='22023';end if;
 if p_category is not null then select jsonb_build_object('slug',slug,'name',name,'description',description) into cat from public.platform_blog_categories where slug=p_category and active;if cat is null then return jsonb_build_object('posts','[]'::jsonb,'total',0,'category_missing',true,'categories','[]'::jsonb);end if;end if;
 with visible as (select p.id,p.slug,p.title,p.excerpt,p.body_md,p.tags,p.cover_url,p.cover_alt,p.author_name,p.updated_at,c.name category_name,c.slug category_slug,case when p.status='published' then p.published_at else p.scheduled_at end visible_at
  from public.platform_blog_posts p left join public.platform_blog_categories c on c.id=p.category_id and c.active
  where ((p.status='published' and p.published_at<=now()) or (p.status='scheduled' and p.scheduled_at<=now())) and (p.category_id is null or c.id is not null)
  and (p_category is null or c.slug=p_category) and (nullif(btrim(p_search),'') is null or p.search_document@@websearch_to_tsquery('portuguese',p_search))),
 page as (select * from visible order by visible_at desc,id limit p_size offset (p_page-1)*p_size)
 select (select count(*) from visible),(select coalesce(jsonb_agg(jsonb_build_object('id',id,'slug',slug,'title',title,'excerpt',excerpt,'category_name',category_name,'category_slug',category_slug,'tags',tags,'visible_at',visible_at,'updated_at',updated_at,'cover_url',cover_url,'cover_alt',cover_alt,'author_name',author_name,'reading_minutes',greatest(1,ceil(array_length(regexp_split_to_array(body_md,'\s+'),1)::numeric/200))) order by visible_at desc,id),'[]') from page) into total,result;
 return jsonb_build_object('posts',result,'total',total,'page',p_page,'page_size',p_size,'category',cat,'categories',(select coalesce(jsonb_agg(jsonb_build_object('slug',slug,'name',name,'description',description) order by position,name),'[]') from public.platform_blog_categories where active));
end $$;
revoke all on function public.blog_public_index(text,text,integer,integer) from public;
grant execute on function public.blog_public_index(text,text,integer,integer) to anon,authenticated,service_role;

create function public.blog_public_article(p_slug text) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',p.id,'slug',p.slug,'title',p.title,'excerpt',p.excerpt,'body_md',p.body_md,'category_name',c.name,'category_slug',c.slug,'tags',p.tags,
  'visible_at',case when p.status='published' then p.published_at else p.scheduled_at end,'updated_at',p.updated_at,'seo_title',p.seo_title,'seo_description',p.seo_description,'cover_url',p.cover_url,'cover_alt',p.cover_alt,'author_name',p.author_name)
 from public.platform_blog_posts p left join public.platform_blog_categories c on c.id=p.category_id and c.active
 where p.slug=p_slug and ((p.status='published' and p.published_at<=now()) or (p.status='scheduled' and p.scheduled_at<=now())) and (p.category_id is null or c.id is not null)
$$;
revoke all on function public.blog_public_article(text) from public;
grant execute on function public.blog_public_article(text) to anon,authenticated,service_role;

create function public.blog_public_sitemap() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('posts',(select coalesce(jsonb_agg(jsonb_build_object('slug',p.slug,'updated_at',p.updated_at,'visible_at',case when p.status='published' then p.published_at else p.scheduled_at end) order by p.slug),'[]') from public.platform_blog_posts p left join public.platform_blog_categories c on c.id=p.category_id and c.active where ((p.status='published' and p.published_at<=now()) or (p.status='scheduled' and p.scheduled_at<=now())) and (p.category_id is null or c.id is not null)),
 'categories',(select coalesce(jsonb_agg(jsonb_build_object('slug',slug,'updated_at',updated_at) order by slug),'[]') from public.platform_blog_categories where active))
$$;
revoke all on function public.blog_public_sitemap() from public;
grant execute on function public.blog_public_sitemap() to anon,authenticated,service_role;

create function public.manage_platform_blog_post(p_actor uuid,p_id uuid,p_values jsonb,p_expected_revision integer default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare old public.platform_blog_posts;result public.platform_blog_posts;k text;v jsonb;fields text[];
begin
 if not exists(select 1 from public.platform_admins where user_id=p_actor) then raise exception 'Somente o master pode editar o blog' using errcode='42501';end if;
 if p_values is null or jsonb_typeof(p_values)<>'object' then raise exception 'Artigo inválido' using errcode='22023';end if;
 for k,v in select * from jsonb_each(p_values) loop if k not in ('slug','title','excerpt','body_md','category_id','tags','status','scheduled_at','seo_title','seo_description','cover_url','cover_alt','author_name') then raise exception 'Campo não permitido: %',k using errcode='22023';end if;end loop;
 select array_agg(key order by key) into fields from jsonb_object_keys(p_values)key;
 if p_id is not null then
  select * into old from public.platform_blog_posts where id=p_id for update;
  if old.id is null then raise exception 'Artigo não encontrado' using errcode='22023';end if;
  if p_expected_revision is distinct from old.revision then raise exception 'Este artigo mudou. Recarregue antes de salvar.' using errcode='22023';end if;
  update public.platform_blog_posts set slug=case when p_values?'slug' then p_values->>'slug' else slug end,title=case when p_values?'title' then p_values->>'title' else title end,
   excerpt=case when p_values?'excerpt' then coalesce(p_values->>'excerpt','') else excerpt end,body_md=case when p_values?'body_md' then p_values->>'body_md' else body_md end,
   category_id=case when p_values?'category_id' then nullif(p_values->>'category_id','')::uuid else category_id end,
   tags=case when p_values?'tags' then array(select jsonb_array_elements_text(p_values->'tags')) else tags end,
   status=case when p_values?'status' then p_values->>'status' else status end,scheduled_at=case when p_values?'scheduled_at' then nullif(p_values->>'scheduled_at','')::timestamptz else scheduled_at end,
   seo_title=case when p_values?'seo_title' then nullif(p_values->>'seo_title','') else seo_title end,seo_description=case when p_values?'seo_description' then nullif(p_values->>'seo_description','') else seo_description end,
   cover_url=case when p_values?'cover_url' then nullif(p_values->>'cover_url','') else cover_url end,cover_alt=case when p_values?'cover_alt' then coalesce(p_values->>'cover_alt','') else cover_alt end,
   author_name=case when p_values?'author_name' then p_values->>'author_name' else author_name end,updated_by=p_actor where id=old.id returning * into result;
 else
  insert into public.platform_blog_posts(slug,title,excerpt,body_md,category_id,tags,status,scheduled_at,seo_title,seo_description,cover_url,cover_alt,author_name,created_by,updated_by)
  values(p_values->>'slug',p_values->>'title',coalesce(p_values->>'excerpt',''),p_values->>'body_md',nullif(p_values->>'category_id','')::uuid,array(select jsonb_array_elements_text(coalesce(p_values->'tags','[]'))),coalesce(p_values->>'status','draft'),nullif(p_values->>'scheduled_at','')::timestamptz,
   nullif(p_values->>'seo_title',''),nullif(p_values->>'seo_description',''),nullif(p_values->>'cover_url',''),coalesce(p_values->>'cover_alt',''),coalesce(nullif(p_values->>'author_name',''),'Equipe Barber System'),p_actor,p_actor) returning * into result;
 end if;
 insert into public.platform_blog_audit(record_type,record_id,actor_id,action,status_before,status_after,revision,changed_fields) values('post',result.id,p_actor,case when old.id is null then 'create' else 'update' end,old.status,result.status,result.revision,coalesce(fields,'{}'));
 return to_jsonb(result)-'search_document';
end $$;
revoke all on function public.manage_platform_blog_post(uuid,uuid,jsonb,integer) from public,anon,authenticated;
grant execute on function public.manage_platform_blog_post(uuid,uuid,jsonb,integer) to service_role;

create function public.manage_platform_blog_category(p_actor uuid,p_id uuid,p_values jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result public.platform_blog_categories;k text;v jsonb;
begin
 if not exists(select 1 from public.platform_admins where user_id=p_actor) then raise exception 'Somente o master pode editar o blog' using errcode='42501';end if;
 if p_values is null or jsonb_typeof(p_values)<>'object' then raise exception 'Categoria inválida' using errcode='22023';end if;
 for k,v in select * from jsonb_each(p_values) loop if k not in ('slug','name','description','position','active') then raise exception 'Campo não permitido: %',k using errcode='22023';end if;end loop;
 if p_id is not null then
  update public.platform_blog_categories set name=case when p_values?'name' then p_values->>'name' else name end,description=case when p_values?'description' then coalesce(p_values->>'description','') else description end,
   position=case when p_values?'position' then (p_values->>'position')::integer else position end,active=case when p_values?'active' then (p_values->>'active')::boolean else active end where id=p_id returning * into result;
  if result.id is null then raise exception 'Categoria não encontrada' using errcode='22023';end if;
  if p_values?'slug' and p_values->>'slug'<>result.slug then raise exception 'O endereço da categoria permanece fixo' using errcode='22023';end if;
 else insert into public.platform_blog_categories(slug,name,description,position,active) values(p_values->>'slug',p_values->>'name',coalesce(p_values->>'description',''),coalesce((p_values->>'position')::integer,0),coalesce((p_values->>'active')::boolean,true)) returning * into result;end if;
 insert into public.platform_blog_audit(record_type,record_id,actor_id,action,changed_fields) values('category',result.id,p_actor,case when p_id is null then 'create' else 'update' end,array(select jsonb_object_keys(p_values)));
 return to_jsonb(result);
end $$;
revoke all on function public.manage_platform_blog_category(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.manage_platform_blog_category(uuid,uuid,jsonb) to service_role;
