-- Operational ledgers. Browser clients may read authorized rows, never mutate journals.
alter table public.products add column minimum_stock integer not null default 0 check(minimum_stock>=0);
alter table public.sales add column barber_membership_id uuid;
alter table public.sales add column request_key uuid;
create unique index sales_request_once on public.sales(barbershop_id,request_key) where request_key is not null;
alter table public.sales add constraint sales_professional_shop_fk foreign key(barbershop_id,barber_membership_id) references public.memberships(barbershop_id,id);

create table public.inventory_suppliers (
 id uuid primary key default gen_random_uuid(), barbershop_id uuid not null references public.barbershops(id),
 name text not null check(length(btrim(name)) between 2 and 160), document text, contact text, email text, notes text,
 active boolean not null default true, created_at timestamptz not null default now(), unique(barbershop_id,id)
);
create table public.inventory_purchases (
 id uuid primary key default gen_random_uuid(), barbershop_id uuid not null references public.barbershops(id), supplier_id uuid,
 invoice_reference text, total_cents bigint not null default 0 check(total_cents>=0), paid boolean not null default false,
 request_key uuid not null, created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 unique(barbershop_id,id), unique(barbershop_id,request_key),
 foreign key(barbershop_id,supplier_id) references public.inventory_suppliers(barbershop_id,id)
);
create table public.inventory_purchase_items (
 id uuid primary key default gen_random_uuid(), barbershop_id uuid not null, purchase_id uuid not null, product_id uuid not null,
 quantity integer not null check(quantity between 1 and 100000), unit_cost_cents integer not null check(unit_cost_cents>=0),
 total_cents bigint generated always as(quantity::bigint*unit_cost_cents) stored, created_at timestamptz not null default now(),
 foreign key(barbershop_id,purchase_id) references public.inventory_purchases(barbershop_id,id),
 foreign key(barbershop_id,product_id) references public.products(barbershop_id,id)
);
create table public.inventory_movements (
 id uuid primary key default gen_random_uuid(), barbershop_id uuid not null, product_id uuid not null,
 quantity_delta integer not null, balance_after integer not null check(balance_after>=0), unit_cost_cents integer not null check(unit_cost_cents>=0),
 reason text not null, notes text, reference_id text, actor_id uuid references auth.users(id), created_at timestamptz not null default now(),
 foreign key(barbershop_id,product_id) references public.products(barbershop_id,id)
);
create index inventory_movements_shop_product_date on public.inventory_movements(barbershop_id,product_id,created_at desc);
create table public.cash_sessions (
 id uuid primary key default gen_random_uuid(), barbershop_id uuid not null references public.barbershops(id),
 opening_cents bigint not null check(opening_cents>=0), counted_cents bigint check(counted_cents>=0), expected_cents bigint,
 difference_cents bigint, opened_by uuid not null references auth.users(id), closed_by uuid references auth.users(id),
 opened_at timestamptz not null default now(), closed_at timestamptz, notes text,
 created_at timestamptz not null default now(), unique(barbershop_id,id),
 check((closed_at is null and closed_by is null) or (closed_at is not null and closed_by is not null and counted_cents is not null))
);
create unique index one_open_cash_session on public.cash_sessions(barbershop_id) where closed_at is null;
create table public.cash_movements (
 id uuid primary key default gen_random_uuid(), barbershop_id uuid not null, session_id uuid not null, payment_id uuid references public.payments(id),
 kind text not null check(kind in ('receipt','refund','supply','withdrawal')),
 method text not null check(method in ('cash','card','pix','other')), amount_cents bigint not null check(amount_cents>0),
 request_key uuid not null, notes text, actor_id uuid not null references auth.users(id), created_at timestamptz not null default now(),
 foreign key(barbershop_id,session_id) references public.cash_sessions(barbershop_id,id), unique(barbershop_id,request_key)
);
create unique index cash_receipt_once on public.cash_movements(payment_id,kind) where payment_id is not null;
create index cash_movements_session_date on public.cash_movements(barbershop_id,session_id,created_at);
create table public.commission_rules (
 id uuid primary key default gen_random_uuid(), barbershop_id uuid not null references public.barbershops(id), barber_membership_id uuid,
 item_kind text not null check(item_kind in ('service','product','subscription')), item_id uuid,
 mode text not null check(mode in ('percent','fixed')), rate numeric(13,3) not null check(rate>=0),
 subscription_basis_cents integer check(subscription_basis_cents>=0), active boolean not null default true,
 created_at timestamptz not null default now(), unique(barbershop_id,id),
 foreign key(barbershop_id,barber_membership_id) references public.memberships(barbershop_id,id),
 check(mode<>'percent' or rate<=100), check(mode<>'fixed' or (rate=trunc(rate) and rate<=2147483647)),
 check(item_kind<>'subscription' or mode='fixed' or subscription_basis_cents is not null)
);
create unique index commission_rule_scope on public.commission_rules(barbershop_id,item_kind,coalesce(item_id,'00000000-0000-0000-0000-000000000000'::uuid),coalesce(barber_membership_id,'00000000-0000-0000-0000-000000000000'::uuid)) where active;
create table public.commission_closings (
 id uuid primary key default gen_random_uuid(), barbershop_id uuid not null references public.barbershops(id), barber_membership_id uuid not null,
 period_from date not null, period_to date not null check(period_to>=period_from), total_cents bigint not null,
 actor_id uuid not null references auth.users(id), created_at timestamptz not null default now(), unique(barbershop_id,id),
 foreign key(barbershop_id,barber_membership_id) references public.memberships(barbershop_id,id)
);
create table public.commission_entries (
 id uuid primary key default gen_random_uuid(), barbershop_id uuid not null references public.barbershops(id), barber_membership_id uuid,
 appointment_id uuid, sale_id uuid, item_kind text not null check(item_kind in ('service','product','subscription')),
 item_id uuid, description text not null, quantity integer not null default 1 check(quantity>0), base_cents bigint not null check(base_cents>=0),
 amount_cents bigint, status text not null check(status in ('review','awaiting_payment','accrued','closed')),
 rule_snapshot jsonb not null default '{}', event_key text not null, closing_id uuid, reverses_entry_id uuid references public.commission_entries(id),
 earned_at timestamptz not null default now(), created_at timestamptz not null default now(), unique(barbershop_id,event_key),
 foreign key(barbershop_id,barber_membership_id) references public.memberships(barbershop_id,id),
 foreign key(barbershop_id,appointment_id) references public.appointments(barbershop_id,id),
 foreign key(barbershop_id,sale_id) references public.sales(barbershop_id,id),
 foreign key(barbershop_id,closing_id) references public.commission_closings(barbershop_id,id),
 check((status='review' and amount_cents is null) or (status<>'review' and amount_cents is not null))
);
create index commissions_shop_member_earned on public.commission_entries(barbershop_id,barber_membership_id,earned_at);

