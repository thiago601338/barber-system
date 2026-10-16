const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const vm = require('node:vm')
const os = require('node:os')
const { execFileSync } = require('node:child_process')
const path = require('node:path')
const compiledDir = fs.mkdtempSync(path.join(os.tmpdir(), 'barber-frontend-tests-'))
execFileSync(process.execPath, [path.resolve(__dirname, '../node_modules/typescript/bin/tsc'), '--ignoreConfig', '--module', 'commonjs', '--jsx', 'react-jsx', '--target', 'es2022', '--noCheck', '--rootDir', 'src', '--outDir', compiledDir, 'src/pages/ClientsPage.tsx', 'src/pages/SubscriptionsPage.tsx', 'src/pages/SchedulingPage.tsx', 'src/pages/MasterPage.tsx', 'src/pages/ClientPage.tsx','src/pages/PublicPage.tsx','src/pages/ClientProfilePanel.tsx','src/pages/ClientLoyaltyPanel.tsx'], { cwd: path.resolve(__dirname, '..'), stdio: 'pipe' })
process.on('exit', () => {
  const resolved = path.resolve(compiledDir)
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('barber-frontend-tests-')) throw new Error('Unexpected test output directory')
  fs.rmSync(resolved, { recursive: true, force: true })
})

// Drive the real event handlers with deterministic hook state and mocked persistence.
// These tests never connect to Supabase or payment providers.
function harness(file, exported, props, mocks = {}) {
  const slots = []
  let index = 0, pending = [], tree
  const same = (a, b) => a && b && a.length === b.length && a.every((item, i) => Object.is(item, b[i]))
  const react = {
    useState(initial) {
      const position = index++
      if (!(position in slots)) slots[position] = typeof initial === 'function' ? initial() : initial
      return [slots[position], next => { slots[position] = typeof next === 'function' ? next(slots[position]) : next }]
    },
    useRef(initial) { return react.useState(() => ({ current: initial }))[0] },
    useMemo(fn, deps) {
      const position = index++
      if (!slots[position] || !same(slots[position].deps, deps)) slots[position] = { deps, value: fn() }
      return slots[position].value
    },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps) },
    useEffect(fn, deps) {
      const position = index++
      const previous = slots[position]
      if (!previous || !same(previous.deps, deps)) pending.push(() => {
        previous?.cleanup?.()
        slots[position] = { deps, cleanup: fn() }
      })
    },
  }
  const jsx = (type, properties) => ({ type, props: properties || {} })
  const modules = {
    react,
    'react-dom': { createPortal: node => node },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'lucide-react': new Proxy({}, { get: (_, key) => String(key) }),
    '../ui': new Proxy({}, { get: (_, key) => String(key) }),
    '../lib/useRows': { useRows: table => ({ rows: mocks.rows?.[table] || [], loading: mocks.rowState?.[table]?.loading || false, error: mocks.rowState?.[table]?.error || null, refresh: async () => {} }), createRow: mocks.createRow, updateRow: mocks.updateRow },
    '../lib/supabase': { requireSupabase: () => mocks.client, authedApi: mocks.api, authedGet: mocks.get },
    '../lib/productImages': { productImageUrl: () => null },
    '../shopBrand': { readBrandTheme: () => null, brandStyle: () => ({}), safeInstagramUrl: () => null },
    '../SubscriptionHealthPanel': { SubscriptionHealthPanel: 'SubscriptionHealthPanel' },
    '../AiUsageSettings': { AiUsageSettings: 'AiUsageSettings' },
    '../lib/useTourProgress': { useTourProgress: () => mocks.progress||({ run:null, finished:[], loading:false, error:null, save() {} }) },
    '../TeamAvatar': { TeamAvatar: 'TeamAvatar' },
    './BookingEnhancements': {problemMessage:p=>p?.message||String(p),useBookingEligibility:()=>mocks.eligibility||{loading:false,error:null,value:{subscriptions:[]}},BookingRules:'BookingRules',EligibilityChoice:'EligibilityChoice',WaitlistJoin:'WaitlistJoin'},
    './AppointmentActions': { AppointmentActions: 'AppointmentActions' },
    './ScheduleSettings': { ScheduleSettings: 'ScheduleSettings' },
    './WaitlistPanel': { WaitlistPanel: 'WaitlistPanel' },
    './ClientRecordsPanel': { ClientRecordsPanel: 'ClientRecordsPanel', ClientConsentPanel: 'ClientConsentPanel' },
    './ClientInstallPanel': { ClientInstallPanel: 'ClientInstallPanel' },
    './ClientLoyaltyPanel': { ClientLoyaltyPanel: 'ClientLoyaltyPanel' },
    './ClientProfilePanel': { ClientProfilePanel: 'ClientProfilePanel' },
    './MasterDashboard': { MasterDashboard: 'MasterDashboard' },
    '../LegacyCashbarber': { LegacyCashbarber: 'LegacyCashbarber' },
    './TutorialPage': { TutorialPage: 'TutorialPage' },
    '../GuidedTour': { GuidedTour: 'GuidedTour' },
    '../tour': { getTourChapters: () => mocks.chapters||[] },
  }
  function localRequire(name) {
    if (modules[name]) return modules[name]
    if (name.endsWith('.css')) return {}
    if (name === './BookingEnhancements') return load(path.resolve(__dirname, '../src/pages/BookingEnhancements.tsx'))
    if (name === '../types' || name.startsWith('../lib/')) return load(path.resolve(__dirname, '../src/pages', name + '.ts'))
    throw new Error(`Unexpected import ${name}`)
  }
  function load(filename, expose = '') {
    const relative = path.relative(path.resolve(__dirname, '../src'), filename).replace(/\.tsx?$/, '.js')
    const compiled = fs.readFileSync(path.join(compiledDir, relative), 'utf8')
    const module = { exports: {} }
    vm.runInNewContext(compiled + expose, { module, exports: module.exports, require: localRequire, Error, Date, Intl, Number, Object, String, Array, Map, Set, Promise, URL, URLSearchParams, crypto:require('node:crypto').webcrypto,navigator:{clipboard:{writeText:mocks.clipboard||(async()=>{})}},window: { location: { pathname: '/b/test/agendar', search: mocks.search||'', origin: 'https://example.test',href:`https://example.test/b/test/agendar${mocks.search||''}` },history:{replaceState:mocks.replaceState||(()=>{})} } }, { filename })
    return module.exports
  }
  const exports = load(path.resolve(__dirname, '../src/pages', file), exported.startsWith('__') ? `\nexports.${exported} = ${exported.slice(2)};` : '')
  return {
    render() { index = 0; pending = []; tree = exports[exported](props); pending.forEach(fn => fn()); return tree },
    find(predicate) {
      const visit = node => {
        if (!node || typeof node !== 'object') return null
        if (Array.isArray(node)) { for (const child of node) { const match = visit(child); if (match) return match }; return null }
        if (node.type && predicate(node)) return node
        if (typeof node.type === 'function' && ['ClientModal','EligibilityChoice'].includes(node.type.name)) return visit(node.type(node.props))
        if (node.props) for (const value of Object.values(node.props)) { const match = visit(value); if (match) return match }
        return null
      }
      const found = visit(tree)
      assert.ok(found, 'Expected interface element was rendered')
      return found
    },
  }
}
const event = { preventDefault() {} }
const flush = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const base = { identity: { shop: { id: 'shop', slug: 'test', timezone: 'America/Sao_Paulo' }, membership: { id: 'barber' }, user: { id: 'admin' } }, role: 'admin', notify() {} }


