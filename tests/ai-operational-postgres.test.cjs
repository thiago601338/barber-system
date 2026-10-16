// Real SQL execution in an isolated PostgreSQL. No live database, paid model or customer contact.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const runtime=process.env.PGLITE_RUNTIME||path.resolve(__dirname,'../../verification/sql-runtime/node_modules/@electric-sql/pglite')
const {PGlite}=require(runtime),{btree_gist}=require(path.join(runtime,'dist/contrib/btree_gist.cjs'))
const db=new PGlite({extensions:{btree_gist}}),dir=path.resolve(__dirname,'../supabase/migrations')
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
const admin=id(1),barber=id(2),other=id(3),customer=id(4),master=id(5),shop=id(10),shop2=id(11),member=id(20),otherMember=id(21),client=id(30),otherClient=id(31),service=id(40),product=id(41)
let passed=0
async function test(name,fn){await fn();passed++;console.log('PASS',name)}
async function query(sql,args=[]){return (await db.query(sql,args)).rows}
async function scalar(sql,args=[]){return Object.values((await query(sql,args))[0])[0]}
async function as(user,role,sql,args=[]){await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);await db.exec(`set role ${role}`);try{return await scalar(sql,args)}finally{await db.exec('reset role')}}
async function validate(actor,type,values,tenant=shop){return as(actor,'service_role','select public.validate_ai_help_action($1,$2,$3,$4)',[actor,tenant,type,JSON.stringify(values)])}
async function propose(actor,type,values,tenant=shop){const validated=await validate(actor,type,values,tenant);return scalar("insert into ai_help_plans(barbershop_id,requester_user_id,prompt,summary,action_type,action_values,status) values($1,$2,'Pedido sintético','Prévia sintética',$3,$4,'pending') returning id",[tenant,actor,type,JSON.stringify(validated)])}
const execute=(actor,plan)=>as(actor,'service_role','select public.execute_ai_help_plan($1,$2)',[plan,actor])
async function main(){
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;grant usage on schema auth to authenticated,service_role;grant execute on function auth.uid() to authenticated,service_role;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,owner uuid,owner_id text,metadata jsonb,created_at timestamptz default now(),updated_at timestamptz default now());alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert,update,delete on storage.objects to authenticated;`)
 for(const file of fs.readdirSync(dir).filter(name=>name.endsWith('.sql')).sort())try{await db.exec(fs.readFileSync(path.join(dir,file),'utf8'))}catch(error){throw new Error(`${file}: ${error.message}`)}
 await test('contract snapshots, exclusive Club, reserved-balance reschedule, reversals and financial RLS regression',async()=>{await db.exec(fs.readFileSync(path.resolve(__dirname,'../supabase/tests/subscription_contracts_and_booking.sql'),'utf8'))})
 await db.query('insert into auth.users(id,email) select value::uuid,value||$1 from unnest($2::text[]) value',['@ai-test.invalid',[admin,barber,other,customer,master]])
 await db.query('insert into barbershops(id,name,slug,timezone) values($1,$2,$3,$4),($5,$6,$7,$4)',[shop,'Loja sintética','ai-test-one','UTC',shop2,'Outra loja','ai-test-two'])
 await db.query("insert into memberships(id,barbershop_id,user_id,role) values($1,$2,$3,'admin'),($4,$2,$5,'barber'),($6,$2,$7,'barber'),($8,$9,$7,'admin')",[id(19),shop,admin,member,barber,otherMember,other,id(22),shop2])
 await db.query('insert into platform_admins(user_id) values($1)',[master])
 await db.query("insert into module_permissions(barbershop_id,user_id,module,allowed) select $1,$2,value,true from unnest(array['ai','clients','appointments','availability','goals','marketing']) value",[shop,barber])
 await db.query('insert into clients(id,barbershop_id,user_id,full_name) values($1,$2,$3,$4),($5,$2,$6,$7)',[client,shop,customer,'Meu cliente sintético',otherClient,other,'Outro cliente sintético'])
 await db.query('insert into client_barbers(barbershop_id,client_id,barber_membership_id) values($1,$2,$3),($1,$4,$5)',[shop,client,member,otherClient,otherMember])
 await db.query("insert into services(id,barbershop_id,name,duration_minutes,price_cents,cost_cents) values($1,$2,'Corte sintético',30,5000,500)",[service,shop])
 await db.query('insert into barber_services(barbershop_id,barber_membership_id,service_id) values($1,$2,$3)',[shop,member,service])
 await db.query("insert into availability_rules(barbershop_id,barber_membership_id,weekday,start_time,end_time) select $1,$2,day,'08:00'::time,'18:00'::time from generate_series(0,6) day",[shop,member])
 await db.query("insert into products(id,barbershop_id,name,category,price_cents,cost_cents,stock_quantity) values($1,$2,'Pomada sintética','retail',3000,1000,4)",[product,shop])
 const start=await scalar("select ((current_date+3)::timestamp+interval '9 hours')::timestamptz::text")
 let booking
 await test('valid own booking is only a preview until confirmation, then replay returns same ID and one audit',async()=>{
  const proposal=await propose(barber,'book_appointment',{client_id:client,barber_membership_id:member,service_ids:[service],starts_at:start,subscription_id:null})
  assert.equal(Number(await scalar('select count(*) from appointments')),0)
  const first=await execute(barber,proposal),second=await execute(barber,proposal);booking=first.result.id
  assert.equal(second.replayed,true);assert.equal(first.result.id,second.result.id);assert.equal(first.result.audit_id,second.result.audit_id)
  assert.equal(Number(await scalar('select count(*) from appointments')),1);assert.equal(Number(await scalar('select count(*) from ai_help_action_audit where plan_id=$1',[proposal])),1)
 })
 await test('barber cannot choose another client, another professional or financial catalog mutation',async()=>{
  await assert.rejects(()=>validate(barber,'book_appointment',{client_id:otherClient,barber_membership_id:member,service_ids:[service],starts_at:start}),/Cliente fora/)
  await assert.rejects(()=>validate(barber,'create_schedule_block',{barber_membership_id:otherMember,starts_at:start,ends_at:new Date(Date.parse(start)+3600000).toISOString(),reason:'Teste'}),/Profissional fora/)
  await assert.rejects(()=>validate(barber,'update_service',{id:service,name:'Indevido'}),/Permissão/)
  await assert.rejects(()=>validate(customer,'create_client',{full_name:'Indevido'}),/Acesso/)
 })
 await test('a revoked module cancels pending permission before any write',async()=>{
  const proposal=await propose(barber,'create_client',{full_name:'Cliente pendente'})
  await db.query("update module_permissions set allowed=false where barbershop_id=$1 and user_id=$2 and module='clients'",[shop,barber])
  await assert.rejects(()=>execute(barber,proposal),/Permissão/)
  assert.equal(Number(await scalar("select count(*) from clients where full_name='Cliente pendente'")),0)
  await db.query("update module_permissions set allowed=true where barbershop_id=$1 and user_id=$2 and module='clients'",[shop,barber])
 })
 await test('new barber client is linked to only that professional; no Auth account or message created',async()=>{
  const before=await scalar('select count(*) from auth.users');const proposal=await propose(barber,'create_client',{full_name:'Novo cliente de teste'})
  const result=await execute(barber,proposal)
  assert.equal(await scalar('select barber_membership_id from client_barbers where client_id=$1',[result.result.id]),member)
  assert.equal(await scalar('select count(*) from auth.users'),before)
 })
 await test('catalog edits preserve price, cost, stock and reject stale proposals',async()=>{
  const version=await scalar('select updated_at::text from products where id=$1',[product])
  await assert.rejects(()=>validate(admin,'update_product',{id:product,expected_updated_at:version,name:'Mudança',stock_quantity:1000}),/Não é permitido/)
  const proposal=await propose(admin,'update_product',{id:product,expected_updated_at:version,name:'Nome revisado',description:'Descrição revisada'})
  await execute(admin,proposal)
  assert.deepEqual((await query('select name,price_cents,cost_cents,stock_quantity from products where id=$1',[product]))[0],{name:'Nome revisado',price_cents:3000,cost_cents:1000,stock_quantity:4})
  await assert.rejects(()=>validate(admin,'update_product',{id:product,expected_updated_at:version,name:'Proposta antiga'}),/cadastro mudou/)
 })
 await test('blocking refuses an existing appointment and only writes the selected own interval',async()=>{
  await assert.rejects(()=>validate(barber,'create_schedule_block',{barber_membership_id:member,starts_at:start,ends_at:new Date(Date.parse(start)+3600000).toISOString(),reason:'Intervalo'}),/atendimentos/)
  const later=new Date(Date.parse(start)+7200000).toISOString(),end=new Date(Date.parse(start)+10800000).toISOString()
  const result=await execute(barber,await propose(barber,'create_schedule_block',{barber_membership_id:member,starts_at:later,ends_at:end,reason:'Intervalo próprio'}))
  assert.equal(await scalar('select barber_membership_id from schedule_blocks where id=$1',[result.result.id]),member)
  assert.equal(await scalar('select status from appointments where id=$1',[booking]),'confirmed')
 })
 await test('client and other-tenant roles cannot read operational audits or usage',async()=>{
  assert.equal(Number(await as(customer,'authenticated','select count(*) from ai_help_action_audit')),0)
  assert.equal(Number(await as(customer,'authenticated','select count(*) from ai_help_usage')),0)
  await assert.rejects(()=>as(other,'service_role','select public.ai_help_available_slots($1,$2,$3,$4,$5,$6)',[other,shop,client,member,[service],start.slice(0,10)]),/Permissão|Cliente|Profissional|Ajuda/)
 })
 await test('only master changes quotas and a collective request cap cannot be bypassed by caller limit',async()=>{
  const settings={enabled:true,admin_daily_limit:20,barber_daily_limit:10,daily_shop_limit:1,monthly_token_limit:null}
  await assert.rejects(()=>as(admin,'service_role','select public.configure_ai_help_limits($1,$2,$3)',[admin,shop2,JSON.stringify(settings)]),/Somente/)
  await as(master,'service_role','select public.configure_ai_help_limits($1,$2,$3)',[master,shop2,JSON.stringify(settings)])
  await as(other,'service_role','select public.start_ai_help_attempt($1,$2,$3,1000,0,$4)',[other,shop2,'Primeiro pedido',id(100)])
  await assert.rejects(()=>as(other,'service_role','select public.start_ai_help_attempt($1,$2,$3,1000,0,$4)',[other,shop2,'Outro pedido',id(101)]),/Limite diário da barbearia/)
 })
 await test('token reservations are atomic, replay does not reserve twice, and unknown metadata is not counted as zero',async()=>{
  await as(master,'service_role','select public.configure_ai_help_limits($1,$2,$3)',[master,shop2,JSON.stringify({enabled:true,admin_daily_limit:20,barber_daily_limit:10,daily_shop_limit:50,monthly_token_limit:1000})])
  const first=await as(other,'service_role','select public.start_ai_help_attempt($1,$2,$3,1000,700,$4)',[other,shop2,'Modelo primeiro',id(102)])
  assert.equal((await as(other,'service_role','select public.start_ai_help_attempt($1,$2,$3,1000,700,$4)',[other,shop2,'Modelo primeiro',id(102)])).reused,true)
  await assert.rejects(()=>as(other,'service_role','select public.start_ai_help_attempt($1,$2,$3,1000,301,$4)',[other,shop2,'Acima da reserva',id(103)]),/Limite mensal/)
  await db.query("insert into ai_help_usage(plan_id,barbershop_id,requester_user_id,model,total_tokens) values($1,$2,$3,'test-model',600)",[first.id,shop2,other])
  const second=await as(other,'service_role','select public.start_ai_help_attempt($1,$2,$3,1000,400,$4)',[other,shop2,'No limite exato',id(104)])
  await db.query("insert into ai_help_usage(plan_id,barbershop_id,requester_user_id,model,total_tokens) values($1,$2,$3,'test-model',null)",[second.id,shop2,other])
  await db.query("update ai_help_plans set status='failed' where id=$1",[second.id])
  await assert.rejects(()=>as(other,'service_role','select public.start_ai_help_attempt($1,$2,$3,1000,1,$4)',[other,shop2,'Metadado ausente',id(105)]),/Limite mensal/)
 })
 console.log(`${passed} AI and contract PostgreSQL scenarios passed`);await db.close()
}
main().catch(async error=>{console.error(error.message,error.detail||'',error.where||'');await db.close();process.exitCode=1})
