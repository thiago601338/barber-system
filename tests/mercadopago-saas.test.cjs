const assert = require('node:assert/strict')
const childProcess = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const project = path.resolve(__dirname, '..')
const generated = path.join(project, 'node_modules', '.cache', 'mp-saas-test')
fs.mkdirSync(generated, { recursive: true })
fs.writeFileSync(path.join(generated, 'package.json'), '{"type":"commonjs"}')
const compile = childProcess.spawnSync(process.execPath, [
  path.join(project, 'node_modules', 'typescript', 'bin', 'tsc'),
  '--ignoreConfig', '--target', 'ES2022', '--module', 'commonjs',
  '--moduleResolution', 'bundler', '--skipLibCheck',
  '--types', 'vite/client,@netlify/functions',
  '--rootDir', 'netlify/functions/_shared', '--outDir', generated,
  'netlify/functions/_shared/mpBilling.ts',
  'netlify/functions/_shared/mpSaasSchedule.ts',
  'netlify/functions/_shared/mpWebhook.ts',
], { cwd: project, encoding: 'utf8' })
if (compile.status !== 0) throw new Error(compile.stderr || compile.stdout || 'TypeScript compilation failed')
const { syncSaasAmount } = require(path.join(generated, 'mpBilling.js'))
const { runSaasReconcileBatch } = require(path.join(generated, 'mpSaasSchedule.js'))
const { savePlatformPayment, syncPlatformPreapproval } = require(path.join(generated, 'mpWebhook.js'))

global.Netlify = { env: { get(name) {
  return { MP_PLATFORM_ACCESS_TOKEN: 'test-token', MP_PLATFORM_ACCOUNT_ID: '123' }[name]
} } }

function fixture({ enabled = true, active = true, seats = 2, price = 1000,
  remoteStatus = 'authorized', remoteAmount = 20, autoPaused = false } = {}) {
  const local = { barbershop_id: 'shop-1', provider_subscription_id: 'pre-1', status: remoteStatus,
    seat_count: 2, unit_price_cents: 1000, amount_cents: 2000, auto_paused: autoPaused }
  const remote = { id: 'pre-1', collector_id: 123, external_reference: 'saas-shop-1',
    status: remoteStatus, auto_recurring: { transaction_amount: remoteAmount, currency_id: 'BRL' } }
  const calls = { puts: [], updates: [] }
  const client = {
    from(table) {
      const query = { table, operation: 'select', update: null }
      const builder = {
        select() { return builder }, eq() { return builder },
        update(value) { query.operation = 'update'; query.update = value; return builder },
        single() { return Promise.resolve(execute()) },
        then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject) },
      }
      function execute() {
        if (table === 'platform_settings') return { data: { seat_price_cents: price, billing_enabled: enabled }, error: null }
        if (table === 'barbershops') return { data: { active }, error: null }
        if (table === 'memberships') return { count: seats, error: null }
        if (table === 'platform_subscriptions' && query.operation === 'select') return { data: { ...local }, error: null }
        if (table === 'platform_subscriptions' && query.operation === 'update') {
          calls.updates.push(query.update)
          Object.assign(local, query.update)
          return { data: null, error: null }
        }
        throw new Error(`Unexpected query ${table} ${query.operation}`)
      }
      return builder
    },
  }
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://api.mercadopago.com/preapproval/pre-1')
    assert.equal(options.headers.authorization, 'Bearer test-token')
    if (options.method === 'PUT') {
      const payload = JSON.parse(options.body)
      calls.puts.push(payload)
      if (payload.status) remote.status = payload.status
      if (payload.auto_recurring) Object.assign(remote.auto_recurring, payload.auto_recurring)
    }
    return new Response(JSON.stringify(remote), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return { client, local, remote, calls }
}

