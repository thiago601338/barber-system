-- CRM follow-up is manual. Loyalty remains disabled until the administrator configures its economics.
alter table public.clients add column birth_date date check(birth_date between '1900-01-01'::date and current_date);
create table public.crm_return_rules (
 id uuid primary key default gen_random_uuid(),barbershop_id uuid not null references public.barbershops(id),service_id uuid,
 return_days integer not null check(return_days between 1 and 3650),active boolean not null default true,created_at timestamptz not null default now(),
 foreign key(barbershop_id,service_id) references public.services(barbershop_id,id)
);
create unique index crm_return_scope on public.crm_return_rules(barbershop_id,coalesce(service_id,'00000000-0000-0000-0000-000000000000'::uuid)) where active;
create table public.crm_tasks (
 id uuid primary key default gen_random_uuid(),barbershop_id uuid not null,client_id uuid not null,assignee_membership_id uuid,
 segment text not null check(segment in ('maintenance','inactive','birthday','manual')),title text not null check(length(btrim(title)) between 2 and 160),
 due_on date not null,status text not null default 'planned' check(status in ('planned','contacted','responded','booked','closed')),
 appointment_id uuid,request_key uuid not null,created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(barbershop_id,id),unique(barbershop_id,request_key),foreign key(barbershop_id,client_id) references public.clients(barbershop_id,id),
 foreign key(barbershop_id,assignee_membership_id) references public.memberships(barbershop_id,id),foreign key(barbershop_id,appointment_id) references public.appointments(barbershop_id,id)
);
create unique index crm_open_followup_once on public.crm_tasks(barbershop_id,client_id,segment) where status not in ('booked','closed');
create index crm_tasks_shop_due on public.crm_tasks(barbershop_id,due_on,status);
create table public.crm_task_events (
 id uuid primary key default gen_random_uuid(),barbershop_id uuid not null,task_id uuid not null,status text not null,notes text not null check(length(btrim(notes)) between 2 and 2000),
 actor_id uuid not null references auth.users(id),created_at timestamptz not null default now(),foreign key(barbershop_id,task_id) references public.crm_tasks(barbershop_id,id)
);
create table public.loyalty_settings (
 id uuid primary key default gen_random_uuid(),barbershop_id uuid not null unique references public.barbershops(id),enabled boolean not null default false,
 points_per_real numeric(9,3) not null default 0 check(points_per_real between 0 and 10000),points_per_visit integer not null default 0 check(points_per_visit between 0 and 1000000),
 referrer_points integer not null default 0 check(referrer_points between 0 and 1000000),referee_points integer not null default 0 check(referee_points between 0 and 1000000),
 max_per_appointment integer not null default 0 check(max_per_appointment between 0 and 1000000),daily_cap integer not null default 0 check(daily_cap between 0 and 1000000),
 refund_policy text not null default 'full' check(refund_policy in ('full','proportional')),cutover_at timestamptz,active_from timestamptz,created_at timestamptz not null default now(),
 check(not enabled or (max_per_appointment>0 and daily_cap>0 and (points_per_real>0 or points_per_visit>0)))
);
create table public.loyalty_tiers (
 id uuid primary key default gen_random_uuid(),barbershop_id uuid not null references public.barbershops(id),name text not null check(length(btrim(name)) between 2 and 80),
 min_points integer not null check(min_points>=0),description text,active boolean not null default false,created_at timestamptz not null default now(),unique(barbershop_id,min_points)
);
create table public.loyalty_rewards (
 id uuid primary key default gen_random_uuid(),barbershop_id uuid not null references public.barbershops(id),name text not null check(length(btrim(name)) between 2 and 160),
 description text,points_cost integer not null check(points_cost between 1 and 1000000),valid_days integer not null check(valid_days between 1 and 365),max_per_client integer not null check(max_per_client between 1 and 1000),
 product_id uuid,quantity integer not null default 1 check(quantity between 1 and 1000),
 active boolean not null default false,created_at timestamptz not null default now(),unique(barbershop_id,id),foreign key(barbershop_id,product_id) references public.products(barbershop_id,id)
);
create table public.loyalty_qualifications (
 id uuid primary key default gen_random_uuid(),barbershop_id uuid not null,client_id uuid not null,appointment_id uuid not null unique,policy_snapshot jsonb not null,created_at timestamptz not null default now(),
 foreign key(barbershop_id,client_id) references public.clients(barbershop_id,id),foreign key(barbershop_id,appointment_id) references public.appointments(barbershop_id,id)
);
create table public.loyalty_referral_codes (
 id uuid primary key default gen_random_uuid(),barbershop_id uuid not null,client_id uuid not null,code text not null default upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),
 created_at timestamptz not null default now(),unique(barbershop_id,client_id),unique(barbershop_id,code),foreign key(barbershop_id,client_id) references public.clients(barbershop_id,id)
);
create table public.loyalty_referrals (
 id uuid primary key default gen_random_uuid(),barbershop_id uuid not null,referrer_client_id uuid not null,referee_client_id uuid not null,appointment_id uuid,
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),unique(barbershop_id,id),unique(barbershop_id,referee_client_id),check(referrer_client_id<>referee_client_id),
 foreign key(barbershop_id,referrer_client_id) references public.clients(barbershop_id,id),foreign key(barbershop_id,referee_client_id) references public.clients(barbershop_id,id),foreign key(barbershop_id,appointment_id) references public.appointments(barbershop_id,id)
);
create table public.loyalty_redemptions (
 id uuid primary key default gen_random_uuid(),barbershop_id uuid not null,client_id uuid not null,reward_id uuid not null,reward_snapshot jsonb not null,points_cost integer not null check(points_cost>0),
 status text not null default 'requested' check(status in ('requested','fulfilled','cancelled','expired')),expires_at timestamptz not null,fulfilled_at timestamptz,cost_cents integer check(cost_cents>=0),
 notes text,request_key uuid not null,created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),unique(barbershop_id,id),unique(barbershop_id,request_key),
 foreign key(barbershop_id,client_id) references public.clients(barbershop_id,id),foreign key(barbershop_id,reward_id) references public.loyalty_rewards(barbershop_id,id)
);
create table public.loyalty_ledger (
 id uuid primary key default gen_random_uuid(),barbershop_id uuid not null,client_id uuid not null,appointment_id uuid,referral_id uuid,redemption_id uuid,
 points_delta integer not null check(points_delta<>0),reason text not null check(reason in ('appointment','referral','refund','redeem','redeem_cancel')),
 event_key text not null,policy_snapshot jsonb not null,source_entry_id uuid references public.loyalty_ledger(id),created_at timestamptz not null default now(),unique(barbershop_id,event_key),
 foreign key(barbershop_id,client_id) references public.clients(barbershop_id,id),foreign key(barbershop_id,appointment_id) references public.appointments(barbershop_id,id),
 foreign key(barbershop_id,referral_id) references public.loyalty_referrals(barbershop_id,id),foreign key(barbershop_id,redemption_id) references public.loyalty_redemptions(barbershop_id,id)
);
create index loyalty_ledger_client_date on public.loyalty_ledger(barbershop_id,client_id,created_at);

