-- Scheduling constraints are enforced in the reservation transaction, not only in the calendar.
create table public.service_scheduling_profiles (
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  service_id uuid not null,
  buffer_before_minutes integer not null default 0 check (buffer_before_minutes between 0 and 120),
  buffer_after_minutes integer not null default 0 check (buffer_after_minutes between 0 and 120),
  primary key (barbershop_id,service_id),
  foreign key (barbershop_id,service_id) references public.services(barbershop_id,id) on delete cascade
);
create table public.barber_service_timings (
  barbershop_id uuid not null,
  barber_membership_id uuid not null,
  service_id uuid not null,
  duration_minutes integer not null check (duration_minutes between 5 and 480),
  buffer_before_minutes integer not null default 0 check (buffer_before_minutes between 0 and 120),
  buffer_after_minutes integer not null default 0 check (buffer_after_minutes between 0 and 120),
  primary key (barbershop_id,barber_membership_id,service_id),
  foreign key (barbershop_id,barber_membership_id) references public.memberships(barbershop_id,id) on delete cascade,
  foreign key (barbershop_id,service_id) references public.services(barbershop_id,id) on delete cascade
);
create table public.schedule_resources (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  capacity integer not null default 1 check (capacity between 1 and 20),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (barbershop_id,id)
);
create table public.service_resource_requirements (
  barbershop_id uuid not null,
  service_id uuid not null,
  resource_id uuid not null,
  units integer not null default 1 check (units between 1 and 20),
  primary key (barbershop_id,service_id,resource_id),
  foreign key (barbershop_id,service_id) references public.services(barbershop_id,id) on delete cascade,
  foreign key (barbershop_id,resource_id) references public.schedule_resources(barbershop_id,id) on delete cascade
);
create table public.schedule_blocks (
  id uuid primary key default gen_random_uuid(),
  barbershop_id uuid not null references public.barbershops(id) on delete cascade,
  barber_membership_id uuid,
  resource_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  reason text not null check (length(trim(reason)) between 1 and 500),
  created_at timestamptz not null default now(),
  foreign key (barbershop_id,barber_membership_id) references public.memberships(barbershop_id,id),
  foreign key (barbershop_id,resource_id) references public.schedule_resources(barbershop_id,id)
);
create index schedule_blocks_shop_time on public.schedule_blocks (barbershop_id,starts_at,ends_at);
create table public.shop_booking_policies (
  barbershop_id uuid primary key references public.barbershops(id) on delete cascade,
  cancellation_hours integer not null default 24 check (cancellation_hours between 0 and 168),
  reschedule_hours integer not null default 12 check (reschedule_hours between 0 and 168),
  confirmation_required boolean not null default false,
  deposit_amount_cents integer not null default 0 check (deposit_amount_cents between 0 and 1000000)
);
alter table public.appointments add column buffer_before_minutes integer not null default 0 check (buffer_before_minutes between 0 and 120),
 add column buffer_after_minutes integer not null default 0 check (buffer_after_minutes between 0 and 120),
 add column occupied_starts_at timestamptz,
 add column occupied_ends_at timestamptz,
 add column client_confirmed_at timestamptz,
 add column cancellation_reason text;
alter table public.appointments drop constraint appointments_no_barber_overlap;
alter table public.appointments add constraint appointments_no_barber_overlap exclude using gist
 (barber_membership_id with =, tstzrange(coalesce(occupied_starts_at,starts_at),coalesce(occupied_ends_at,ends_at),'[)') with &&)
 where (status in ('pending','confirmed','in_progress'));
