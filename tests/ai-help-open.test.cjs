const assert = require('node:assert/strict')
const { test } = require('node:test')

function fakeClient(tables) {
  const calls = []
  const client = {
    calls,
    from(table) {
      const call = { table, filters: [], eqs: [], columns: '', head: false, limit: Infinity, single: false }
      calls.push(call)
      const query = {
        select(columns, options = {}) { call.columns = columns; call.head = Boolean(options.head); return query },
        eq(column, value) { call.eqs.push([column, value]); call.filters.push(row => row[column] === value); return query },
        gte(column, value) { call.filters.push(row => row[column] >= value); return query },
        lte(column, value) { call.filters.push(row => row[column] <= value); return query },
        order() { return query },
        limit(value) { call.limit = value; return query },
        single() { call.single = true; return query },
        then(resolve, reject) {
          const rows = (tables[table] || []).filter(row => call.filters.every(filter => filter(row)))
          return Promise.resolve({ data: call.head ? null : call.single ? rows[0] || null : rows.slice(0, call.limit),
            count: call.head ? rows.length : null, error: null }).then(resolve, reject)
        },
      }
      return query
    },
  }
  return client
}

test('pergunta aberta devolve orientação e não é forçada a cadastro', async () => {
  const { readHelpAnswer, modelInstructions, visibleInCurrentAccess } = await import('../netlify/functions/ai-help.ts')
  assert.equal(readHelpAnswer({ type: 'answer', answer: 'O horário oficial não está cadastrado.' }),
    'O horário oficial não está cadastrado.')
  assert.equal(readHelpAnswer({ type: 'create_service', values: {} }), null)
  assert.equal(readHelpAnswer({ type: 'unsupported', reason: 'Preciso saber quais dias você quer informar.' }),
    'Preciso saber quais dias você quer informar.')
  assert.throws(() => readHelpAnswer({ type: 'answer', answer: '' }))
  const instructions = modelInstructions({ role: 'barber', shopId: 'shop-a', shopName: 'A', memberId: 'me',
    modules: ['ai'], timezone: 'America/Sao_Paulo', allowed: [], dailyLimit: 10 }, '2026-09-29')
  assert.match(instructions, /dúvidas abertas/)
  assert.match(instructions, /Se não houver ação liberada, ainda responda consultas/)
  assert.match(instructions, /própria disponibilidade/)
  const currentAccess = { role: 'barber', shopId: 'shop-a', memberId: 'me', modules: ['ai'], allowed: [] }
  assert.equal(visibleInCurrentAccess({ status: 'answered', result: { answer: 'Agendamentos', context_role: 'barber',
    context_member_id: 'me', context_modules: ['ai', 'appointments'] } }, currentAccess), false)
  assert.equal(visibleInCurrentAccess({ status: 'answered', result: { answer: 'Finanças', context_role: 'admin',
    context_member_id: 'me', context_modules: [] } }, currentAccess), false)
  assert.equal(visibleInCurrentAccess({ status: 'answered', result: { answer: 'Dica geral', context_role: 'barber',
    context_member_id: 'me', context_modules: ['ai'] } }, currentAccess), true)
  assert.equal(visibleInCurrentAccess({ status: 'completed', action_type: 'create_shop_goal', result: {} }, currentAccess), false)
})

