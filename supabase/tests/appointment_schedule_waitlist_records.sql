-- Synthetic data only. The entire fixture is rolled back, including Storage metadata.
begin;
set local time zone 'UTC';
create temporary table agenda_test_fixture(shop uuid,other_shop uuid,admin_user uuid,barber_user uuid,other_barber_user uuid,client_user uuid,other_user uuid,client_id uuid,other_client_id uuid,barber_id uuid,other_barber_id uuid,service_id uuid,resource_id uuid,appointment_id uuid,waitlist_id uuid,offer_id uuid,care_id uuid);
grant select on agenda_test_fixture to authenticated;
do $$
declare sh uuid:=gen_random_uuid(); sh2 uuid:=gen_random_uuid(); au uuid:=gen_random_uuid(); bu uuid:=gen_random_uuid(); bu2 uuid:=gen_random_uuid(); cu uuid:=gen_random_uuid(); ou uuid:=gen_random_uuid(); cl uuid; cl2 uuid; br uuid; br2 uuid; srv uuid; resource uuid; booked uuid; booked2 uuid; waiting uuid; offered uuid; consent uuid; care uuid; long_service uuid; details jsonb; slot timestamptz:=(current_date+2)::timestamp+interval '9 hours'; v_path text;
begin
 insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data) values(au,au::text||'@agenda-test.invalid','{}','{}'),(bu,bu::text||'@agenda-test.invalid','{}','{}'),(bu2,bu2::text||'@agenda-test.invalid','{}','{}'),(cu,cu::text||'@agenda-test.invalid','{}','{}'),(ou,ou::text||'@agenda-test.invalid','{}','{}');
 insert into public.barbershops(id,name,slug,timezone) values(sh,'Agenda sintética','agenda-test-'||sh,'UTC'),(sh2,'Outro espaço','agenda-test-'||sh2,'UTC');
 insert into public.memberships(barbershop_id,user_id,role,display_name) values(sh,au,'admin','Administrador'),(sh2,ou,'admin','Outra empresa');
 insert into public.memberships(barbershop_id,user_id,role,display_name) values(sh,bu,'barber','Profissional um') returning id into br;
 insert into public.memberships(barbershop_id,user_id,role,display_name) values(sh,bu2,'barber','Profissional dois') returning id into br2;
 insert into public.module_permissions(barbershop_id,user_id,module,allowed) select sh,u,m,true from unnest(array[bu,bu2]) u cross join unnest(array['clients','appointments','services']) m;
 insert into public.clients(barbershop_id,user_id,full_name) values(sh,cu,'Cliente sintético') returning id into cl;
 insert into public.clients(barbershop_id,full_name) values(sh,'Cliente sem atribuição') returning id into cl2;
 insert into public.client_barbers(barbershop_id,client_id,barber_membership_id) values(sh,cl,br);
 insert into public.services(barbershop_id,name,duration_minutes,price_cents) values(sh,'Corte de teste',30,5000) returning id into srv;
 insert into public.barber_services values(sh,br,srv),(sh,br2,srv);
 insert into public.availability_rules(barbershop_id,barber_membership_id,weekday,start_time,end_time) select sh,b,d,'08:00'::time,'18:00'::time from unnest(array[br,br2]) b cross join generate_series(0,6) d;
 insert into public.barber_service_timings values(sh,br,srv,45,15,15);
 insert into public.schedule_resources(barbershop_id,name,capacity) values(sh,'Lavatório único',1) returning id into resource;
 insert into public.service_resource_requirements values(sh,srv,resource,1);
 insert into public.shop_booking_policies values(sh,24,12,true,1000);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',au,'role','authenticated')::text,true);
 details:=app_private.appointment_schedule_details(sh,br,array[srv],slot);
 if not (details->>'available')::boolean or details->>'duration_minutes'<>'45' or (details->>'ends_at')::timestamptz<>slot+interval '45 minutes' then raise exception 'Duração individual incorreta'; end if;
 if exists(select 1 from public.available_slots(sh,br,array[srv],slot::date) where starts_at=slot::date+interval '8 hours') then raise exception 'Buffer antes escapou da jornada: %',app_private.appointment_schedule_details(sh,br,array[srv],slot::date+interval '8 hours'); end if;
 booked:=public.book_appointment(sh,cl,br,array[srv],slot,null);
 if (select occupied_starts_at from public.appointments where id=booked)<>slot-interval '15 minutes' or (select occupied_ends_at from public.appointments where id=booked)<>slot+interval '60 minutes' then raise exception 'Reserva não guardou intervalos'; end if;
 if not exists(select 1 from storage.buckets where id='client-records' and not public) then raise exception 'Fotos clínicas estão em bucket público';end if;
 if (select status from public.appointment_deposits where appointment_id=booked)<>'requires_provider' or exists(select 1 from public.payments where appointment_id=booked) then raise exception 'Sinal fingiu cobrança'; end if;
 begin perform public.book_appointment(sh,cl2,br2,array[srv],slot,null);raise exception 'Recurso foi reservado simultaneamente';exception when check_violation or invalid_parameter_value then null;end;
 booked2:=public.book_appointment(sh,cl2,br2,array[srv],slot+interval '1 hour',null);
 if booked2 is null then raise exception 'Fim exclusivo do intervalo bloqueou vaga válida';end if;
 perform public.manage_appointment(sh,booked2,'cancel',null,'Teste sem cobrança');
 if (select status from public.appointment_deposits where appointment_id=booked2)<>'cancelled' then raise exception 'Cancelamento manteve sinal pendente';end if;
 begin perform public.manage_appointment(sh,booked,'no_show');raise exception 'Falta antecipada aceita';exception when check_violation then null;end;
 -- Custom resource blocks and the preserved Cashbarber archive both constrain slots.
 perform public.create_schedule_block(sh,null,resource,(slot+interval '1 day')::timestamp,(slot+interval '1 day 1 hour')::timestamp,'Manutenção sintética');
 if (app_private.appointment_schedule_details(sh,br2,array[srv],slot+interval '1 day')->>'available')::boolean then raise exception 'Bloqueio de recurso ignorado';end if;
 update public.memberships set import_source='cashbarber',source_id='agenda-fixture' where id=br2;
 insert into app_private.cashbarber_import_records(barbershop_id,dataset,source_id,payload) values(sh,'availability_blocks','synthetic-block',jsonb_build_object('id_barbeiro','agenda-fixture','start',(slot+interval '2 days')::timestamp,'end',(slot+interval '2 days 1 hour')::timestamp));
 if (app_private.appointment_schedule_details(sh,br2,array[srv],slot+interval '2 days')->>'available')::boolean then raise exception 'Bloqueio importado ignorado';end if;
 waiting:=public.create_waitlist_entry(sh,cl,array[srv],br,slot::date,slot::date+7,'09:00','17:00',array[0,1,2,3,4,5,6]::smallint[],'Só horários de preferência');
 begin perform public.offer_waitlist_slot(sh,waiting,br,slot+interval '10 hours');raise exception 'Oferta fora da preferência aceita';exception when check_violation then null;end;
 offered:=public.offer_waitlist_slot(sh,waiting,br,slot+interval '2 hours');
 if (select count(*) from public.appointments where barbershop_id=sh)<>2 then raise exception 'Oferta já criou reserva';end if;
 -- Consent does not imply publicity and is mandatory for clinical photos.
 begin insert into public.client_care_records(barbershop_id,client_id,barber_membership_id,kind,title,consent_id) values(sh,cl,br,'before','Foto sem autorização',gen_random_uuid());raise exception 'Foto sem autorização aceita';exception when check_violation then null;end;
 consent:=public.record_client_consent(sh,cl,'care_photos',true,'written','Autorização de atendimento sintética.');
 care:=gen_random_uuid();v_path:=sh::text||'/'||cl::text||'/'||care::text||'/'||care::text||'.jpg';
 insert into public.client_care_records(id,barbershop_id,client_id,barber_membership_id,kind,title,consent_id,storage_path) values(care,sh,cl,br,'before','Antes sintético',consent,v_path);
 if exists(select 1 from public.client_consents where client_id=cl and purpose='marketing_images' and granted) then raise exception 'Foto clínica autorizou marketing';end if;
 -- Resource capacity uses maximum simultaneous demand, not the sum of disjoint reservations.
 update public.schedule_resources set capacity=2 where id=resource;
 perform public.book_appointment(sh,cl,br,array[srv],slot+interval '5 hours',null);
 perform public.book_appointment(sh,cl,br,array[srv],slot+interval '7 hours',null);
 insert into public.services(barbershop_id,name,duration_minutes,price_cents) values(sh,'Sessão longa sintética',180,9000) returning id into long_service;
 insert into public.barber_services values(sh,br2,long_service);
 insert into public.service_resource_requirements values(sh,long_service,resource,1);
 details:=app_private.appointment_schedule_details(sh,br2,array[long_service],slot+interval '5 hours');
 if not (details->>'available')::boolean then raise exception 'Capacidade somou reservas que não acontecem juntas';end if;
 insert into agenda_test_fixture values(sh,sh2,au,bu,bu2,cu,ou,cl,cl2,br,br2,srv,resource,booked,waiting,offered,care);