const customer={identity:{shop:{id:'shop',name:'Marca Teste',slug:'test',timezone:'America/Sao_Paulo'},clientId:'client',user:{id:'client-user',email:'client@example.test',user_metadata:{full_name:'Cliente'}}},onSignOut(){}}
const active={id:'contract',client_id:'client',plan_id:'mutable-plan',status:'active',provider_subscription_id:'preapproval',current_period_start:'2026-01-01T00:00:00Z',current_period_end:'2099-01-01T00:00:00Z',contract_review_required:false,contract_snapshot:{plan_name:'Contrato Original',price_cents:8900,visits_per_cycle:5,frequency_months:1,services:[{id:'service',name:'Corte contratado'}]}}
test('área cliente exibe saldo e nome do contrato original, sem usar preço ou usos mutáveis do plano',()=>{
 const h=harness('ClientPage.tsx','ClientPage',customer,{rows:{subscriptions:[active],subscription_plans:[{id:'mutable-plan',name:'Plano alterado',visits_per_cycle:99}],appointments:[{id:'appointment',client_id:'client',starts_at:'2030-01-01T10:00:00Z'}],subscription_usages:[{id:'usage',subscription_id:'contract',appointment_id:'appointment',status:'reserved'}]}})
 h.render();assert.equal(h.find(n=>n.type==='Stat'&&n.props.label==='Usos restantes').props.value,4);h.find(n=>n.type==='h3'&&n.props.children==='Contrato Original')
})
test('consultar assinatura usa GET; cancelamento só ocorre após revisão e confirmação explícita',async()=>{
 const calls=[];const h=harness('ClientPage.tsx','ClientPage',customer,{rows:{subscriptions:[active]},get:async url=>{calls.push(['GET',url]);return{status:'active',checkout_url:'https://checkout.mercadopago.com.br/link'}},api:async(url,body)=>{calls.push(['POST',url,body]);return{status:'cancelled'}}})
 h.render();h.find(n=>n.type==='button'&&n.props.children==='Ver contrato e cobrança').props.onClick();h.render();h.find(n=>n.type==='button'&&n.props.children==='Consultar cobrança no provedor').props.onClick();await flush();h.render();assert.equal(calls[0][0],'GET');assert.match(calls[0][1],/subscription-status\?subscription_id=contract/)
 h.find(n=>n.type==='button'&&n.props.children==='Revisar cancelamento').props.onClick();h.render();assert.equal(calls.length,1);h.find(n=>n.type==='PrimaryButton').props.onClick();await flush();h.render();assert.deepEqual(JSON.parse(JSON.stringify(calls[1])),['POST','/api/mercadopago/subscription-cancel',{subscription_id:'contract'}])
})
test('tutorial do cliente só marca capítulo concluído quando todas as práticas foram validadas',()=>{
 const saves=[],steps=[{id:'first',module:'client',selector:'[data-tour-client="summary"]'},{id:'second',module:'client',selector:'[data-tour-client="history"]'}];const h=harness('ClientPage.tsx','ClientPage',customer,{progress:{run:null,finished:[],save:(...args)=>saves.push(args)},chapters:[{id:'client',steps}]})
 h.render();h.find(n=>n.type==='button'&&Array.isArray(n.props.children)&&n.props.children.some(v=>v?.type==='span'&&v.props.children==='Passo a passo')).props.onClick();h.render();h.find(n=>n.type==='TutorialPage').props.onStart(['client']);h.render();h.find(n=>n.type==='GuidedTour').props.onNext(false);h.render();h.find(n=>n.props['data-tour-client']==='history');h.find(n=>n.type==='GuidedTour').props.onNext(true);h.render();assert.deepEqual(JSON.parse(JSON.stringify(saves.at(-1))),[null,[]])
})
test('perfil pessoal conserva formulário após falha e envia somente nome/telefone para RPC própria',async()=>{
 const calls=[];let attempt=0;const h=harness('ClientProfilePanel.tsx','ClientProfilePanel',{shopId:'shop',clientId:'client',email:'login@example.test'},{rows:{clients:[{id:'client',full_name:'Original',phone:'11999999999'}]},client:{rpc:async(name,params)=>{calls.push([name,params]);return{error:++attempt===1?{message:'falha de conexão'}:null}}}})
 h.render();h.find(n=>n.type==='button'&&n.props.children==='Editar meus dados').props.onClick();h.render();h.find(n=>n.type==='input'&&n.props.minLength===2).props.onChange({target:{value:'Nome corrigido'}});h.render();await h.find(n=>n.type==='form').props.onSubmit(event);h.render();assert.equal(h.find(n=>n.type==='input'&&n.props.minLength===2).props.value,'Nome corrigido');await h.find(n=>n.type==='form').props.onSubmit(event);h.render();assert.equal(calls.length,2);assert.deepEqual(Object.keys(calls[0][1]).sort(),['p_client','p_full_name','p_phone','p_shop']);assert.equal(calls[0][0],'update_client_profile')
})
function loyalty(balance=100){return {enabled:true,balance_points:balance,earned_points:100,tier:null,next_tier:null,referral_code:'CODE',rewards:[{id:'reward',name:'Recompensa',description:'Benefício',points_cost:50,valid_days:30}],ledger:[],redemptions:[],referral_count:0}}
test('resgate repete a mesma chave após resposta incerta, e saldo negativo não permite resgate',async()=>{
 const keys=[];let attempts=0;const summary=loyalty();const h=harness('ClientLoyaltyPanel.tsx','ClientLoyaltyPanel',{shopId:'shop',clientId:'client',timezone:'America/Sao_Paulo',slug:'test'},{client:{rpc:async(name,params)=>name==='loyalty_summary'?{data:summary}:{error:++attempts===1?{message:'Resposta incerta'}:null,data:(keys.push(params.p_request),'redemption')}}})
 h.render();await flush();h.render();h.find(n=>n.type==='button'&&n.props.children==='Revisar resgate').props.onClick();h.render();h.find(n=>n.type==='PrimaryButton').props.onClick();await flush();h.render();h.find(n=>n.type==='PrimaryButton').props.onClick();await flush();h.render();assert.equal(keys.length,2);assert.equal(keys[0],keys[1])
 summary.balance_points=-50;const negative=harness('ClientLoyaltyPanel.tsx','ClientLoyaltyPanel',{shopId:'shop',clientId:'client',timezone:'UTC',slug:'test'},{client:{rpc:async()=>({data:summary})}});negative.render();await flush();negative.render();assert.equal(negative.find(n=>n.type==='button'&&n.props.children==='Pontos insuficientes').props.disabled,true)
})
test('link de indicação abre benefícios e preenche código, mantendo confirmação do cliente',async()=>{
 let link;const h=harness('ClientLoyaltyPanel.tsx','ClientLoyaltyPanel',{shopId:'shop',clientId:'client',timezone:'UTC',slug:'test'},{search:'?indicacao=code',clipboard:async value=>{link=value},client:{rpc:async()=>({data:loyalty()})}})
 h.render();await flush();h.render();assert.equal(h.find(n=>n.type==='input').props.value,'CODE');h.find(n=>n.type==='button'&&n.props.children==='Copiar link').props.onClick();await flush();const parsed=new URL(link);assert.equal(parsed.searchParams.get('shop'),'test');assert.equal(parsed.searchParams.get('view'),'loyalty');assert.equal(parsed.searchParams.get('indicacao'),'CODE')
})
test('campanha pública preenche benefício sem substituir cupom explícito e mantém atribuição no retorno do login',async()=>{
 const h=harness('PublicPage.tsx','__PublicBooking',{shop:customer.identity.shop,user:null,services:[{id:'service',name:'Corte',price_cents:5000,duration_minutes:30}],barbers:[{id:'barber'}],error:null},{search:'?campaign=campanha&ref=CUPOM-EXPLICITO',client:{rpc:async()=>({data:{code:'campanha',name:'Campanha pública',offer_code:'OUTRO-CUPOM'}})}})
 h.render();await flush();h.render();h.find(n=>n.type==='h2'&&n.props.children==='Campanha pública');const login=h.find(n=>n.type==='a'&&n.props.children==='Entrar ou criar conta');const query=new URL(login.props.href,'https://example.test').searchParams;const target=new URL(query.get('return'),'https://example.test');assert.equal(target.searchParams.get('campaign'),'campanha');assert.equal(target.searchParams.get('ref'),'CUPOM-EXPLICITO')
})
test('campanha inexistente bloqueia reserva até remoção, sem criar cliente ou agendamento',async()=>{
 let calls=0;const h=harness('PublicPage.tsx','__PublicBooking',{shop:customer.identity.shop,user:null,services:[{id:'service',name:'Corte'}],barbers:[{id:'barber'}],error:null},{search:'?campaign=indisponivel',client:{rpc:async()=>{calls++;return{data:null}}}})
 h.render();await flush();h.render();h.find(n=>n.type==='Notice'&&String(n.props.text).includes('não está mais disponível'));h.find(n=>n.type==='button'&&n.props.children==='Remover campanha').props.onClick();h.render();assert.equal(calls,1);assert.equal(Boolean(h.find(n=>n.type==='form').props.children[0]),false)
})

