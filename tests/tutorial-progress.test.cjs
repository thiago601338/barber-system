const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const vm = require('node:vm')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'barber-tour-tests-'))
execFileSync(process.execPath,[path.resolve(__dirname,'../node_modules/typescript/bin/tsc'),'--ignoreConfig','--module','commonjs','--jsx','react-jsx','--target','es2022','--noCheck','--rootDir','src','--outDir',output,'src/tour.ts','src/lib/useTourProgress.ts','src/GuidedTour.tsx'],{cwd:path.resolve(__dirname,'..'),stdio:'pipe'})
process.on('exit',()=>{if(path.dirname(output)!==os.tmpdir()||!path.basename(output).startsWith('barber-tour-tests-'))throw Error('Unexpected output path');fs.rmSync(output,{recursive:true,force:true})})
const flush=()=>new Promise(resolve=>setImmediate(resolve))
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}}
const run=(step='admin:clients:2',updatedAt='2026-10-05T18:30:00.000Z')=>({chapterIds:['clients'],stepKey:step,completedSteps:['admin:clients:0'],skippedModules:[],updatedAt})

function hooks(){
 const slots=[];let index=0,pending=[]
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]))
 const react={
  useState(initial){const i=index++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value}]},
  useRef(initial){return react.useState(()=>({current:initial}))[0]},
  useMemo(fn,deps){const i=index++;if(!slots[i]||!same(slots[i].deps,deps))slots[i]={deps,value:fn()};return slots[i].value},
  useCallback(fn,deps){return react.useMemo(()=>fn,deps)},
  useEffect(fn,deps){const i=index++,previous=slots[i];if(!previous||!same(previous.deps,deps))pending.push(()=>{previous?.cleanup?.();slots[i]={deps,cleanup:fn()}})},
 }
 react.useLayoutEffect=react.useEffect
 return {react,render(fn){index=0;pending=[];const value=fn();pending.forEach(effect=>effect());return value},cleanup(){slots.forEach(slot=>slot?.cleanup?.())}}
}
function storage(blocked=false){const map=new Map([['barber-guided-tour-audio:v1','off']]);return{map,getItem:key=>map.get(key)||null,setItem(key,value){if(blocked)throw Error('Storage disabled');map.set(key,value)},removeItem(key){if(blocked)throw Error('Storage disabled');map.delete(key)}}}
function loadTour(localStorage){const module={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(output,'tour.js'),'utf8'),{module,exports:module.exports,require:name=>{if(name==='./types')return{moduleLabels:{clients:'Clientes',services:'Serviços',settings:'Configurações',dashboard:'Dashboard',ai:'IA'}};throw Error(name)},localStorage,Date,Set,Map,Array,JSON,Number});return module.exports}
function progressHarness({stored=storage(),client}={}){
 const h=hooks(),tour=loadTour(stored),module={exports:{}}
 vm.runInNewContext(fs.readFileSync(path.join(output,'lib/useTourProgress.js'),'utf8'),{module,exports:module.exports,require:name=>name==='react'?h.react:name==='../tour'?tour:name==='./supabase'?{requireSupabase:()=>client}:(()=>{throw Error(name)})(),localStorage:stored,Promise,Set,JSON,Array})
 let context=['user','shop','admin']
 return{tour,stored,render(){return h.render(()=>module.exports.useTourProgress(...context))},change(...next){context=next;return this.render()},cleanup:h.cleanup}
}
function mockClient(response=Promise.resolve({data:null,error:null}),rpc=async()=>({error:null})){
 const chain={select(){return this},eq(){return this},is(){return this},maybeSingle(){return response}}
 return{from:()=>chain,rpc}
}
test('retoma etapa e conclusões válidas do servidor, sem aceitar formato corrompido',async()=>{
 const remote=run(),h=progressHarness({client:mockClient(Promise.resolve({data:{run:remote,finished_chapters:['services',37],updated_at:remote.updatedAt},error:null}))})
 h.render();await flush();const state=h.render();assert.equal(state.run.stepKey,remote.stepKey);assert.deepEqual([...state.finished],['services']);assert.equal(state.loading,false)
 assert.equal(h.tour.validSavedTourRun({...remote,completedSteps:[37]}),null)
 assert.equal(h.tour.validSavedTourRun({...remote,skippedModules:'clients'}),null)
 assert.equal(h.tour.validSavedTourRun({...remote,updatedAt:'wrong'}),null)
 h.cleanup()
})
test('resposta atrasada não troca o passo salvo durante carregamento por etapa antiga',async()=>{
 const response=deferred(),h=progressHarness({client:mockClient(response.promise)})
 h.render();const current=h.render();current.save(run('admin:clients:3'),['services'])
 response.resolve({data:{run:run('admin:clients:0','2026-10-01T00:00:00.000Z'),finished_chapters:[],updated_at:'2026-10-01T00:00:00.000Z'},error:null})
 await flush();const state=h.render();assert.equal(state.run.stepKey,'admin:clients:3');assert.deepEqual([...state.finished],['services']);assert.equal(state.loading,false);h.cleanup()
})
test('armazenamento indisponível não impede treino e preserva conclusões na memória',async()=>{
 const calls=[],h=progressHarness({stored:storage(true),client:mockClient(undefined,async(name,args)=>{calls.push(args);return{error:null}})})
 h.render();await flush();let state=h.render();assert.ok(state.error);assert.doesNotThrow(()=>state.save(null,['clients']));state=h.render();state.save(run());state=h.render()
 assert.deepEqual([...state.finished],['clients']);assert.equal(state.run.stepKey,'admin:clients:2');await flush();assert.equal(calls.length,2);assert.deepEqual([...calls[1].p_finished],['clients']);h.cleanup()
})
test('falha de rede não deixa progresso em carregamento nem rejeição sem tratamento',async()=>{
 const response=deferred(),h=progressHarness({client:mockClient(response.promise,async()=>{throw Error('network')})})
 h.render();response.reject(Error('network'));await flush();let state=h.render();assert.equal(state.loading,false);assert.ok(state.error);state.save(run());await flush();state=h.render();assert.match(state.error,/sincronização/);assert.equal(state.run.stepKey,'admin:clients:2');h.cleanup()
})
test('fila de salvamento de contexto anterior não grava no usuário ou loja seguinte',async()=>{
 const gate=deferred(),calls=[];let count=0
 const h=progressHarness({client:mockClient(undefined,async(name,args)=>{calls.push(args);if(++count===1)await gate.promise;return{error:null}})})
 h.render();await flush();let state=h.render();state.save(run('admin:clients:1'));await flush();state=h.render();state.save(run('admin:clients:2'))
 h.change('other-user','other-shop','barber');gate.resolve();await flush();await flush();assert.equal(calls.length,1);assert.equal(h.render().run,null);h.cleanup()
})
test('catálogo respeita permissões, contexto master e exige todos exercícios únicos',()=>{
 const tour=loadTour(storage()),admin=tour.getTourChapters('admin',['clients','services'],true),barber=tour.getTourChapters('barber',['clients'],true),master=tour.getTourChapters('master',['master','ai'],false)
 assert.deepEqual([...barber.map(c=>c.id)],['clients']);assert.ok(!tour.getTourChapters('master',['clients'],true).some(c=>c.id==='master'))
 assert.ok(master.some(c=>c.id==='master'));assert.ok(master.some(c=>c.id==='ai'))
 for(const chapters of [admin,barber,master]){const ids=chapters.flatMap(c=>c.steps.map(s=>s.id));assert.equal(new Set(ids).size,ids.length);for(const chapter of chapters)assert.ok(chapter.steps.some(s=>['quiz','valid_form'].includes(s.practice?.completeOn)))}
 const chapter=admin.find(c=>c.id==='clients');const done=chapter.steps.slice(0,-1).map(s=>s.id);assert.equal(chapter.steps.every(s=>done.includes(s.id)),false);done.push(chapter.steps.at(-1).id);assert.equal(chapter.steps.every(s=>done.includes(s.id)),true)
})