end $$;
set local role authenticated;
do $$ declare f record; v_path text; booked uuid; consent uuid;
begin
 select * into f from agenda_test_fixture;
 -- Client can confirm only their own booking, accept one real slot and cannot view private staff notes/photos.
 perform set_config('request.jwt.claims',jsonb_build_object('sub',f.client_user,'role','authenticated')::text,true);
 perform public.manage_appointment(f.shop,f.appointment_id,'confirm');
 if (select client_confirmed_at from public.appointments where id=f.appointment_id) is null then raise exception 'Confirmação não registrada';end if;
 if exists(select 1 from public.client_care_records where barbershop_id=f.shop) then raise exception 'Cliente acessou notas internas';end if;
 booked:=public.respond_waitlist_offer(f.shop,f.offer_id,true,null);
 if booked is null or (select status from public.appointment_waitlist where id=f.waitlist_id)<>'booked' then raise exception 'Aceite não criou reserva';end if;
 begin perform public.respond_waitlist_offer(f.shop,f.offer_id,true,null);raise exception 'Oferta duplicou reserva';exception when check_violation then null;end;
 begin perform public.record_client_consent(f.shop,f.client_id,'care_photos',true,'written','Origem falsa');raise exception 'Cliente fingiu documento';exception when check_violation then null;end;
 -- Assigned barber can view private record, other barber and other tenant cannot.
 perform set_config('request.jwt.claims',jsonb_build_object('sub',f.barber_user,'role','authenticated')::text,true);
 if not exists(select 1 from public.client_care_records where id=f.care_id) then raise exception 'Barbeiro atribuído não leu a ficha';end if;
 select storage_path into v_path from public.client_care_records where id=f.care_id;
 insert into storage.objects(bucket_id,name) values('client-records',v_path);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',f.other_barber_user,'role','authenticated')::text,true);
 if exists(select 1 from public.client_care_records where id=f.care_id) or exists(select 1 from storage.objects where bucket_id='client-records') then raise exception 'Foto vazou para outro barbeiro';end if;
 begin perform public.manage_appointment(f.shop,f.appointment_id,'cancel');raise exception 'Outro barbeiro cancelou reserva';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',f.other_user,'role','authenticated')::text,true);
 if exists(select 1 from public.appointment_waitlist where barbershop_id=f.shop) or exists(select 1 from public.schedule_resources where barbershop_id=f.shop) then raise exception 'Dados cruzaram empresas';end if;
 begin perform public.offer_waitlist_slot(f.shop,f.waitlist_id,f.barber_id,now()+interval '7 days');raise exception 'Oferta cruzou empresas';exception when insufficient_privilege then null;end;
 -- Client revocation blocks new upload; old records are retained with permission-controlled access.
 perform set_config('request.jwt.claims',jsonb_build_object('sub',f.client_user,'role','authenticated')::text,true);
 consent:=public.record_client_consent(f.shop,f.client_id,'care_photos',false,'client_account','Revogação sintética.');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',f.barber_user,'role','authenticated')::text,true);
 begin insert into storage.objects(bucket_id,name) values('client-records',v_path||'.webp');raise exception 'Revogação não bloqueou upload';exception when insufficient_privilege then null;end;
 if not exists(select 1 from storage.objects where name=v_path) then raise exception 'Revogação apagou evidência anterior';end if;
 delete from storage.objects where name=v_path;
 if exists(select 1 from storage.objects where name=v_path) then raise exception 'Limpeza autorizada falhou';end if;
end $$;
reset role;
set local role anon;
do $$ declare f record; begin
 -- This fixture is readable only by authenticated for tenant checks, so use the safe RPC without client data.
 if public.public_booking_policy(gen_random_uuid()) is not null then raise exception 'Política de empresa inexistente apareceu';end if;
 begin perform * from public.client_care_records;raise exception 'Anônimo acessou ficha';exception when insufficient_privilege then null;end;
end $$;
reset role;
select 'Scheduling, waitlist and private care-record tests passed' as result;
rollback;