do $$ declare t text; begin
 foreach t in array array['crm_return_rules','crm_tasks','crm_task_events','loyalty_settings','loyalty_tiers','loyalty_rewards','loyalty_referral_codes','loyalty_referrals','loyalty_redemptions','loyalty_ledger','loyalty_qualifications'] loop
  execute format('alter table public.%I enable row level security',t);execute format('grant select on public.%I to authenticated',t);execute format('grant all on public.%I to service_role',t);
  execute format('create policy crm_loyalty_admin_read on public.%I for select to authenticated using(app_private.has_shop_role(barbershop_id,array[''admin'']::public.shop_role[]))',t);
 end loop;
 foreach t in array array['crm_return_rules','loyalty_settings','loyalty_tiers','loyalty_rewards'] loop
  execute format('grant insert,update on public.%I to authenticated',t);
  execute format('create policy crm_loyalty_admin_insert on public.%I for insert to authenticated with check(app_private.has_shop_role(barbershop_id,array[''admin'']::public.shop_role[]))',t);
  execute format('create policy crm_loyalty_admin_update on public.%I for update to authenticated using(app_private.has_shop_role(barbershop_id,array[''admin'']::public.shop_role[])) with check(app_private.has_shop_role(barbershop_id,array[''admin'']::public.shop_role[]))',t);
 end loop;
 foreach t in array array['loyalty_ledger','loyalty_redemptions','loyalty_referral_codes','loyalty_qualifications'] loop
  execute format('create policy loyalty_client_staff_read on public.%I for select to authenticated using(app_private.is_own_client(barbershop_id,client_id) or app_private.can_manage_client(barbershop_id,client_id,''clients''))',t);
 end loop;
end $$;
create policy crm_tasks_barber_read on public.crm_tasks for select to authenticated using(app_private.can_manage_client(barbershop_id,client_id,'clients') and (assignee_membership_id is null or app_private.is_own_barber(barbershop_id,assignee_membership_id)));
create policy crm_events_barber_read on public.crm_task_events for select to authenticated using(exists(select 1 from public.crm_tasks t where t.id=task_id and t.barbershop_id=crm_task_events.barbershop_id));
create policy crm_rules_barber_read on public.crm_return_rules for select to authenticated using(app_private.has_module(barbershop_id,'clients'));

