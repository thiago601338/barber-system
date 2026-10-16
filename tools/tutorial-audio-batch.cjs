// Uses credentials through the authorized Netlify CLI. Never writes or prints credentials.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto')
const {ElevenLabsClient}=require('@elevenlabs/elevenlabs-js')
const {createClient}=require('@supabase/supabase-js')
const project=path.resolve(__dirname,'..'),generated=path.join(project,'node_modules','.cache','tutorial-audio-access-test')
const {uniqueTutorialTexts}=require(path.join(generated,'netlify/functions/_shared/tutorialAudioCatalog.js'))
const {serverSupabaseFetch}=require(path.join(generated,'netlify/functions/_shared/supabaseFetch.js'))
function setting(name){
 if(!['ELEVENLABS_VOICE_ID','ELEVENLABS_API_KEY','SUPABASE_URL','SUPABASE_SECRET_KEY'].includes(name))throw Error('Configuração não permitida.')
 let out;try{out=cp.execFileSync('cmd.exe',['/d','/s','/c',`npx netlify env:get ${name} --context production --scope functions --json`],{cwd:project,encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true}).trim()}catch{throw Error(`Não foi possível ler a configuração ${name}.`)}
 try{const parsed=JSON.parse(out);if(typeof parsed==='string')out=parsed;else if(typeof parsed?.value==='string')out=parsed.value;else if(typeof parsed?.[name]==='string')out=parsed[name]}catch{}
 const pattern=name==='SUPABASE_SECRET_KEY'?/sb_secret_[\w-]+/:name==='SUPABASE_URL'?/https:\/\/[a-z0-9]+\.supabase\.co/:name==='ELEVENLABS_API_KEY'?/(?:sk_[\w-]+|[a-fA-F0-9]{32,128})/:/^[A-Za-z0-9]{20}$/m
 const value=out.match(pattern)?.[0];if(!value)throw Error(`Valor da configuração ${name} indisponível.`);return value
}
async function main(){
 const voice=setting('ELEVENLABS_VOICE_ID'), model='eleven_multilingual_v2'
 const eleven=new ElevenLabsClient({apiKey:setting('ELEVENLABS_API_KEY')})
 const baseUrl=setting('SUPABASE_URL'),key=setting('SUPABASE_SECRET_KEY')
 if(!/^sb_secret_[\w-]+$/.test(key))throw Error('A credencial do servidor retornada pela Netlify não está no formato esperado.')
 const db=createClient(baseUrl,key,{auth:{persistSession:false},global:{fetch:serverSupabaseFetch(key,baseUrl)}})
 const prefix=`v1/${voice}/${model}`
 const {data,error}=await db.storage.from('tutorial-audio').list(prefix,{limit:1000})
 if(error){console.log(JSON.stringify({storageErrorCode:error.statusCode||error.status||null,reason:String(error.message).replace(/sb_secret_[\w-]+|sk_[\w-]+/g,'[oculto]')}));throw Error('Não foi possível verificar os áudios salvos.')}
 const existing=new Set((data||[]).map(x=>x.name))
 const records=uniqueTutorialTexts().map(text=>({text,path:`${prefix}/${crypto.createHash('sha256').update(JSON.stringify({voiceId:voice,modelId:model,tutorialText:text})).digest('hex')}.mp3`}))
 const missing=records.filter(x=>!existing.has(x.path.split('/').pop()))
 let subscription=null
 try{subscription=await eleven.user.subscription.get()}catch{throw Error('A chave ElevenLabs não permite consultar o saldo. Não foi gerado áudio.')}
 const characters=missing.reduce((n,x)=>n+x.text.length,0),remaining=Math.max(0,subscription.characterLimit-subscription.characterCount)
 const report={total:records.length,cached:records.length-missing.length,missing:missing.length,characters,remainingCredits:remaining,tier:subscription.tier,voice,model,generated:0}
 console.log(JSON.stringify(report))
 if(!process.argv.includes('--generate'))return
 const approved=Number(process.env.TUTORIAL_APPROVED_CREDITS||0)
 if(characters>approved||characters>remaining)throw Error('O lote supera a autorização ou o saldo incluído; não foi gerado áudio.')
 for(const item of missing){
  const s=await eleven.user.subscription.get()
  if(s.characterLimit-s.characterCount<item.text.length)throw Error('Saldo incluído insuficiente. Lote pausado para evitar cobrança extra.')
  const stream=await eleven.textToSpeech.convert(voice,{text:item.text,modelId:model,outputFormat:'mp3_44100_128',voiceSettings:{stability:0.58,similarityBoost:0.82,style:0.18,useSpeakerBoost:true}})
  const raw=Buffer.from(await new Response(stream).arrayBuffer())
  if(raw.length<1000)throw Error('Resposta de áudio incompleta; lote pausado.')
  const {error:uploadError}=await db.storage.from('tutorial-audio').upload(item.path,raw,{contentType:'audio/mpeg',cacheControl:'31536000',upsert:false})
  if(uploadError&&!/already exists|Duplicate/i.test(uploadError.message))throw Error('Áudio gerado, mas não confirmado no armazenamento. Não repetir geração.')
  report.generated++;console.log(JSON.stringify({generated:report.generated,totalMissing:missing.length,path:item.path}))
 }
 fs.writeFileSync(path.resolve(project,'../verification/tutorial-audio-batch-20261005.json'),JSON.stringify(report,null,2))
}
main().catch(e=>{console.error(e.message);process.exitCode=1})