create table public.appointment_resources (
  barbershop_id uuid not null,
  appointment_id uuid not null,
  resource_id uuid not null,
  units integer not null check (units between 1 and 20),
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  primary key (barbershop_id,appointment_id,resource_id),
  foreign key (barbershop_id,appointment_id) references public.appointments(barbershop_id,id) on delete cascade,
  foreign key (barbershop_id,resource_id) references public.schedule_resources(barbershop_id,id)
);
create index appointment_resources_time on public.appointment_resources (barbershop_id,resource_id,starts_at,ends_at);
create table public.appointment_deposits (
 id uuid primary key default gen_random_uuid(),
 barbershop_id uuid not null,
 appointment_id uuid not null,
 amount_cents integer not null check (amount_cents > 0),
 status text not null default 'requires_provider' check (status in ('requires_provider','pending','paid','waived','cancelled')),
 provider_payment_id text,
 created_at timestamptz not null default now(),
 unique (barbershop_id,appointment_id),
 foreign key (barbershop_id,appointment_id) references public.appointments(barbershop_id,id) on delete cascade
);
-- Pending deposits are not payments, revenue or automatically marked paid.
alter table public.service_scheduling_profiles enable row level security;
alter table public.barber_service_timings enable row level security;
alter table public.schedule_resources enable row level security;
alter table public.service_resource_requirements enable row level security;
alter table public.schedule_blocks enable row level security;
alter table public.shop_booking_policies enable row level security;
alter table public.appointment_resources enable row level security;
alter table public.appointment_deposits enable row level security;
grant select,insert,update,delete on public.service_scheduling_profiles,public.barber_service_timings,public.schedule_resources,public.service_resource_requirements,public.schedule_blocks,public.shop_booking_policies to authenticated;
grant select on public.appointment_resources,public.appointment_deposits to authenticated;
create policy schedule_profiles_read on public.service_scheduling_profiles for select to authenticated using (app_private.has_module(barbershop_id,'services') or app_private.has_module(barbershop_id,'appointments'));
create policy schedule_profiles_manage on public.service_scheduling_profiles for all to authenticated using (app_private.has_shop_role(barbershop_id,array['admin']::public.shop_role[])) with check (app_private.has_shop_role(barbershop_id,array['admin']::public.shop_role[]));
create policy barber_timings_read on public.barber_service_timings for select to authenticated using (app_private.has_module(barbershop_id,'services') or app_private.has_module(barbershop_id,'appointments'));
create policy barber_timings_manage on public.barber_service_timings for all to authenticated using (app_private.has_shop_role(barbershop_id,array['admin']::public.shop_role[]) or (app_private.has_module(barbershop_id,'services') and app_private.is_own_barber(barbershop_id,barber_membership_id))) with check (app_private.has_shop_role(barbershop_id,array['admin']::public.shop_role[]) or (app_private.has_module(barbershop_id,'services') and app_private.is_own_barber(barbershop_id,barber_membership_id)));
create policy resources_read on public.schedule_resources for select to authenticated using (app_private.has_module(barbershop_id,'services') or app_private.has_module(barbershop_id,'appointments'));
create policy resources_manage on public.schedule_resources for all to authenticated using (app_private.has_shop_role(barbershop_id,array['admin']::public.shop_role[])) with check (app_private.has_shop_role(barbershop_id,array['admin']::public.shop_role[]));
create policy requirements_read on public.service_resource_requirements for select to authenticated using (app_private.has_module(barbershop_id,'services') or app_private.has_module(barbershop_id,'appointments'));
create policy requirements_manage on public.service_resource_requirements for all to authenticated using (app_private.has_shop_role(barbershop_id,array['admin']::public.shop_role[])) with check (app_private.has_shop_role(barbershop_id,array['admin']::public.shop_role[]));
create policy blocks_read on public.schedule_blocks for select to authenticated using (app_private.has_module(barbershop_id,'services') or app_private.has_module(barbershop_id,'appointments'));
create policy blocks_manage on public.schedule_blocks for all to authenticated using (app_private.has_shop_role(barbershop_id,array['admin']::public.shop_role[]) or ((app_private.has_module(barbershop_id,'services') or app_private.has_module(barbershop_id,'appointments')) and app_private.is_own_barber(barbershop_id,barber_membership_id) and resource_id is null)) with check (app_private.has_shop_role(barbershop_id,array['admin']::public.shop_role[]) or ((app_private.has_module(barbershop_id,'services') or app_private.has_module(barbershop_id,'appointments')) and app_private.is_own_barber(barbershop_id,barber_membership_id) and resource_id is null));
create policy policies_read on public.shop_booking_policies for select to authenticated using (app_private.has_module(barbershop_id,'services') or app_private.has_module(barbershop_id,'appointments'));
create policy policies_manage on public.shop_booking_policies for all to authenticated using (app_private.has_shop_role(barbershop_id,array['admin']::public.shop_role[])) with check (app_private.has_shop_role(barbershop_id,array['admin']::public.shop_role[]));
create policy appointment_resources_read on public.appointment_resources for select to authenticated using (app_private.can_read_appointment(barbershop_id,appointment_id));
create policy deposits_read on public.appointment_deposits for select to authenticated using (app_private.can_read_appointment(barbershop_id,appointment_id));

