const assert = require('node:assert/strict')
const childProcess = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

// The installed TypeScript 7 compiler is CLI-only. Compile the tested Functions
// into ignored node_modules cache, then run them with Node's built-in test runner.
const project = path.resolve(__dirname, '..')
const generated = path.join(project, 'node_modules', '.cache', 'mp-payment-test')
fs.mkdirSync(generated, { recursive: true })
fs.writeFileSync(path.join(generated, 'package.json'), '{"type":"commonjs"}')
const compile = childProcess.spawnSync(process.execPath, [
  path.join(project, 'node_modules', 'typescript', 'bin', 'tsc'),
  '--ignoreConfig', '--target', 'ES2022', '--module', 'commonjs',
  '--moduleResolution', 'bundler', '--skipLibCheck',
  '--types', 'vite/client,@netlify/functions',
  '--rootDir', 'netlify/functions/_shared', '--outDir', generated,
  'netlify/functions/_shared/mpStore.ts', 'netlify/functions/_shared/core.ts',
], { cwd: project, encoding: 'utf8' })
if (compile.status !== 0) throw new Error(compile.stderr || compile.stdout || 'TypeScript compilation failed')
const { saveCustomerPayment } = require(path.join(generated, 'mpStore.js'))

function fixture({ status = 'past_due', existingPayment = null } = {}) {
  const subscription = {
    id: 'subscription-1', barbershop_id: 'shop-1', client_id: 'client-1',
    plan_id: 'plan-1', status, provider_subscription_id: 'preapproval-1',
    current_period_start: '2026-09-01T00:00:00.000Z',
    current_period_end: '2026-10-01T00:00:00.000Z',
  }
  const payments = new Map()
  if (existingPayment) payments.set(existingPayment.provider_payment_id, { ...existingPayment })
  const calls = { subscriptionUpdates: 0, reconciliations: 0 }
  const client = {
    from(table) {
      const query = { table, operation: 'select', record: null, filters: [], excludedTerminal: false }
      const builder = {
        select() { return builder },
        eq(name, value) { query.filters.push([name, value]); return builder },
        is(name, value) { query.filters.push([name, value]); return builder },
        in(name, values) { query.filters.push([name, values]); return builder },
        not(name) { if (name === 'status') query.excludedTerminal = true; return builder },
        update(value) { query.operation = 'update'; query.record = value; return builder },
        insert(value) { query.operation = 'insert'; query.record = value; return builder },
        single() { return Promise.resolve(execute()) },
        maybeSingle() { return Promise.resolve(execute()) },
        then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject) },
      }
      function filter(name) { return query.filters.find(([key]) => key === name)?.[1] }
      function execute() {
        if (table === 'subscription_plans') return { data: { price_cents: 5000, frequency_months: 1 }, error: null }
        if (table === 'payments' && query.operation === 'select') {
          return { data: payments.get(filter('provider_payment_id')) || null, error: null }
        }
        if (table === 'payments') {
          const id = query.operation === 'update' ? filter('id') : query.record.provider_payment_id
          const existing = [...payments.values()].find(item => item.id === id)
          if (query.excludedTerminal && existing && ['refunded', 'charged_back', 'cancelled'].includes(existing.status)) {
            return { data: null, error: null }
          }
          const row = { ...existing, ...query.record, id: existing?.id || id }
          payments.set(row.provider_payment_id, row)
          return { data: { id: row.id }, error: null }
        }
        if (table === 'subscriptions' && query.operation === 'update') {
          calls.subscriptionUpdates++
          Object.assign(subscription, query.record)
          return { data: null, error: null }
        }
        throw new Error(`Unexpected query: ${table} ${query.operation}`)
      }
      return builder
    },
    rpc(name) {
      assert.equal(name, 'reconcile_subscription_entitlement')
      calls.reconciliations++
      return Promise.resolve({ data: subscription.status, error: null })
    },
  }
  return { client, subscription, payments, calls }
}

function payment(id, status, approvedAt = '2026-09-02T10:00:00.000Z', amount = 50) {
  return { id, status, currency_id: 'BRL', transaction_amount: amount,
    date_approved: approvedAt, payment_method_id: 'visa', payment_type_id: 'credit_card' }
}

test('a late approved webhook cannot restore a refunded payment', async () => {
  const setup = fixture({ existingPayment: { id: 'db-1', provider_payment_id: 'p1',
    subscription_id: 'subscription-1', status: 'refunded', paid_at: '2026-09-02T10:00:00.000Z' } })
  await saveCustomerPayment(setup.client, setup.subscription, payment('p1', 'approved'))
  assert.equal(setup.payments.get('p1').status, 'refunded')
  assert.equal(setup.subscription.status, 'past_due')
  assert.equal(setup.calls.reconciliations, 0)
})

test('a refund retains its original paid date for cycle reconciliation', async () => {
  const setup = fixture({ status: 'active', existingPayment: { id: 'db-1', provider_payment_id: 'p1',
    subscription_id: 'subscription-1', status: 'paid', paid_at: '2026-09-02T10:00:00.000Z' } })
  await saveCustomerPayment(setup.client, setup.subscription, payment('p1', 'refunded', null))
  assert.equal(setup.payments.get('p1').status, 'refunded')
  assert.equal(setup.payments.get('p1').paid_at, '2026-09-02T10:00:00.000Z')
  assert.equal(setup.calls.subscriptionUpdates, 0)
})

test('a valid replacement payment restores the same billing cycle', async () => {
  const setup = fixture()
  await saveCustomerPayment(setup.client, setup.subscription, payment('p2', 'approved'))
  assert.equal(setup.subscription.status, 'active')
  assert.equal(setup.subscription.current_period_start, '2026-09-01T00:00:00.000Z')
  assert.equal(setup.calls.reconciliations, 1)
})

test('an approved payment from an older cycle cannot restore the current one', async () => {
  const setup = fixture()
  await saveCustomerPayment(setup.client, setup.subscription,
    payment('old-p1', 'approved', '2026-08-03T10:00:00.000Z'))
  assert.equal(setup.subscription.status, 'past_due')
  assert.equal(setup.calls.reconciliations, 0)
})

test('an underpaid invoice never grants a visit entitlement', async () => {
  const setup = fixture()
  await assert.rejects(saveCustomerPayment(setup.client, setup.subscription,
    payment('p3', 'approved', undefined, 10)), /Valor pago difere do plano/)
  assert.equal(setup.payments.size, 0)
  assert.equal(setup.subscription.status, 'past_due')
})
