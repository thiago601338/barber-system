create table public.appointment_waitlist (
 id uuid primary key default gen_random_uuid(), barbershop_id uuid not null, client_id uuid not null, service_ids uuid[] not null check (cardinality(service_ids) between 1 and 8), preferred_barber_id uuid,
 from_day date not null, until_day date not null check (until_day>=from_day and until_day<=from_day+90), start_time time not null default '09:00', end_time time not null default '19:00' check(end_time>start_time), weekdays smallint[] not null default array[0,1,2,3,4,5,6]::smallint[] check (cardinality(weekdays) between 1 and 7 and weekdays<@array[0,1,2,3,4,5,6]::smallint[]), notes text check(length(notes)<=1000),
 status text not null default 'waiting' check(status in ('waiting','offered','booked','cancelled')), created_at timestamptz not null default now(), appointment_id uuid,
 unique(barbershop_id,id), foreign key(barbershop_id,client_id) references public.clients(barbershop_id,id), foreign key(barbershop_id,preferred_barber_id) references public.memberships(barbershop_id,id), foreign key(barbershop_id,appointment_id) references public.appointments(barbershop_id,id)
);
create index appointment_waitlist_shop_status on public.appointment_waitlist(barbershop_id,status,from_day,until_day);
create table public.waitlist_offers (
 id uuid primary key default gen_random_uuid(), barbershop_id uuid not null, waitlist_id uuid not null, barber_membership_id uuid not null, starts_at timestamptz not null, ends_at timestamptz not null check(ends_at>starts_at), expires_at timestamptz not null, status text not null default 'pending' check(status in ('pending','accepted','declined','expired')), created_at timestamptz not null default now(), offered_by uuid not null references auth.users(id),
 foreign key(barbershop_id,waitlist_id) references public.appointment_waitlist(barbershop_id,id), foreign key(barbershop_id,barber_membership_id) references public.memberships(barbershop_id,id)
);
alter table public.appointment_waitlist enable row level security;
alter table public.waitlist_offers enable row level security;
grant select on public.appointment_waitlist,public.waitlist_offers to authenticated;
create function app_private.can_manage_waitlist(p_barbershop_id uuid,p_client_id uuid,p_barber_id uuid) returns boolean language sql stable security definer set search_path='' as $$ select app_private.has_shop_role(p_barbershop_id,array['admin']::public.shop_role[]) or (app_private.has_module(p_barbershop_id,'appointments') and app_private.is_own_barber(p_barbershop_id,p_barber_id)); $$;
revoke all on function app_private.can_manage_waitlist(uuid,uuid,uuid) from public,anon;
grant execute on function app_private.can_manage_waitlist(uuid,uuid,uuid) to authenticated;
create policy waitlist_read on public.appointment_waitlist for select to authenticated using (app_private.is_own_client(barbershop_id,client_id) or app_private.can_manage_waitlist(barbershop_id,client_id,preferred_barber_id));
create policy waitlist_offers_read on public.waitlist_offers for select to authenticated using (exists(select 1 from public.appointment_waitlist w where w.id=waitlist_id and w.barbershop_id=waitlist_offers.barbershop_id));

create function app_private.create_waitlist_entry(p_barbershop_id uuid,p_client_id uuid,p_service_ids uuid[],p_barber_id uuid,p_from_day date,p_until_day date,p_start_time time,p_end_time time,p_weekdays smallint[],p_notes text default null) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_zone text;
begin
 if auth.uid() is null or not (app_private.is_own_client(p_barbershop_id,p_client_id) or app_private.can_manage_client(p_barbershop_id,p_client_id,'clients')) then raise exception 'Você não pode cadastrar esse cliente na lista.' using errcode='42501'; end if;
 select timezone into v_zone from public.barbershops where id=p_barbershop_id and active;
 if v_zone is null or p_from_day<(now() at time zone v_zone)::date or p_until_day>p_from_day+90 then raise exception 'Escolha um período futuro de até 90 dias.' using errcode='23514'; end if;
 if p_service_ids is null or cardinality(p_service_ids) not between 1 and 8 or (select count(distinct s.id) from public.services s where s.barbershop_id=p_barbershop_id and s.id=any(p_service_ids) and s.active)<>cardinality(p_service_ids) then raise exception 'Procedimentos inválidos.' using errcode='23514'; end if;
 if p_barber_id is not null and not exists(select 1 from public.memberships m where m.barbershop_id=p_barbershop_id and m.id=p_barber_id and m.active and m.role='barber') then raise exception 'Profissional inválido.' using errcode='23514'; end if;
 if not app_private.has_shop_role(p_barbershop_id,array['admin']::public.shop_role[]) and not app_private.is_own_client(p_barbershop_id,p_client_id) and not app_private.is_own_barber(p_barbershop_id,p_barber_id) then raise exception 'Selecione seu próprio perfil profissional.' using errcode='42501'; end if;
 insert into public.appointment_waitlist(barbershop_id,client_id,service_ids,preferred_barber_id,from_day,until_day,start_time,end_time,weekdays,notes) values(p_barbershop_id,p_client_id,p_service_ids,p_barber_id,p_from_day,p_until_day,p_start_time,p_end_time,p_weekdays,nullif(trim(p_notes),'')) returning id into v_id;
 if p_barber_id is not null and app_private.is_own_client(p_barbershop_id,p_client_id) then insert into public.client_barbers(barbershop_id,client_id,barber_membership_id) values(p_barbershop_id,p_client_id,p_barber_id) on conflict do nothing; end if;
 return v_id;