test('contexto do barbeiro só consulta a própria atividade na loja ativa', async () => {
  const { loadAiHelpContext } = await import('../netlify/functions/_shared/aiHelpContext.ts')
  const now = new Date().toISOString()
  const nextMonth = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10)
  const client = fakeClient({
    services: [{ barbershop_id: 'shop-a', active: true, name: 'Corte', price_cents: 5000, duration_minutes: 30 }],
    availability_rules: [
      { barbershop_id: 'shop-a', barber_membership_id: 'me', active: true, weekday: 1, start_time: '09:00', end_time: '17:00' },
      { barbershop_id: 'shop-a', barber_membership_id: 'other', active: true, weekday: 2, start_time: '10:00', end_time: '18:00' },
      { barbershop_id: 'shop-b', barber_membership_id: 'me', active: true, weekday: 3, start_time: '11:00', end_time: '19:00' },
    ],
    availability_exceptions: [],
    appointments: [
      { barbershop_id: 'shop-a', barber_membership_id: 'me', starts_at: now, status: 'completed', total_price_cents: 5000 },
      { barbershop_id: 'shop-a', barber_membership_id: 'other', starts_at: now, status: 'completed', total_price_cents: 99900 },
    ],
    goals: [
      { barbershop_id: 'shop-a', barber_membership_id: 'me', period_end: nextMonth, title: 'Minha meta' },
      { barbershop_id: 'shop-a', barber_membership_id: 'other', period_end: nextMonth, title: 'Meta alheia' },
    ],
    payments: [{ barbershop_id: 'shop-a', status: 'paid', amount_cents: 99900, paid_at: now }],
  })
  const context = JSON.parse(await loadAiHelpContext(client, { role: 'barber', shopId: 'shop-a', shopName: 'A',
    memberId: 'me', modules: ['ai', 'goals', 'appointments', 'availability', 'services'], timezone: 'America/Sao_Paulo' }))
  assert.equal(context.scope, 'own_barber_activity')
  assert.equal(context.weekly_availability_sample.items.length, 1)
  assert.equal(context.appointments_last_30_days_sample.count_in_sample, 1)
  assert.deepEqual(context.goals_sample.items.map(item => item.title), ['Minha meta'])
  assert.equal(context.paid_transactions_last_30_days_sample, undefined)
  assert.equal(client.calls.some(call => call.table === 'payments' || call.table === 'memberships' || call.table === 'clients'), false)
  for (const call of client.calls) assert.deepEqual(call.eqs.find(([column]) => column === 'barbershop_id'), ['barbershop_id', 'shop-a'])
  for (const call of client.calls.filter(call => ['availability_rules', 'availability_exceptions', 'appointments', 'goals'].includes(call.table))) {
    assert.deepEqual(call.eqs.find(([column]) => column === 'barber_membership_id'), ['barber_membership_id', 'me'])
  }
})

test('barbeiro com só IA não recebe dados de módulos negados', async () => {
  const { loadAiHelpContext } = await import('../netlify/functions/_shared/aiHelpContext.ts')
  const client = fakeClient({})
  const context = JSON.parse(await loadAiHelpContext(client, { role: 'barber', shopId: 'shop-a',
    shopName: 'A', memberId: 'me', modules: ['ai'], timezone: 'America/Sao_Paulo' }))
  assert.deepEqual(context.unavailable_modules, ['services', 'appointments', 'goals'])
  assert.equal(context.active_services_sample, undefined)
  assert.equal(context.weekly_availability_sample, undefined)
  assert.equal(context.appointments_last_30_days_sample, undefined)
  assert.equal(context.goals_sample, undefined)
  assert.equal(client.calls.length, 0)
})

test('aba Serviços libera apenas a própria disponibilidade do barbeiro', async () => {
  const { loadAiHelpContext } = await import('../netlify/functions/_shared/aiHelpContext.ts')
  const client = fakeClient({ availability_rules: [
    { barbershop_id: 'shop-a', barber_membership_id: 'me', active: true, weekday: 1, start_time: '08:00', end_time: '12:00' },
    { barbershop_id: 'shop-a', barber_membership_id: 'other', active: true, weekday: 1, start_time: '13:00', end_time: '18:00' },
  ] })
  const context = JSON.parse(await loadAiHelpContext(client, { role: 'barber', shopId: 'shop-a',
    shopName: 'A', memberId: 'me', modules: ['ai', 'services'], timezone: 'America/Sao_Paulo' }))
  assert.deepEqual(context.weekly_availability_sample.items.map(item => item.start), ['08:00'])
  assert.equal(context.appointments_last_30_days_sample, undefined)
})

test('contexto do master sem loja usa somente agregados centrais', async () => {
  const { loadAiHelpContext } = await import('../netlify/functions/_shared/aiHelpContext.ts')
  const client = fakeClient({
    barbershops: [{ id: 'shop-a', active: true }, { id: 'shop-b', active: false }],
    memberships: [{ id: 'm1', active: true, role: 'barber' }, { id: 'm2', active: false, role: 'barber' }],
    platform_settings: [{ id: 1, seat_price_cents: 8999, billing_enabled: false }],
    platform_subscriptions: [{ status: 'active', amount_cents: 8999 }],
    platform_invoices: [{ status: 'paid', amount_cents: 8999, created_at: new Date().toISOString() }],
  })
  const context = JSON.parse(await loadAiHelpContext(client, { role: 'master', shopId: null,
    shopName: null, memberId: null, modules: [], timezone: 'America/Sao_Paulo' }))
  assert.equal(context.active_shops, 1)
  assert.equal(context.active_barber_memberships, 1)
  assert.equal(context.default_price_per_barber_cents, 8999)
  assert.equal(context.central_invoices_last_30_days_sample.paid_cents_in_sample, 8999)
  assert.equal(client.calls.some(call => ['clients', 'payments', 'availability_rules'].includes(call.table)), false)
})