create function app_private.lock_loyalty_cutover() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then new.cutover_at:=case when new.enabled then now() else null end;new.active_from:=new.cutover_at;
 else new.cutover_at:=coalesce(old.cutover_at,case when new.enabled then now() else null end);new.active_from:=case when new.enabled and not old.enabled then now() else old.active_from end;end if;
 return new;
end $$;
revoke all on function app_private.lock_loyalty_cutover() from public,anon,authenticated;
create trigger loyalty_cutover_guard before insert or update on public.loyalty_settings for each row execute function app_private.lock_loyalty_cutover();

create function app_private.crm_segments(p_shop uuid,p_inactive_days integer,p_birthday_window integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_today date; v_tz text; result jsonb;
begin
 if not app_private.has_module(p_shop,'clients') then raise exception 'Acesso ao CRM não permitido' using errcode='42501';end if;
 if p_inactive_days not between 1 and 3650 or p_birthday_window not between 0 and 31 then raise exception 'Filtros de dias inválidos';end if;
 select timezone into v_tz from public.barbershops where id=p_shop;v_today:=(now() at time zone v_tz)::date;
 select coalesce(jsonb_agg(to_jsonb(q) order by full_name),'[]') into result from (
  select c.id,c.full_name,c.phone,c.email,c.birth_date,c.created_at,last_visit.visit_date,last_visit.barber_membership_id,
   maintenance.due_on maintenance_due_on,case when maintenance.due_on<=v_today and not exists(select 1 from public.appointments nx where nx.client_id=c.id and nx.status in ('pending','confirmed','in_progress') and nx.starts_at>=now()) then true else false end maintenance_due,
   v_today-coalesce(last_visit.visit_date,(c.created_at at time zone v_tz)::date)>=p_inactive_days inactive,
   case when c.birth_date is not null then birthday.next_birthday-v_today<=p_birthday_window else false end birthday_upcoming,birthday.next_birthday,
   v_today-last_visit.visit_date days_since_visit
  from public.clients c
  left join lateral(select (a.starts_at at time zone v_tz)::date visit_date,a.barber_membership_id from public.appointments a where a.client_id=c.id and a.status='completed' order by a.starts_at desc limit 1) last_visit on true
  left join lateral(select min(last_service.visit_date+coalesce(specific.return_days,general.return_days)) due_on from
    (select aps.service_id,max((a.starts_at at time zone v_tz)::date) visit_date from public.appointments a join public.appointment_services aps on aps.appointment_id=a.id where a.client_id=c.id and a.status='completed' group by aps.service_id) last_service
    left join public.crm_return_rules specific on specific.barbershop_id=p_shop and specific.active and specific.service_id=last_service.service_id
    left join public.crm_return_rules general on general.barbershop_id=p_shop and general.active and general.service_id is null) maintenance on true
  left join lateral(select case when candidate.d>=v_today then candidate.d else make_date(extract(year from v_today)::integer+1,extract(month from c.birth_date)::integer,least(extract(day from c.birth_date)::integer,extract(day from (make_date(extract(year from v_today)::integer+1,extract(month from c.birth_date)::integer,1)+interval '1 month - 1 day'))::integer)) end next_birthday from (select make_date(extract(year from v_today)::integer,extract(month from c.birth_date)::integer,least(extract(day from c.birth_date)::integer,extract(day from (make_date(extract(year from v_today)::integer,extract(month from c.birth_date)::integer,1)+interval '1 month - 1 day'))::integer)) d) candidate) birthday on c.birth_date is not null
  where c.barbershop_id=p_shop and app_private.can_manage_client(p_shop,c.id,'clients')
 ) q;
 return result;
end $$;
create function app_private.crm_create_task(p_shop uuid,p_client uuid,p_assignee uuid,p_segment text,p_title text,p_due date,p_request uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if not app_private.can_manage_client(p_shop,p_client,'clients') then raise exception 'Cliente não permitido' using errcode='42501';end if;
 if not app_private.has_shop_role(p_shop,array['admin']::public.shop_role[]) and p_assignee is not null and not app_private.is_own_barber(p_shop,p_assignee) then raise exception 'Só pode atribuir a si mesmo' using errcode='42501';end if;
 if p_assignee is not null and not exists(select 1 from public.memberships where id=p_assignee and barbershop_id=p_shop and active) then raise exception 'Responsável inválido';end if;
 if p_request is null then raise exception 'Identificação da tarefa obrigatória';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_shop::text||p_request::text,0));
 select id into v_id from public.crm_tasks where barbershop_id=p_shop and request_key=p_request;if found then return v_id;end if;
 insert into public.crm_tasks(barbershop_id,client_id,assignee_membership_id,segment,title,due_on,request_key,created_by) values(p_shop,p_client,p_assignee,p_segment,p_title,p_due,p_request,auth.uid()) returning id into v_id;
 insert into public.crm_task_events(barbershop_id,task_id,status,notes,actor_id) values(p_shop,v_id,'planned','Tarefa criada; nenhum contato foi enviado.',auth.uid());return v_id;
