-- Synthetic identities only; no real customer, provider, message or consent is touched.
begin;
create temporary table client_profile_fixture(shop uuid,other_shop uuid,client uuid,other_client uuid,actor uuid,other_actor uuid);
grant select on client_profile_fixture to authenticated;
do $$ declare s uuid:=gen_random_uuid();s2 uuid:=gen_random_uuid();u uuid:=gen_random_uuid();u2 uuid:=gen_random_uuid();c uuid;c2 uuid;begin
 insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data) values(u,u::text||'@profile.test','{}','{}'),(u2,u2::text||'@profile.test','{}','{}');
 insert into public.barbershops(id,name,slug) values(s,'Perfil sintético','profile-test-'||s),(s2,'Outro perfil','profile-test-'||s2);
 insert into public.clients(barbershop_id,user_id,full_name,email,phone,notes) values(s,u,'Nome antigo','original@profile.test','11999999999','Anotação interna preservada') returning id into c;
 insert into public.clients(barbershop_id,user_id,full_name) values(s2,u2,'Outro cliente') returning id into c2;
 insert into client_profile_fixture values(s,s2,c,c2,u,u2);
 perform set_config('request.jwt.claim.sub',u::text,true);
end $$;
set local role authenticated;
do $$ declare f client_profile_fixture;v public.clients;begin
 select * into f from client_profile_fixture;
 if public.update_client_profile(f.shop,f.client,'  Nome corrigido  ','(11) 98888-7777')<>f.client then raise exception 'Perfil não retornou o cliente';end if;
 select * into v from public.clients where id=f.client;
 if v.full_name<>'Nome corrigido' or v.phone<>'(11) 98888-7777' or v.email<>'original@profile.test' or v.notes<>'Anotação interna preservada' or v.user_id<>f.actor then raise exception 'Alterou campo fora do cadastro pessoal';end if;
 begin perform public.update_client_profile(f.other_shop,f.other_client,'Intrusão',null);raise exception 'Outro cliente editável';exception when insufficient_privilege then null;end;
 begin perform public.update_client_profile(f.shop,f.other_client,'Intrusão',null);raise exception 'ID de outra loja aceito';exception when insufficient_privilege then null;end;
 begin perform public.update_client_profile(f.shop,f.client,'x',null);raise exception 'Nome curto aceito';exception when invalid_parameter_value then null;end;
 begin perform public.update_client_profile(f.shop,f.client,repeat('a',161),null);raise exception 'Nome excessivo aceito';exception when invalid_parameter_value then null;end;
 begin perform public.update_client_profile(f.shop,f.client,'Nome','1234');raise exception 'Telefone curto aceito';exception when invalid_parameter_value then null;end;
 begin update public.clients set user_id=f.other_actor where id=f.client;raise exception 'Usuário de login alterável pelo cliente';exception when insufficient_privilege then null;end;
 perform public.update_client_profile(f.shop,f.client,'Nome corrigido','');
 if exists(select 1 from public.clients where id=f.client and phone is not null) then raise exception 'Telefone opcional não pode ser removido';end if;
 if exists(select 1 from public.clients where id=f.other_client) then raise exception 'Cliente leu cadastro de outra loja';end if;
end $$;
reset role;
set local role anon;
do $$ begin
 if has_function_privilege('anon','public.update_client_profile(uuid,uuid,text,text)','execute') then raise exception 'Anônimo pode alterar perfil';end if;
end $$;
reset role;
select 'Client own profile validation and tenant isolation passed' as result;
rollback;
