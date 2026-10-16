const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path')
const runtime = process.env.PGLITE_RUNTIME || path.resolve(__dirname,'../../verification/sql-runtime/node_modules/@electric-sql/pglite')
const { PGlite } = require(runtime), { btree_gist } = require(path.join(runtime,'dist/contrib/btree_gist.cjs'))
const db = new PGlite({extensions:{btree_gist}})
async function main(){
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid,metadata jsonb);alter table storage.objects enable row level security;grant usage on schema storage to authenticated,anon;grant select,insert,delete,update on storage.objects to authenticated;`)
 const directory=path.resolve(__dirname,'../supabase/migrations')
 for(const name of fs.readdirSync(directory).filter(n=>n.endsWith('.sql')&&n<'20261005172900').sort()){
  try{await db.exec(fs.readFileSync(path.join(directory,name),'utf8'))}catch(p){throw new Error(`Migration ${name}: ${p.message}`,{cause:p})}
 }
 await db.exec(fs.readFileSync(path.join(directory,'20261005180733_client_self_service.sql'),'utf8'))
 console.log('PASS scheduling and record migrations compile against complete prerequisite schema')
 const result=await db.exec(fs.readFileSync(path.resolve(__dirname,'../supabase/tests/appointment_schedule_waitlist_records.sql'),'utf8'))
 assert.match(JSON.stringify(result),/Scheduling, waitlist and private care-record tests passed/)
 console.log('PASS transactional synthetic scheduling, subscription, waitlist, consent, Storage and tenant tests')
 const contracts=await db.exec(fs.readFileSync(path.resolve(__dirname,'../supabase/tests/subscription_contracts_and_booking.sql'),'utf8'))
 assert.match(JSON.stringify(contracts),/Subscription snapshots/)
 console.log('PASS subscription snapshots, exclusive services, reservation reuse, refunds and financial isolation')
 const profile=await db.exec(fs.readFileSync(path.resolve(__dirname,'../supabase/tests/client_self_service.sql'),'utf8'))
 assert.match(JSON.stringify(profile),/Client own profile/)
 console.log('PASS client own profile validation, immutable access fields and tenant isolation')
 await db.close()
}
main().catch(async p=>{console.error(p.message);console.error(p.cause?.message||'');await db.close();process.exitCode=1})