end $$;
create function app_private.crm_update_task(p_shop uuid,p_task uuid,p_status text,p_notes text,p_appointment uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare t public.crm_tasks;
begin
 select * into t from public.crm_tasks where barbershop_id=p_shop and id=p_task for update;
 if not found or not app_private.can_manage_client(p_shop,t.client_id,'clients') or (not app_private.has_shop_role(p_shop,array['admin']::public.shop_role[]) and t.assignee_membership_id is not null and not app_private.is_own_barber(p_shop,t.assignee_membership_id)) then raise exception 'Tarefa não permitida' using errcode='42501';end if;
 if t.status in ('booked','closed') then raise exception 'Tarefa já finalizada; crie uma nova para outro acompanhamento';end if;
 if p_status not in ('contacted','responded','booked','closed') or length(btrim(coalesce(p_notes,''))) not between 2 and 2000 then raise exception 'Situação e observação obrigatórias';end if;
 if p_status='booked' and not exists(select 1 from public.appointments a where a.id=p_appointment and a.barbershop_id=p_shop and a.client_id=t.client_id and a.created_at>=t.created_at and a.starts_at>=t.created_at and a.status not in ('cancelled','no_show') and (app_private.has_shop_role(p_shop,array['admin']::public.shop_role[]) or app_private.is_own_barber(p_shop,a.barber_membership_id))) then raise exception 'Vincule um agendamento válido desse cliente, criado após o início do acompanhamento';end if;
 update public.crm_tasks set status=p_status,appointment_id=case when p_status='booked' then p_appointment else null end,updated_at=now() where id=t.id;
 insert into public.crm_task_events(barbershop_id,task_id,status,notes,actor_id) values(p_shop,t.id,p_status,p_notes,auth.uid());return t.id;
end $$;

-- Internal points writer serializes the customer wallet and applies daily and per-event caps.
create function app_private.loyalty_credit(p_shop uuid,p_client uuid,p_appointment uuid,p_referral uuid,p_points integer,p_reason text,p_key text,p_policy jsonb) returns void language plpgsql security definer set search_path='' as $$
declare v_points integer;v_used integer;v_event_used integer;v_tz text;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_shop::text||p_client::text,1));
 if exists(select 1 from public.loyalty_ledger where barbershop_id=p_shop and event_key=p_key) then return;end if;
 select timezone into v_tz from public.barbershops where id=p_shop;
 select coalesce(sum(points_delta),0) into v_used from public.loyalty_ledger where barbershop_id=p_shop and client_id=p_client and points_delta>0 and reason in ('appointment','referral') and (created_at at time zone v_tz)::date=(now() at time zone v_tz)::date;
 select coalesce(sum(points_delta),0) into v_event_used from public.loyalty_ledger where barbershop_id=p_shop and client_id=p_client and appointment_id=p_appointment and points_delta>0 and reason in ('appointment','referral');
 v_points:=greatest(0,least(p_points,(p_policy->>'max_per_appointment')::integer-v_event_used,(p_policy->>'daily_cap')::integer-v_used));
 if v_points>0 then insert into public.loyalty_ledger(barbershop_id,client_id,appointment_id,referral_id,points_delta,reason,event_key,policy_snapshot) values(p_shop,p_client,p_appointment,p_referral,v_points,p_reason,p_key,p_policy);end if;
