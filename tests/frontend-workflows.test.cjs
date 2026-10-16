const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const vm = require('node:vm')
const os = require('node:os')
const { execFileSync } = require('node:child_process')
const path = require('node:path')
const compiledDir = fs.mkdtempSync(path.join(os.tmpdir(), 'barber-frontend-tests-'))
execFileSync(process.execPath, [path.resolve(__dirname, '../node_modules/typescript/bin/tsc'), '--ignoreConfig', '--module', 'commonjs', '--jsx', 'react-jsx', '--target', 'es2022', '--noCheck', '--rootDir', 'src', '--outDir', compiledDir, 'src/pages/ClientsPage.tsx', 'src/pages/SubscriptionsPage.tsx', 'src/pages/SchedulingPage.tsx', 'src/pages/MasterPage.tsx', 'src/pages/ClientPage.tsx'], { cwd: path.resolve(__dirname, '..'), stdio: 'pipe' })
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
    '../TutorialAudioAdmin': { TutorialAudioAdmin: 'TutorialAudioAdmin' },
    '../MasterBlogPanel': { MasterBlogPanel: 'MasterBlogPanel' },
    '../MasterLeadsPanel': { MasterLeadsPanel: 'MasterLeadsPanel' },
    '../lib/useTourProgress': { useTourProgress: () => ({ run:null, finished:[], loading:false, error:null, save() {} }) },
    './AppointmentActions': { AppointmentActions: 'AppointmentActions' },
    './ScheduleSettings': { ScheduleSettings: 'ScheduleSettings' },
    './WaitlistPanel': { WaitlistPanel: 'WaitlistPanel' },
    './ClientRecordsPanel': { ClientRecordsPanel: 'ClientRecordsPanel', ClientConsentPanel: 'ClientConsentPanel' },
    './ClientInstallPanel': { ClientInstallPanel: 'ClientInstallPanel' },
    './ClientLoyaltyPanel': { ClientLoyaltyPanel: 'ClientLoyaltyPanel' },
    './ClientProfilePanel': { ClientProfilePanel: 'ClientProfilePanel' },
    './CrmPanel': { CrmPanel: 'CrmPanel' },
    './LoyaltyPanel': { LoyaltyPanel: 'LoyaltyPanel' },
    './MasterDashboard': { MasterDashboard: 'MasterDashboard' },
    '../LegacyCashbarber': { LegacyCashbarber: 'LegacyCashbarber' },
    './TutorialPage': { TutorialPage: 'TutorialPage' },
    '../GuidedTour': { GuidedTour: 'GuidedTour' },
    '../tour': { getTourChapters: () => [] },
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
    vm.runInNewContext(compiled + expose, { module, exports: module.exports, require: localRequire, Error, Date, Intl, Number, Object, String, Array, Map, Set, Promise, URL, URLSearchParams, window: { location: { pathname: '/b/test/agendar', search: '', origin: 'https://example.test' } } }, { filename })
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

test('novo cliente com falha de vínculo mantém ID e retry atualiza em vez de duplicar', async () => {
  let inserted = 0, updated = 0, assignments = 0
  const h = harness('ClientsPage.tsx', '__ClientDirectory', base, {
    createRow: async () => { inserted++; return { id: 'saved-client' } },
    updateRow: async () => { updated++; return { id: 'saved-client' } },
    client: { from: () => ({ upsert: async () => ({ error: ++assignments === 1 ? { message: 'temporary error' } : null }) }) },
  })
  h.render(); h.find(n => n.props['data-tour-action'] === 'client-create').props.onClick(); h.render()
  h.find(n => n.type === 'input' && n.props.required).props.onChange({ target: { value: 'Cliente teste' } }); h.render()
  h.find(n => n.type === 'select').props.onChange({ target: { value: 'barber' } }); h.render()
  await h.find(n => n.type === 'form').props.onSubmit(event); h.render()
  assert.equal(h.find(n => n.type === 'Modal').props.title, 'Editar cliente')
  await h.find(n => n.type === 'form').props.onSubmit(event)
  assert.equal(inserted, 1); assert.equal(updated, 1); assert.equal(assignments, 2)
})

