-- Run after the scheduling, operations and subscription-contract migrations.
-- All users, tenants, payments and bookings below are synthetic and rolled back.
begin;
create temporary table subscription_test_fixture(shop uuid,other_shop uuid,client_id uuid,barber_id uuid,
 admin_user uuid,client_user uuid,barber_user uuid,club_service uuid,subscription_id uuid,appointment_id uuid);
grant select on subscription_test_fixture to authenticated;
do $$
declare sh uuid:=gen_random_uuid(); sh2 uuid:=gen_random_uuid(); au uuid:=gen_random_uuid(); cu uuid:=gen_random_uuid(); bu uuid:=gen_random_uuid();
 cl uuid; br uuid; club uuid; regular uuid; pl uuid; sub uuid; pay uuid; booked uuid; booked2 uuid; v jsonb;
 slot timestamptz:=(current_date+2)::timestamp+interval '9 hours'; original jsonb;
begin
 insert into auth.users(id,email,raw_user_meta_data) values
  (au,au::text||'@subscription-test.invalid','{}'),(cu,cu::text||'@subscription-test.invalid','{}'),(bu,bu::text||'@subscription-test.invalid','{}');
 insert into public.barbershops(id,name,slug,timezone) values(sh,'Teste contrato','contract-test-'||sh::text,'UTC'),(sh2,'Outro teste','contract-test-'||sh2::text,'UTC');
 insert into public.memberships(barbershop_id,user_id,role) values(sh,au,'admin');
 insert into public.memberships(barbershop_id,user_id,role) values(sh,bu,'barber') returning id into br;
 insert into public.clients(barbershop_id,user_id,full_name) values(sh,cu,'Cliente sintético') returning id into cl;
 insert into public.services(barbershop_id,name,duration_minutes,price_cents,requires_subscription) values(sh,'Clube exclusivo',30,0,true) returning id into club;
 insert into public.services(barbershop_id,name,duration_minutes,price_cents) values(sh,'Corte avulso',30,5000) returning id into regular;
 insert into public.barber_services(barbershop_id,barber_membership_id,service_id) values(sh,br,club),(sh,br,regular);
 insert into public.availability_rules(barbershop_id,barber_membership_id,weekday,start_time,end_time)
 select sh,br,d,'08:00'::time,'18:00'::time from generate_series(0,6) d;
 insert into public.subscription_plans(barbershop_id,name,description,price_cents,frequency_months,visits_per_cycle)
 values(sh,'Condição original','Clube em dois meses',10000,2,2) returning id into pl;
 insert into public.subscription_plan_services values(sh,pl,club);
 insert into public.subscriptions(barbershop_id,client_id,plan_id) values(sh,cl,pl) returning id,contract_snapshot into sub,original;
 if original->>'price_cents'<>'10000' or original->>'frequency_months'<>'2' or original->>'visits_per_cycle'<>'2' then raise exception 'Snapshot incorreto'; end if;
 begin update public.subscriptions set contract_snapshot=jsonb_set(original,'{price_cents}','0') where id=sub;
  raise exception 'Condições imutáveis foram alteradas'; exception when invalid_parameter_value then null; end;
 -- Only closed contracts allow updating plan conditions. Reopening still retains its original snapshot.
 update public.subscriptions set status='cancelled' where id=sub;
 update public.subscription_plans set name='Catálogo atualizado',price_cents=20000,frequency_months=1,visits_per_cycle=10 where id=pl;
 delete from public.subscription_plan_services where plan_id=pl;
 insert into public.subscription_plan_services values(sh,pl,regular);
 insert into public.payments(barbershop_id,client_id,subscription_id,provider,provider_payment_id,amount_cents,status,method,paid_at)
 values(sh,cl,sub,'mercadopago','synthetic-'||gen_random_uuid(),10000,'paid','card',now()) returning id into pay;
 update public.subscriptions set status='active',current_period_start=now()-interval '1 day',current_period_end=now()+interval '60 days' where id=sub;
 if public.reconcile_subscription_entitlement(sub)<>'active' then raise exception 'Preço atual invalidou pagamento contratado'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',cu,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',cu::text,true);
 v:=public.booking_subscription_eligibility(sh,cl,array[club],slot);
 if not (v->>'eligible')::boolean or v->'subscriptions'->0->>'remaining_visits'<>'2' then raise exception 'Cobertura original perdeu validade'; end if;
 begin perform public.book_appointment(sh,cl,br,array[club],slot,null);
  raise exception 'Clube foi agendado sem assinatura'; exception when invalid_parameter_value then null; end;
 booked:=public.book_appointment(sh,cl,br,array[club],slot,sub);
 booked2:=public.book_appointment(sh,cl,br,array[club],slot+interval '1 hour',sub);
 v:=public.booking_subscription_eligibility(sh,cl,array[club],slot+interval '2 hours');
 if (v->>'eligible')::boolean then raise exception 'Assinatura excedeu limite original'; end if;
 v:=public.booking_subscription_eligibility(sh,cl,array[club],slot+interval '2 hours',booked);
 if not (v->>'eligible')::boolean or v->'subscriptions'->0->>'remaining_visits'<>'1' then raise exception 'Reagendamento perdeu a própria reserva'; end if;
 perform public.manage_appointment(sh,booked,'reschedule',slot+interval '2 hours');
 if (select starts_at from public.appointments where id=booked)<>slot+interval '2 hours' then raise exception 'Reagendamento não preservou reserva'; end if;
 update public.payments set status='refunded' where id=pay;
 if (select status from public.subscriptions where id=sub)<>'past_due' then raise exception 'Estorno não suspendeu benefício'; end if;
 v:=public.booking_subscription_eligibility(sh,cl,array[club],slot+interval '3 hours');
 if (v->>'eligible')::boolean then raise exception 'Estorno manteve elegibilidade'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',au,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',au::text,true);
 v:=public.subscription_health(sh,30);
 if v->>'contribution_margin_cents' is not null or (v->>'history_complete')::boolean or v->>'churn_pct' is not null then raise exception 'Saúde inventou margem ou histórico'; end if;
 if v->>'overdue_cents'<>'10000' then raise exception 'Inadimplência usou preço de catálogo'; end if;
 insert into subscription_test_fixture values(sh,sh2,cl,br,au,cu,bu,club,sub,booked);
end $$;
-- Exercise actual application privileges, not only guards under the operator role.
set local role authenticated;
do $$ declare f record; v jsonb;
begin
 select * into f from subscription_test_fixture;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',f.client_user,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',f.client_user::text,true);
 begin perform public.subscription_health(f.shop,30); raise exception 'Cliente leu saúde financeira'; exception when insufficient_privilege then null; end;
 if exists(select 1 from public.subscription_payment_financial_snapshots where barbershop_id=f.shop) then raise exception 'Cliente leu impostos privados'; end if;
 begin perform public.booking_subscription_eligibility(f.other_shop,f.client_id,array[f.club_service],now()); raise exception 'Elegibilidade cruzou lojas'; exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',f.barber_user,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',f.barber_user::text,true);
 begin perform public.subscription_health(f.shop,30); raise exception 'Barbeiro leu saúde financeira'; exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',f.admin_user,'role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub',f.admin_user::text,true);
 v:=public.subscription_health(f.shop,30);
 if v->>'overdue_contracts'<>'1' then raise exception 'Administrador não acessou a recuperação'; end if;
 begin perform public.subscription_health(f.other_shop,30); raise exception 'Administrador leu outra loja'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'Subscription snapshots, exclusive services, balance, rescheduling, refunds and financial isolation passed' as result;
rollback;