end $$;
create function app_private.loyalty_accrue(p_appointment uuid) returns void language plpgsql security definer set search_path='' as $$
declare a public.appointments;s public.loyalty_settings;r public.loyalty_referrals;v_paid bigint;v_points integer;v_policy jsonb;v_qualification uuid;
begin
 select * into a from public.appointments where id=p_appointment;if not found or a.status<>'completed' then return;end if;
 select * into s from public.loyalty_settings where barbershop_id=a.barbershop_id and enabled;if not found or a.starts_at<s.active_from then return;end if;
 v_policy:=to_jsonb(s);
 if a.subscription_id is null then
  select coalesce(sum(amount_cents),0) into v_paid from public.payments where appointment_id=a.id and status in ('paid','approved');
  if v_paid<a.total_price_cents or a.total_price_cents<=0 then return;end if;
  v_points:=least(1000000,floor(a.total_price_cents::numeric*s.points_per_real/100)+s.points_per_visit)::integer;
 else
  if not exists(select 1 from public.subscriptions sub join public.payments p on p.subscription_id=sub.id where sub.id=a.subscription_id and p.status in ('paid','approved') and p.paid_at>=sub.current_period_start and p.paid_at<sub.current_period_end and a.starts_at>=sub.current_period_start and a.starts_at<sub.current_period_end) then return;end if;
  v_points:=s.points_per_visit;
  select v_policy||jsonb_build_object('period_start',current_period_start,'period_end',current_period_end) into v_policy from public.subscriptions where id=a.subscription_id;
 end if;
 insert into public.loyalty_qualifications(barbershop_id,client_id,appointment_id,policy_snapshot) values(a.barbershop_id,a.client_id,a.id,v_policy) on conflict(appointment_id) do nothing returning id into v_qualification;
 if not found then return;end if;
 select * into r from public.loyalty_referrals where barbershop_id=a.barbershop_id and referee_client_id=a.client_id and appointment_id is null and created_at<=a.starts_at for update;
 if found then
  perform pg_advisory_xact_lock(hashtextextended(a.barbershop_id::text||least(r.referrer_client_id,r.referee_client_id)::text,1));
  perform pg_advisory_xact_lock(hashtextextended(a.barbershop_id::text||greatest(r.referrer_client_id,r.referee_client_id)::text,1));
 end if;
 perform app_private.loyalty_credit(a.barbershop_id,a.client_id,a.id,null,v_points,'appointment','appointment:'||a.id,v_policy);
 if r.id is not null and not exists(select 1 from public.appointments prior where prior.client_id=a.client_id and prior.status='completed' and prior.starts_at<a.starts_at and (prior.subscription_id is not null or exists(select 1 from public.payments p where p.appointment_id=prior.id and p.status in ('paid','approved')))) then
  update public.loyalty_referrals set appointment_id=a.id where id=r.id;
  perform app_private.loyalty_credit(a.barbershop_id,r.referrer_client_id,a.id,r.id,s.referrer_points,'referral','referrer:'||r.id,v_policy);
  perform app_private.loyalty_credit(a.barbershop_id,r.referee_client_id,a.id,r.id,s.referee_points,'referral','referee:'||r.id,v_policy);
 end if;
end $$;
revoke all on function app_private.loyalty_credit(uuid,uuid,uuid,uuid,integer,text,text,jsonb),app_private.loyalty_accrue(uuid) from public,anon,authenticated;

create function app_private.loyalty_on_appointment() returns trigger language plpgsql security definer set search_path='' as $$
begin if new.status='completed' and (tg_op='INSERT' or old.status<>'completed') then perform app_private.loyalty_accrue(new.id);end if;return new;end $$;
revoke all on function app_private.loyalty_on_appointment() from public,anon,authenticated;
create trigger loyalty_on_completed after insert or update of status on public.appointments for each row execute function app_private.loyalty_on_appointment();
create function app_private.loyalty_on_payment() returns trigger language plpgsql security definer set search_path='' as $$
declare a record;e record;v_total bigint;v_refunded bigint;v_reversed integer;v_reverse integer;
begin
 if new.status in ('paid','approved') then
  if new.appointment_id is not null then perform app_private.loyalty_accrue(new.appointment_id);
  elsif new.subscription_id is not null then for a in select ap.id from public.appointments ap join public.subscriptions sub on sub.id=ap.subscription_id where ap.subscription_id=new.subscription_id and ap.starts_at>=sub.current_period_start and ap.starts_at<sub.current_period_end and ap.status='completed' loop perform app_private.loyalty_accrue(a.id);end loop;end if;
 elsif tg_op='UPDATE' and new.status in ('refunded','charged_back') and old.status in ('paid','approved') then
  for e in select ll.* from public.loyalty_ledger ll join public.appointments ap on ap.id=ll.appointment_id where ll.barbershop_id=new.barbershop_id and ll.reason in ('appointment','referral') and ll.points_delta>0 and ((new.appointment_id is not null and ap.id=new.appointment_id) or (new.subscription_id is not null and ap.subscription_id=new.subscription_id and new.paid_at>=(ll.policy_snapshot->>'period_start')::timestamptz and new.paid_at<(ll.policy_snapshot->>'period_end')::timestamptz)) order by ll.client_id,ll.id for update of ll loop
   perform pg_advisory_xact_lock(hashtextextended(e.barbershop_id::text||e.client_id::text,1));
   select coalesce(-sum(points_delta),0) into v_reversed from public.loyalty_ledger where source_entry_id=e.id;
   if e.policy_snapshot->>'refund_policy'='proportional' then
    if new.appointment_id is not null then
     select total_price_cents into v_total from public.appointments where id=new.appointment_id;
     select coalesce(sum(amount_cents),0) into v_refunded from public.payments where appointment_id=new.appointment_id and status in ('refunded','charged_back');
    else
     select coalesce(sum(amount_cents),0),coalesce(sum(amount_cents) filter(where status in ('refunded','charged_back')),0) into v_total,v_refunded from public.payments where subscription_id=new.subscription_id and status in ('paid','approved','refunded','charged_back') and paid_at>=(e.policy_snapshot->>'period_start')::timestamptz and paid_at<(e.policy_snapshot->>'period_end')::timestamptz;
    end if;
    v_reverse:=greatest(0,least(e.points_delta,round(e.points_delta::numeric*v_refunded/nullif(v_total,0)))-v_reversed);
   else v_reverse:=greatest(0,e.points_delta-v_reversed);end if;
   if v_reverse>0 then insert into public.loyalty_ledger(barbershop_id,client_id,appointment_id,referral_id,points_delta,reason,event_key,policy_snapshot,source_entry_id) values(e.barbershop_id,e.client_id,e.appointment_id,e.referral_id,-v_reverse,'refund','refund:'||new.id||':'||e.id,e.policy_snapshot,e.id) on conflict(barbershop_id,event_key) do nothing;end if;
  end loop;
 end if;return new;
