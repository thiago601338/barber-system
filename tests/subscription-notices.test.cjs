const assert = require('node:assert/strict')
const childProcess = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const project = path.resolve(__dirname, '..')
const generated = path.join(project, 'node_modules', '.cache', 'subscription-notices-test')
fs.mkdirSync(generated, { recursive: true })
fs.writeFileSync(path.join(generated, 'package.json'), '{"type":"commonjs"}')
const compile = childProcess.spawnSync(process.execPath, [
  path.join(project, 'node_modules', 'typescript', 'bin', 'tsc'), '--ignoreConfig', '--target', 'ES2022', '--module', 'commonjs', '--rewriteRelativeImportExtensions',
  '--moduleResolution', 'bundler', '--skipLibCheck', '--types', 'vite/client,node,@netlify/functions',
  '--rootDir', 'netlify/functions/_shared', '--outDir', generated, 'netlify/functions/_shared/subscriptionNotices.ts',
], { cwd: project, encoding: 'utf8' })
if (compile.status !== 0) throw new Error(compile.stderr || compile.stdout)
const { runSubscriptionNotices, noticeParameters, noticeTemplates, whatsappNumber, templateText } = require(path.join(generated, 'subscriptionNotices.js'))

const NOW = new Date('2026-11-20T12:00:00Z')
// Banco em memória com o subconjunto do query builder usado pela rotina.
function fakeDb(tables) {
  const writes = []
  function from(table) {
    const filters = []; let patch = null; let limit = Infinity
    const rows = () => (tables[table] || []).filter(row => filters.every(f => f(row)))
    const b = {
      select() { return b }, order() { return b }, limit(n) { limit = n; return b },
      eq(k, v) { filters.push(r => r[k] === v); return b }, lt(k, v) { filters.push(r => r[k] < v); return b },
      lte(k, v) { filters.push(r => r[k] <= v); return b }, gt(k, v) { filters.push(r => r[k] > v); return b },
      in(k, v) { filters.push(r => v.includes(r[k])); return b },
      update(values) { patch = values; return b },
      async single() { return { data: rows()[0] ?? null, error: rows()[0] ? null : { message: 'not found' } } },
      async maybeSingle() { const r = b._apply(); return { data: r[0] ?? null, error: null } },
      then(resolve) { resolve({ data: b._apply().slice(0, limit), error: null }) },
      _apply() { const r = rows(); if (patch) { r.forEach(row => Object.assign(row, patch)); writes.push([table, patch, r.map(x => x.id)]) } return r },
    }
    return b
  }
  return { from, writes }
}
const base = () => ({
  whatsapp_connections: [{ barbershop_id: 'shop', phone_number_id: '123', status: 'connected' }],
  barbershops: [{ id: 'shop', name: 'Kingsman' }],
  clients: [{ id: 'client', full_name: 'João  da Silva', phone: '(82) 99999-1234' }],
  subscriptions: [{ id: 'sub', client_id: 'client', status: 'active', contract_snapshot: { plan_name: 'Classic Corte', price_cents: 13499, frequency_months: 1 } }],
  payments: [],
  subscription_notices: [],
})
const notice = (extra) => ({ id: 'n1', barbershop_id: 'shop', subscription_id: 'sub', kind: 'welcome', status: 'pending', attempts: 0, send_after: '2026-11-20T11:55:00Z', created_at: '2026-11-20T11:55:00Z', updated_at: '2026-11-20T11:55:00Z', ...extra })
const deps = (sent, fail) => ({ token: async () => 'token', send: async (phone, token, to, name, params) => { if (fail) throw new Error(fail); sent.push({ phone, token, to, name, params }); return 'wamid.1' } })

