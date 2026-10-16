-- Forward-only fix for the CRM routine already deployed.
create or replace function public.update_daily_action(p_shop uuid,p_key text,p_status text,p_assignee uuid default null,p_note text default null) returns void
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