end $$;
revoke all on function app_private.loyalty_on_payment() from public,anon,authenticated;
create trigger loyalty_payment_changed after insert or update of status on public.payments for each row execute function app_private.loyalty_on_payment();

create function app_private.register_loyalty_referral(p_shop uuid,p_client uuid,p_code text) returns uuid language plpgsql security definer set search_path='' as $$
declare ref uuid;v_id uuid;
begin
 if not(app_private.is_own_client(p_shop,p_client) or app_private.can_manage_client(p_shop,p_client,'clients')) then raise exception 'Cliente não permitido' using errcode='42501';end if;
 if not exists(select 1 from public.loyalty_settings where barbershop_id=p_shop and enabled) then raise exception 'Fidelidade ainda não está ativa';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_shop::text||p_client::text,1));
 select client_id into ref from public.loyalty_referral_codes where barbershop_id=p_shop and code=upper(btrim(p_code));
 if ref is null or ref=p_client or exists(select 1 from public.clients c join public.clients other on c.user_id=other.user_id and c.user_id is not null where c.id=p_client and other.id=ref) then raise exception 'Código de indicação inválido';end if;
 if exists(select 1 from public.appointments a where a.client_id=p_client and a.status='completed' and (a.subscription_id is not null or exists(select 1 from public.payments p where p.appointment_id=a.id and p.status in ('paid','approved')))) then raise exception 'Indicação deve ser registrada antes do primeiro atendimento pago';end if;
 select id into v_id from public.loyalty_referrals where barbershop_id=p_shop and referee_client_id=p_client;if found then return v_id;end if;
 insert into public.loyalty_referrals(barbershop_id,referrer_client_id,referee_client_id,created_by) values(p_shop,ref,p_client,auth.uid()) returning id into v_id;return v_id;
end $$;
create function app_private.cancel_loyalty(p_shop uuid,p_redemption uuid,p_reason text) returns uuid language plpgsql security definer set search_path='' as $$
declare r public.loyalty_redemptions;
begin
 select * into r from public.loyalty_redemptions where id=p_redemption and barbershop_id=p_shop for update;
 if not found or not(app_private.is_own_client(p_shop,r.client_id) or app_private.can_manage_client(p_shop,r.client_id,'clients')) then raise exception 'Resgate não permitido' using errcode='42501';end if;
 if r.status in ('cancelled','expired') then return r.id;end if;
 if r.status<>'requested' or length(btrim(coalesce(p_reason,'')))<2 then raise exception 'Só pedidos pendentes podem ser cancelados; informe o motivo';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_shop::text||r.client_id::text,1));
 update public.loyalty_redemptions set status=case when expires_at<now() then 'expired' else 'cancelled' end,notes=p_reason where id=r.id;
 insert into public.loyalty_ledger(barbershop_id,client_id,redemption_id,points_delta,reason,event_key,policy_snapshot) values(p_shop,r.client_id,r.id,r.points_cost,'redeem_cancel','cancel:'||r.id,r.reward_snapshot) on conflict(barbershop_id,event_key) do nothing;return r.id;
