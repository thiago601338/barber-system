// Isolated full PostgreSQL migration chain. No production access, customers or paid APIs.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const runtime=process.env.PGLITE_RUNTIME||path.resolve(__dirname,'../../verification/sql-runtime/node_modules/@electric-sql/pglite'),{PGlite}=require(runtime),{btree_gist}=require(path.join(runtime,'dist/contrib/btree_gist.cjs'))
const db=new PGlite({extensions:{btree_gist}}),dir=path.resolve(__dirname,'../supabase/migrations'),id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
let passed=0;const failures=[];async function test(name,fn){try{await fn();passed++;console.log('PASS',name)}catch(error){failures.push({name,error});console.error('FAIL',name,error.message)}}
async function scalar(sql,args=[]){return Object.values((await db.query(sql,args)).rows[0]||{})[0]}
async function as(role,user,sql,args=[]){await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user||'']);await db.exec(`set role ${role}`);try{return await scalar(sql,args)}finally{await db.exec('reset role')}}
const master=id(1),other=id(2);const call=(actor,post,values,revision=null)=>as('service_role',null,'select manage_platform_blog_post($1,$2,$3,$4)',[actor,post,JSON.stringify(values),revision])
const values=(slug,status='draft',extra={})=>({slug,title:`Artigo sobre ${slug}`,body_md:'## Agenda online\n\nOrganizar horários para a barbearia melhora atendimento e finanças.',excerpt:'Gestão da barbearia.',status,...extra})
async function main(){
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;grant usage on schema auth to authenticated,service_role;grant execute on function auth.uid() to authenticated,service_role;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,owner uuid,owner_id text,metadata jsonb,created_at timestamptz default now(),updated_at timestamptz default now());alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert,update,delete on storage.objects to authenticated;`)
 for(const file of fs.readdirSync(dir).filter(x=>x.endsWith('.sql')).sort())try{await db.exec(fs.readFileSync(path.join(dir,file),'utf8'))}catch(error){throw new Error(`${file}: ${error.message}`)}
 await db.query("insert into auth.users(id,email) values($1,'master@blog.invalid'),($2,'other@blog.invalid')",[master,other]);await db.query('insert into platform_admins(user_id)values($1)',[master])
 let draft,future,due,published,category
 await test('master editor validates actor, snapshots version and writes audit exactly once',async()=>{
  await assert.rejects(()=>call(other,null,values('not-allowed')),/master/)
  draft=await call(master,null,values('rascunho'));assert.equal(draft.revision,1)
  const before=await scalar('select count(*) from platform_blog_audit');await assert.rejects(()=>call(master,draft.id,{title:'Atualização incorreta'},9),/Recarregue/);assert.equal(await scalar('select count(*) from platform_blog_audit'),before)
  draft=await call(master,draft.id,{title:'Rascunho de agenda online'},1);assert.equal(draft.revision,2)
  await assert.rejects(()=>call(master,draft.id,{created_by:other},2),/Campo/)
  await assert.rejects(()=>as('authenticated',master,'select manage_platform_blog_post($1,null,$2,null)',[master,JSON.stringify(values('rpc-auth'))]),/permission denied/)
 })
 await test('draft and future scheduled posts remain private even via the service role public RPC',async()=>{
  future=await call(master,null,values('agendado-futuro','scheduled',{scheduled_at:new Date(Date.now()+86400000).toISOString()}))
  due=await call(master,null,values('agendado-visivel','scheduled',{scheduled_at:new Date(Date.now()-60000).toISOString()}))
  published=await call(master,null,values('publicado','published'))
  for(const role of ['anon','authenticated','service_role']){
   const index=await as(role,other,'select blog_public_index()');assert.deepEqual(index.posts.map(x=>x.slug).sort(),['agendado-visivel','publicado'])
   assert.equal(await as(role,other,'select blog_public_article($1)',[draft.slug]),null);assert.equal(await as(role,other,'select blog_public_article($1)',[future.slug]),null)
   assert.equal((await as(role,other,'select blog_public_article($1)',[due.slug])).slug,due.slug)
   const sitemap=await as(role,other,'select blog_public_sitemap()');assert.equal(sitemap.posts.length,2)
  }
 })
 await test('anonymous role cannot read editorial metadata or perform writes',async()=>{
  await assert.rejects(()=>as('anon',null,'select created_by from platform_blog_posts'),/permission denied/)
  await assert.rejects(()=>as('anon',null,"update platform_blog_posts set title='Ataque'"),/permission denied/)
  assert.equal(await as('authenticated',other,'select count(*) from platform_blog_audit'),0)
  assert.equal(await as('anon',null,'select count(id) from platform_blog_posts'),2)
 })
 await test('public permalinks are immutable and returning to draft hides the content',async()=>{
  await assert.rejects(()=>call(master,published.id,{slug:'changed-public-link'},published.revision),/permanece fixo/)
  await assert.rejects(()=>call(master,due.id,{slug:'changed-due-link'},due.revision),/permanece fixo/)
  published=await call(master,published.id,{status:'draft'},published.revision);assert.equal(await as('anon',null,'select blog_public_article($1)',[published.slug]),null)
  await assert.rejects(()=>call(master,published.id,{slug:'changed-after-unpublish'},published.revision),/permanece fixo/)
 })
 await test('categories control public visibility, search is Portuguese, summaries exclude full content',async()=>{
  category=await as('service_role',null,'select manage_platform_blog_category($1,null,$2)',[master,JSON.stringify({slug:'gestao',name:'Gestão',description:'Aprenda gestão.'})])
  due=await call(master,due.id,{category_id:category.id},due.revision)
  const result=await as('anon',null,"select blog_public_index('horários','gestao',1,12)");assert.equal(result.total,1);assert(!('body_md'in result.posts[0]));assert(result.posts[0].reading_minutes>=1)
  await as('service_role',null,'select manage_platform_blog_category($1,$2,$3)',[master,category.id,JSON.stringify({active:false})]);assert.equal(await as('anon',null,'select blog_public_article($1)',[due.slug]),null)
  assert.equal((await as('service_role',null,"select blog_public_index('','gestao')")).category_missing,true)
  assert.equal((await as('anon',null,'select blog_public_sitemap()')).posts.length,0)
  await assert.rejects(()=>as('service_role',null,'select manage_platform_blog_category($1,$2,$3)',[other,category.id,JSON.stringify({active:true})]),/master/)
  await assert.rejects(()=>as('anon',null,"select blog_public_index('',null,0,100)"),/Filtro/)
  await assert.rejects(()=>as('anon',null,"select blog_public_index('',null,null,12)"),/Filtro/)
  await assert.rejects(()=>as('anon',null,"select blog_public_index('',null,1,null)"),/Filtro/)
 })
 await db.close();if(failures.length)throw new Error(`${failures.length} failed`);console.log(`${passed} blog PostgreSQL scenarios passed`)
}
main().catch(async e=>{console.error(e);await db.close().catch(()=>{});process.exitCode=1})
