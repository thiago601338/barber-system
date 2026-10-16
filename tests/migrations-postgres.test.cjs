// Compile the real migration chain in an isolated PostgreSQL, with empty local Auth/Storage stand-ins.
const fs = require('node:fs')
const path = require('node:path')
const runtime=process.env.PGLITE_RUNTIME || path.resolve(__dirname,'../../verification/sql-runtime/node_modules/@electric-sql/pglite')
const { PGlite }=require(runtime)
const { btree_gist }=require(path.join(runtime,'dist/contrib/btree_gist.cjs'))
const db=new PGlite({extensions:{btree_gist}})
const dir=path.resolve(__dirname,'../supabase/migrations')
async function main(){
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,owner uuid,owner_id text,metadata jsonb,created_at timestamptz default now(),updated_at timestamptz default now());alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert,update,delete on storage.objects to authenticated;`)
 const results=[]
 for(const file of fs.readdirSync(dir).filter(f=>f.endsWith('.sql')).sort()){
  try{await db.exec(fs.readFileSync(path.join(dir,file),'utf8'));results.push({file,ok:true});console.log('PASS',file)}
  catch(error){results.push({file,ok:false,message:error.message,detail:error.detail});console.error('FAIL',file,error.message,error.detail||'');process.exitCode=1;break}
 }
 fs.writeFileSync(path.resolve(__dirname,'../../verification/migrations-postgres-20261005.json'),JSON.stringify({tested_at:new Date().toISOString(),engine:'PGlite PostgreSQL, empty local Auth/Storage, no live connection',results},null,2))
 await db.close()
}
main().catch(async e=>{console.error(e.message);await db.close();process.exitCode=1})