test('plano novo com falha de cobertura é reaproveitado e só ativa depois de salvar cobertura', async () => {
  let inserted = 0, covers = 0
  const writes = []
  const h = harness('SubscriptionsPage.tsx', 'SubscriptionsPage', base, {
    rows: { services: [{ id: 'service', active: true }] },
    createRow: async (_, values) => { inserted++; writes.push(values.active); return { id: 'plan', active: false } },
    updateRow: async (_, id, values) => { writes.push(values.active); return { id, active: values.active ?? false } },
    client: { rpc: async name => name === 'subscription_overview' ? { data: null } : { error: ++covers === 1 ? { message: 'coverage failed' } : null } },
  })
  h.render(); h.find(n => n.props['data-tour-action'] === 'subscription-create-plan').props.onClick(); h.render()
  h.find(n => n.type === 'input' && n.props.type === 'checkbox' && !n.props.checked).props.onChange({ target: { checked: true } }); h.render()
  await h.find(n => n.type === 'form').props.onSubmit(event); h.render()
  assert.equal(h.find(n => n.type === 'Modal').props.title, 'Editar plano')
  await h.find(n => n.type === 'form').props.onSubmit(event)
  assert.equal(inserted, 1); assert.equal(covers, 2)
  assert.deepEqual(writes, [false, undefined, true])
})

test('trocar cliente no agendamento remove assinatura do cliente anterior', async () => {
  const calls = []
  const props = { shopId: 'shop', timezone: 'America/Sao_Paulo', initialDay: '2026-10-05', barbers: [{ id: 'barber' }], clients: [{ id: 'a' }, { id: 'b' }], services: [{ id: 'service', price_cents: 2000 }], subscriptions: [{ id: 'plan-a', client_id: 'a', status: 'active' }], onClose() {}, onSaved() {} }
  const h = harness('SchedulingPage.tsx', 'BookingModal', props, { client: { rpc: async (name, values) => { calls.push({ name, values }); return { data: name === 'available_slots' ? [{ starts_at: '2026-10-05T12:00:00Z' }] : name==='booking_subscription_eligibility' ? {requires_subscription:false,eligible:true,subscriptions:values.p_client_id==='a'?[{id:'plan-a',plan_name:'Plano A',remaining_visits:1}]:[],reason:null} : null } } } })
  h.render()
  h.find(n => n.type === 'select' && n.props.required && n.props.children[1]?.length === 2).props.onChange({ target: { value: 'a' } }); h.render()
  h.find(n => n.type === 'select' && n.props.required && n.props.children[1]?.length === 1).props.onChange({ target: { value: 'barber' } }); h.render()
  h.find(n => n.type === 'input' && n.props.type === 'checkbox').props.onChange({ target: { checked: true } }); h.render(); await flush(); h.render()
  h.find(n => n.type === 'button' && n.props.className?.startsWith('slot ')).props.onClick(); h.render(); await flush(); h.render()
  h.find(n => n.type === 'select' && !n.props.required).props.onChange({ target: { value: 'plan-a' } }); h.render()
  h.find(n => n.type === 'select' && n.props.required && n.props.children[1]?.length === 2).props.onChange({ target: { value: 'b' } }); h.render(); await flush(); h.render()
  h.find(n => n.type === 'button' && n.props.className?.startsWith('slot ')).props.onClick(); h.render()
  await h.find(n => n.type === 'form').props.onSubmit(event)
  const booking = calls.find(call => call.name === 'book_appointment').values
  assert.equal(booking.p_client_id, 'b'); assert.equal(booking.p_subscription_id, null)
})

test('limpar serviços durante consulta pendente encerra carregamento e ignora resposta antiga', async () => {
  const request = deferred()
  const props = { shopId: 'shop', timezone: 'America/Sao_Paulo', initialDay: '2026-10-05', barbers: [{ id: 'barber' }], clients: [], services: [{ id: 'service' }], subscriptions: [], onClose() {}, onSaved() {} }
  const h = harness('SchedulingPage.tsx', 'BookingModal', props, { client: { rpc: () => request.promise } })
  h.render(); h.find(n => n.type === 'select' && n.props.required && n.props.children[1]?.length === 1).props.onChange({ target: { value: 'barber' } }); h.render()
  h.find(n => n.type === 'input' && n.props.type === 'checkbox').props.onChange({ target: { checked: true } }); h.render(); h.render()
  h.find(n => n.type === 'input' && n.props.type === 'checkbox').props.onChange({ target: { checked: false } }); h.render(); h.render()
  const unavailable = h.find(n => n.type === 'span' && n.props.className === 'muted')
  assert.equal(unavailable.props.children, 'Escolha profissional, serviço e data.')
  request.resolve({ data: [{ starts_at: '2026-10-05T12:00:00Z' }] }); await flush(); h.render()
  assert.equal(h.find(n => n.type === 'span' && n.props.className === 'muted').props.children, unavailable.props.children)
})