end $$;
create function app_private.redeem_loyalty(p_shop uuid,p_client uuid,p_reward uuid,p_request uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare r public.loyalty_rewards;v_balance bigint;v_id uuid;
begin
 if not(app_private.is_own_client(p_shop,p_client) or app_private.can_manage_client(p_shop,p_client,'clients')) then raise exception 'Cliente não permitido' using errcode='42501';end if;
 if p_request is null or not exists(select 1 from public.loyalty_settings where barbershop_id=p_shop and enabled) then raise exception 'Fidelidade não está ativa';end if;
 perform app_private.loyalty_expire(p_shop,p_client);
 perform pg_advisory_xact_lock(hashtextextended(p_shop::text||p_client::text,1));
 select id into v_id from public.loyalty_redemptions where barbershop_id=p_shop and client_id=p_client and request_key=p_request;if found then return v_id;end if;
 select * into r from public.loyalty_rewards where barbershop_id=p_shop and id=p_reward and active for share;if not found then raise exception 'Benefício indisponível';end if;
 if (select count(*) from public.loyalty_redemptions where barbershop_id=p_shop and client_id=p_client and reward_id=p_reward and status in ('requested','fulfilled'))>=r.max_per_client then raise exception 'Limite de resgates deste benefício atingido';end if;
 select coalesce(sum(points_delta),0) into v_balance from public.loyalty_ledger where barbershop_id=p_shop and client_id=p_client;
 if v_balance<r.points_cost then raise exception 'Pontos insuficientes';end if;
 insert into public.loyalty_redemptions(barbershop_id,client_id,reward_id,reward_snapshot,points_cost,expires_at,request_key,created_by) values(p_shop,p_client,p_reward,to_jsonb(r),r.points_cost,now()+make_interval(days=>r.valid_days),p_request,auth.uid()) returning id into v_id;
 insert into public.loyalty_ledger(barbershop_id,client_id,redemption_id,points_delta,reason,event_key,policy_snapshot) values(p_shop,p_client,v_id,-r.points_cost,'redeem','redeem:'||v_id,to_jsonb(r));return v_id;
end $$;
create function app_private.loyalty_expire(p_shop uuid,p_client uuid) returns void language plpgsql security definer set search_path='' as $$
declare r public.loyalty_redemptions;
begin
 for r in select * from public.loyalty_redemptions where barbershop_id=p_shop and client_id=p_client and status='requested' and expires_at<now() order by id for update loop
  perform pg_advisory_xact_lock(hashtextextended(p_shop::text||p_client::text,1));
  update public.loyalty_redemptions set status='expired',notes='Prazo de retirada expirado; pontos devolvidos.' where id=r.id;
  insert into public.loyalty_ledger(barbershop_id,client_id,redemption_id,points_delta,reason,event_key,policy_snapshot) values(p_shop,p_client,r.id,r.points_cost,'redeem_cancel','cancel:'||r.id,r.reward_snapshot) on conflict(barbershop_id,event_key) do nothing;
 end loop;
end $$;
revoke all on function app_private.loyalty_expire(uuid,uuid) from public,anon,authenticated;
create function app_private.fulfill_loyalty(p_shop uuid,p_redemption uuid,p_cost integer,p_notes text) returns uuid language plpgsql security definer set search_path='' as $$
declare r public.loyalty_redemptions;p public.products;v_cost integer;v_quantity integer;
begin
 if not app_private.has_shop_role(p_shop,array['admin']::public.shop_role[]) then raise exception 'Apenas administrador confirma entrega do benefício' using errcode='42501';end if;
 select * into r from public.loyalty_redemptions where id=p_redemption and barbershop_id=p_shop for update;
 if not found then raise exception 'Resgate não encontrado';end if;if r.status='fulfilled' then return r.id;end if;
 if r.status<>'requested' or r.expires_at<now() or p_cost is null or p_cost<0 or length(btrim(coalesce(p_notes,'')))<2 then raise exception 'Resgate expirado ou dados da entrega inválidos';end if;
 v_cost:=p_cost;
 if r.reward_snapshot->>'product_id' is not null then
  select * into p from public.products where barbershop_id=p_shop and id=(r.reward_snapshot->>'product_id')::uuid for update;
  v_quantity:=(r.reward_snapshot->>'quantity')::integer;
  if not found or not p.active or p.stock_quantity<v_quantity or p.cost_cents::bigint*v_quantity>2147483647 then raise exception 'Produto do benefício indisponível';end if;
  v_cost:=p.cost_cents*v_quantity;
  perform set_config('app.inventory_reason','loyalty_reward',true);perform set_config('app.inventory_reference',r.id::text,true);perform set_config('app.inventory_notes',p_notes,true);
  update public.products set stock_quantity=stock_quantity-v_quantity where id=p.id;
 end if;
 update public.loyalty_redemptions set status='fulfilled',fulfilled_at=now(),cost_cents=v_cost,notes=p_notes where id=r.id;
 if v_cost>0 then insert into public.expenses(barbershop_id,category,cost_kind,description,amount_cents,occurred_on,created_by) values(p_shop,'Benefício de fidelidade','operating',(r.reward_snapshot->>'name')||' · '||p_notes,v_cost,(now() at time zone (select timezone from public.barbershops where id=p_shop))::date,auth.uid());end if;return r.id;
end $$;
create function app_private.loyalty_summary(p_shop uuid,p_client uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.loyalty_settings;v_balance bigint;v_earned bigint;v_code text;
begin
 if not(app_private.is_own_client(p_shop,p_client) or app_private.can_manage_client(p_shop,p_client,'clients')) then raise exception 'Cliente não permitido' using errcode='42501';end if;
 perform app_private.loyalty_expire(p_shop,p_client);
 select * into s from public.loyalty_settings where barbershop_id=p_shop;
 if coalesce(s.enabled,false) then
  insert into public.loyalty_referral_codes(barbershop_id,client_id) values(p_shop,p_client) on conflict(barbershop_id,client_id) do nothing;
  select code into v_code from public.loyalty_referral_codes where barbershop_id=p_shop and client_id=p_client;
 end if;
 select coalesce(sum(points_delta),0),coalesce(sum(points_delta) filter(where reason in ('appointment','referral','refund')),0) into v_balance,v_earned from public.loyalty_ledger where barbershop_id=p_shop and client_id=p_client;
 return jsonb_build_object('enabled',coalesce(s.enabled,false),'balance_points',v_balance,'earned_points',v_earned,'referral_code',v_code,
  'tier',(select jsonb_build_object('name',name,'min_points',min_points) from public.loyalty_tiers where barbershop_id=p_shop and active and min_points<=v_earned order by min_points desc limit 1),
  'next_tier',(select jsonb_build_object('name',name,'min_points',min_points) from public.loyalty_tiers where barbershop_id=p_shop and active and min_points>v_earned order by min_points limit 1),
  'rewards',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'description',description,'points_cost',points_cost,'valid_days',valid_days)) from public.loyalty_rewards where barbershop_id=p_shop and active and coalesce(s.enabled,false)),'[]'),
  'ledger',coalesce((select jsonb_agg(to_jsonb(q) order by created_at desc) from (select id,points_delta,reason,created_at from public.loyalty_ledger where barbershop_id=p_shop and client_id=p_client order by created_at desc limit 30) q),'[]'),
  'redemptions',coalesce((select jsonb_agg(jsonb_build_object('id',id,'reward_snapshot',reward_snapshot,'status',status,'expires_at',expires_at,'created_at',created_at)) from public.loyalty_redemptions where barbershop_id=p_shop and client_id=p_client),'[]'),
  'referral_count',(select count(*) from public.loyalty_referrals where barbershop_id=p_shop and referrer_client_id=p_client));