test('reserva da campanha envia todos os parâmetros juntos ao wrapper atômico',async()=>{
 const calls=[];const chosen='2099-01-01T12:00:00Z',client={from:()=>{const b={select:()=>b,eq:()=>b,maybeSingle:async()=>({data:{id:'client',full_name:'Cliente'}})};return b},rpc:async(name,params)=>{calls.push([name,params]);return name==='public_campaign_lookup'?{data:{code:'campanha',name:'Campanha',offer_code:null}}:name==='available_slots'?{data:[{starts_at:chosen,ends_at:'2099-01-01T12:30:00Z'}]}:name==='book_attributed_appointment'?{data:{appointment_id:'appointment'}}:{data:null}}}
 const h=harness('PublicPage.tsx','__PublicBooking',{shop:customer.identity.shop,user:customer.identity.user,services:[{id:'service',name:'Corte',price_cents:5000,duration_minutes:30}],barbers:[{id:'barber'}],error:null},{search:'?campaign=campanha',client})
 h.render();await flush();h.render();h.find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});h.render();h.find(n=>n.type==='input'&&n.props.type==='radio').props.onChange();h.render();await flush();h.render();h.find(n=>n.type==='button'&&n.props.className==='slot ').props.onClick();h.render();await h.find(n=>n.type==='form').props.onSubmit(event);h.render();const saved=calls.filter(c=>c[0].startsWith('book_'));assert.equal(saved.length,1);assert.equal(saved[0][0],'book_attributed_appointment');assert.equal(saved[0][1].p_campaign_code,'campanha');assert.equal(saved[0][1].p_client_id,'client');assert.equal(saved[0][1].p_coupon_code,null);h.find(n=>n.type==='h1'&&n.props.children==='Agendamento registrado')
})