test('resposta antiga da agenda não substitui dia novo já carregado', async () => {
  const first = deferred(), second = deferred(); let requests = 0
  const client = { from: () => {
    const chain = { select: () => chain, eq: () => chain, gte: () => chain, lt: () => chain, order: () => chain, limit: () => (++requests === 1 ? first.promise : second.promise) }; return chain
  } }
  const h = harness('SchedulingPage.tsx', 'AppointmentsPage', base, { client, rows: { memberships: [{ id: 'barber', role: 'barber', active: true }] } })
  h.render(); h.find(n => n.type === 'input' && n.props.type === 'date').props.onChange({ target: { value: '2026-10-06' } }); h.render()
  second.resolve({ data: [{ id: 'new', barber_membership_id: 'barber', starts_at: '2026-10-06T12:00:00Z', ends_at: '2026-10-06T12:30:00Z', total_price_cents: 100 }] }); await flush(); h.render()
  first.resolve({ data: [{ id: 'old', barber_membership_id: 'barber', starts_at: '2026-10-05T12:00:00Z', ends_at: '2026-10-05T12:30:00Z', total_price_cents: 999 }] }); await flush(); h.render()
  const appointment = h.find(n => n.type === 'button' && n.props.className?.startsWith('appointment-block'))
  assert.match(JSON.stringify(appointment.props.children), /1,00/)
  assert.doesNotMatch(JSON.stringify(appointment.props.children), /9,99/)
})

test('master mantém link de convite manual e bloqueia reenvio duplicado', async () => {
  let invites = 0
  const h = harness('MasterPage.tsx', 'MasterPage', { ...base, onRefresh: async () => {} }, {
    get: async () => ({ shops: [], memberships: [], invoices: [], settings: null }),
    api: async () => { invites++; return { delivery: 'manual_link', email_sent: false, invite_url: 'https://example.test/invite-test' } },
  })
  h.render(); await flush(); h.render()
  h.find(n => n.type === 'MasterDashboard').props.onInviteAdmin(); h.render()
  await h.find(n => n.type === 'form').props.onSubmit(event); h.render()
  assert.equal(h.find(n => n.type === 'input' && n.props.readOnly).props.value, 'https://example.test/invite-test')
  await h.find(n => n.type === 'form').props.onSubmit(event)
  assert.equal(invites, 1)
})


test('cliente não recebe usos antes do pagamento nem reutiliza ciclo já encerrado', () => {
  const props = { ...base, role: 'client', onSignOut() {}, identity: { ...base.identity, clientId: 'client' } }
  const pending = harness('ClientPage.tsx', 'ClientPage', props, { rows: {
    subscriptions: [{ id: 'subscription', client_id: 'client', plan_id: 'plan', status: 'authorized' }],
    subscription_plans: [{ id: 'plan', visits_per_cycle: 4 }],
  } })
  pending.render()
  assert.equal(pending.find(n => n.type === 'Stat' && n.props.label === 'Usos restantes').props.value, 'Aguardando pagamento')
  const expired = harness('ClientPage.tsx', 'ClientPage', props, { rows: {
    subscriptions: [{ id: 'subscription', client_id: 'client', plan_id: 'plan', status: 'active', current_period_end: '2020-01-01T00:00:00Z' }],
    subscription_plans: [{ id: 'plan', visits_per_cycle: 4 }],
  } })
  expired.render()
  assert.equal(expired.find(n => n.type === 'Stat' && n.props.label === 'Usos restantes').props.value, 0)
})