test('same remote amount is a no-op, yet the current seat snapshot is saved', async () => {
  const setup = fixture({ seats: 4, price: 500 })
  const result = await syncSaasAmount(setup.client, 'shop-1')
  assert.equal(result.action, 'unchanged')
  assert.equal(setup.calls.puts.length, 0)
  assert.equal(setup.local.seat_count, 4)
  assert.equal(setup.local.amount_cents, 2000)
})

test('a changed seat count updates recurring amount once', async () => {
  const setup = fixture({ seats: 3 })
  const result = await syncSaasAmount(setup.client, 'shop-1')
  assert.equal(result.action, 'amount_updated')
  assert.equal(setup.calls.puts.length, 1)
  assert.equal(setup.calls.puts[0].auto_recurring.transaction_amount, 30)
  assert.equal(setup.local.amount_cents, 3000)
  await syncSaasAmount(setup.client, 'shop-1')
  assert.equal(setup.calls.puts.length, 1, 'retry must not send a second PUT')
  assert.equal(setup.calls.updates.length, 1, 'retry must not rewrite the same local state')
})

test('zero barbers pauses instead of sending a zero-value charge', async () => {
  const setup = fixture({ seats: 0 })
  const result = await syncSaasAmount(setup.client, 'shop-1')
  assert.equal(result.action, 'paused')
  assert.deepEqual(setup.calls.puts, [{ status: 'paused' }])
  assert.equal(setup.local.auto_paused, true)
  assert.equal(setup.local.amount_cents, 2000, 'retains historical amount for delayed invoices')
})

test('disabled billing pauses an authorized subscription and cancels pending checkout', async () => {
  const authorized = fixture({ enabled: false })
  await syncSaasAmount(authorized.client, 'shop-1')
  assert.equal(authorized.remote.status, 'paused')
  const pending = fixture({ enabled: false, remoteStatus: 'pending' })
  await syncSaasAmount(pending.client, 'shop-1')
  assert.equal(pending.remote.status, 'canceled')
  assert.equal(pending.local.status, 'cancelled')
})

test('only a system pause is resumed at the new amount', async () => {
  const automatic = fixture({ remoteStatus: 'paused', autoPaused: true, seats: 3 })
  const result = await syncSaasAmount(automatic.client, 'shop-1')
  assert.equal(result.action, 'resumed')
  assert.deepEqual(automatic.calls.puts, [{ status: 'authorized',
    auto_recurring: { transaction_amount: 30, currency_id: 'BRL' } }])
  assert.equal(automatic.local.auto_paused, false)
  const manual = fixture({ remoteStatus: 'paused', autoPaused: false, seats: 3 })
  const untouched = await syncSaasAmount(manual.client, 'shop-1')
  assert.equal(untouched.action, 'unchanged')
  assert.equal(manual.calls.puts.length, 0)
})

test('an MP response that does not confirm the requested pause is not persisted', async () => {
  const setup = fixture({ seats: 0 })
  global.fetch = async () => new Response(JSON.stringify(setup.remote), { status: 200 })
  await assert.rejects(syncSaasAmount(setup.client, 'shop-1'), /não confirmou o estado/)
  assert.equal(setup.calls.updates.length, 0)
})

test('the scheduler claims a bounded batch and rotates failed shops', async () => {
  const rows = Array.from({ length: 5 }, (_, index) => ({ barbershop_id: `shop-${index}`,
    provider_subscription_id: `pre-${index}`, last_reconciled_at: null }))
  const calls = []
  const client = { from() {
    const query = { operation: 'select', filters: [], update: null }
    const builder = {
      select() { return builder }, not() { return builder }, order() { return builder }, limit() { return builder },
      eq(name, value) { query.filters.push([name, value]); return builder },
      is(name, value) { query.filters.push([name, value]); return builder },
      update(value) { query.operation = 'update'; query.update = value; return builder },
      then(resolve, reject) { return Promise.resolve({ data: rows, error: null }).then(resolve, reject) },
      maybeSingle() {
        const id = query.filters.find(([name]) => name === 'barbershop_id')[1]
        const row = rows.find(item => item.barbershop_id === id)
        if (row.last_reconciled_at !== null) return Promise.resolve({ data: null, error: null })
        row.last_reconciled_at = query.update.last_reconciled_at
        return Promise.resolve({ data: { barbershop_id: id }, error: null })
      },
    }
    return builder
  } }
  const originalError = console.error
  console.error = () => {}
  try {
    const result = await runSaasReconcileBatch(client, async (_db, id) => {
      calls.push(id)
      if (id === 'shop-1') throw new Error('temporary failure')
    })
    assert.deepEqual(result, { claimed: 4, succeeded: 3, failed: 1 })
    assert.equal(calls.length, 4)
    assert.ok(rows[1].last_reconciled_at, 'failed shop must rotate and be retried later')
    assert.equal(rows[4].last_reconciled_at, null)
  } finally { console.error = originalError }
})