create function app_private.appointment_duration_minutes(p_barbershop_id uuid,p_barber_membership_id uuid,p_service_ids uuid[]) returns integer
 language sql stable security definer set search_path='' as $$
 select sum(coalesce(t.duration_minutes,s.duration_minutes))::integer from public.services s
 left join public.barber_service_timings t on t.barbershop_id=s.barbershop_id and t.service_id=s.id and t.barber_membership_id=p_barber_membership_id
 where s.barbershop_id=p_barbershop_id and s.id=any(p_service_ids);
$$;
revoke all on function app_private.appointment_duration_minutes(uuid,uuid,uuid[]) from public,anon,authenticated;

create function app_private.appointment_schedule_details(p_barbershop_id uuid,p_barber_membership_id uuid,p_service_ids uuid[],p_starts_at timestamptz,p_ignore_appointment_id uuid default null)
 returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_zone text; v_duration integer; v_before integer; v_after integer; v_end timestamptz; v_from timestamptz; v_until timestamptz; v_day date; v_reason text; v_resource record; v_peak integer;
begin
 select timezone into v_zone from public.barbershops where id=p_barbershop_id and active;
 if v_zone is null or p_starts_at is null or p_service_ids is null or cardinality(p_service_ids) not between 1 and 8 or (select count(distinct x) from unnest(p_service_ids) x)<>cardinality(p_service_ids) then return jsonb_build_object('available',false,'reason','Escolha uma barbearia, profissional e procedimentos válidos.'); end if;
 if (select count(*) from public.services s where s.barbershop_id=p_barbershop_id and s.id=any(p_service_ids) and app_private.public_barber_service_visible(p_barbershop_id,p_barber_membership_id,s.id))<>cardinality(p_service_ids) then return jsonb_build_object('available',false,'reason','Profissional ou procedimento indisponível.'); end if;
 select sum(coalesce(t.duration_minutes,s.duration_minutes)),max(coalesce(t.buffer_before_minutes,p.buffer_before_minutes,0)),max(coalesce(t.buffer_after_minutes,p.buffer_after_minutes,0)) into v_duration,v_before,v_after from public.services s
 left join public.service_scheduling_profiles p on p.barbershop_id=s.barbershop_id and p.service_id=s.id
 left join public.barber_service_timings t on t.barbershop_id=s.barbershop_id and t.service_id=s.id and t.barber_membership_id=p_barber_membership_id
 where s.barbershop_id=p_barbershop_id and s.id=any(p_service_ids);
 v_end:=p_starts_at+v_duration*interval '1 minute'; v_from:=p_starts_at-v_before*interval '1 minute'; v_until:=v_end+v_after*interval '1 minute'; v_day:=(p_starts_at at time zone v_zone)::date;
 if p_starts_at<=now() then v_reason:='Escolha um horário futuro.';
 elsif not exists (
  select 1 from (
   select r.start_time,r.end_time from public.availability_rules r where r.barbershop_id=p_barbershop_id and r.barber_membership_id=p_barber_membership_id and r.active and r.weekday=extract(dow from v_day)::integer and not exists(select 1 from public.availability_exceptions e where e.barbershop_id=p_barbershop_id and e.barber_membership_id=p_barber_membership_id and e.day=v_day)
   union all select e.start_time,e.end_time from public.availability_exceptions e where e.barbershop_id=p_barbershop_id and e.barber_membership_id=p_barber_membership_id and e.day=v_day and not e.unavailable
  ) w where v_from >= (v_day+w.start_time) at time zone v_zone and v_until <= (v_day+w.end_time) at time zone v_zone
 ) then v_reason:='A duração e os intervalos precisam caber na jornada do profissional.';
 elsif app_private.cashbarber_slot_blocked(p_barbershop_id,p_barber_membership_id,v_from,v_until) then v_reason:='Há um bloqueio de agenda nesse horário.';
 elsif exists(select 1 from public.schedule_blocks b where b.barbershop_id=p_barbershop_id and (b.barber_membership_id=p_barber_membership_id or (b.barber_membership_id is null and b.resource_id is null)) and tstzrange(b.starts_at,b.ends_at,'[)')&&tstzrange(v_from,v_until,'[)')) then v_reason:='O profissional ou a barbearia está bloqueado nesse período.';
 elsif exists(select 1 from public.appointments a where a.barbershop_id=p_barbershop_id and a.barber_membership_id=p_barber_membership_id and a.id is distinct from p_ignore_appointment_id and a.status in ('pending','confirmed','in_progress') and tstzrange(coalesce(a.occupied_starts_at,a.starts_at),coalesce(a.occupied_ends_at,a.ends_at),'[)')&&tstzrange(v_from,v_until,'[)')) then v_reason:='Esse período já está ocupado, incluindo os intervalos do atendimento.';
 end if;
 if v_reason is null then
  for v_resource in select r.id,r.capacity,r.active,max(q.units)::integer as units from public.service_resource_requirements q join public.schedule_resources r on r.barbershop_id=q.barbershop_id and r.id=q.resource_id where q.barbershop_id=p_barbershop_id and q.service_id=any(p_service_ids) group by r.id,r.capacity,r.active loop
   if not v_resource.active or v_resource.units>v_resource.capacity or exists(select 1 from public.schedule_blocks b where b.barbershop_id=p_barbershop_id and b.resource_id=v_resource.id and tstzrange(b.starts_at,b.ends_at,'[)')&&tstzrange(v_from,v_until,'[)')) then v_reason:='Um recurso necessário está indisponível.'; exit; end if;
   with reservations as (select ar.* from public.appointment_resources ar join public.appointments a on a.barbershop_id=ar.barbershop_id and a.id=ar.appointment_id where ar.barbershop_id=p_barbershop_id and ar.resource_id=v_resource.id and ar.appointment_id is distinct from p_ignore_appointment_id and a.status in ('pending','confirmed','in_progress') and tstzrange(ar.starts_at,ar.ends_at,'[)')&&tstzrange(v_from,v_until,'[)')
    union all select a.barbershop_id,a.id,q.resource_id,max(q.units)::integer,coalesce(a.occupied_starts_at,a.starts_at),coalesce(a.occupied_ends_at,a.ends_at) from public.appointments a join public.appointment_services aps on aps.barbershop_id=a.barbershop_id and aps.appointment_id=a.id join public.service_resource_requirements q on q.barbershop_id=aps.barbershop_id and q.service_id=aps.service_id where a.barbershop_id=p_barbershop_id and q.resource_id=v_resource.id and a.id is distinct from p_ignore_appointment_id and a.status in ('pending','confirmed','in_progress') and not exists(select 1 from public.appointment_resources snap where snap.barbershop_id=a.barbershop_id and snap.appointment_id=a.id) and tstzrange(coalesce(a.occupied_starts_at,a.starts_at),coalesce(a.occupied_ends_at,a.ends_at),'[)')&&tstzrange(v_from,v_until,'[)') group by a.barbershop_id,a.id,q.resource_id,a.occupied_starts_at,a.starts_at,a.occupied_ends_at,a.ends_at),
   moments as (select v_from as moment union select starts_at from reservations where starts_at>=v_from and starts_at<v_until)
   select coalesce(max((select coalesce(sum(r.units),0) from reservations r where r.starts_at<=m.moment and r.ends_at>m.moment)),0)::integer into v_peak from moments m;
   if v_peak+v_resource.units>v_resource.capacity then v_reason:='Não há capacidade de recursos para esse horário.'; exit; end if;
  end loop;
 end if;
 return jsonb_build_object('available',v_reason is null,'duration_minutes',v_duration,'buffer_before_minutes',v_before,'buffer_after_minutes',v_after,'ends_at',v_end,'occupied_starts_at',v_from,'occupied_ends_at',v_until,'reason',v_reason);
