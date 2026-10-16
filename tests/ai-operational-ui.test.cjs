const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),vm=require('node:vm'),os=require('node:os'),path=require('node:path')
const {execFileSync}=require('node:child_process'),{webcrypto}=require('node:crypto')
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'barber-ai-ui-'))
execFileSync(process.execPath,[path.resolve(__dirname,'../node_modules/typescript/bin/tsc'),'--ignoreConfig','--noCheck','--module','commonjs','--jsx','react-jsx','--target','es2022','--rootDir','src','--outDir',temporary,'src/AiOperationalActions.tsx'],{cwd:path.resolve(__dirname,'..'),stdio:'pipe'})
process.on('exit',()=>{const resolved=path.resolve(temporary);if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('barber-ai-ui-'))throw Error('Unsafe temporary directory');fs.rmSync(resolved,{recursive:true,force:true})})
function harness(api,get){
 const slots=[];let index=0,effects=[],tree
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]))
 const react={useState(initial){const n=index++;if(!(n in slots))slots[n]=typeof initial==='function'?initial():initial;return[slots[n],value=>{slots[n]=typeof value==='function'?value(slots[n]):value}]},useRef(value){return react.useState(()=>({current:value}))[0]},useEffect(fn,deps){const n=index++,before=slots[n];if(!before||!same(before.deps,deps))effects.push(()=>{before?.cleanup?.();slots[n]={deps,cleanup:fn()}})}}
 const cache={};const jsx=(type,props)=>({type,props:props||{}})
 function load(name){if(cache[name])return cache[name].exports;const module={exports:{}};cache[name]=module;vm.runInNewContext(fs.readFileSync(path.join(temporary,name+'.js'),'utf8'),{module,exports:module.exports,require:localRequire,Error,Date,Intl,Number,Object,String,Array,Map,Set,Promise,URLSearchParams,crypto:webcrypto});return module.exports}
 function localRequire(name){if(name==='react')return react;if(name==='react/jsx-runtime')return{jsx,jsxs:jsx,Fragment:'Fragment'};if(name==='lucide-react'||name==='./ui')return new Proxy({},{get:(_,k)=>k});if(name==='./lib/supabase')return{authedApi:api,authedGet:get};if(name==='./lib/aiActionDisplay')return load('lib/aiActionDisplay');if(name==='./lib/shopTime'||name==='./shopTime')return load('lib/shopTime');if(name==='./types'||name==='../types')return load('types');throw Error('Unexpected '+name)}
 const {AiOperationalActions}=load('AiOperationalActions')
 return{render(){index=0;effects=[];tree=AiOperationalActions({shopId:'shop',notify(){}});effects.forEach(fn=>fn());return tree},find(predicate,required=true){function visit(n){if(!n||typeof n!=='object')return null;if(Array.isArray(n)){for(const item of n){const f=visit(item);if(f)return f}return null}if(n.type&&predicate(n))return n;if(n.props)for(const child of Object.values(n.props)){const f=visit(child);if(f)return f}return null}const found=visit(tree);if(required)assert(found,'Expected AI interface control');return found},display:load('lib/aiActionDisplay')}
}
const flush=()=>new Promise(resolve=>setImmediate(resolve)),deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return{promise,resolve}}
const options={allowed:['update_client'],clients:[{id:'client-a',full_name:'Cliente sintético',updated_at:'2026-10-05T12:00:00Z'}],barbers:[],services:[],products:[],timezone:'America/Sao_Paulo',daily_limit:10}
async function open(h){h.render();h.find(n=>n.type==='button'&&Array.isArray(n.props.children)&&n.props.children.includes(' Ações guiadas')).props.onClick();await flush();h.render()}
async function choose(h){h.find(n=>n.type==='select'&&n.props.required).props.onChange({target:{value:'client-a'}});h.render()}
test('guided update is a preview until explicit confirmation and preserves blank contact fields',async()=>{
 const calls=[];const h=harness(async(url,body)=>{calls.push({url,body});return{plan_id:'plan',summary:'Prévia',action:{type:'update_client',values:{full_name:'Cliente revisado'}},expires_at:'2030-01-01T00:00:00Z'}},async()=>options)
 await open(h);await choose(h);h.find(n=>n.type==='input'&&n.props.required).props.onChange({target:{value:'Cliente revisado'}});h.render()
 await h.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});h.render()
 assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/ai-help/prepare');assert.deepEqual(Object.keys(calls[0].body.action.values),['id','expected_updated_at','full_name'])
 assert(h.find(n=>n.type==='button'&&Array.isArray(n.props.children)&&n.props.children.includes('Confirmar e salvar')))
 h.find(n=>n.type==='button'&&Array.isArray(n.props.children)&&n.props.children.includes('Confirmar e salvar')).props.onClick();await flush();h.render()
 assert.equal(calls.filter(x=>x.url==='/api/ai-help/execute').length,1)
})
test('editing while a preview request is pending discards the old proposal',async()=>{
 const pending=deferred();const h=harness(()=>pending.promise,async()=>options)
 await open(h);await choose(h)
 const request=h.find(n=>n.type==='form').props.onSubmit({preventDefault(){}})
 h.find(n=>n.type==='input'&&n.props.required).props.onChange({target:{value:'Outro nome escolhido'}});h.render()
 pending.resolve({plan_id:'old-plan',summary:'Proposta antiga',action:{type:'update_client',values:{full_name:'Nome anterior'}},expires_at:'2030-01-01T00:00:00Z'});await request;h.render()
 assert(!h.find(n=>n.type==='button'&&Array.isArray(n.props.children)&&n.props.children.includes('Confirmar e salvar'),false))
 assert.equal(h.find(n=>n.type==='input'&&n.props.required).props.value,'Outro nome escolhido')
})
test('shop local times convert to exact instants and impossible daylight-saving times are refused',()=>{
 const {aiLocalInstant}=harness(async()=>{},async()=>options).display
 assert.equal(aiLocalInstant('2026-10-05T10:00','America/Sao_Paulo'),'2026-10-05T13:00:00.000Z')
 assert.equal(aiLocalInstant('2026-07-05T10:00','America/New_York'),'2026-07-05T14:00:00.000Z')
 assert.throws(()=>aiLocalInstant('2026-03-08T02:30','America/New_York'),/horário|Horário/)
})