do $$ declare t text; begin
 foreach t in array array['inventory_suppliers','inventory_purchases','inventory_purchase_items','inventory_movements','cash_sessions','cash_movements','commission_rules','commission_closings','commission_entries'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('create policy operations_admin_read on public.%I for select to authenticated using(app_private.has_shop_role(barbershop_id,array[''admin'']::public.shop_role[]))',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
 foreach t in array array['inventory_suppliers','commission_rules'] loop
  execute format('create policy operations_admin_insert on public.%I for insert to authenticated with check(app_private.has_shop_role(barbershop_id,array[''admin'']::public.shop_role[]))',t);
  execute format('create policy operations_admin_update on public.%I for update to authenticated using(app_private.has_shop_role(barbershop_id,array[''admin'']::public.shop_role[])) with check(app_private.has_shop_role(barbershop_id,array[''admin'']::public.shop_role[]))',t);
  execute format('grant insert,update on public.%I to authenticated',t);
 end loop;
end $$;
create policy commissions_barber_read on public.commission_entries for select to authenticated using(app_private.has_module(barbershop_id,'finance') and app_private.is_own_barber(barbershop_id,barber_membership_id));
create policy commission_closings_barber_read on public.commission_closings for select to authenticated using(app_private.has_module(barbershop_id,'finance') and app_private.is_own_barber(barbershop_id,barber_membership_id));

-- Cost and inventory balances change only through audited administrator operations.
revoke update on public.products from authenticated;
grant update(name,sku,description,category,price_cents,active,image_path,minimum_stock) on public.products to authenticated;
create function app_private.inventory_journal() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' or new.stock_quantity is distinct from old.stock_quantity or new.cost_cents is distinct from old.cost_cents then
  insert into public.inventory_movements(barbershop_id,product_id,quantity_delta,balance_after,unit_cost_cents,reason,notes,reference_id,actor_id)
  values(new.barbershop_id,new.id,case when tg_op='INSERT' then new.stock_quantity else new.stock_quantity-old.stock_quantity end,new.stock_quantity,new.cost_cents,
   coalesce(nullif(current_setting('app.inventory_reason',true),''),case when tg_op='INSERT' then 'initial' else 'sale_or_cancellation' end),
   nullif(current_setting('app.inventory_notes',true),''),nullif(current_setting('app.inventory_reference',true),''),auth.uid());
 end if;
 return new;
end $$;
revoke all on function app_private.inventory_journal() from public,anon,authenticated;
create trigger products_inventory_journal after insert or update of stock_quantity,cost_cents on public.products for each row execute function app_private.inventory_journal();
insert into public.inventory_movements(barbershop_id,product_id,quantity_delta,balance_after,unit_cost_cents,reason,notes)
select barbershop_id,id,stock_quantity,stock_quantity,cost_cents,'opening_balance','Saldo inicial na implantação; não reconstrói movimentações antigas.' from public.products;

create function app_private.product_cost(p_shop uuid,p_product uuid,p_cost integer) returns void language plpgsql security definer set search_path='' as $$
begin
 if not app_private.has_shop_role(p_shop,array['admin']::public.shop_role[]) then raise exception 'Apenas administrador altera custo' using errcode='42501'; end if;
 if p_cost is null or p_cost<0 then raise exception 'Custo inválido'; end if;
 perform set_config('app.inventory_reason','cost_review',true);
 update public.products set cost_cents=p_cost where barbershop_id=p_shop and id=p_product;
 if not found then raise exception 'Produto não encontrado'; end if;
end $$;
create function app_private.product_save(p_shop uuid,p_product uuid,p_values jsonb) returns uuid language plpgsql security definer set search_path='' as $$
begin
 if not app_private.has_shop_role(p_shop,array['admin']::public.shop_role[]) then raise exception 'Apenas administrador altera produto' using errcode='42501'; end if;
 perform set_config('app.inventory_reason','cost_review',true);
 update public.products set name=p_values->>'name',sku=nullif(p_values->>'sku',''),description=nullif(p_values->>'description',''),category=p_values->>'category',price_cents=(p_values->>'price_cents')::integer,cost_cents=(p_values->>'cost_cents')::integer,active=(p_values->>'active')::boolean,image_path=nullif(p_values->>'image_path',''),minimum_stock=(p_values->>'minimum_stock')::integer where id=p_product and barbershop_id=p_shop;
 if not found then raise exception 'Produto não encontrado'; end if;
 return p_product;
end $$;
create function app_private.inventory_adjust(p_shop uuid,p_product uuid,p_quantity integer,p_reason text,p_notes text,p_request uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare p public.products; v_id uuid;
begin
 if not app_private.has_shop_role(p_shop,array['admin']::public.shop_role[]) then raise exception 'Apenas administrador movimenta estoque' using errcode='42501'; end if;
 select * into p from public.products where barbershop_id=p_shop and id=p_product for update;
 if not found then raise exception 'Produto não encontrado'; end if;
 select id into v_id from public.inventory_movements where barbershop_id=p_shop and product_id=p_product and reference_id=p_request::text and reason=p_reason and quantity_delta=p_quantity;
 if v_id is not null then return v_id; end if;
 if p_request is null or p_quantity is null or p_quantity=0 or abs(p_quantity::bigint)>100000 or p_reason not in ('internal_use','loss','adjustment') or length(btrim(coalesce(p_notes,'')))<3 then raise exception 'Informe movimento e justificativa válidos'; end if;
 if p_reason in ('internal_use','loss') and p_quantity>0 then raise exception 'Consumo e perda devem reduzir estoque'; end if;
 if p.stock_quantity::bigint+p_quantity<0 or p.stock_quantity::bigint+p_quantity>2147483647 then raise exception 'Saldo insuficiente ou inválido'; end if;
 perform set_config('app.inventory_reason',p_reason,true); perform set_config('app.inventory_notes',p_notes,true); perform set_config('app.inventory_reference',p_request::text,true);
 update public.products set stock_quantity=stock_quantity+p_quantity where id=p_product;
 if p_reason in ('internal_use','loss') and p.cost_cents>0 then
  if abs(p_quantity::bigint)*p.cost_cents>2147483647 then raise exception 'Custo do movimento acima do limite'; end if;
  insert into public.expenses(barbershop_id,category,cost_kind,description,amount_cents,occurred_on,created_by) values(p_shop,case when p_reason='loss' then 'Perda de estoque' else 'Consumo interno' end,'operating',p.name||' · '||p_notes,(abs(p_quantity::bigint)*p.cost_cents)::integer,(now() at time zone (select timezone from public.barbershops where id=p_shop))::date,auth.uid());
 end if;
 select id into v_id from public.inventory_movements where barbershop_id=p_shop and reference_id=p_request::text and reason=p_reason;
 return v_id;
end $$;
create function app_private.inventory_pay(p_shop uuid,p_purchase uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare p public.inventory_purchases;
begin
 if not app_private.has_shop_role(p_shop,array['admin']::public.shop_role[]) then raise exception 'Apenas administrador registra pagamento da compra' using errcode='42501'; end if;
 select * into p from public.inventory_purchases where barbershop_id=p_shop and id=p_purchase for update;
 if not found then raise exception 'Compra não encontrada'; end if;
 if p.paid then return p.id; end if;
 if p.total_cents>0 then insert into public.expenses(barbershop_id,category,cost_kind,description,amount_cents,occurred_on,created_by) values(p_shop,'Compra de estoque','inventory','Compra '||coalesce(nullif(p.invoice_reference,''),p.id::text),p.total_cents::integer,(now() at time zone (select timezone from public.barbershops where id=p_shop))::date,auth.uid()); end if;
 update public.inventory_purchases set paid=true where id=p.id;
 return p.id;
end $$;
create function app_private.inventory_receive(p_shop uuid,p_supplier uuid,p_invoice text,p_items jsonb,p_paid boolean,p_request uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare v_purchase uuid; i record; p public.products; v_total bigint:=0; v_cost bigint;
begin
 if not app_private.has_shop_role(p_shop,array['admin']::public.shop_role[]) then raise exception 'Apenas administrador recebe compra' using errcode='42501'; end if;
 if p_request is null or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 100 then raise exception 'Compra inválida'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_shop::text||p_request::text,0));
 select id into v_purchase from public.inventory_purchases where barbershop_id=p_shop and request_key=p_request;
 if found then return v_purchase; end if;
 if p_supplier is not null and not exists(select 1 from public.inventory_suppliers where barbershop_id=p_shop and id=p_supplier and active) then raise exception 'Fornecedor inválido'; end if;
 if (select count(*)<>count(distinct value->>'product_id') from jsonb_array_elements(p_items)) then raise exception 'Produto repetido na compra'; end if;
 insert into public.inventory_purchases(barbershop_id,supplier_id,invoice_reference,paid,request_key,created_by) values(p_shop,p_supplier,p_invoice,p_paid,p_request,auth.uid()) returning id into v_purchase;
 for i in select (value->>'product_id')::uuid product_id,(value->>'quantity')::integer quantity,(value->>'unit_cost_cents')::integer unit_cost_cents from jsonb_array_elements(p_items) order by (value->>'product_id')::uuid loop
  if i.quantity is null or i.quantity not between 1 and 100000 or i.unit_cost_cents is null or i.unit_cost_cents<0 then raise exception 'Quantidade ou custo inválido'; end if;
  select * into p from public.products where barbershop_id=p_shop and id=i.product_id for update;
  if not found or p.stock_quantity::bigint+i.quantity>2147483647 then raise exception 'Produto ou saldo inválido'; end if;
  v_cost:=round((p.stock_quantity::numeric*p.cost_cents+i.quantity::numeric*i.unit_cost_cents)/(p.stock_quantity+i.quantity));
  insert into public.inventory_purchase_items(barbershop_id,purchase_id,product_id,quantity,unit_cost_cents) values(p_shop,v_purchase,p.id,i.quantity,i.unit_cost_cents);
  perform set_config('app.inventory_reason','purchase',true); perform set_config('app.inventory_reference',v_purchase::text,true); perform set_config('app.inventory_notes',coalesce(p_invoice,''),true);
  update public.products set stock_quantity=stock_quantity+i.quantity,cost_cents=v_cost::integer where id=p.id;
  v_total:=v_total+i.quantity::bigint*i.unit_cost_cents;
 end loop;
 if v_total>2147483647 then raise exception 'Compra acima do limite'; end if;
 update public.inventory_purchases set total_cents=v_total where id=v_purchase;
 if p_paid and v_total>0 then insert into public.expenses(barbershop_id,category,cost_kind,description,amount_cents,occurred_on,created_by) values(p_shop,'Compra de estoque','inventory','Compra '||coalesce(nullif(p_invoice,''),v_purchase::text),v_total::integer,(now() at time zone (select timezone from public.barbershops where id=p_shop))::date,auth.uid()); end if;
 return v_purchase;
end $$;

create function app_private.cash_open(p_shop uuid,p_opening bigint,p_notes text) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if not app_private.has_shop_role(p_shop,array['admin']::public.shop_role[]) then raise exception 'Apenas administrador abre caixa' using errcode='42501'; end if;
 if p_opening is null or p_opening<0 or p_opening>2147483647 then raise exception 'Valor de abertura inválido'; end if;
 insert into public.cash_sessions(barbershop_id,opening_cents,opened_by,notes) values(p_shop,p_opening,auth.uid(),p_notes) returning id into v_id;
 return v_id;
end $$;
create function app_private.cash_adjust(p_shop uuid,p_kind text,p_amount bigint,p_notes text,p_request uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare s public.cash_sessions; v_id uuid; v_balance bigint;
begin
 if not app_private.has_shop_role(p_shop,array['admin']::public.shop_role[]) then raise exception 'Apenas administrador movimenta caixa' using errcode='42501'; end if;
 select * into s from public.cash_sessions where barbershop_id=p_shop and closed_at is null for update;
 if not found then raise exception 'Abra o caixa primeiro'; end if;
 select id into v_id from public.cash_movements where barbershop_id=p_shop and request_key=p_request;
 if found then return v_id; end if;
 if p_request is null or p_kind not in ('supply','withdrawal') or p_amount is null or p_amount<=0 or length(btrim(coalesce(p_notes,'')))<3 then raise exception 'Movimento e justificativa obrigatórios'; end if;
 select s.opening_cents+coalesce(sum(case when kind in ('receipt','supply') then amount_cents else -amount_cents end),0) into v_balance from public.cash_movements where session_id=s.id and method='cash';
 if p_kind='withdrawal' and p_amount>v_balance then raise exception 'Dinheiro insuficiente para sangria'; end if;
 insert into public.cash_movements(barbershop_id,session_id,kind,method,amount_cents,request_key,notes,actor_id) values(p_shop,s.id,p_kind,'cash',p_amount,p_request,p_notes,auth.uid()) returning id into v_id;
 return v_id;
end $$;
create function app_private.cash_close(p_shop uuid,p_session uuid,p_counted bigint,p_notes text) returns uuid language plpgsql security definer set search_path='' as $$
declare s public.cash_sessions; v_expected bigint;
begin
 if not app_private.has_shop_role(p_shop,array['admin']::public.shop_role[]) then raise exception 'Apenas administrador fecha caixa' using errcode='42501'; end if;
 select * into s from public.cash_sessions where barbershop_id=p_shop and id=p_session for update;
 if not found then raise exception 'Caixa não encontrado'; end if;
 if s.closed_at is not null then return s.id; end if;
 if p_counted is null or p_counted<0 then raise exception 'Informe dinheiro contado'; end if;
 select s.opening_cents+coalesce(sum(case when kind in ('receipt','supply') then amount_cents else -amount_cents end),0) into v_expected from public.cash_movements where session_id=s.id and method='cash';
 update public.cash_sessions set counted_cents=p_counted,expected_cents=v_expected,difference_cents=p_counted-v_expected,closed_at=now(),closed_by=auth.uid(),notes=concat_ws(E'\n',s.notes,p_notes) where id=s.id;
 return s.id;
end $$;
create function app_private.cash_receive(p_shop uuid,p_sale uuid,p_appointment uuid,p_methods jsonb,p_request uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.cash_sessions; v_client uuid; v_total bigint; v_paid bigint; v_amount bigint; i record; v_payment uuid; ids jsonb:='[]'; v_sale public.sales;
begin
 if not app_private.has_shop_role(p_shop,array['admin']::public.shop_role[]) then raise exception 'Apenas administrador registra recebimento' using errcode='42501'; end if;
 if (p_sale is null)=(p_appointment is null) or p_request is null or jsonb_typeof(p_methods) is distinct from 'array' or jsonb_array_length(p_methods) not between 1 and 8 then raise exception 'Recebimento inválido'; end if;
 select * into s from public.cash_sessions where barbershop_id=p_shop and closed_at is null for update;
 if not found then raise exception 'Abra o caixa primeiro'; end if;
 select coalesce(jsonb_agg(payment_id),'[]') into ids from public.cash_movements where barbershop_id=p_shop and notes='checkout:'||p_request::text and kind='receipt';
 if jsonb_array_length(ids)>0 then return ids; end if;
 if p_sale is not null then
  select * into v_sale from public.sales where id=p_sale and barbershop_id=p_shop for update;
  if not found or v_sale.status not in ('open','delivered','paid') then raise exception 'Comanda indisponível'; end if;
  v_client:=v_sale.client_id; v_total:=v_sale.total_cents;
 else
  select client_id,total_price_cents into v_client,v_total from public.appointments where id=p_appointment and barbershop_id=p_shop and status='completed' and subscription_id is null for update;
  if not found then raise exception 'Recebimento exige atendimento avulso concluído'; end if;
 end if;
 select coalesce(sum(amount_cents),0) into v_paid from public.payments where barbershop_id=p_shop and status in ('paid','approved') and ((p_sale is not null and sale_id=p_sale) or (p_appointment is not null and appointment_id=p_appointment));
 select sum((value->>'amount_cents')::bigint) into v_amount from jsonb_array_elements(p_methods);
 if v_amount is null or v_amount<=0 or v_amount>v_total-v_paid then raise exception 'Valor excede saldo em aberto ou é inválido'; end if;
 ids:='[]';
 for i in select value->>'method' method,(value->>'amount_cents')::bigint amount_cents from jsonb_array_elements(p_methods) loop
  if i.method not in ('cash','card','pix','other') or i.method is null or i.amount_cents is null or i.amount_cents<=0 or i.amount_cents>2147483647 then raise exception 'Forma ou valor inválido'; end if;
  insert into public.payments(barbershop_id,client_id,sale_id,appointment_id,provider,provider_payment_id,amount_cents,status,method,paid_at) values(p_shop,v_client,p_sale,p_appointment,'cash_register',gen_random_uuid()::text,i.amount_cents::integer,'paid',i.method,now()) returning id into v_payment;
  insert into public.cash_movements(barbershop_id,session_id,payment_id,kind,method,amount_cents,request_key,notes,actor_id) values(p_shop,s.id,v_payment,'receipt',i.method,i.amount_cents,gen_random_uuid(),'checkout:'||p_request::text,auth.uid());
  ids:=ids||jsonb_build_array(v_payment);
 end loop;
 if p_sale is not null and v_paid+v_amount=v_total then update public.sales set status='paid' where id=p_sale; end if;
 return ids;
end $$;
create function app_private.cash_refund(p_shop uuid,p_payment uuid,p_reason text,p_restock boolean,p_request uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare p public.payments; s public.cash_sessions; v_id uuid; v_balance bigint; v_sale public.sales;
begin
 if not app_private.has_shop_role(p_shop,array['admin']::public.shop_role[]) then raise exception 'Apenas administrador registra devolução' using errcode='42501'; end if;
 select * into s from public.cash_sessions where barbershop_id=p_shop and closed_at is null for update;
 if not found then raise exception 'Abra o caixa primeiro'; end if;
 select id into v_id from public.cash_movements where barbershop_id=p_shop and request_key=p_request;
 if found then return v_id; end if;
 select * into p from public.payments where barbershop_id=p_shop and id=p_payment for update;
 if not found or p.provider<>'cash_register' or p.status<>'paid' then raise exception 'Só um recebimento manual pago pode ser devolvido aqui; pagamentos online devem ser estornados no provedor'; end if;
 if p_request is null or length(btrim(coalesce(p_reason,'')))<3 then raise exception 'Justificativa obrigatória'; end if;
 if p.method='cash' then
  select s.opening_cents+coalesce(sum(case when kind in ('receipt','supply') then amount_cents else -amount_cents end),0) into v_balance from public.cash_movements where session_id=s.id and method='cash';
  if p.amount_cents>v_balance then raise exception 'Dinheiro insuficiente para devolução'; end if;
 end if;
 update public.payments set status='refunded' where id=p.id;
 insert into public.cash_movements(barbershop_id,session_id,payment_id,kind,method,amount_cents,request_key,notes,actor_id) values(p_shop,s.id,p.id,'refund',p.method,p.amount_cents,p_request,p_reason,auth.uid()) returning id into v_id;
 if p.sale_id is not null then
  select * into v_sale from public.sales where id=p.sale_id for update;
  if v_sale.status='paid' and not exists(select 1 from public.payments where sale_id=p.sale_id and status in ('paid','approved')) then
   update public.sales set status='refunded' where id=p.sale_id;
   if p_restock then perform set_config('app.inventory_reason','refund_return',true); perform set_config('app.inventory_reference',p.id::text,true); perform set_config('app.inventory_notes',p_reason,true);
    update public.products product set stock_quantity=product.stock_quantity+item.quantity from public.sale_items item where item.sale_id=p.sale_id and product.id=item.product_id and product.barbershop_id=p_shop;
   end if;
  end if;
 end if;
 return v_id;
end $$;
create function app_private.sale_professional(p_shop uuid,p_client uuid,p_items jsonb,p_professional uuid,p_request uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if not app_private.has_module(p_shop,'products') and not app_private.has_module(p_shop,'bar') then raise exception 'Acesso à comanda não permitido' using errcode='42501'; end if;
 if p_request is null then raise exception 'Identificação da comanda obrigatória'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_shop::text||p_request::text,0));
 select id into v_id from public.sales where barbershop_id=p_shop and request_key=p_request;
 if found then return v_id; end if;
 if p_professional is not null and not exists(select 1 from public.memberships where id=p_professional and barbershop_id=p_shop and active and role='barber') then raise exception 'Profissional inválido'; end if;
 if p_professional is not null and not app_private.has_shop_role(p_shop,array['admin']::public.shop_role[]) and not app_private.is_own_barber(p_shop,p_professional) then raise exception 'Profissional não permitido' using errcode='42501'; end if;
 v_id:=app_private.create_sale(p_shop,p_client,p_items);
 update public.sales set barber_membership_id=p_professional,request_key=p_request where id=v_id;
 return v_id;
end $$;

-- A browser status change cannot bypass settlement or return reserved stock twice.
create or replace function app_private.enforce_sale_status() returns trigger language plpgsql security definer set search_path='' as $$
declare v_paid bigint;
begin
 if new.status=old.status then return new; end if;
 if old.status in ('cancelled','refunded') then raise exception 'Comanda finalizada não pode mudar de situação'; end if;
 select coalesce(sum(amount_cents),0) into v_paid from public.payments where sale_id=old.id and status in ('paid','approved');
 if new.status='cancelled' then
  if old.status not in ('open','delivered') or v_paid>0 then raise exception 'Devolva os recebimentos antes de cancelar'; end if;
  perform set_config('app.inventory_reason','sale_cancelled',true); perform set_config('app.inventory_reference',old.id::text,true);
  update public.products p set stock_quantity=p.stock_quantity+i.quantity from public.sale_items i where i.sale_id=old.id and i.product_id=p.id and p.barbershop_id=old.barbershop_id;
 elsif new.status='delivered' and old.status<>'open' then raise exception 'Somente comanda aberta pode ser entregue';
 elsif new.status='paid' and (old.status not in ('open','delivered') or v_paid<new.total_cents) then raise exception 'Receba o saldo da comanda antes de marcar como paga';
 elsif new.status='refunded' and (old.status<>'paid' or v_paid>0) then raise exception 'Devolva todos os recebimentos antes de finalizar o estorno';
 elsif new.status not in ('delivered','paid','refunded') then raise exception 'Transição de comanda inválida'; end if;
 return new;
end $$;

create function app_private.validate_commission_rule() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.barber_membership_id is not null and not exists(select 1 from public.memberships where id=new.barber_membership_id and barbershop_id=new.barbershop_id and role='barber' and active) then raise exception 'Profissional inválido'; end if;
 if new.item_id is not null and not(case when new.item_kind='service' then exists(select 1 from public.services where id=new.item_id and barbershop_id=new.barbershop_id) when new.item_kind='product' then exists(select 1 from public.products where id=new.item_id and barbershop_id=new.barbershop_id) else exists(select 1 from public.subscription_plans where id=new.item_id and barbershop_id=new.barbershop_id) end) then raise exception 'Item pertence a outra barbearia'; end if;
 return new;
end $$;
revoke all on function app_private.validate_commission_rule() from public,anon,authenticated;
create trigger commission_rule_validate before insert or update on public.commission_rules for each row execute function app_private.validate_commission_rule();
create function app_private.commission_credit(p_shop uuid,p_member uuid,p_kind text,p_item uuid,p_description text,p_quantity integer,p_base bigint,p_appointment uuid,p_sale uuid,p_key text,p_paid boolean) returns void language plpgsql security definer set search_path='' as $$
declare r public.commission_rules; v_base bigint:=p_base; v_amount bigint; v_status text:='review';
begin
 select * into r from public.commission_rules where barbershop_id=p_shop and active and item_kind=p_kind and (barber_membership_id is null or barber_membership_id=p_member) and (item_id is null or item_id=p_item) order by (barber_membership_id is not null) desc,(item_id is not null) desc,created_at desc limit 1;
 if r.id is not null and p_member is not null then
  if p_kind='subscription' and r.mode='percent' then v_base:=r.subscription_basis_cents; end if;
  v_amount:=case when r.mode='percent' then round(v_base*r.rate/100) else r.rate::bigint*p_quantity end;
  v_status:=case when p_paid then 'accrued' else 'awaiting_payment' end;
 end if;
 insert into public.commission_entries(barbershop_id,barber_membership_id,appointment_id,sale_id,item_kind,item_id,description,quantity,base_cents,amount_cents,status,rule_snapshot,event_key)
 values(p_shop,p_member,p_appointment,p_sale,p_kind,p_item,p_description,p_quantity,v_base,v_amount,v_status,coalesce(to_jsonb(r),'{}'),p_key) on conflict(barbershop_id,event_key) do nothing;
end $$;
revoke all on function app_private.commission_credit(uuid,uuid,text,uuid,text,integer,bigint,uuid,uuid,text,boolean) from public,anon,authenticated;
create function app_private.commission_appointment() returns trigger language plpgsql security definer set search_path='' as $$
declare i record; v_paid boolean; v_plan uuid;
begin
 if new.status<>'completed' or (tg_op='UPDATE' and old.status='completed') then return new; end if;
 if new.subscription_id is not null then
  select plan_id into v_plan from public.subscriptions where id=new.subscription_id;
  select exists(select 1 from public.payments pay join public.subscriptions sub on sub.id=pay.subscription_id where pay.subscription_id=new.subscription_id and pay.status in ('paid','approved') and pay.paid_at>=sub.current_period_start and pay.paid_at<sub.current_period_end) into v_paid;
  perform app_private.commission_credit(new.barbershop_id,new.barber_membership_id,'subscription',v_plan,'Visita de assinatura',1,0,new.id,null,'appointment:'||new.id,v_paid);
  update public.commission_entries e set rule_snapshot=e.rule_snapshot||jsonb_build_object('period_start',sub.current_period_start,'period_end',sub.current_period_end) from public.subscriptions sub where sub.id=new.subscription_id and e.appointment_id=new.id;
 else
  select coalesce(sum(amount_cents),0)>=new.total_price_cents and new.total_price_cents>0 into v_paid from public.payments where appointment_id=new.id and status in ('paid','approved');
  for i in with weights as (select ap.*,svc.name,case when sum(ap.price_cents) over()>0 then new.total_price_cents::numeric*ap.price_cents/sum(ap.price_cents) over() else 0 end exact_base from public.appointment_services ap join public.services svc on svc.id=ap.service_id where ap.appointment_id=new.id), ranked as (select *,row_number() over(order by exact_base-floor(exact_base) desc,service_id) remainder_rank from weights) select *,floor(exact_base)::bigint+case when remainder_rank<=new.total_price_cents-sum(floor(exact_base)) over() then 1 else 0 end allocated_base from ranked loop
   perform app_private.commission_credit(new.barbershop_id,new.barber_membership_id,'service',i.service_id,i.name,1,i.allocated_base,new.id,null,'appointment:'||new.id||':'||i.service_id,v_paid);
  end loop;
 end if;
 return new;
end $$;
revoke all on function app_private.commission_appointment() from public,anon,authenticated;
create trigger commission_appointment_completed after insert or update of status on public.appointments for each row execute function app_private.commission_appointment();
create function app_private.commission_payment() returns trigger language plpgsql security definer set search_path='' as $$
declare s public.sales; i record; e record; v_paid bigint; v_total bigint; v_refunded bigint; v_reversed bigint; v_reversal bigint;
begin
 if new.status in ('paid','approved') then
  if new.sale_id is not null then
   select * into s from public.sales where id=new.sale_id for update;
   select coalesce(sum(amount_cents),0) into v_paid from public.payments where sale_id=s.id and status in ('paid','approved');
   if v_paid>=s.total_cents and s.total_cents>0 then for i in select * from public.sale_items where sale_id=s.id loop
    perform app_private.commission_credit(s.barbershop_id,s.barber_membership_id,'product',i.product_id,i.description,i.quantity,i.total_cents,null,s.id,'sale:'||i.id,true);
   end loop; end if;
  elsif new.appointment_id is not null then
   select total_price_cents into v_total from public.appointments where id=new.appointment_id;
   select coalesce(sum(amount_cents),0) into v_paid from public.payments where appointment_id=new.appointment_id and status in ('paid','approved');
   if v_paid>=v_total then update public.commission_entries set status='accrued' where appointment_id=new.appointment_id and status='awaiting_payment'; end if;
  elsif new.subscription_id is not null then
   update public.commission_entries ce set status='accrued' from public.appointments a,public.subscriptions sub where ce.appointment_id=a.id and a.subscription_id=new.subscription_id and sub.id=new.subscription_id and a.starts_at>=sub.current_period_start and a.starts_at<sub.current_period_end and ce.status='awaiting_payment';
  end if;
 elsif new.status in ('refunded','charged_back') and tg_op='UPDATE' and old.status in ('paid','approved') then
  for e in select ce.* from public.commission_entries ce left join public.appointments a on a.id=ce.appointment_id where ce.barbershop_id=new.barbershop_id and ce.status in ('accrued','closed') and ce.amount_cents is not null and ce.reverses_entry_id is null and ((new.sale_id is not null and ce.sale_id=new.sale_id) or (new.appointment_id is not null and ce.appointment_id=new.appointment_id) or (new.subscription_id is not null and a.subscription_id=new.subscription_id and new.paid_at>=(ce.rule_snapshot->>'period_start')::timestamptz and new.paid_at<(ce.rule_snapshot->>'period_end')::timestamptz)) for update of ce loop
   if new.subscription_id is not null then
    select coalesce(sum(amount_cents),0),coalesce(sum(amount_cents) filter(where status in ('refunded','charged_back')),0) into v_total,v_refunded from public.payments where subscription_id=new.subscription_id and status in ('paid','approved','refunded','charged_back') and paid_at>=(e.rule_snapshot->>'period_start')::timestamptz and paid_at<(e.rule_snapshot->>'period_end')::timestamptz;
   else
    select case when new.sale_id is not null then (select total_cents from public.sales where id=new.sale_id) else (select total_price_cents from public.appointments where id=new.appointment_id) end into v_total;
    select coalesce(sum(amount_cents),0) into v_refunded from public.payments where status in ('refunded','charged_back') and ((new.sale_id is not null and sale_id=new.sale_id) or (new.appointment_id is not null and appointment_id=new.appointment_id));
   end if;
   select coalesce(-sum(amount_cents),0) into v_reversed from public.commission_entries where reverses_entry_id=e.id;
   v_reversal:=greatest(0,least(e.amount_cents,round(e.amount_cents::numeric*v_refunded/nullif(v_total,0)))-v_reversed);
   if v_reversal=0 then continue; end if;
   insert into public.commission_entries(barbershop_id,barber_membership_id,appointment_id,sale_id,item_kind,item_id,description,base_cents,amount_cents,status,rule_snapshot,event_key,reverses_entry_id)
   values(e.barbershop_id,e.barber_membership_id,e.appointment_id,e.sale_id,e.item_kind,e.item_id,'Estorno · '||e.description,e.base_cents,-v_reversal,'accrued',e.rule_snapshot,'refund:'||new.id||':'||e.id,e.id) on conflict(barbershop_id,event_key) do nothing;
  end loop;
 end if;
 return new;
end $$;
revoke all on function app_private.commission_payment() from public,anon,authenticated;
create trigger commission_payment_changed after insert or update of status on public.payments for each row execute function app_private.commission_payment();
create function app_private.commission_review(p_shop uuid,p_entry uuid,p_member uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare e public.commission_entries; r public.commission_rules; v_base bigint; v_amount bigint; v_paid boolean;
begin
 if not app_private.has_shop_role(p_shop,array['admin']::public.shop_role[]) then raise exception 'Apenas administrador revisa comissão' using errcode='42501'; end if;
 select * into e from public.commission_entries where id=p_entry and barbershop_id=p_shop for update;
 if not found or e.status<>'review' then raise exception 'Lançamento não está pendente de revisão'; end if;
 if not exists(select 1 from public.memberships where id=p_member and barbershop_id=p_shop and role='barber') then raise exception 'Profissional inválido'; end if;
 select * into r from public.commission_rules where barbershop_id=p_shop and active and item_kind=e.item_kind and (barber_membership_id is null or barber_membership_id=p_member) and (item_id is null or item_id=e.item_id) order by (barber_membership_id is not null) desc,(item_id is not null) desc,created_at desc limit 1;
 if not found then raise exception 'Configure uma regra compatível antes de revisar'; end if;
 v_base:=case when e.item_kind='subscription' and r.mode='percent' then r.subscription_basis_cents else e.base_cents end;
 v_amount:=case when r.mode='percent' then round(v_base*r.rate/100) else r.rate::bigint*e.quantity end;
 if e.sale_id is not null then select coalesce(sum(amount_cents),0)>=s.total_cents into v_paid from public.sales s left join public.payments p on p.sale_id=s.id and p.status in ('paid','approved') where s.id=e.sale_id group by s.total_cents;
 elsif e.item_kind='subscription' then select exists(select 1 from public.payments p join public.appointments a on a.subscription_id=p.subscription_id where a.id=e.appointment_id and p.status in ('paid','approved') and p.paid_at>=(e.rule_snapshot->>'period_start')::timestamptz and p.paid_at<(e.rule_snapshot->>'period_end')::timestamptz) into v_paid;
 else select coalesce(sum(amount_cents),0)>=a.total_price_cents into v_paid from public.appointments a left join public.payments p on p.appointment_id=a.id and p.status in ('paid','approved') where a.id=e.appointment_id group by a.total_price_cents; end if;
 update public.commission_entries set barber_membership_id=p_member,base_cents=v_base,amount_cents=v_amount,status=case when v_paid then 'accrued' else 'awaiting_payment' end,rule_snapshot=rule_snapshot||to_jsonb(r)||jsonb_build_object('reviewed_by',auth.uid(),'reviewed_at',now()) where id=e.id;
 return e.id;
end $$;
create function app_private.commission_close(p_shop uuid,p_member uuid,p_from date,p_to date) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_total bigint; v_count integer; v_tz text; v_entries uuid[];
begin
 if not app_private.has_shop_role(p_shop,array['admin']::public.shop_role[]) then raise exception 'Apenas administrador fecha comissões' using errcode='42501'; end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>370 then raise exception 'Período inválido'; end if;
 select timezone into v_tz from public.barbershops where id=p_shop;
 perform pg_advisory_xact_lock(hashtextextended(p_shop::text||p_member::text,0));
 if exists(select 1 from public.commission_entries where barbershop_id=p_shop and barber_membership_id=p_member and status='review' and (earned_at at time zone v_tz)::date between p_from and p_to) then raise exception 'Há lançamentos sem regra; revise antes de fechar'; end if;
 select array_agg(id),sum(amount_cents),count(*) into v_entries,v_total,v_count from (select id,amount_cents from public.commission_entries where barbershop_id=p_shop and barber_membership_id=p_member and status='accrued' and (earned_at at time zone v_tz)::date between p_from and p_to for update) locked;
 if v_count=0 then raise exception 'Não há comissão disponível neste período'; end if;
 insert into public.commission_closings(barbershop_id,barber_membership_id,period_from,period_to,total_cents,actor_id) values(p_shop,p_member,p_from,p_to,v_total,auth.uid()) returning id into v_id;
 update public.commission_entries set status='closed',closing_id=v_id where id=any(v_entries);
 return v_id;
end $$;

-- Public RPC wrappers are invokers; private definers explicitly authorize the actor.
create function public.inventory_adjust(p_shop uuid,p_product uuid,p_quantity integer,p_reason text,p_notes text,p_request uuid) returns uuid language sql security invoker set search_path='' as $$ select app_private.inventory_adjust(p_shop,p_product,p_quantity,p_reason,p_notes,p_request) $$;
create function public.inventory_receive(p_shop uuid,p_supplier uuid,p_invoice text,p_items jsonb,p_paid boolean,p_request uuid) returns uuid language sql security invoker set search_path='' as $$ select app_private.inventory_receive(p_shop,p_supplier,p_invoice,p_items,p_paid,p_request) $$;
create function public.inventory_pay(p_shop uuid,p_purchase uuid) returns uuid language sql security invoker set search_path='' as $$ select app_private.inventory_pay(p_shop,p_purchase) $$;
create function public.product_cost(p_shop uuid,p_product uuid,p_cost integer) returns void language sql security invoker set search_path='' as $$ select app_private.product_cost(p_shop,p_product,p_cost) $$;
create function public.product_save(p_shop uuid,p_product uuid,p_values jsonb) returns uuid language sql security invoker set search_path='' as $$ select app_private.product_save(p_shop,p_product,p_values) $$;
create function public.cash_open(p_shop uuid,p_opening bigint,p_notes text) returns uuid language sql security invoker set search_path='' as $$ select app_private.cash_open(p_shop,p_opening,p_notes) $$;
create function public.cash_adjust(p_shop uuid,p_kind text,p_amount bigint,p_notes text,p_request uuid) returns uuid language sql security invoker set search_path='' as $$ select app_private.cash_adjust(p_shop,p_kind,p_amount,p_notes,p_request) $$;
create function public.cash_close(p_shop uuid,p_session uuid,p_counted bigint,p_notes text) returns uuid language sql security invoker set search_path='' as $$ select app_private.cash_close(p_shop,p_session,p_counted,p_notes) $$;
create function public.cash_receive(p_shop uuid,p_sale uuid,p_appointment uuid,p_methods jsonb,p_request uuid) returns jsonb language sql security invoker set search_path='' as $$ select app_private.cash_receive(p_shop,p_sale,p_appointment,p_methods,p_request) $$;
create function public.cash_refund(p_shop uuid,p_payment uuid,p_reason text,p_restock boolean,p_request uuid) returns uuid language sql security invoker set search_path='' as $$ select app_private.cash_refund(p_shop,p_payment,p_reason,p_restock,p_request) $$;
create function public.sale_professional(p_shop uuid,p_client uuid,p_items jsonb,p_professional uuid,p_request uuid) returns uuid language sql security invoker set search_path='' as $$ select app_private.sale_professional(p_shop,p_client,p_items,p_professional,p_request) $$;
create function public.commission_close(p_shop uuid,p_member uuid,p_from date,p_to date) returns uuid language sql security invoker set search_path='' as $$ select app_private.commission_close(p_shop,p_member,p_from,p_to) $$;
create function public.commission_review(p_shop uuid,p_entry uuid,p_member uuid) returns uuid language sql security invoker set search_path='' as $$ select app_private.commission_review(p_shop,p_entry,p_member) $$;
do $$ declare r record; begin
 for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and p.proname in ('inventory_adjust','inventory_receive','inventory_pay','product_cost','product_save','cash_open','cash_adjust','cash_close','cash_receive','cash_refund','sale_professional','commission_close','commission_review') loop
  execute format('revoke all on function %s from public,anon,authenticated',r.signature);
  execute format('grant execute on function %s to authenticated',r.signature);
 end loop;
end $$;