end;
$$;
revoke all on function app_private.appointment_schedule_details(uuid,uuid,uuid[],timestamptz,uuid) from public,anon,authenticated;

create function app_private.commit_appointment_schedule(p_barbershop_id uuid,p_appointment_id uuid,p_service_ids uuid[]) returns void language plpgsql security definer set search_path='' as $$
declare v_appointment public.appointments; v_details jsonb; v_policy public.shop_booking_policies;
begin
 perform pg_advisory_xact_lock(hashtext(p_barbershop_id::text),hashtext('appointment_schedule'));
 select * into strict v_appointment from public.appointments where barbershop_id=p_barbershop_id and id=p_appointment_id for update;
 v_details:=app_private.appointment_schedule_details(p_barbershop_id,v_appointment.barber_membership_id,p_service_ids,v_appointment.starts_at,p_appointment_id);
 if not coalesce((v_details->>'available')::boolean,false) then raise exception '%',coalesce(v_details->>'reason','Horário indisponível.') using errcode='23514'; end if;
 update public.appointments set ends_at=(v_details->>'ends_at')::timestamptz,buffer_before_minutes=(v_details->>'buffer_before_minutes')::integer,buffer_after_minutes=(v_details->>'buffer_after_minutes')::integer,occupied_starts_at=(v_details->>'occupied_starts_at')::timestamptz,occupied_ends_at=(v_details->>'occupied_ends_at')::timestamptz where barbershop_id=p_barbershop_id and id=p_appointment_id;
 delete from public.appointment_resources where barbershop_id=p_barbershop_id and appointment_id=p_appointment_id;
 insert into public.appointment_resources(barbershop_id,appointment_id,resource_id,units,starts_at,ends_at) select p_barbershop_id,p_appointment_id,q.resource_id,max(q.units),(v_details->>'occupied_starts_at')::timestamptz,(v_details->>'occupied_ends_at')::timestamptz from public.service_resource_requirements q where q.barbershop_id=p_barbershop_id and q.service_id=any(p_service_ids) group by q.resource_id;
 select * into v_policy from public.shop_booking_policies where barbershop_id=p_barbershop_id;
 if v_policy.deposit_amount_cents>0 and v_appointment.subscription_id is null then insert into public.appointment_deposits(barbershop_id,appointment_id,amount_cents) values(p_barbershop_id,p_appointment_id,v_policy.deposit_amount_cents) on conflict(barbershop_id,appointment_id) do nothing; end if;
