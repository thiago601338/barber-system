-- Comparisons use equal calendar windows. Drilldown and daily actions enforce the same scope as aggregates.
create table public.marketing_campaigns (
 id uuid primary key default gen_random_uuid(), barbershop_id uuid not null references public.barbershops(id),
 name text not null check(length(btrim(name)) between 2 and 160), code text not null check(code~'^[a-z0-9][a-z0-9_-]{2,59}$'),
 channel text not null check(channel in ('instagram_paid','instagram_organic','google','referral','other')),
 starts_on date not null, ends_on date check(ends_on>=starts_on), active boolean not null default true,
 offer_id uuid, notes text, created_at timestamptz not null default now(),
 unique(barbershop_id,id), unique(barbershop_id,code),
 foreign key(barbershop_id,offer_id) references public.partner_offers(barbershop_id,id)
);
create table public.marketing_spend (
 id uuid primary key default gen_random_uuid(), barbershop_id uuid not null, campaign_id uuid not null,
 occurred_on date not null, amount_cents integer not null check(amount_cents>0), reference text,
 created_at timestamptz not null default now(),
 foreign key(barbershop_id,campaign_id) references public.marketing_campaigns(barbershop_id,id)
);
create index marketing_spend_campaign_day on public.marketing_spend(barbershop_id,campaign_id,occurred_on);
create table public.appointment_campaign_attribution (
 appointment_id uuid primary key, barbershop_id uuid not null, campaign_id uuid not null,
 code_snapshot text not null, channel_snapshot text not null, attributed_at timestamptz not null default now(),
 foreign key(barbershop_id,appointment_id) references public.appointments(barbershop_id,id),
 foreign key(barbershop_id,campaign_id) references public.marketing_campaigns(barbershop_id,id)
);
create index appointment_campaign_shop_campaign on public.appointment_campaign_attribution(barbershop_id,campaign_id,appointment_id);
create table public.daily_task_states (
 barbershop_id uuid not null references public.barbershops(id), task_key text not null,
 assignee_membership_id uuid, status text not null default 'open' check(status in ('open','done','snoozed')),
 note text check(length(note)<=500), updated_by uuid not null references auth.users(id), updated_at timestamptz not null default now(),
 primary key(barbershop_id,task_key),
 foreign key(barbershop_id,assignee_membership_id) references public.memberships(barbershop_id,id)
);
create index daily_task_assignee on public.daily_task_states(barbershop_id,assignee_membership_id);
do $$ declare t text; begin
 foreach t in array array['marketing_campaigns','marketing_spend','appointment_campaign_attribution','daily_task_states'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
 foreach t in array array['marketing_campaigns','marketing_spend'] loop
  execute format('create policy campaign_admin on public.%I for all to authenticated using(app_private.has_shop_role(barbershop_id,array[''admin'']::public.shop_role[])) with check(app_private.has_shop_role(barbershop_id,array[''admin'']::public.shop_role[]))',t);
  execute format('grant insert,update on public.%I to authenticated',t);
 end loop;
end $$;
create policy attribution_admin on public.appointment_campaign_attribution for select to authenticated using(app_private.has_shop_role(barbershop_id,array['admin']::public.shop_role[]));
create policy daily_state_read on public.daily_task_states for select to authenticated using(app_private.has_shop_role(barbershop_id,array['admin']::public.shop_role[]) or app_private.is_own_barber(barbershop_id,assignee_membership_id));

create function public.attribute_appointment_campaign(p_shop uuid,p_appointment uuid,p_code text) returns boolean
language plpgsql security definer set search_path='' as $$
declare a public.appointments; c public.marketing_campaigns; v_day date;
begin
 if (select auth.uid()) is null then raise exception 'Entre na sua conta para continuar' using errcode='42501'; end if;
 select * into a from public.appointments where id=p_appointment and barbershop_id=p_shop;
 if a.id is null or a.created_at<now()-interval '15 minutes' or not (app_private.has_shop_role(p_shop,array['admin']::public.shop_role[]) or app_private.is_own_client(p_shop,a.client_id)) then raise exception 'Atribuição não permitida' using errcode='42501'; end if;
 select (now() at time zone timezone)::date into v_day from public.barbershops where id=p_shop;
 select * into c from public.marketing_campaigns where barbershop_id=p_shop and code=lower(btrim(p_code)) and active and starts_on<=v_day and (ends_on is null or ends_on>=v_day);
 if c.id is null then return false; end if;
 insert into public.appointment_campaign_attribution values(a.id,p_shop,c.id,c.code,c.channel,now()) on conflict(appointment_id) do nothing;
 return true;
end $$;
revoke all on function public.attribute_appointment_campaign(uuid,uuid,text) from public,anon;
grant execute on function public.attribute_appointment_campaign(uuid,uuid,text) to authenticated;

create function public.public_campaign_lookup(p_shop uuid,p_code text) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('code',c.code,'name',c.name,'offer_code',o.code)
 from public.marketing_campaigns c join public.barbershops b on b.id=c.barbershop_id and b.active
 left join public.partner_offers o on o.id=c.offer_id and o.barbershop_id=c.barbershop_id and o.active
 where c.barbershop_id=p_shop and c.code=lower(btrim(p_code)) and c.active
 and c.starts_on<=(now() at time zone b.timezone)::date and (c.ends_on is null or c.ends_on>=(now() at time zone b.timezone)::date)
$$;
revoke all on function public.public_campaign_lookup(uuid,text) from public;
grant execute on function public.public_campaign_lookup(uuid,text) to anon,authenticated;

create function public.book_attributed_appointment(
 p_barbershop_id uuid,p_client_id uuid,p_barber_membership_id uuid,p_service_ids uuid[],p_starts_at timestamptz,
 p_subscription_id uuid default null,p_campaign_code text default null,p_coupon_code text default null,
 p_expected_subtotal_cents integer default null,p_expected_discount_cents integer default null,p_expected_total_cents integer default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; aid uuid;
begin
 if p_campaign_code is not null and public.public_campaign_lookup(p_barbershop_id,p_campaign_code) is null then raise exception 'Esta campanha não está mais disponível. Remova o código de campanha para continuar.' using errcode='22023'; end if;
 if nullif(btrim(p_coupon_code),'') is not null then
  if p_subscription_id is not null then raise exception 'Assinatura e cupom não podem ser usados juntos' using errcode='22023'; end if;
  result:=public.book_partner_appointment(p_barbershop_id,p_client_id,p_barber_membership_id,p_service_ids,p_starts_at,p_coupon_code,p_expected_subtotal_cents,p_expected_discount_cents,p_expected_total_cents);
  aid:=(result->>'appointment_id')::uuid;
 else
  aid:=public.book_appointment(p_barbershop_id,p_client_id,p_barber_membership_id,p_service_ids,p_starts_at,p_subscription_id);
  result:=jsonb_build_object('appointment_id',aid);
 end if;
 if p_campaign_code is not null then perform public.attribute_appointment_campaign(p_barbershop_id,aid,p_campaign_code); end if;
 return result;
end $$;
revoke all on function public.book_attributed_appointment(uuid,uuid,uuid,uuid[],timestamptz,uuid,text,text,integer,integer,integer) from public,anon;
grant execute on function public.book_attributed_appointment(uuid,uuid,uuid,uuid[],timestamptz,uuid,text,text,integer,integer,integer) to authenticated;

-- Match both service receipts and product/bar sales to the responsible professional.
-- The same predicate is used by cards, comparisons, chart and drilldown.
create function app_private.management_receipts(p_shop uuid,p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare tz text; admin boolean; own uuid; amount bigint; transactions bigint; days jsonb; chart_end date;
begin
 if (select auth.uid()) is null or not app_private.has_shop_role(p_shop,array['admin','barber']::public.shop_role[]) or not app_private.has_module(p_shop,'reports') then raise exception 'Acesso não permitido' using errcode='42501'; end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>370 then raise exception 'Filtro inválido' using errcode='22023'; end if;
 select timezone into tz from public.barbershops where id=p_shop;
 admin:=app_private.has_shop_role(p_shop,array['admin']::public.shop_role[]);
 if not admin then select id into own from public.memberships where barbershop_id=p_shop and user_id=(select auth.uid()) and active and role='barber'; end if;
 select coalesce(sum(p.amount_cents),0),count(*) filter(where p.amount_cents>0) into amount,transactions
 from public.payments p left join public.appointments a on a.id=p.appointment_id and a.barbershop_id=p.barbershop_id left join public.sales s on s.id=p.sale_id and s.barbershop_id=p.barbershop_id
 where p.barbershop_id=p_shop and p.status='paid' and p.paid_at>=p_from::timestamp at time zone tz and p.paid_at<(p_to+1)::timestamp at time zone tz and (admin or a.barber_membership_id=own or s.barber_membership_id=own);
 chart_end:=least(p_to,(now() at time zone tz)::date);
 select coalesce(jsonb_agg(jsonb_build_object('day',d.chart_date,'value',coalesce(x.amount,0)) order by d.chart_date),'[]') into days
 from (select generate_series(greatest(p_from,chart_end-6)::timestamp,chart_end::timestamp,interval '1 day')::date chart_date)d
 left join lateral(select sum(p.amount_cents) amount from public.payments p left join public.appointments a on a.id=p.appointment_id and a.barbershop_id=p.barbershop_id left join public.sales s on s.id=p.sale_id and s.barbershop_id=p.barbershop_id where p.barbershop_id=p_shop and p.status='paid' and p.paid_at>=d.chart_date::timestamp at time zone tz and p.paid_at<(d.chart_date+1)::timestamp at time zone tz and (admin or a.barber_membership_id=own or s.barber_membership_id=own))x on true;
 return jsonb_build_object('revenue_cents',amount,'paid_transactions',transactions,'ticket_average_cents',case when transactions>0 then round(amount::numeric/transactions) else 0 end,'days',days);
end $$;
revoke all on function app_private.management_receipts(uuid,date,date) from public,anon,authenticated;

create function public.management_insights(p_shop uuid,p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_current jsonb; v_prior jsonb; tz text; v_admin boolean; v_barber uuid; v_sold bigint; v_forecast bigint; v_goals jsonb:='[]';
begin
 v_current:=app_private.management_dashboard(p_shop,p_from,p_to);
 v_prior:=app_private.management_dashboard(p_shop,p_from-(p_to-p_from+1),p_from-1);
 select timezone into tz from public.barbershops where id=p_shop;
 v_admin:=app_private.has_shop_role(p_shop,array['admin']::public.shop_role[]);
 if not v_admin then select id into v_barber from public.memberships where barbershop_id=p_shop and user_id=(select auth.uid()) and active and role='barber'; end if;
 if app_private.has_module(p_shop,'reports') then
  v_current:=v_current||app_private.management_receipts(p_shop,p_from,p_to);
  v_prior:=v_prior||app_private.management_receipts(p_shop,p_from-(p_to-p_from+1),p_from-1);
 end if;
 if app_private.has_module(p_shop,'reports') then
  select coalesce(sum(total_price_cents),0) into v_sold from public.appointments where barbershop_id=p_shop and status='completed' and subscription_id is null and starts_at>=p_from::timestamp at time zone tz and starts_at<(p_to+1)::timestamp at time zone tz and (v_admin or barber_membership_id=v_barber);
  select v_sold+coalesce(sum(i.total_cents),0) into v_sold from public.sale_items i join public.sales s on s.id=i.sale_id and s.barbershop_id=i.barbershop_id where s.barbershop_id=p_shop and s.status='paid' and i.product_id is not null and s.created_at>=p_from::timestamp at time zone tz and s.created_at<(p_to+1)::timestamp at time zone tz and (v_admin or s.barber_membership_id=v_barber);
 end if;
 if app_private.has_module(p_shop,'appointments') then
  select coalesce(sum(total_price_cents),0) into v_forecast from public.appointments where barbershop_id=p_shop and status in ('pending','confirmed') and subscription_id is null and starts_at>=greatest(now(),p_from::timestamp at time zone tz) and starts_at<(p_to+1)::timestamp at time zone tz and (v_admin or barber_membership_id=v_barber);
 end if;
 if app_private.has_module(p_shop,'goals') then v_goals:=public.goal_progress(p_shop); end if;
 return jsonb_build_object('current',v_current,'previous',v_prior,'from',p_from,'to',p_to,'previous_from',p_from-(p_to-p_from+1),'previous_to',p_from-1,'sold_cents',v_sold,'forecast_cents',v_forecast,'goals',v_goals,'provenance',jsonb_build_object('received','Pagamentos com status pago, pela data de recebimento; inclui dados importados.','sold','Serviços avulsos concluídos + produtos em vendas pagas, pela data de execução/venda. Não soma mensalidade a visita coberta.','forecast','Reservas avulsas futuras ainda pendentes ou confirmadas no período. Não representa recebimento.','ticket','Recebido dividido por pagamentos positivos; pagamentos divididos contam como transações.','occupancy','Minutos de atendimento reservados dentro das regras e exceções da equipe / minutos disponíveis.','plans','Contratos ativos atuais e contratos ativos preservados do Cashbarber; não é uma contagem histórica do período.'));
end $$;
revoke all on function public.management_insights(uuid,date,date) from public,anon;
grant execute on function public.management_insights(uuid,date,date) to authenticated;

create function public.management_drilldown(p_shop uuid,p_from date,p_to date,p_kind text,p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare tz text; v_admin boolean; v_barber uuid; result jsonb;
begin
 if (select auth.uid()) is null or not app_private.has_shop_role(p_shop,array['admin','barber']::public.shop_role[]) or not app_private.has_module(p_shop,case when p_kind='occupancy' then 'appointments' else 'reports' end) then raise exception 'Acesso não permitido' using errcode='42501'; end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>370 or p_offset<0 or p_offset>100000 or p_kind not in ('received','sold','forecast','occupancy') then raise exception 'Filtro inválido' using errcode='22023'; end if;
 select timezone into tz from public.barbershops where id=p_shop;
 v_admin:=app_private.has_shop_role(p_shop,array['admin']::public.shop_role[]);
 if not v_admin then select id into v_barber from public.memberships where barbershop_id=p_shop and user_id=(select auth.uid()) and active and role='barber'; end if;
 if p_kind='received' then
  select coalesce(jsonb_agg(x),'[]') into result from (select p.id,p.paid_at occurred_at,c.full_name client_name,p.amount_cents value_cents,p.method,p.provider source,p.appointment_id,p.sale_id,p.subscription_id from public.payments p left join public.clients c on c.id=p.client_id and c.barbershop_id=p.barbershop_id left join public.appointments a on a.id=p.appointment_id and a.barbershop_id=p.barbershop_id left join public.sales s on s.id=p.sale_id and s.barbershop_id=p.barbershop_id where p.barbershop_id=p_shop and p.status='paid' and p.paid_at>=p_from::timestamp at time zone tz and p.paid_at<(p_to+1)::timestamp at time zone tz and (v_admin or a.barber_membership_id=v_barber or s.barber_membership_id=v_barber) order by p.paid_at desc,p.id limit 50 offset p_offset)x;
 elsif p_kind='sold' then
  select coalesce(jsonb_agg(x),'[]') into result from (
   select * from (
    select a.id,a.starts_at occurred_at,c.full_name client_name,a.total_price_cents::bigint value_cents,'Serviço avulso'::text source
    from public.appointments a join public.clients c on c.id=a.client_id and c.barbershop_id=a.barbershop_id
    where a.barbershop_id=p_shop and a.status='completed' and a.subscription_id is null and a.starts_at>=p_from::timestamp at time zone tz and a.starts_at<(p_to+1)::timestamp at time zone tz and (v_admin or a.barber_membership_id=v_barber)
    union all
    select s.id,s.created_at,c.full_name,sum(i.total_cents),'Produtos / bar e cozinha'::text
    from public.sales s join public.sale_items i on i.sale_id=s.id and i.barbershop_id=s.barbershop_id left join public.clients c on c.id=s.client_id and c.barbershop_id=s.barbershop_id
    where s.barbershop_id=p_shop and s.status='paid' and i.product_id is not null and s.created_at>=p_from::timestamp at time zone tz and s.created_at<(p_to+1)::timestamp at time zone tz and (v_admin or s.barber_membership_id=v_barber)
    group by s.id,s.created_at,c.full_name
   ) all_sales order by occurred_at desc,id limit 50 offset p_offset
  )x;
 else
  select coalesce(jsonb_agg(x),'[]') into result from (select a.id,a.starts_at occurred_at,c.full_name client_name,a.total_price_cents value_cents,a.status,a.source,a.subscription_id,round(extract(epoch from a.ends_at-a.starts_at)/60) minutes from public.appointments a join public.clients c on c.id=a.client_id and c.barbershop_id=a.barbershop_id where a.barbershop_id=p_shop and a.starts_at>=p_from::timestamp at time zone tz and a.starts_at<(p_to+1)::timestamp at time zone tz and (v_admin or a.barber_membership_id=v_barber) and (case when p_kind='sold' then a.status='completed' and a.subscription_id is null when p_kind='forecast' then a.status in ('pending','confirmed') and a.starts_at>=now() and a.subscription_id is null else a.status in ('pending','confirmed','in_progress','completed') end) order by a.starts_at desc,a.id limit 50 offset p_offset)x;
 end if;
 return result;
end $$;
revoke all on function public.management_drilldown(uuid,date,date,text,integer) from public,anon;
grant execute on function public.management_drilldown(uuid,date,date,text,integer) to authenticated;

create function public.marketing_funnel(p_shop uuid,p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare tz text; result jsonb;
begin
 if (select auth.uid()) is null or not app_private.has_shop_role(p_shop,array['admin']::public.shop_role[]) then raise exception 'Análise financeira disponível para administração' using errcode='42501'; end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>370 then raise exception 'Período inválido' using errcode='22023'; end if;
 select timezone into tz from public.barbershops where id=p_shop;
 with cohort as (select a.*,r.campaign_id from public.appointments a join public.appointment_campaign_attribution r on r.appointment_id=a.id and r.barbershop_id=a.barbershop_id where a.barbershop_id=p_shop and a.created_at>=p_from::timestamp at time zone tz and a.created_at<(p_to+1)::timestamp at time zone tz),
 paid as (select a.id,a.campaign_id,a.client_id,a.status,a.total_price_cents,a.subscription_id,a.starts_at,coalesce(sum(case when p.status='paid' then p.amount_cents else 0 end),0) received from cohort a left join public.payments p on p.appointment_id=a.id and p.barbershop_id=a.barbershop_id group by a.id,a.campaign_id,a.client_id,a.status,a.total_price_cents,a.subscription_id,a.starts_at),
 margins as (select a.*,case when a.status='completed' and a.subscription_id is null and a.received>=a.total_price_cents and a.received>0 and not exists(select 1 from public.appointment_services s left join public.financial_item_snapshots f on f.barbershop_id=s.barbershop_id and f.record_key='appointment:'||s.appointment_id||':'||s.service_id where s.appointment_id=a.id and (f.record_key is null or f.estimated)) and exists(select 1 from public.commission_entries e where e.appointment_id=a.id) and not exists(select 1 from public.commission_entries e where e.appointment_id=a.id and e.status in ('review','awaiting_payment')) then a.received-(select coalesce(sum(f.cost_cents+f.extra_cost_cents+round(a.received*s.price_cents::numeric/nullif((select sum(ss.price_cents) from public.appointment_services ss where ss.appointment_id=a.id),0)*(f.tax_pct+f.fee_pct)/100)),0) from public.appointment_services s join public.financial_item_snapshots f on f.barbershop_id=s.barbershop_id and f.record_key='appointment:'||s.appointment_id||':'||s.service_id where s.appointment_id=a.id)-(select coalesce(sum(e.amount_cents),0) from public.commission_entries e where e.appointment_id=a.id) end contribution from paid a),
 stats as (select campaign_id,count(*) bookings,count(*) filter(where status='completed') attended,count(*) filter(where received>0) paid_visits,sum(received) received,count(distinct client_id) filter(where status='completed' and received>0 and not exists(select 1 from public.appointments first where first.barbershop_id=p_shop and first.client_id=m.client_id and first.status='completed' and (first.starts_at,first.id)<(m.starts_at,m.id))) new_paid_clients,sum(contribution) contribution,count(*) filter(where received>0 and contribution is null) unreviewed from margins m group by campaign_id)
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'code',c.code,'channel',c.channel,'offer_id',c.offer_id,'bookings',coalesce(s.bookings,0),'attended',coalesce(s.attended,0),'paid_visits',coalesce(s.paid_visits,0),'received_cents',coalesce(s.received,0),'new_paid_clients',coalesce(s.new_paid_clients,0),'spend_cents',coalesce(d.spend,0),'cac_cents',case when s.new_paid_clients>0 then round(coalesce(d.spend,0)::numeric/s.new_paid_clients) end,'contribution_cents',case when s.unreviewed=0 and s.paid_visits>0 then s.contribution end,'unreviewed',coalesce(s.unreviewed,0)) order by c.created_at desc),'[]') into result from public.marketing_campaigns c left join stats s on s.campaign_id=c.id left join lateral(select sum(amount_cents) spend from public.marketing_spend where campaign_id=c.id and barbershop_id=p_shop and occurred_on between p_from and p_to)d on true where c.barbershop_id=p_shop;
 return result;
end $$;
revoke all on function public.marketing_funnel(uuid,date,date) from public,anon;
grant execute on function public.marketing_funnel(uuid,date,date) to authenticated;

create table public.operational_tasks (
 id uuid primary key default gen_random_uuid(), barbershop_id uuid not null references public.barbershops(id),
 title text not null check(length(btrim(title)) between 2 and 160), details text check(length(details)<=1000),
 due_on date not null, priority text not null default 'normal' check(priority in ('normal','high')),
 assignee_membership_id uuid not null, completed_at timestamptz, created_by uuid not null references auth.users(id) default auth.uid(),
 created_at timestamptz not null default now(),
 foreign key(barbershop_id,assignee_membership_id) references public.memberships(barbershop_id,id)
);
create index operational_tasks_due on public.operational_tasks(barbershop_id,due_on,assignee_membership_id) where completed_at is null;
alter table public.operational_tasks enable row level security;
create policy operational_task_team on public.operational_tasks for select to authenticated using(app_private.has_shop_role(barbershop_id,array['admin']::public.shop_role[]) or app_private.is_own_barber(barbershop_id,assignee_membership_id));
create policy operational_task_create on public.operational_tasks for insert to authenticated with check(created_by=(select auth.uid()) and (app_private.has_shop_role(barbershop_id,array['admin']::public.shop_role[]) or app_private.is_own_barber(barbershop_id,assignee_membership_id)));
grant select,insert on public.operational_tasks to authenticated;
grant all on public.operational_tasks to service_role;

create function public.daily_actions(p_shop uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare tz text; d date; admin boolean; own uuid; tasks jsonb:='[]'; stats jsonb; goals jsonb;
begin
 if (select auth.uid()) is null or not app_private.has_shop_role(p_shop,array['admin','barber']::public.shop_role[]) then raise exception 'Acesso não permitido' using errcode='42501'; end if;
 select timezone into tz from public.barbershops where id=p_shop;
 d:=(now() at time zone tz)::date;
 admin:=app_private.has_shop_role(p_shop,array['admin']::public.shop_role[]);
 select id into own from public.memberships where barbershop_id=p_shop and user_id=(select auth.uid()) and active;
 if admin then
  select coalesce(jsonb_agg(jsonb_build_object('key','debt:'||r.id||':'||d,'title','Conferir recebimento · '||c.full_name,'detail',r.description,'module','dashboard','priority','high','value_cents',r.amount_cents,'due_on',r.due_on,'kind','debt','phone',c.phone,'source_id',r.id) order by r.due_on),'[]') into tasks from public.receivables r join public.clients c on c.id=r.client_id and c.barbershop_id=r.barbershop_id where r.barbershop_id=p_shop and r.status='open' and r.due_on<d;
 end if;
 if app_private.has_module(p_shop,'products') then
  tasks:=tasks||coalesce((select jsonb_agg(jsonb_build_object('key','stock:'||p.id||':'||d,'title','Repor · '||p.name,'detail','Saldo: '||p.stock_quantity||' · mínimo: '||p.minimum_stock,'module','products','priority',case when p.stock_quantity=0 then 'high' else 'normal' end,'kind','stock','source_id',p.id)) from public.products p where p.barbershop_id=p_shop and p.active and p.minimum_stock>0 and p.stock_quantity<=p.minimum_stock),'[]');
 end if;
 if app_private.has_module(p_shop,'appointments') then
  stats:=app_private.management_dashboard(p_shop,d,d);
  if (stats->>'available_minutes')::numeric>0 and (stats->>'occupancy_pct')::numeric<50 then
   tasks:=tasks||jsonb_build_array(jsonb_build_object('key','agenda:'||d||':'||coalesce(own::text,'admin'),'title','Revisar horários livres de hoje','detail','Ocupação: '||(stats->>'occupancy_pct')||'%. Confira os horários disponíveis e a fila de espera.','module','appointments','priority','normal','kind','agenda'));
  end if;
 end if;
 if app_private.has_module(p_shop,'marketing') then
  tasks:=tasks||coalesce((select jsonb_agg(jsonb_build_object('key','marketing:'||t.id||':'||d,'title',t.title,'detail','Tarefa de marketing em atraso','module','marketing','priority','normal','due_on',t.due_on,'kind','marketing','source_id',t.id,'assignee_user_id',t.assignee_user_id)) from public.marketing_tasks t where t.barbershop_id=p_shop and t.status<>'done' and t.due_on<=d and (admin or t.assignee_user_id=(select auth.uid()))),'[]');
 end if;
 if app_private.has_module(p_shop,'goals') then
  goals:=public.goal_progress(p_shop);
  tasks:=tasks||coalesce((select jsonb_agg(jsonb_build_object('key','goal:'||(g->>'id')||':'||d,'title','Acompanhar meta · '||(g->>'title'),'detail','Resultado atual abaixo do ritmo proporcional ao período','module','goals','priority','normal','due_on',g->>'period_end','kind','goal','source_id',g->>'id','assignee_membership_id',g->>'barber_membership_id')) from jsonb_array_elements(goals) g where g->>'metric'<>'profit_pct' and (g->>'period_start')::date<=d and (g->>'period_end')::date>=d and (g->>'current_value')::numeric is not null and (g->>'current_value')::numeric/nullif((g->>'target_value')::numeric,0)<(d-(g->>'period_start')::date+1)::numeric/((g->>'period_end')::date-(g->>'period_start')::date+1) and (admin or g->>'barber_membership_id'=own::text)),'[]');
 end if;
 tasks:=tasks||coalesce((select jsonb_agg(jsonb_build_object('key','task:'||t.id,'title',t.title,'detail',t.details,'module','dashboard','priority',t.priority,'due_on',t.due_on,'kind','manual','source_id',t.id,'assignee_membership_id',t.assignee_membership_id)) from public.operational_tasks t where t.barbershop_id=p_shop and (t.completed_at is null or (t.completed_at at time zone tz)::date=d) and t.due_on<=d and (admin or t.assignee_membership_id=own)),'[]');
 select coalesce(jsonb_agg(g||jsonb_build_object('state',coalesce(s.status,'open'),'assignee_membership_id',coalesce(s.assignee_membership_id::text,g->>'assignee_membership_id'),'assignee_name',m.display_name,'note',s.note) order by case when g->>'priority'='high' then 0 else 1 end,g->>'due_on',g->>'title'),'[]') into tasks from jsonb_array_elements(tasks)g left join public.daily_task_states s on s.barbershop_id=p_shop and s.task_key=g->>'key' left join public.memberships m on m.barbershop_id=p_shop and m.id=coalesce(s.assignee_membership_id::text,g->>'assignee_membership_id')::uuid where admin or s.assignee_membership_id is null or s.assignee_membership_id=own;
 return jsonb_build_object('day',d,'total',jsonb_array_length(tasks),'tasks',tasks);
end $$;
revoke all on function public.daily_actions(uuid) from public,anon;
grant execute on function public.daily_actions(uuid) to authenticated;

create function public.update_daily_action(p_shop uuid,p_key text,p_status text,p_assignee uuid default null,p_note text default null) returns void
language plpgsql security definer set search_path='' as $$
declare task jsonb; admin boolean; target public.memberships;
begin
 perform pg_advisory_xact_lock(hashtext(p_shop::text),hashtext('daily_actions'));
 select t into task from jsonb_array_elements(public.daily_actions(p_shop)->'tasks')t where t->>'key'=p_key;
 if task is null or p_status is null or p_status not in ('open','done','snoozed') or length(coalesce(p_note,''))>500 then raise exception 'Tarefa inválida ou fora do seu acesso' using errcode='42501'; end if;
 admin:=app_private.has_shop_role(p_shop,array['admin']::public.shop_role[]);
 if p_assignee is not null then
  select * into target from public.memberships where barbershop_id=p_shop and id=p_assignee and active and role in ('admin','barber');
  if not admin or target.id is null or (target.role='barber' and (
    task->>'kind'='debt' or (task->>'kind'='goal' and p_assignee::text is distinct from task->>'assignee_membership_id')
    or (task->>'module'<>'dashboard' and not exists(select 1 from public.module_permissions where barbershop_id=p_shop and user_id=target.user_id and module=task->>'module' and allowed))
  )) then raise exception 'Responsável não permitido' using errcode='42501'; end if;
 end if;
 insert into public.daily_task_states(barbershop_id,task_key,assignee_membership_id,status,note,updated_by) values(p_shop,p_key,p_assignee,p_status,p_note,(select auth.uid())) on conflict(barbershop_id,task_key) do update set assignee_membership_id=case when admin then excluded.assignee_membership_id else daily_task_states.assignee_membership_id end,status=excluded.status,note=excluded.note,updated_by=excluded.updated_by,updated_at=now();
 if task->>'kind'='manual' then update public.operational_tasks set completed_at=case when p_status='done' then now() else null end,assignee_membership_id=case when admin and p_assignee is not null then p_assignee else assignee_membership_id end where id=(task->>'source_id')::uuid and barbershop_id=p_shop; end if;
 if task->>'kind'='marketing' and admin and p_assignee is not null then update public.marketing_tasks set assignee_user_id=target.user_id where id=(task->>'source_id')::uuid and barbershop_id=p_shop; end if;
end $$;
revoke all on function public.update_daily_action(uuid,text,text,uuid,text) from public,anon;
grant execute on function public.update_daily_action(uuid,text,text,uuid,text) to authenticated;