test('a late SaaS payment uses the verified historical rate instead of the current price', async () => {
  const inserted = []
  const client = { from(table) {
    const query = { table, operation: 'select', record: null }
    const builder = {
      select() { return builder }, eq() { return builder }, lte() { return builder },
      order() { return builder }, limit() { return builder },
      insert(record) { query.operation = 'insert'; query.record = record; return builder },
      maybeSingle() {
        if (table === 'platform_subscriptions') return Promise.resolve({ data: {
          barbershop_id: 'shop-1', provider_subscription_id: 'pre-1', status: 'authorized',
          seat_count: 3, unit_price_cents: 1000, amount_cents: 3000,
        }, error: null })
        if (table === 'platform_subscription_rates') return Promise.resolve({ data: {
          seat_count: 2, unit_price_cents: 1000, amount_cents: 2000,
        }, error: null })
        if (table === 'platform_invoices') return Promise.resolve({ data: null, error: null })
        throw new Error(`Unexpected ${table}`)
      },
      then(resolve, reject) {
        if (table !== 'platform_invoices' || query.operation !== 'insert') throw new Error(`Unexpected ${table}`)
        inserted.push(query.record)
        return Promise.resolve({ error: null }).then(resolve, reject)
      },
    }
    return builder
  } }
  const invoice = { id: 81, preapproval_id: 'pre-1', external_reference: 'saas-shop-1',
    payment: { id: 52 }, currency_id: 'BRL', transaction_amount: '20.00',
    date_created: '2026-09-01T10:00:00.000Z' }
  const payment = { id: 52, status: 'approved', currency_id: 'BRL', transaction_amount: 20,
    date_approved: '2026-09-01T10:03:00.000Z' }
  await savePlatformPayment(client, 'pre-1', invoice, payment)
  assert.equal(inserted.length, 1)
  assert.equal(inserted[0].amount_cents, 2000)
  assert.equal(inserted[0].seat_count, 2)
  assert.equal(inserted[0].unit_price_cents, 1000)
  await assert.rejects(savePlatformPayment(client, 'pre-1',
    { ...invoice, transaction_amount: '19.00' }, payment), /difere da fatura oficial/)
})

test('an invoice from a replaced central subscription is matched by its former provider ID', async () => {
  const inserted = []
  const client = { from(table) {
    const query = { operation: 'select', record: null }
    const builder = {
      select() { return builder }, eq() { return builder }, lte() { return builder },
      order() { return builder }, limit() { return builder },
      insert(record) { query.operation = 'insert'; query.record = record; return builder },
      maybeSingle() {
        if (table === 'platform_subscriptions') return Promise.resolve({ data: null, error: null })
        if (table === 'platform_subscription_rates') return Promise.resolve({ data: {
          barbershop_id: 'shop-1', provider_subscription_id: 'old-pre',
          seat_count: 2, unit_price_cents: 1000, amount_cents: 2000,
        }, error: null })
        if (table === 'platform_invoices') return Promise.resolve({ data: null, error: null })
        throw new Error(`Unexpected ${table}`)
      },
      then(resolve, reject) {
        if (table !== 'platform_invoices' || query.operation !== 'insert') throw new Error(`Unexpected ${table}`)
        inserted.push(query.record)
        return Promise.resolve({ error: null }).then(resolve, reject)
      },
    }
    return builder
  } }
  await savePlatformPayment(client, 'old-pre', {
    id: 81, preapproval_id: 'old-pre', external_reference: 'saas-shop-1',
    payment: { id: 52 }, currency_id: 'BRL', transaction_amount: '20.00',
    date_created: '2026-09-01T10:00:00.000Z',
  }, { id: 52, status: 'approved', currency_id: 'BRL', transaction_amount: 20,
    date_approved: '2026-09-01T10:03:00.000Z' })
  assert.equal(inserted[0].barbershop_id, 'shop-1')
  assert.equal(inserted[0].amount_cents, 2000)
})

