-- CRM follow-ups join the existing routine only after the CRM schema exists.
-- This adds manual task state and audit, never contact or notification delivery.
alter function public.daily_actions(uuid) rename to daily_actions_before_crm;
revoke all on function public.daily_actions_before_crm(uuid) from public,anon,authenticated;
create function public.daily_actions(p_shop uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare base jsonb; extra jsonb; admin boolean; own uuid; today date;
begin
 base:=public.daily_actions_before_crm(p_shop);
 admin:=app_private.has_shop_role(p_shop,array['admin']::public.shop_role[]);
 select id into own from public.memberships where barbershop_id=p_shop and user_id=(select auth.uid()) and active;
 today:=(base->>'day')::date;
 if app_private.has_module(p_shop,'clients') then
  select coalesce(jsonb_agg(jsonb_build_object(
   'key','crm:'||t.id,'title',t.title,'detail','Acompanhamento manual · '||c.full_name,
   'module','clients','priority',case when t.due_on<today then 'high' else 'normal' end,
   'due_on',t.due_on,'kind','crm','source_id',t.id,'client_id',t.client_id,'phone',c.phone,
   'assignee_membership_id',coalesce(s.assignee_membership_id,t.assignee_membership_id),
   'assignee_name',m.display_name,'state',coalesce(s.status,'open'),'note',s.note,
   'crm_status',t.status,'segment',t.segment) order by t.due_on,t.created_at),'[]') into extra
  from public.crm_tasks t join public.clients c on c.id=t.client_id and c.barbershop_id=t.barbershop_id
  left join public.daily_task_states s on s.barbershop_id=t.barbershop_id and s.task_key='crm:'||t.id
  left join public.memberships m on m.id=coalesce(s.assignee_membership_id,t.assignee_membership_id) and m.barbershop_id=t.barbershop_id
  where t.barbershop_id=p_shop and t.due_on<=today and t.status not in ('booked','closed')
  and app_private.can_manage_client(p_shop,t.client_id,'clients')
  and (admin or ((t.assignee_membership_id is null or t.assignee_membership_id=own) and (s.assignee_membership_id is null or s.assignee_membership_id=own)));
  base:=jsonb_set(base,'{tasks}',(base->'tasks')||extra);
 end if;
 return jsonb_set(base,'{total}',to_jsonb(jsonb_array_length(base->'tasks')));
end $$;
revoke all on function public.daily_actions(uuid) from public,anon;
grant execute on function public.daily_actions(uuid) to authenticated;

alter function public.update_daily_action(uuid,text,text,uuid,text) rename to update_daily_action_before_crm;
revoke all on function public.update_daily_action_before_crm(uuid,text,text,uuid,text) from public,anon,authenticated;
create function public.update_daily_action(p_shop uuid,p_key text,p_status text,p_assignee uuid default null,p_note text default null) returns void
language plpgsql security definer set search_path='' as $$
declare task public.crm_tasks; target public.memberships; admin boolean; own uuid; desired text;
begin
 if p_key not like 'crm:%' then perform public.update_daily_action_before_crm(p_shop,p_key,p_status,p_assignee,p_note);return;end if;
 perform pg_advisory_xact_lock(hashtext(p_shop::text),hashtext('daily_actions'));
 if (select auth.uid()) is null or not app_private.has_shop_role(p_shop,array['admin','barber']::public.shop_role[]) or not app_private.has_module(p_shop,'clients') then raise exception 'Tarefa inválida ou fora do seu acesso' using errcode='42501';end if;
 if p_status is null or p_status not in ('open','done','snoozed') or length(coalesce(p_note,''))>500 then raise exception 'Tarefa inválida ou fora do seu acesso' using errcode='42501';end if;
 select * into task from public.crm_tasks where barbershop_id=p_shop and 'crm:'||id=p_key for update;
 admin:=app_private.has_shop_role(p_shop,array['admin']::public.shop_role[]);
 select id into own from public.memberships where barbershop_id=p_shop and user_id=(select auth.uid()) and active;
 if task.id is null or task.status in ('booked','closed') or not app_private.can_manage_client(p_shop,task.client_id,'clients') or (not admin and task.assignee_membership_id is not null and task.assignee_membership_id<>own)
   or not exists(select 1 from jsonb_array_elements(public.daily_actions(p_shop)->'tasks')x where x->>'key'=p_key) then raise exception 'Tarefa inválida ou fora do seu acesso' using errcode='42501';end if;
 if p_assignee is not null then
  select * into target from public.memberships where barbershop_id=p_shop and id=p_assignee and active and role in ('admin','barber');
  if not admin or target.id is null or (target.role='barber' and (
   not exists(select 1 from public.module_permissions where barbershop_id=p_shop and user_id=target.user_id and module='clients' and allowed)
   or not exists(select 1 from public.client_barbers where barbershop_id=p_shop and client_id=task.client_id and barber_membership_id=target.id)
  )) then raise exception 'Responsável não permitido' using errcode='42501';end if;
 end if;
 -- Persist the common routine state after CRM-specific scope checks. The previous
 -- function remains responsible for other task types and need not know this new kind.
 insert into public.daily_task_states(barbershop_id,task_key,assignee_membership_id,status,note,updated_by)
 values(p_shop,p_key,p_assignee,p_status,p_note,(select auth.uid()))
 on conflict(barbershop_id,task_key) do update set assignee_membership_id=case when admin then excluded.assignee_membership_id else daily_task_states.assignee_membership_id end,
  status=excluded.status,note=excluded.note,updated_by=excluded.updated_by,updated_at=now();
 desired:=case when p_status='done' then 'closed' else task.status end;
 update public.crm_tasks set status=desired,assignee_membership_id=case when admin and p_assignee is not null then p_assignee else assignee_membership_id end,updated_at=now() where id=task.id;
 insert into public.crm_task_events(barbershop_id,task_id,status,notes,actor_id) values(p_shop,task.id,desired,
  case when nullif(btrim(p_note),'') is not null then 'Rotina: '||btrim(p_note) else 'Rotina atualizada manualmente. Nenhum contato foi enviado.' end,(select auth.uid()));
end $$;
revoke all on function public.update_daily_action(uuid,text,text,uuid,text) from public,anon;
grant execute on function public.update_daily_action(uuid,text,text,uuid,text) to authenticated;