end;
$$;
revoke all on function app_private.create_waitlist_entry(uuid,uuid,uuid[],uuid,date,date,time,time,smallint[],text) from public,anon;
grant execute on function app_private.create_waitlist_entry(uuid,uuid,uuid[],uuid,date,date,time,time,smallint[],text) to authenticated;
create function public.create_waitlist_entry(p_barbershop_id uuid,p_client_id uuid,p_service_ids uuid[],p_barber_id uuid,p_from_day date,p_until_day date,p_start_time time,p_end_time time,p_weekdays smallint[],p_notes text default null) returns uuid language sql security invoker set search_path='' as $$ select app_private.create_waitlist_entry(p_barbershop_id,p_client_id,p_service_ids,p_barber_id,p_from_day,p_until_day,p_start_time,p_end_time,p_weekdays,p_notes); $$;
revoke all on function public.create_waitlist_entry(uuid,uuid,uuid[],uuid,date,date,time,time,smallint[],text) from public,anon;
grant execute on function public.create_waitlist_entry(uuid,uuid,uuid[],uuid,date,date,time,time,smallint[],text) to authenticated;

create function app_private.offer_waitlist_slot(p_barbershop_id uuid,p_waitlist_id uuid,p_barber_id uuid,p_starts_at timestamptz) returns uuid language plpgsql security definer set search_path='' as $$
declare v_w public.appointment_waitlist; v_details jsonb; v_zone text; v_local timestamp; v_id uuid;
begin
 if auth.uid() is null then raise exception 'Entre na sua conta.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtext(p_barbershop_id::text),hashtext('appointment_schedule'));
 select * into strict v_w from public.appointment_waitlist where barbershop_id=p_barbershop_id and id=p_waitlist_id for update;
 if not app_private.can_manage_waitlist(p_barbershop_id,v_w.client_id,p_barber_id) then raise exception 'Você não pode oferecer vagas desse profissional.' using errcode='42501'; end if;
 if v_w.status not in ('waiting','offered') or (v_w.preferred_barber_id is not null and v_w.preferred_barber_id<>p_barber_id) then raise exception 'Lista encerrada ou profissional fora da preferência.' using errcode='23514'; end if;
 select timezone into v_zone from public.barbershops where id=p_barbershop_id; v_local:=p_starts_at at time zone v_zone;
 if v_local::date not between v_w.from_day and v_w.until_day or v_local::time not between v_w.start_time and v_w.end_time or not extract(dow from v_local)::smallint=any(v_w.weekdays) then raise exception 'O horário está fora das preferências do cliente.' using errcode='23514'; end if;
 v_details:=app_private.appointment_schedule_details(p_barbershop_id,p_barber_id,v_w.service_ids,p_starts_at);
 if not coalesce((v_details->>'available')::boolean,false) then raise exception '%',coalesce(v_details->>'reason','Vaga indisponível.') using errcode='23514'; end if;
 if ((v_details->>'ends_at')::timestamptz at time zone v_zone)::time>v_w.end_time then raise exception 'O procedimento termina depois do horário preferido.' using errcode='23514'; end if;
 update public.waitlist_offers set status='expired' where barbershop_id=p_barbershop_id and waitlist_id=p_waitlist_id and status='pending';
 insert into public.waitlist_offers(barbershop_id,waitlist_id,barber_membership_id,starts_at,ends_at,expires_at,offered_by) values(p_barbershop_id,p_waitlist_id,p_barber_id,p_starts_at,(v_details->>'ends_at')::timestamptz,least(now()+interval '2 hours',p_starts_at),auth.uid()) returning id into v_id;
 update public.appointment_waitlist set status='offered' where id=p_waitlist_id;
 return v_id;