test('falha ao consultar pagamentos do cliente mostra erro e nunca apresenta R$0 como dado confirmado', () => {
  const h = harness('ClientPage.tsx', 'ClientPage', { ...base, role: 'client', onSignOut() {}, identity: { ...base.identity, clientId: 'client' } }, { rowState: { payments: { error: 'Network unavailable' } } })
  h.render()
  assert.equal(h.find(n => n.type === 'Stat' && n.props.label === 'Valor pago').props.value, '—')
  assert.match(h.find(n => n.type === 'Notice' && n.props.text?.includes('Network')).props.text, /Não foi possível carregar/)
})

test('serviço exclusivo não permite confirmar sem contrato com cobertura e saldo', async () => {
  const calls = []
  const h = harness('SchedulingPage.tsx','BookingModal',{shopId:'shop',timezone:'UTC',initialDay:'2030-10-05',barbers:[{id:'barber'}],clients:[{id:'a'}],services:[{id:'club',requires_subscription:true,price_cents:0}],subscriptions:[],onClose(){},onSaved(){}},{client:{rpc:async(name,values)=>{calls.push({name,values});return {data:name==='available_slots'?[{starts_at:'2030-10-05T12:00:00Z'}]:name==='booking_subscription_eligibility'?{requires_subscription:true,eligible:false,subscriptions:[],reason:'Sem saldo no ciclo.'}:null}}}})
  h.render()
  const selects = []
  const collect = node => { if (node?.type==='select' && node.props.required) selects.push(node); if(node?.props) for(const value of Object.values(node.props)) { if(Array.isArray(value))value.forEach(collect);else if(value&&typeof value==='object')collect(value) } }
  collect(h.render()); selects[0].props.onChange({target:{value:'a'}}); selects[1].props.onChange({target:{value:'barber'}}); h.render()
  h.find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});h.render();await flush();h.render()
  h.find(n=>n.type==='button'&&n.props.className?.startsWith('slot ')).props.onClick();h.render();await flush();h.render()
  assert.equal(h.find(n=>n.type==='PrimaryButton'&&n.props.type==='submit').props.disabled,true)
  await h.find(n=>n.type==='form').props.onSubmit(event);h.render()
  assert.equal(calls.filter(c=>c.name==='book_appointment').length,0)
  assert.match(h.find(n=>n.type==='Notice'&&n.props.text?.includes('assinatura')).props.text,/assinatura elegível/)
})

test('consulta de assinatura de cliente anterior não substitui os contratos do cliente atual', async () => {
  const old = deferred()
  const h = harness('SchedulingPage.tsx','BookingModal',{shopId:'shop',timezone:'UTC',initialDay:'2030-10-05',barbers:[{id:'barber'}],clients:[{id:'a'},{id:'b'}],services:[{id:'service',price_cents:2000}],subscriptions:[],onClose(){},onSaved(){}},{client:{rpc:async(name,values)=>name==='available_slots'?{data:[{starts_at:'2030-10-05T12:00:00Z'}]}:name==='booking_subscription_eligibility'&&values.p_client_id==='a'?old.promise:{data:{requires_subscription:false,eligible:true,subscriptions:[{id:'b-plan',plan_name:'Plano B',remaining_visits:2}],reason:null}}}})
  h.render();h.find(n=>n.type==='select'&&n.props.required&&n.props.children[1]?.length===2).props.onChange({target:{value:'a'}});h.render()
  h.find(n=>n.type==='select'&&n.props.required&&n.props.children[1]?.length===1).props.onChange({target:{value:'barber'}});h.render()
  h.find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});h.render();await flush();h.render()
  h.find(n=>n.type==='button'&&n.props.className?.startsWith('slot ')).props.onClick();h.render()
  h.find(n=>n.type==='select'&&n.props.required&&n.props.children[1]?.length===2).props.onChange({target:{value:'b'}});h.render();await flush();h.render()
  old.resolve({data:{requires_subscription:false,eligible:true,subscriptions:[{id:'a-plan',plan_name:'Plano A',remaining_visits:7}],reason:null}});await flush();h.render()
  const choice=h.find(n=>n.type==='select'&&!n.props.required)
  assert.match(JSON.stringify(choice.props.children),/Plano B/)
  assert.doesNotMatch(JSON.stringify(choice.props.children),/Plano A/)
})
