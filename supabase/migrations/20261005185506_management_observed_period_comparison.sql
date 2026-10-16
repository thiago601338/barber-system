-- Preserve the requested-period cards; compare only elapsed calendar days in the shop zone.
create or replace function public.management_insights(p_shop uuid,p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_current jsonb;v_comparison jsonb;v_prior jsonb;tz text;v_admin boolean;v_barber uuid;v_sold bigint;v_forecast bigint;v_goals jsonb:='[]';
 v_today date;v_end date;v_previous_from date;v_previous_to date;v_method text:='unavailable';
begin
 -- This existing helper performs role, tenant, permission and date-range validation.
 v_current:=app_private.management_dashboard(p_shop,p_from,p_to);
 select timezone into tz from public.barbershops where id=p_shop;
 v_today:=(now() at time zone tz)::date;v_end:=least(p_to,v_today);
 v_admin:=app_private.has_shop_role(p_shop,array['admin']::public.shop_role[]);
 if not v_admin then select id into v_barber from public.memberships where barbershop_id=p_shop and user_id=(select auth.uid()) and active and role='barber';end if;
 if p_from<=v_today then
  if p_from=date_trunc('month',v_today)::date then
   v_method:='month_to_date';v_previous_from:=(p_from-interval '1 month')::date;
   v_previous_to:=least(v_previous_from+(v_end-p_from),p_from-1);
  else
   v_method:='previous_equal_length';v_previous_to:=p_from-1;v_previous_from:=p_from-(v_end-p_from+1);
  end if;
  v_comparison:=app_private.management_dashboard(p_shop,p_from,v_end);
  v_prior:=app_private.management_dashboard(p_shop,v_previous_from,v_previous_to);
 end if;
 if app_private.has_module(p_shop,'reports') then
  v_current:=v_current||app_private.management_receipts(p_shop,p_from,p_to);
  if v_comparison is not null then
   v_comparison:=v_comparison||app_private.management_receipts(p_shop,p_from,v_end);
   v_prior:=v_prior||app_private.management_receipts(p_shop,v_previous_from,v_previous_to);
  end if;
  select coalesce(sum(total_price_cents),0) into v_sold from public.appointments where barbershop_id=p_shop and status='completed' and subscription_id is null and starts_at>=p_from::timestamp at time zone tz and starts_at<(p_to+1)::timestamp at time zone tz and (v_admin or barber_membership_id=v_barber);
  select v_sold+coalesce(sum(i.total_cents),0) into v_sold from public.sale_items i join public.sales s on s.id=i.sale_id and s.barbershop_id=i.barbershop_id where s.barbershop_id=p_shop and s.status='paid' and i.product_id is not null and s.created_at>=p_from::timestamp at time zone tz and s.created_at<(p_to+1)::timestamp at time zone tz and (v_admin or s.barber_membership_id=v_barber);
 end if;
 if app_private.has_module(p_shop,'appointments') then
  select coalesce(sum(total_price_cents),0) into v_forecast from public.appointments where barbershop_id=p_shop and status in ('pending','confirmed') and subscription_id is null and starts_at>=greatest(now(),p_from::timestamp at time zone tz) and starts_at<(p_to+1)::timestamp at time zone tz and (v_admin or barber_membership_id=v_barber);
 end if;
 if app_private.has_module(p_shop,'goals') then v_goals:=public.goal_progress(p_shop);end if;
 return jsonb_build_object('current',v_current,'comparison_current',v_comparison,'comparison_from',case when v_comparison is not null then p_from end,'comparison_to',case when v_comparison is not null then v_end end,'comparison_method',v_method,
  'previous',v_prior,'from',p_from,'to',p_to,'previous_from',v_previous_from,'previous_to',v_previous_to,'sold_cents',v_sold,'forecast_cents',v_forecast,'goals',v_goals,
  'provenance',jsonb_build_object('received','Pagamentos com status pago, pela data de recebimento; inclui dados importados.','sold','Serviços avulsos concluídos + produtos em vendas pagas, pela data de execução/venda. Não soma mensalidade a visita coberta.','forecast','Reservas avulsas futuras ainda pendentes ou confirmadas no período. Não representa recebimento.','ticket','Recebido dividido por pagamentos positivos; pagamentos divididos contam como transações.','occupancy','Minutos de atendimento reservados dentro das regras e exceções da equipe / minutos disponíveis. Os cards incluem todo o período escolhido; a comparação usa somente as datas observadas até hoje.','comparison','Mês atual compara o trecho decorrido com as mesmas datas do mês anterior (limitadas ao último dia daquele mês). Outros filtros usam o período anterior com igual quantidade de dias observados. Filtros totalmente futuros não têm comparação.','plans','Contratos ativos atuais e contratos ativos preservados do Cashbarber; não é uma contagem histórica do período.'));
end $$;
revoke all on function public.management_insights(uuid,date,date) from public,anon;
grant execute on function public.management_insights(uuid,date,date) to authenticated;