end;
$$;
revoke all on function app_private.commit_appointment_schedule(uuid,uuid,uuid[]) from public,anon,authenticated;

create or replace function app_private.available_slots(p_barbershop_id uuid,p_barber_membership_id uuid,p_service_ids uuid[],p_day date) returns table(starts_at timestamptz,ends_at timestamptz) language sql stable security definer set search_path='' as $$
 with shop as (select timezone from public.barbershops where id=p_barbershop_id and active),windows as (
 select r.start_time,r.end_time from public.availability_rules r where r.barbershop_id=p_barbershop_id and r.barber_membership_id=p_barber_membership_id and r.active and r.weekday=extract(dow from p_day)::integer and not exists(select 1 from public.availability_exceptions e where e.barbershop_id=p_barbershop_id and e.barber_membership_id=p_barber_membership_id and e.day=p_day)
 union all select e.start_time,e.end_time from public.availability_exceptions e where e.barbershop_id=p_barbershop_id and e.barber_membership_id=p_barber_membership_id and e.day=p_day and not e.unavailable
 ),candidates as (select distinct candidate from windows w cross join shop s cross join lateral generate_series((p_day+w.start_time) at time zone s.timezone,(p_day+w.end_time) at time zone s.timezone,interval '15 minutes') candidate),details as (
 select candidate,app_private.appointment_schedule_details(p_barbershop_id,p_barber_membership_id,p_service_ids,candidate) detail from candidates
 ) select candidate,(detail->>'ends_at')::timestamptz from details where (detail->>'available')::boolean order by candidate;