test('aviso pendente sai pelo modelo certo, com o número no formato do WhatsApp, e fica marcado como enviado', async () => {
  const tables = base(); tables.subscription_notices.push(notice())
  const sent = []; const result = await runSubscriptionNotices(fakeDb(tables), NOW, deps(sent))
  assert.equal(result.sent, 1)
  assert.deepEqual(sent, [{ phone: '123', token: 'token', to: '5582999991234', name: 'assinatura_confirmada', params: ['João', 'Classic Corte', 'Kingsman', 'R$ 134,99', 'por mês'] }])
  assert.equal(tables.subscription_notices[0].status, 'sent'); assert.equal(tables.subscription_notices[0].provider_message_id, 'wamid.1'); assert.equal(tables.subscription_notices[0].attempts, 1)
})
test('sem WhatsApp conectado o aviso espera na fila; depois de 2 dias vence sem ser enviado', async () => {
  const tables = base(); tables.whatsapp_connections = []; tables.subscription_notices.push(notice())
  const sent = []
  assert.equal((await runSubscriptionNotices(fakeDb(tables), NOW, deps(sent))).waiting, 1)
  assert.equal(tables.subscription_notices[0].status, 'pending')
  tables.subscription_notices[0].send_after = '2026-11-17T12:00:00Z'
  assert.equal((await runSubscriptionNotices(fakeDb(tables), NOW, deps(sent))).expired, 1)
  assert.equal(tables.subscription_notices[0].status, 'expired'); assert.equal(sent.length, 0)
})
test('lembrete de cobrança é descartado se a mensalidade foi paga depois da recusa ou se o contrato já caiu', async () => {
  const tables = base(); tables.subscription_notices.push(notice({ kind: 'payment_reminder', created_at: '2026-11-14T10:00:00Z' }))
  tables.payments.push({ id: 'p', subscription_id: 'sub', status: 'paid', paid_at: '2026-11-16T10:00:00Z' })
  const sent = []; await runSubscriptionNotices(fakeDb(tables), NOW, deps(sent))
  assert.equal(tables.subscription_notices[0].status, 'skipped'); assert.equal(sent.length, 0)
  const other = base(); other.subscriptions[0].status = 'cancelled'; other.subscription_notices.push(notice({ kind: 'payment_failed' }))
  await runSubscriptionNotices(fakeDb(other), NOW, deps(sent))
  assert.equal(other.subscription_notices[0].status, 'skipped'); assert.equal(sent.length, 0)
})
test('cliente sem telefone válido não recebe e o motivo fica registrado', async () => {
  const tables = base(); tables.clients[0].phone = '123'; tables.subscription_notices.push(notice())
  await runSubscriptionNotices(fakeDb(tables), NOW, deps([]))
  assert.equal(tables.subscription_notices[0].status, 'skipped'); assert.match(tables.subscription_notices[0].last_error, /telefone/)
})
test('falha da Meta tenta de novo até 3 vezes e então desiste; envio interrompido não é repetido', async () => {
  const tables = base(); tables.subscription_notices.push(notice())
  await runSubscriptionNotices(fakeDb(tables), NOW, deps([], 'WhatsApp: template não aprovado'))
  assert.equal(tables.subscription_notices[0].status, 'pending'); assert.ok(tables.subscription_notices[0].send_after > NOW.toISOString())
  tables.subscription_notices[0].attempts = 2; tables.subscription_notices[0].send_after = '2026-11-20T11:59:00Z'
  await runSubscriptionNotices(fakeDb(tables), NOW, deps([], 'WhatsApp: template não aprovado'))
  assert.equal(tables.subscription_notices[0].status, 'failed')
  const stuck = base(); stuck.subscription_notices.push(notice({ status: 'sending', updated_at: '2026-11-20T11:00:00Z' }))
  const sent = []; await runSubscriptionNotices(fakeDb(stuck), NOW, deps(sent))
  assert.equal(stuck.subscription_notices[0].status, 'failed'); assert.equal(sent.length, 0)
})
test('parâmetros e textos dos modelos seguem as regras da Meta', () => {
  const context = { client: 'Ana Maria', plan: 'Plano\nWeek', shop: 'Kingsman', priceCents: 22999, months: 3 }
  assert.deepEqual(noticeParameters('welcome', context), ['Ana', 'Plano Week', 'Kingsman', 'R$ 229,99', 'a cada 3 meses'])
  assert.deepEqual(noticeParameters('payment_failed', context), ['Ana', 'R$ 229,99', 'Plano Week', 'Kingsman'])
  assert.deepEqual(noticeParameters('cancelled', context), ['Ana', 'Plano Week', 'Kingsman'])
  assert.equal(templateText('  a\t\tb    c ', 'x'), 'a b c'); assert.equal(templateText('', 'x'), 'x')
  for (const t of noticeTemplates) {
    const count = Math.max(...[...t.body.matchAll(/\{\{(\d+)\}\}/g)].map(m => Number(m[1])))
    assert.equal(t.examples.length, count, t.name); assert.equal(noticeParameters(t.kind, context).length, count, t.name)
    assert.doesNotMatch(t.body, /^\{\{|\}\}[.!]?$/, `${t.name} não pode começar nem terminar com variável`)
    assert.match(t.name, /^[a-z0-9_]+$/)
  }
  assert.equal(whatsappNumber('5582999991234'), '5582999991234'); assert.equal(whatsappNumber('8233334444'), '558233334444'); assert.equal(whatsappNumber('99 1234'), null)
})
