-- Saúde das assinaturas por período (mês a mês): mesma lógica, com início e fim escolhidos.
do $mig$
declare d text := pg_get_functiondef('app_private.subscription_health(uuid,integer)'::regprocedure);
begin
  d := replace(d, 'app_private.subscription_health(p_barbershop_id uuid, p_days integer DEFAULT 30)', 'app_private.subscription_health_range(p_barbershop_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)');
  d := replace(d, 'declare v_from timestamptz:=now()-make_interval(days=>p_days);', 'declare v_from timestamptz:=p_from; v_to timestamptz:=least(p_to,now()); p_days integer:=greatest(1,ceil(extract(epoch from (least(p_to,now())-p_from))/86400))::int;');
  d := replace(d, 'if p_days is null or p_days<7 or p_days>365 then', 'if p_from is null or p_to is null or p_to<=p_from or p_to-p_from>interval ''372 days'' then');
  d := replace(d, 'e.occurred_at<=now()))', 'e.occurred_at<=v_to))');
  d := replace(d, 'p.paid_at<=now();', 'p.paid_at<v_to;');
  d := replace(d, 'a.starts_at<=now();', 'a.starts_at<v_to;');
  d := replace(d, '''to'',now()', '''to'',v_to');
  if position('subscription_health_range' in d) = 0 or position('v_to))' in d) = 0 then raise exception 'transform failed'; end if;
  execute d;
end $mig$;

grant execute on function app_private.subscription_health_range(uuid, timestamptz, timestamptz) to authenticated;

create or replace function app_private.subscription_health(p_barbershop_id uuid, p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path to ''
as $function$
begin
  if p_days is null or p_days<7 or p_days>365 then raise exception 'Período inválido' using errcode='22023'; end if;
  return app_private.subscription_health_range(p_barbershop_id, now()-make_interval(days=>p_days), now());
end $function$;

create or replace function public.subscription_health_range(p_barbershop_id uuid, p_from date, p_to date) returns jsonb
language plpgsql stable set search_path to ''
as $function$
declare v_tz text;
begin
  select coalesce(s.timezone,'America/Sao_Paulo') into v_tz from public.barbershops s where s.id = p_barbershop_id;
  return app_private.subscription_health_range(p_barbershop_id, p_from::timestamp at time zone v_tz, (p_to + 1)::timestamp at time zone v_tz);
end $function$;
grant execute on function public.subscription_health_range(uuid, date, date) to authenticated;
