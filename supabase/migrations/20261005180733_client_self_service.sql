create function app_private.update_client_profile(p_shop uuid,p_client uuid,p_full_name text,p_phone text default null) returns uuid language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not app_private.is_own_client(p_shop,p_client) then raise exception 'Você só pode editar seu próprio cadastro.' using errcode='42501';end if;
 if p_full_name is null or length(trim(p_full_name)) not between 2 and 160 then raise exception 'Informe seu nome, entre 2 e 160 caracteres.' using errcode='22023';end if;
 if nullif(trim(p_phone),'') is not null and (length(p_phone)>50 or length(regexp_replace(p_phone,'[^0-9]','','g')) not between 10 and 15) then raise exception 'Informe um telefone válido com DDD.' using errcode='22023';end if;
 update public.clients set full_name=trim(p_full_name),phone=nullif(trim(p_phone),'') where barbershop_id=p_shop and id=p_client;
 return p_client;
end $$;
revoke all on function app_private.update_client_profile(uuid,uuid,text,text) from public,anon;
grant execute on function app_private.update_client_profile(uuid,uuid,text,text) to authenticated;
create function public.update_client_profile(p_shop uuid,p_client uuid,p_full_name text,p_phone text default null) returns uuid language sql security invoker set search_path='' as $$select app_private.update_client_profile(p_shop,p_client,p_full_name,p_phone);$$;
revoke all on function public.update_client_profile(uuid,uuid,text,text) from public,anon;
grant execute on function public.update_client_profile(uuid,uuid,text,text) to authenticated;