test('two official invoices in one month keep separate provider invoice IDs', async () => {
  const inserted = []
  const client = { from(table) {
    const query = { operation: 'select', record: null, filters: [] }
    const builder = {
      select() { return builder },
      eq(name, value) { query.filters.push([name, value]); return builder },
      lte() { return builder }, order() { return builder }, limit() { return builder },
      insert(record) { query.operation = 'insert'; query.record = record; return builder },
      maybeSingle() {
        const providerId = query.filters.find(([key]) => key === 'provider_subscription_id')?.[1]
        if (table === 'platform_subscriptions') return Promise.resolve({ data: providerId === 'new-pre'
          ? { barbershop_id: 'shop-1', provider_subscription_id: 'new-pre',
            seat_count: 3, unit_price_cents: 1000, amount_cents: 3000 } : null, error: null })
        if (table === 'platform_subscription_rates') return Promise.resolve({ data: {
          barbershop_id: 'shop-1', provider_subscription_id: providerId,
          seat_count: providerId === 'old-pre' ? 2 : 3,
          unit_price_cents: 1000, amount_cents: providerId === 'old-pre' ? 2000 : 3000,
        }, error: null })
        if (table === 'platform_invoices') return Promise.resolve({ data: null, error: null })
        throw new Error(`Unexpected ${table}`)
      },
      then(resolve, reject) {
        inserted.push(query.record)
        return Promise.resolve({ error: null }).then(resolve, reject)
      },
    }
    return builder
  } }
  for (const [id, providerId, amount] of [[81, 'old-pre', 20], [82, 'new-pre', 30]]) {
    await savePlatformPayment(client, providerId, {
      id, preapproval_id: providerId, external_reference: 'saas-shop-1',
      payment: { id: id + 100 }, currency_id: 'BRL', transaction_amount: amount,
      date_created: '2026-09-01T10:00:00.000Z',
    }, { id: id + 100, status: 'approved', currency_id: 'BRL', transaction_amount: amount })
  }
  assert.equal(inserted.length, 2)
  assert.equal(inserted[0].period_start, inserted[1].period_start)
  assert.deepEqual(inserted.map(row => row.provider_invoice_id), ['81', '82'])
  assert.deepEqual(inserted.map(row => row.amount_cents), [2000, 3000])
})

test('a late status webhook from a replaced subscription never overwrites the new one', async () => {
  let updates = 0
  const client = { from(table) {
    const builder = {
      select() { return builder }, eq() { return builder }, order() { return builder }, limit() { return builder },
      update() { updates++; return builder },
      maybeSingle() { return Promise.resolve({ data: table === 'platform_subscription_rates'
        ? { barbershop_id: 'shop-1', provider_subscription_id: 'old-pre' } : null, error: null }) },
    }
    return builder
  } }
  global.fetch = async () => new Response(JSON.stringify({ id: 'old-pre', collector_id: 123,
    external_reference: 'saas-shop-1', status: 'canceled' }), { status: 200 })
  await syncPlatformPreapproval(client, 'old-pre')
  assert.equal(updates, 0)
})
