// Trusted local migration runner. Never logs the server credential or source rows.
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
const dir=path.resolve(process.argv[2]);const shop=process.argv[3]
if(!dir||!/^[\da-f-]{36}$/.test(shop||''))throw Error('Informe a pasta normalizada e o ID da barbearia.')
let secret=process.env.SUPABASE_SECRET_KEY
if(!secret){let output;try{output=execFileSync('cmd.exe',['/d','/s','/c','npx netlify env:get SUPABASE_SECRET_KEY --context production --scope functions --json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']})}catch{throw Error('Não foi possível ler a configuração segura da Netlify.')}secret=output.match(/sb_secret_[\w-]+/)?.[0];if(!secret){console.log(JSON.stringify({configurationRead:true,outputLength:output.length,masked:/\*{3}|redact|hidden/i.test(output),missing:/not found|undefined|no value|does not exist/i.test(output)}));throw Error('Chave do servidor indisponível.')}}
const client=createClient('https://oyjiiqbsbshfdgdaxbus.supabase.co',secret,{auth:{persistSession:false,autoRefreshToken:false}})
const datasets=process.argv[4]?.split(',')||['clients','memberships','services','products','appointments','appointment_services','availability_rules','availability_blocks','payments','expenses','orders','plans','contracts','overdue','sales_summary']
const results={}
for(const dataset of datasets){const rows=JSON.parse(await fs.readFile(path.join(dir,dataset+'.json'),'utf8'));let totals={imported:0,skipped:0,review:0};for(let i=0;i<rows.length;i+=500){const {data,error}=await client.rpc('import_cashbarber_batch',{p_shop:shop,p_dataset:dataset,p_rows:rows.slice(i,i+500)});if(error){console.error(JSON.stringify({dataset,offset:i,code:error.code}));process.exit(1)}for(const key of Object.keys(totals))totals[key]+=Number(data[key]||0);if(i%5000===0)console.log(JSON.stringify({dataset,processed:Math.min(i+500,rows.length),total:rows.length,...totals}))}results[dataset]=totals;console.log(JSON.stringify({dataset,complete:true,...totals}))}
await fs.writeFile(path.join(dir,'result-'+Date.now()+'.json'),JSON.stringify(results,null,2));console.log('Importação terminada; conferir contagens e totais no banco.')
