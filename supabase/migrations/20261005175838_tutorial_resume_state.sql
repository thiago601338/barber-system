-- Store lesson identifiers only. Training fields and customer data never enter this record.
create table public.guided_tour_runs (
 user_id uuid not null references auth.users(id) on delete cascade,
 barbershop_id uuid references public.barbershops(id), role text not null check(role in ('master','admin','barber','client')),
 scope text generated always as (coalesce(barbershop_id::text,'platform')) stored,
 run jsonb, finished_chapters text[] not null default '{}', updated_at timestamptz not null default now(),
 primary key(user_id,scope,role),
 check(run is null or (jsonb_typeof(run)='object' and octet_length(run::text)<=20000)),
 check(cardinality(finished_chapters)<=100)
);
alter table public.guided_tour_runs enable row level security;
create policy tour_own_read on public.guided_tour_runs for select to authenticated using(user_id=(select auth.uid()));
grant select on public.guided_tour_runs to authenticated;
grant all on public.guided_tour_runs to service_role;

create function public.save_guided_tour(p_shop uuid,p_role text,p_run jsonb,p_finished text[]) returns void
language plpgsql security definer set search_path='' as $$
declare uid uuid:=(select auth.uid()); k text; v jsonb;
begin
 if uid is null then raise exception 'Entre na sua conta para continuar' using errcode='42501'; end if;
 if p_role='master' then
  if not app_private.is_platform_admin() then raise exception 'Perfil não permitido' using errcode='42501'; end if;
 elsif p_shop is null or not (
   (p_role in ('admin','barber') and exists(select 1 from public.memberships where user_id=uid and barbershop_id=p_shop and active and role::text=p_role))
   or (p_role='client' and exists(select 1 from public.clients where user_id=uid and barbershop_id=p_shop))
 ) then raise exception 'Perfil não permitido' using errcode='42501'; end if;
 if cardinality(p_finished)>100 or exists(select 1 from unnest(p_finished) id where id is null or length(id) not between 1 and 100 or id !~ '^[a-zA-Z0-9_.:-]+$') then raise exception 'Progresso inválido' using errcode='22023'; end if;
 if p_run is not null then
  if jsonb_typeof(p_run) is distinct from 'object' or octet_length(p_run::text)>20000 or jsonb_typeof(p_run->'chapterIds') is distinct from 'array' or jsonb_typeof(p_run->'completedSteps') is distinct from 'array' or jsonb_typeof(p_run->'skippedModules') is distinct from 'array' or jsonb_typeof(p_run->'stepKey') is distinct from 'string' or length(p_run->>'stepKey') not between 1 and 160 or p_run->>'stepKey' !~ '^[a-zA-Z0-9_.:-]+$' or jsonb_typeof(p_run->'updatedAt') is distinct from 'string' or p_run->>'updatedAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then raise exception 'Progresso inválido' using errcode='22023'; end if;
  begin perform (p_run->>'updatedAt')::timestamptz; exception when others then raise exception 'Progresso inválido' using errcode='22023'; end;
  for k,v in select * from jsonb_each(p_run) loop
   if k not in ('chapterIds','completedSteps','skippedModules','stepKey','updatedAt') then raise exception 'Campo de treino não permitido' using errcode='22023'; end if;
   if k in ('chapterIds','completedSteps','skippedModules') and (jsonb_array_length(v)>300 or exists(select 1 from jsonb_array_elements(v) x where jsonb_typeof(x) is distinct from 'string' or length(x#>>'{}') not between 1 and 160 or x#>>'{}' !~ '^[a-zA-Z0-9_.:-]+$')) then raise exception 'Progresso inválido' using errcode='22023'; end if;
  end loop;
 end if;
 insert into public.guided_tour_runs(user_id,barbershop_id,role,run,finished_chapters) values(uid,p_shop,p_role,p_run,coalesce(p_finished,'{}'))
 on conflict(user_id,scope,role) do update set run=excluded.run,finished_chapters=excluded.finished_chapters,updated_at=now();
end $$;
revoke all on function public.save_guided_tour(uuid,text,jsonb,text[]) from public,anon;
grant execute on function public.save_guided_tour(uuid,text,jsonb,text[]) to authenticated;