end $$;

-- Only explicit public RPCs may change tasks, points or redemptions.
create function public.crm_segments(p_shop uuid,p_inactive_days integer,p_birthday_window integer) returns jsonb language sql security invoker set search_path='' as $$select app_private.crm_segments(p_shop,p_inactive_days,p_birthday_window)$$;
create function public.crm_create_task(p_shop uuid,p_client uuid,p_assignee uuid,p_segment text,p_title text,p_due date,p_request uuid) returns uuid language sql security invoker set search_path='' as $$select app_private.crm_create_task(p_shop,p_client,p_assignee,p_segment,p_title,p_due,p_request)$$;
create function public.crm_update_task(p_shop uuid,p_task uuid,p_status text,p_notes text,p_appointment uuid) returns uuid language sql security invoker set search_path='' as $$select app_private.crm_update_task(p_shop,p_task,p_status,p_notes,p_appointment)$$;
create function public.loyalty_summary(p_shop uuid,p_client uuid) returns jsonb language sql security invoker set search_path='' as $$select app_private.loyalty_summary(p_shop,p_client)$$;
create function public.register_loyalty_referral(p_shop uuid,p_client uuid,p_code text) returns uuid language sql security invoker set search_path='' as $$select app_private.register_loyalty_referral(p_shop,p_client,p_code)$$;
create function public.redeem_loyalty(p_shop uuid,p_client uuid,p_reward uuid,p_request uuid) returns uuid language sql security invoker set search_path='' as $$select app_private.redeem_loyalty(p_shop,p_client,p_reward,p_request)$$;
create function public.cancel_loyalty(p_shop uuid,p_redemption uuid,p_reason text) returns uuid language sql security invoker set search_path='' as $$select app_private.cancel_loyalty(p_shop,p_redemption,p_reason)$$;
create function public.fulfill_loyalty(p_shop uuid,p_redemption uuid,p_cost integer,p_notes text) returns uuid language sql security invoker set search_path='' as $$select app_private.fulfill_loyalty(p_shop,p_redemption,p_cost,p_notes)$$;
do $$declare r record;begin
 for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and p.proname in ('crm_segments','crm_create_task','crm_update_task','loyalty_summary','register_loyalty_referral','redeem_loyalty','cancel_loyalty','fulfill_loyalty') loop
  execute format('revoke all on function %s from public,anon,authenticated',r.signature);execute format('grant execute on function %s to authenticated',r.signature);
 end loop;
end $$;