end;
$$;
revoke all on function app_private.offer_waitlist_slot(uuid,uuid,uuid,timestamptz) from public,anon;
grant execute on function app_private.offer_waitlist_slot(uuid,uuid,uuid,timestamptz) to authenticated;
create function public.offer_waitlist_slot(p_barbershop_id uuid,p_waitlist_id uuid,p_barber_id uuid,p_starts_at timestamptz) returns uuid language sql security invoker set search_path='' as $$ select app_private.offer_waitlist_slot(p_barbershop_id,p_waitlist_id,p_barber_id,p_starts_at); $$;
revoke all on function public.offer_waitlist_slot(uuid,uuid,uuid,timestamptz) from public,anon;
grant execute on function public.offer_waitlist_slot(uuid,uuid,uuid,timestamptz) to authenticated;

create function app_private.respond_waitlist_offer(p_barbershop_id uuid,p_offer_id uuid,p_accept boolean,p_subscription_id uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare v_o public.waitlist_offers; v_w public.appointment_waitlist; v_id uuid;
begin
 if auth.uid() is null then raise exception 'Entre na sua conta.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtext(p_barbershop_id::text),hashtext('appointment_schedule'));
 select * into strict v_o from public.waitlist_offers where barbershop_id=p_barbershop_id and id=p_offer_id for update;
 select * into strict v_w from public.appointment_waitlist where barbershop_id=p_barbershop_id and id=v_o.waitlist_id for update;
 if not app_private.is_own_client(p_barbershop_id,v_w.client_id) then raise exception 'Somente o cliente pode aceitar essa oferta.' using errcode='42501'; end if;
 if v_o.status<>'pending' or v_o.expires_at<=now() or v_w.status<>'offered' then raise exception 'A oferta venceu ou já foi respondida. Peça uma nova vaga.' using errcode='23514'; end if;
 if not p_accept then update public.waitlist_offers set status='declined' where id=p_offer_id; update public.appointment_waitlist set status='waiting' where id=v_w.id; return null; end if;
 v_id:=public.book_appointment(p_barbershop_id,v_w.client_id,v_o.barber_membership_id,v_w.service_ids,v_o.starts_at,p_subscription_id);
 update public.waitlist_offers set status='accepted' where id=p_offer_id;
 update public.appointment_waitlist set status='booked',appointment_id=v_id where id=v_w.id;
 return v_id;
end;
$$;
revoke all on function app_private.respond_waitlist_offer(uuid,uuid,boolean,uuid) from public,anon;
grant execute on function app_private.respond_waitlist_offer(uuid,uuid,boolean,uuid) to authenticated;
create function public.respond_waitlist_offer(p_barbershop_id uuid,p_offer_id uuid,p_accept boolean,p_subscription_id uuid default null) returns uuid language sql security invoker set search_path='' as $$ select app_private.respond_waitlist_offer(p_barbershop_id,p_offer_id,p_accept,p_subscription_id); $$;
revoke all on function public.respond_waitlist_offer(uuid,uuid,boolean,uuid) from public,anon;
grant execute on function public.respond_waitlist_offer(uuid,uuid,boolean,uuid) to authenticated;

create function app_private.cancel_waitlist_entry(p_barbershop_id uuid,p_waitlist_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare v_w public.appointment_waitlist;
begin
 select * into strict v_w from public.appointment_waitlist where barbershop_id=p_barbershop_id and id=p_waitlist_id for update;
 if auth.uid() is null or not(app_private.is_own_client(p_barbershop_id,v_w.client_id) or app_private.can_manage_waitlist(p_barbershop_id,v_w.client_id,v_w.preferred_barber_id)) then raise exception 'Acesso negado.' using errcode='42501'; end if;
 if v_w.status='booked' then raise exception 'A reserva já foi criada; cancele pela agenda.' using errcode='23514'; end if;
 update public.appointment_waitlist set status='cancelled' where id=p_waitlist_id;
 update public.waitlist_offers set status='expired' where barbershop_id=p_barbershop_id and waitlist_id=p_waitlist_id and status='pending';
end;
$$;
revoke all on function app_private.cancel_waitlist_entry(uuid,uuid) from public,anon;
grant execute on function app_private.cancel_waitlist_entry(uuid,uuid) to authenticated;
create function public.cancel_waitlist_entry(p_barbershop_id uuid,p_waitlist_id uuid) returns void language sql security invoker set search_path='' as $$ select app_private.cancel_waitlist_entry(p_barbershop_id,p_waitlist_id); $$;
revoke all on function public.cancel_waitlist_entry(uuid,uuid) from public,anon;
grant execute on function public.cancel_waitlist_entry(uuid,uuid) to authenticated;

-- Consent is an append-only history. Care photos and publicity have separate purposes.
create table public.client_consents (
 id uuid primary key default gen_random_uuid(),barbershop_id uuid not null,client_id uuid not null,
 purpose text not null check(purpose in ('care_photos','marketing_images')), granted boolean not null,
 source text not null check(source in ('client_account','written','verbal')), statement text not null check(length(trim(statement)) between 1 and 1000), version text not null default '1', recorded_by uuid not null references auth.users(id), recorded_at timestamptz not null default clock_timestamp(),
 foreign key(barbershop_id,client_id) references public.clients(barbershop_id,id)
);
create index client_consents_latest on public.client_consents(barbershop_id,client_id,purpose,recorded_at desc,id desc);
create table public.client_care_records (
 id uuid primary key default gen_random_uuid(),barbershop_id uuid not null,client_id uuid not null,barber_membership_id uuid not null,
 kind text not null check(kind in ('reference','before','after','care_note','formula')), title text not null check(length(trim(title)) between 1 and 150), notes text check(length(notes)<=4000), formula text check(length(formula)<=2000), allergies text check(length(allergies)<=2000), patch_test boolean not null default false,
 procedure_id uuid, consent_id uuid references public.client_consents(id), storage_path text, performed_at timestamptz not null default now(),created_at timestamptz not null default now(),
 unique(barbershop_id,id),
 check(storage_path is null or storage_path like barbershop_id::text||'/'||client_id::text||'/'||id::text||'/%'),
 check(kind in ('care_note','formula') or consent_id is not null),
 foreign key(barbershop_id,client_id) references public.clients(barbershop_id,id),foreign key(barbershop_id,barber_membership_id) references public.memberships(barbershop_id,id),foreign key(barbershop_id,procedure_id) references public.procedure_records(barbershop_id,id)
);
alter table public.client_consents enable row level security;
alter table public.client_care_records enable row level security;
grant select on public.client_consents to authenticated;
grant select,insert,delete on public.client_care_records to authenticated;
grant update(storage_path) on public.client_care_records to authenticated;
create policy client_consents_read on public.client_consents for select to authenticated using (app_private.can_read_client(barbershop_id,client_id,'clients'));
create policy client_care_read on public.client_care_records for select to authenticated using (app_private.can_manage_client(barbershop_id,client_id,'clients'));
create policy client_care_write on public.client_care_records for all to authenticated using (app_private.can_manage_client(barbershop_id,client_id,'clients') and (app_private.has_shop_role(barbershop_id,array['admin']::public.shop_role[]) or app_private.is_own_barber(barbershop_id,barber_membership_id))) with check (app_private.can_manage_client(barbershop_id,client_id,'clients') and (app_private.has_shop_role(barbershop_id,array['admin']::public.shop_role[]) or app_private.is_own_barber(barbershop_id,barber_membership_id)));
create function app_private.record_client_consent(p_barbershop_id uuid,p_client_id uuid,p_purpose text,p_granted boolean,p_source text,p_statement text) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if auth.uid() is null or not(app_private.is_own_client(p_barbershop_id,p_client_id) or app_private.can_manage_client(p_barbershop_id,p_client_id,'clients')) then raise exception 'Acesso negado.' using errcode='42501'; end if;
 if app_private.is_own_client(p_barbershop_id,p_client_id) and p_source<>'client_account' then raise exception 'Origem de autorização inválida.' using errcode='23514'; end if;
 if not app_private.is_own_client(p_barbershop_id,p_client_id) and p_source not in ('written','verbal') then raise exception 'Informe como a autorização do cliente foi registrada.' using errcode='23514'; end if;
 perform pg_advisory_xact_lock(hashtext(p_barbershop_id::text),hashtext('consent:'||p_client_id::text||':'||p_purpose));
 insert into public.client_consents(barbershop_id,client_id,purpose,granted,source,statement,recorded_by) values(p_barbershop_id,p_client_id,p_purpose,p_granted,p_source,p_statement,auth.uid()) returning id into v_id;
 return v_id;
end;
$$;
revoke all on function app_private.record_client_consent(uuid,uuid,text,boolean,text,text) from public,anon;
grant execute on function app_private.record_client_consent(uuid,uuid,text,boolean,text,text) to authenticated;
create function public.record_client_consent(p_barbershop_id uuid,p_client_id uuid,p_purpose text,p_granted boolean,p_source text,p_statement text) returns uuid language sql security invoker set search_path='' as $$ select app_private.record_client_consent(p_barbershop_id,p_client_id,p_purpose,p_granted,p_source,p_statement); $$;
revoke all on function public.record_client_consent(uuid,uuid,text,boolean,text,text) from public,anon;
grant execute on function public.record_client_consent(uuid,uuid,text,boolean,text,text) to authenticated;

create function app_private.check_care_photo_consent() returns trigger language plpgsql security definer set search_path='' as $$
declare v_consent public.client_consents;
begin
 if not exists(select 1 from public.memberships m where m.id=new.barber_membership_id and m.barbershop_id=new.barbershop_id and m.role='barber') then raise exception 'Profissional responsável inválido.' using errcode='23514'; end if;
 if new.procedure_id is not null and not exists(select 1 from public.procedure_records p where p.id=new.procedure_id and p.barbershop_id=new.barbershop_id and p.client_id=new.client_id) then raise exception 'O procedimento deve pertencer ao mesmo cliente.' using errcode='23514'; end if;
 if new.kind in ('reference','before','after') then
  select * into v_consent from public.client_consents c where c.barbershop_id=new.barbershop_id and c.client_id=new.client_id and c.purpose='care_photos' order by recorded_at desc,id desc limit 1;
  if v_consent.id is null or not v_consent.granted or new.consent_id is distinct from v_consent.id then raise exception 'Registre autorização atual para fotos de atendimento antes de anexar.' using errcode='23514'; end if;
 end if;
 return new;
end;
$$;
revoke all on function app_private.check_care_photo_consent() from public,anon,authenticated;
create trigger check_care_photo_consent before insert or update of storage_path on public.client_care_records for each row execute function app_private.check_care_photo_consent();
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('client-records','client-records',false,2097152,array['image/jpeg','image/png','image/webp']) on conflict(id) do update set public=false,file_size_limit=2097152,allowed_mime_types=array['image/jpeg','image/png','image/webp'];
create function app_private.can_access_care_file(p_name text,p_write boolean) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.client_care_records r where p_name like r.barbershop_id::text||'/'||r.client_id::text||'/'||r.id::text||'/%' and app_private.can_manage_client(r.barbershop_id,r.client_id,'clients') and (not p_write or app_private.has_shop_role(r.barbershop_id,array['admin']::public.shop_role[]) or app_private.is_own_barber(r.barbershop_id,r.barber_membership_id)) and (not p_write or exists(select 1 from public.client_consents c where c.id=r.consent_id and c.granted and c.id=(select latest.id from public.client_consents latest where latest.barbershop_id=r.barbershop_id and latest.client_id=r.client_id and latest.purpose='care_photos' order by recorded_at desc,id desc limit 1))));
$$;
revoke all on function app_private.can_access_care_file(text,boolean) from public,anon;
grant execute on function app_private.can_access_care_file(text,boolean) to authenticated;
create policy care_files_read on storage.objects for select to authenticated using (bucket_id='client-records' and app_private.can_access_care_file(name,false));
create policy care_files_insert on storage.objects for insert to authenticated with check (bucket_id='client-records' and app_private.can_access_care_file(name,true));
create function app_private.can_delete_care_file(p_name text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.client_care_records r where p_name like r.barbershop_id::text||'/'||r.client_id::text||'/'||r.id::text||'/%' and app_private.can_manage_client(r.barbershop_id,r.client_id,'clients') and (app_private.has_shop_role(r.barbershop_id,array['admin']::public.shop_role[]) or app_private.is_own_barber(r.barbershop_id,r.barber_membership_id)));
$$;
revoke all on function app_private.can_delete_care_file(text) from public,anon;
grant execute on function app_private.can_delete_care_file(text) to authenticated;
create policy care_files_delete on storage.objects for delete to authenticated using (bucket_id='client-records' and app_private.can_delete_care_file(name));