$$;

create function app_private.public_booking_policy(p_barbershop_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('cancellation_hours',coalesce(p.cancellation_hours,24),'reschedule_hours',coalesce(p.reschedule_hours,12),'confirmation_required',coalesce(p.confirmation_required,false),'deposit_amount_cents',coalesce(p.deposit_amount_cents,0),'deposit_collection_ready',false)
 from public.barbershops s left join public.shop_booking_policies p on p.barbershop_id=s.id where s.id=p_barbershop_id and s.active;
$$;
revoke all on function app_private.public_booking_policy(uuid) from public;
grant execute on function app_private.public_booking_policy(uuid) to anon,authenticated;
create function public.public_booking_policy(p_barbershop_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$ select app_private.public_booking_policy(p_barbershop_id); $$;
revoke all on function public.public_booking_policy(uuid) from public;
grant execute on function public.public_booking_policy(uuid) to anon,authenticated;

create function app_private.manage_appointment(p_barbershop_id uuid,p_appointment_id uuid,p_action text,p_starts_at timestamptz default null,p_reason text default null) returns uuid language plpgsql security definer set search_path='' as $$
declare v_a public.appointments; v_staff boolean; v_policy public.shop_booking_policies; v_ids uuid[]; v_details jsonb; v_eligibility jsonb;
begin
 if auth.uid() is null then raise exception 'Entre na sua conta.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtext(p_barbershop_id::text),hashtext('appointment_schedule'));
 select * into strict v_a from public.appointments where barbershop_id=p_barbershop_id and id=p_appointment_id for update;
 v_staff:=app_private.has_shop_role(p_barbershop_id,array['admin']::public.shop_role[]) or (app_private.has_module(p_barbershop_id,'appointments') and app_private.is_own_barber(p_barbershop_id,v_a.barber_membership_id));
 if not v_staff and not app_private.is_own_client(p_barbershop_id,v_a.client_id) then raise exception 'Você não tem acesso a esse agendamento.' using errcode='42501'; end if;
 if v_a.status in ('completed','cancelled','no_show') then raise exception 'Esse atendimento já foi encerrado.' using errcode='23514'; end if;
 select * into v_policy from public.shop_booking_policies where barbershop_id=p_barbershop_id;
 if p_action='confirm' then
  if v_a.status not in ('pending','confirmed') then raise exception 'A presença já passou da etapa de confirmação.' using errcode='23514'; end if;
  update public.appointments set status='confirmed',client_confirmed_at=case when not v_staff then now() else client_confirmed_at end where id=p_appointment_id;
 elsif p_action in ('start','complete','no_show') then
  if not v_staff then raise exception 'Ação exclusiva da equipe.' using errcode='42501'; end if;
  if p_action='no_show' and v_a.status='in_progress' then raise exception 'Atendimento em andamento não pode ser marcado como falta.' using errcode='23514'; end if;
  if v_a.starts_at>now() then raise exception 'O horário do atendimento ainda não chegou.' using errcode='23514'; end if;
  update public.appointments set status=case p_action when 'start' then 'in_progress'::public.appointment_status when 'complete' then 'completed'::public.appointment_status else 'no_show'::public.appointment_status end where id=p_appointment_id;
 elsif p_action='cancel' then
  if not v_staff and v_a.starts_at-now()<coalesce(v_policy.cancellation_hours,24)*interval '1 hour' then raise exception 'O prazo para cancelar pela área do cliente terminou. Entre em contato com a barbearia.' using errcode='23514'; end if;
  update public.appointments set status='cancelled',cancellation_reason=nullif(trim(p_reason),'') where id=p_appointment_id;
  update public.appointment_deposits set status='cancelled' where appointment_id=p_appointment_id and status in ('requires_provider','pending');
 elsif p_action='reschedule' then
  if v_a.status='in_progress' then raise exception 'Um atendimento em andamento não pode ser reagendado.' using errcode='23514'; end if;
  if not v_staff and v_a.starts_at-now()<coalesce(v_policy.reschedule_hours,12)*interval '1 hour' then raise exception 'O prazo para reagendar pela área do cliente terminou. Entre em contato com a barbearia.' using errcode='23514'; end if;
  select array_agg(service_id) into v_ids from public.appointment_services where barbershop_id=p_barbershop_id and appointment_id=p_appointment_id;
  v_details:=app_private.appointment_schedule_details(p_barbershop_id,v_a.barber_membership_id,v_ids,p_starts_at,p_appointment_id);
  if not coalesce((v_details->>'available')::boolean,false) then raise exception '%',coalesce(v_details->>'reason','Horário indisponível.') using errcode='23514'; end if;
  if v_a.subscription_id is not null then
   select app_private.subscription_eligibility_for_booking(p_barbershop_id,v_a.client_id,v_ids,p_starts_at,p_appointment_id) into v_eligibility;
   if not exists(select 1 from jsonb_array_elements(v_eligibility->'subscriptions') s where s->>'id'=v_a.subscription_id::text) then raise exception 'A assinatura não cobre o novo horário ou não tem saldo.' using errcode='23514'; end if;
  end if;
  update public.appointments set starts_at=p_starts_at,ends_at=(v_details->>'ends_at')::timestamptz,occupied_starts_at=(v_details->>'occupied_starts_at')::timestamptz,occupied_ends_at=(v_details->>'occupied_ends_at')::timestamptz,client_confirmed_at=null where id=p_appointment_id;
  perform app_private.commit_appointment_schedule(p_barbershop_id,p_appointment_id,v_ids);
 else raise exception 'Ação inválida.' using errcode='23514'; end if;
 return p_appointment_id;
end;
$$;
revoke all on function app_private.manage_appointment(uuid,uuid,text,timestamptz,text) from public,anon;
grant execute on function app_private.manage_appointment(uuid,uuid,text,timestamptz,text) to authenticated;
create function public.manage_appointment(p_barbershop_id uuid,p_appointment_id uuid,p_action text,p_starts_at timestamptz default null,p_reason text default null) returns uuid language sql security invoker set search_path='' as $$ select app_private.manage_appointment(p_barbershop_id,p_appointment_id,p_action,p_starts_at,p_reason); $$;
revoke all on function public.manage_appointment(uuid,uuid,text,timestamptz,text) from public,anon;
grant execute on function public.manage_appointment(uuid,uuid,text,timestamptz,text) to authenticated;

create function app_private.reschedule_slots(p_barbershop_id uuid,p_appointment_id uuid,p_day date) returns table(starts_at timestamptz,ends_at timestamptz) language plpgsql stable security definer set search_path='' as $$
declare v_a public.appointments; v_ids uuid[]; v_zone text;
begin
 if auth.uid() is null or not app_private.can_read_appointment(p_barbershop_id,p_appointment_id) then raise exception 'Acesso negado.' using errcode='42501'; end if;
 select * into strict v_a from public.appointments where barbershop_id=p_barbershop_id and id=p_appointment_id;
 select timezone into v_zone from public.barbershops where id=p_barbershop_id;
 select array_agg(service_id) into v_ids from public.appointment_services where barbershop_id=p_barbershop_id and appointment_id=p_appointment_id;
 return query select c,(d->>'ends_at')::timestamptz from generate_series(p_day::timestamp at time zone v_zone,((p_day+1)::timestamp at time zone v_zone)-interval '1 minute',interval '15 minutes') c cross join lateral (select app_private.appointment_schedule_details(p_barbershop_id,v_a.barber_membership_id,v_ids,c,p_appointment_id) d) detail where (d->>'available')::boolean;
end;
$$;
revoke all on function app_private.reschedule_slots(uuid,uuid,date) from public,anon;
grant execute on function app_private.reschedule_slots(uuid,uuid,date) to authenticated;
create function public.reschedule_slots(p_barbershop_id uuid,p_appointment_id uuid,p_day date) returns table(starts_at timestamptz,ends_at timestamptz) language sql stable security invoker set search_path='' as $$ select * from app_private.reschedule_slots(p_barbershop_id,p_appointment_id,p_day); $$;
revoke all on function public.reschedule_slots(uuid,uuid,date) from public,anon;
grant execute on function public.reschedule_slots(uuid,uuid,date) to authenticated;
create function app_private.save_service_resources(p_barbershop_id uuid,p_service_id uuid,p_resource_ids uuid[]) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not app_private.has_shop_role(p_barbershop_id,array['admin']::public.shop_role[]) then raise exception 'Somente administradores podem definir recursos.' using errcode='42501'; end if;
 if not exists(select 1 from public.services where barbershop_id=p_barbershop_id and id=p_service_id) or (select count(*) from public.schedule_resources r where r.barbershop_id=p_barbershop_id and r.id=any(p_resource_ids) and r.active)<>cardinality(p_resource_ids) then raise exception 'Recursos ou serviço inválidos.' using errcode='23514'; end if;
 perform pg_advisory_xact_lock(hashtext(p_barbershop_id::text),hashtext('appointment_schedule'));
 delete from public.service_resource_requirements where barbershop_id=p_barbershop_id and service_id=p_service_id;
 insert into public.service_resource_requirements(barbershop_id,service_id,resource_id,units) select p_barbershop_id,p_service_id,r,1 from unnest(p_resource_ids) r;
end;
$$;
revoke all on function app_private.save_service_resources(uuid,uuid,uuid[]) from public,anon;
grant execute on function app_private.save_service_resources(uuid,uuid,uuid[]) to authenticated;
create function public.save_service_resources(p_barbershop_id uuid,p_service_id uuid,p_resource_ids uuid[]) returns void language sql security invoker set search_path='' as $$ select app_private.save_service_resources(p_barbershop_id,p_service_id,p_resource_ids); $$;
revoke all on function public.save_service_resources(uuid,uuid,uuid[]) from public,anon;
grant execute on function public.save_service_resources(uuid,uuid,uuid[]) to authenticated;

create function app_private.create_schedule_block(p_barbershop_id uuid,p_barber_id uuid,p_resource_id uuid,p_starts_local timestamp,p_ends_local timestamp,p_reason text) returns uuid language plpgsql security definer set search_path='' as $$
declare v_zone text; v_id uuid;
begin
 if auth.uid() is null or not (app_private.has_shop_role(p_barbershop_id,array['admin']::public.shop_role[]) or ((app_private.has_module(p_barbershop_id,'services') or app_private.has_module(p_barbershop_id,'appointments')) and app_private.is_own_barber(p_barbershop_id,p_barber_id) and p_resource_id is null)) then raise exception 'Você não pode bloquear esse período.' using errcode='42501'; end if;
 select timezone into strict v_zone from public.barbershops where id=p_barbershop_id;
 if p_barber_id is not null and not exists(select 1 from public.memberships m where m.barbershop_id=p_barbershop_id and m.id=p_barber_id and m.active and m.role='barber') then raise exception 'Profissional inválido.' using errcode='23514'; end if;
 insert into public.schedule_blocks(barbershop_id,barber_membership_id,resource_id,starts_at,ends_at,reason) values(p_barbershop_id,p_barber_id,p_resource_id,p_starts_local at time zone v_zone,p_ends_local at time zone v_zone,p_reason) returning id into v_id;
 return v_id;
end;
$$;
revoke all on function app_private.create_schedule_block(uuid,uuid,uuid,timestamp,timestamp,text) from public,anon;
grant execute on function app_private.create_schedule_block(uuid,uuid,uuid,timestamp,timestamp,text) to authenticated;
create function public.create_schedule_block(p_barbershop_id uuid,p_barber_id uuid,p_resource_id uuid,p_starts_local timestamp,p_ends_local timestamp,p_reason text) returns uuid language sql security invoker set search_path='' as $$ select app_private.create_schedule_block(p_barbershop_id,p_barber_id,p_resource_id,p_starts_local,p_ends_local,p_reason); $$;
revoke all on function public.create_schedule_block(uuid,uuid,uuid,timestamp,timestamp,text) from public,anon;
grant execute on function public.create_schedule_block(uuid,uuid,uuid,timestamp,timestamp,text) to authenticated;