// Minimal DOM doubles expose actual component validation and capture listeners;
// they do not pretend to verify pixel layout or native browser validation.
function guideHarness({completeOn='valid_form',missing=false,mobile=false}={}){
 const h=hooks(),listeners=new Map(),mutations=[],children=[];const observed=[]
 class Element{constructor(opts={}){Object.assign(this,{style:{},disabled:false,value:'',isConnected:true,textContent:'',rect:{top:100,left:40,width:350,height:120},...opts})}getBoundingClientRect(){return this.rect}getClientRects(){return[this.rect]}addEventListener(type,fn){this.events??=new Map();this.events.set(type,fn)}removeEventListener(type){this.events?.delete(type)}querySelector(){return null}querySelectorAll(){return[]}closest(selector){if(selector==='form')return this.form||null;if(selector.includes('.content'))return content;if(selector==='.modal')return modal;if(selector==='button')return this instanceof Button?this:null;return null}matches(selector){return selector===this.selector}contains(child){return this===child||this.children?.includes(child)||false}scrollIntoView(){this.scrolled=true}focus(){document.activeElement=this}getAttribute(key){return this.attrs?.[key]||null}click(){this.clicked=true}}
 class Input extends Element{closest(selector){return selector.startsWith('input, textarea')?this:super.closest(selector)}}
 class Button extends Element{}
 class Form extends Element{reportValidity(){return this.valid!==false}querySelector(selector){return selector==='button[type="submit"]'?submit:null}querySelectorAll(selector){return selector==='input[type="time"]'?[start,end]:[name,start,end]}contains(child){return children.includes(child)}}
 const content=new Element(),modal=new Element(),name=new Input({value:'Cliente teste'}),start=new Input({value:'09:00'}),end=new Input({value:'18:00'}),submit=new Button(),file=new Input({disabled:false}),form=new Form({selector:'#form'}),target=new Element({selector:'#target'})
 children.push(name,start,end,submit);children.forEach(el=>el.form=form)
 const document={activeElement:null,body:content,querySelector(selector){if(selector==='#root'||selector==='.main-area')return content;if(selector==='#form')return missing?null:form;if(selector==='#target')return missing?null:target;return null},querySelectorAll(selector){return selector.includes('[type="file"]')?[file]:[]},addEventListener(type,fn){listeners.set(type,fn)},removeEventListener(type,fn){if(listeners.get(type)===fn)listeners.delete(type)}}
 const window={innerWidth:mobile?390:1366,innerHeight:mobile?736:900,setTimeout(){return 1},clearTimeout(){},addEventListener(type,fn){listeners.set(`window:${type}`,fn)},removeEventListener(type){listeners.delete(`window:${type}`)}}
 const module={exports:{}},jsx=(type,props)=>({type,props:props||{}}),reactModules={react:h.react,'react/jsx-runtime':{jsx,jsxs:jsx},'lucide-react':new Proxy({},{get:(_,key)=>key}),'./lib/supabase':{requireSupabase(){throw Error('Provider calls must not run')}}}
 vm.runInNewContext(fs.readFileSync(path.join(output,'GuidedTour.js'),'utf8'),{module,exports:module.exports,require:key=>reactModules[key],document,window,Element,HTMLElement:Element,HTMLInputElement:Input,HTMLFormElement:Form,HTMLButtonElement:Button,MutationObserver:class{constructor(fn){mutations.push(fn)}observe(){}disconnect(){}},ResizeObserver:class{observe(el){observed.push(el)}unobserve(){}disconnect(){}},getComputedStyle:()=>({display:'block',visibility:'visible'}),requestAnimationFrame:()=>1,cancelAnimationFrame(){},localStorage:storage(),Set,Map,Promise,URL,Error,Number,Math})
 const step={module:'clients',kind:'content',selector:completeOn==='valid_form'?'#form':'#target',title:'Treino',description:'Descrição',practice:{instruction:'Pratique',completeOn,...(completeOn==='valid_form'?{openedSelector:'#form'}:{}),...(completeOn==='quiz'?{quiz:{question:'Grava dados?',choices:['Sim','Não'],correct:1,explanation:'Nenhum dado gravado'}}:{})}}
 const moves=[];let tree
 const visit=(node,predicate)=>{if(!node||typeof node!=='object')return null;if(Array.isArray(node)){for(const child of node){const match=visit(child,predicate);if(match)return match}return null}if(predicate(node))return node;for(const value of Object.values(node.props||{})){const match=visit(value,predicate);if(match)return match}return null}
 return{form,name,start,end,submit,file,target,moves,render(){tree=h.render(()=>module.exports.GuidedTour({steps:[step],index:0,onNext:completed=>moves.push(completed),onBack(){},onClose(){}}));return tree},find(predicate){const node=visit(tree,predicate);assert.ok(node,'Expected guide control');return node},button(label){return this.find(n=>n.type==='button'&&n.props.children===label)},next(){return this.find(n=>n.type==='button'&&n.props.className==='guided-tour-next')},status(){return this.find(n=>n.props?.role==='status').props.children},event(type,target){let prevented=false,stopped=false;listeners.get(type)?.({target,preventDefault(){prevented=true},stopImmediatePropagation(){stopped=true}});return{prevented,stopped}},key(key,target=name){let prevented=false;listeners.get('window:keydown')?.({key,target,preventDefault(){prevented=true}});return prevented},mutate(){mutations.forEach(fn=>fn())},makeButton(opts){return new Button(opts)},cleanup:h.cleanup}
}
test('formulário exige alteração, obrigatórios, horário válido e cadastro pronto antes de concluir',()=>{
 const h=guideHarness();h.render();h.render();h.button('Validar treino').props.onClick();h.render();assert.match(h.status(),/Altere pelo menos/);assert.equal(h.next().props.disabled,true)
 h.event('input',h.name);h.form.valid=false;h.button('Validar treino').props.onClick();h.render();assert.match(h.status(),/campos obrigatórios/)
 h.form.valid=true;h.end.value='08:00';h.button('Validar treino').props.onClick();h.render();assert.match(h.status(),/posterior/)
 h.end.value='18:00';h.submit.disabled=true;h.button('Validar treino').props.onClick();h.render();assert.match(h.status(),/ainda não está pronto/)
 h.submit.disabled=false;h.button('Validar treino').props.onClick();h.render();assert.match(h.status(),/Treino validado/)
 h.name.value='';h.form.valid=false;h.event('input',h.name);h.render();assert.ok(h.button('Validar treino'));assert.equal(h.next().props.disabled,true);h.cleanup()
})
test('submit, confirmação IA, entrega e permissões ficam interceptados; upload é restaurado ao sair',()=>{
 const h=guideHarness({completeOn:'click'});h.render();h.render();assert.equal(h.file.disabled,true)
 assert.deepEqual(h.event('submit',h.form),{prevented:true,stopped:true})
 for(const label of ['Confirmar ação','Entregar','Liberar Agenda']){const button=h.makeButton({textContent:label,attrs:{'aria-label':label}});assert.deepEqual(h.event('click',button),{prevented:true,stopped:true})}
 const icon=h.makeButton({matches:selector=>selector.includes('.permission-toggle')});assert.deepEqual(h.event('click',icon),{prevented:true,stopped:true})
 h.cleanup();assert.equal(h.file.disabled,false)
})
test('quiz errado não libera conclusão; resposta certa, recolher e expandir preservam exercício',()=>{
 const h=guideHarness({completeOn:'quiz'});h.render();h.render();assert.equal(h.next().props.disabled,true)
 h.button('Sim').props.onClick();h.render();assert.match(h.status(),/Ainda não/);assert.equal(h.next().props.disabled,true)
 h.button('Não').props.onClick();h.render();assert.equal(h.next().props.disabled,false)
 h.find(n=>n.props?.['aria-label']==='Recolher instruções do guia').props.onClick();h.render();assert.ok(h.find(n=>n.props?.className?.includes('is-minimized')))
 h.find(n=>n.props?.['aria-label']==='Mostrar instruções do guia').props.onClick();h.render();assert.equal(h.next().props.disabled,false);h.next().props.onClick();assert.deepEqual(h.moves,[true]);h.cleanup()
})
test('etapa indisponível é pulada sem conclusão; setas no campo preservam edição',()=>{
 const missing=guideHarness({missing:true,completeOn:'click'});missing.render();missing.render();assert.equal(missing.next().props.disabled,false);missing.next().props.onClick();assert.deepEqual(missing.moves,[false]);missing.cleanup()
 const form=guideHarness();form.render();form.render();assert.equal(form.key('ArrowRight'),false);assert.deepEqual(form.moves,[]);form.cleanup()
})
test('formulário móvel aparece recolhido e pode expandir sem perder etapa',()=>{
 const h=guideHarness({mobile:true});h.render();h.render();assert.ok(h.find(n=>n.props?.className?.includes('is-minimized')));assert.ok(h.form.scrolled);h.find(n=>n.props?.['aria-label']==='Mostrar instruções do guia').props.onClick();h.render();assert.equal(h.next().props.disabled,true);h.cleanup()
})
