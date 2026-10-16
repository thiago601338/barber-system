const assert = require('node:assert/strict')
const childProcess = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const project = path.resolve(__dirname, '..')
const generated = path.join(project, 'node_modules', '.cache', 'subscription-contract-test')
fs.mkdirSync(generated, { recursive: true })
fs.writeFileSync(path.join(generated, 'package.json'), '{"type":"commonjs"}')
const compile = childProcess.spawnSync(process.execPath, [
  path.join(project, 'node_modules', 'typescript', 'bin', 'tsc'), '--ignoreConfig', '--target', 'ES2022', '--module', 'commonjs', '--rewriteRelativeImportExtensions',
  '--moduleResolution', 'bundler', '--skipLibCheck', '--types', 'vite/client,node,@netlify/functions',
  '--rootDir', 'netlify/functions/_shared', '--outDir', generated,
  'netlify/functions/_shared/mpStore.ts', 'netlify/functions/_shared/subscriptionTerms.ts',
], { cwd: project, encoding: 'utf8' })
if (compile.status !== 0) throw new Error(compile.stderr || compile.stdout)
const { subscriptionTerms, addContractMonths } = require(path.join(generated, 'subscriptionTerms.js'))
const { saveCustomerPayment, localPreapprovalStatus } = require(path.join(generated, 'mpStore.js'))

function fixture({ review = false, price = 10000, months = 1, status = 'pending' } = {}) {
  const terms = { version: 1, captured_at: '2026-01-01T00:00:00Z', plan_name: 'Condição original', description: 'Corte incluso',
    price_cents: price, frequency_months: months, visits_per_cycle: 4,
    services: [{ id: 'service-1', name: 'Corte', price_cents: 0, duration_minutes: 30 }] }
  const subscription = { id: 'subscription-1', barbershop_id: 'shop-1', client_id: 'client-1', plan_id: 'plan-1', status,
    provider_subscription_id: 'remote-1', current_period_start: null, current_period_end: null,
    contract_snapshot: review ? null : terms, contract_review_required: review }
  const calls = { payments: [], subscriptions: [], reconcile: [] }
  const client = { from(table) {
    // A changed current plan must never participate in payment reconciliation.
    if (table === 'subscription_plans') throw new Error('Read of mutable plan terms')
    let operation = 'select'; let values
    const query = { select() { return query }, eq() { return query }, in() { return query }, is() { return query }, not() { return query },
      update(record) { operation = 'update'; values = record; return query },
      insert(record) { operation = 'insert'; values = record; return query },
      maybeSingle() { return Promise.resolve(run()) }, single() { return Promise.resolve(run()) },
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject) } }
    function run() {
      if (table === 'payments' && operation === 'select') return { data: null, error: null }
      if (table === 'payments') { calls.payments.push(values); return { data: { id: 'payment-1' }, error: null } }
      if (table === 'subscriptions' && operation === 'update') { calls.subscriptions.push(values); return { data: null, error: null } }
      throw new Error(`Unexpected query ${table} ${operation}`)
    }
    return query
  }, async rpc(name, values) { calls.reconcile.push({ name, values }); return { data: 'active', error: null } } }
  const payment = { id: 'payment-remote-1', status: 'approved', transaction_amount: 100, currency_id: 'BRL',
    date_approved: '2026-01-31T15:42:00.000Z', payment_type_id: 'credit_card', payment_method_id: 'visa' }
  return { subscription, terms, client, calls, payment }
}

test('payment reconciliation honors original price and cycle without querying the current plan', async () => {
  const f = fixture()
  await saveCustomerPayment(f.client, f.subscription, f.payment)
  assert.equal(f.calls.payments[0].amount_cents, 10000)
  assert.equal(f.calls.subscriptions[0].current_period_start, '2026-01-31T15:42:00.000Z')
  assert.equal(f.calls.subscriptions[0].current_period_end, '2026-02-28T15:42:00.000Z')
  assert.equal(f.calls.reconcile[0].name, 'reconcile_subscription_entitlement')
})
test('a payment of the new catalog price cannot authorize an older contract', async () => {
  const f = fixture()
  await assert.rejects(saveCustomerPayment(f.client, f.subscription, { ...f.payment, transaction_amount: 200 }), /difere do contratado/)
  assert.equal(f.calls.payments.length, 0)
  assert.equal(f.calls.subscriptions.length, 0)
})
test('a verified legacy receipt is retained without inventing contract benefits or activating visits', async () => {
  const f = fixture({ review: true, status: 'past_due' })
  await saveCustomerPayment(f.client, f.subscription, f.payment)
  assert.equal(f.calls.payments[0].status, 'paid')
  assert.equal(f.calls.subscriptions.length, 0)
})
test('refunds still get recorded when a legacy contract is under review', async () => {
  const f = fixture({ review: true, status: 'active' })
  await saveCustomerPayment(f.client, f.subscription, { ...f.payment, status: 'refunded' })
  assert.equal(f.calls.payments[0].status, 'refunded')
  assert.equal(f.calls.subscriptions.length, 0)
})
test('an authorized card mandate does not erase delinquency', () => {
  assert.equal(localPreapprovalStatus('authorized', 'past_due'), 'past_due')
  assert.equal(localPreapprovalStatus('authorized', 'active'), 'active')
  assert.equal(localPreapprovalStatus('authorized', 'pending'), 'authorized')
})
test('calendar billing handles leap years, month ends and year crossings', () => {
  assert.equal(addContractMonths(new Date('2024-01-31T12:00:00Z'), 1).toISOString(), '2024-02-29T12:00:00.000Z')
  assert.equal(addContractMonths(new Date('2026-12-31T12:00:00Z'), 2).toISOString(), '2027-02-28T12:00:00.000Z')
  assert.equal(addContractMonths(new Date('2026-01-31T12:00:00Z'), 12).toISOString(), '2027-01-31T12:00:00.000Z')
})
test('missing or corrupt commercial terms cannot be treated as a free contract', () => {
  const f = fixture()
  assert.equal(subscriptionTerms(f.subscription).visits_per_cycle, 4)
  for (const changed of [null, { ...f.terms, frequency_months: 0 }, { ...f.terms, price_cents: 0 }, { ...f.terms, services: [] }]) {
    assert.throws(() => subscriptionTerms({ contract_snapshot: changed, contract_review_required: false }), /condições originais/)
  }
  assert.throws(() => subscriptionTerms({ ...f.subscription, contract_review_required: true }), /condições originais/)
})
