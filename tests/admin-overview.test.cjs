const assert = require('node:assert/strict')
const childProcess = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const project = path.resolve(__dirname, '..')
const generated = path.join(project, 'node_modules', '.cache', 'admin-overview-test')
fs.mkdirSync(generated, { recursive: true })
fs.writeFileSync(path.join(generated, 'package.json'), '{"type":"commonjs"}')
const compile = childProcess.spawnSync(process.execPath, [
  path.join(project, 'node_modules', 'typescript', 'bin', 'tsc'),
  '--ignoreConfig', '--target', 'ES2022', '--module', 'commonjs',
  '--moduleResolution', 'bundler', '--skipLibCheck', '--noCheck',
  '--rootDir', 'netlify/functions', '--outDir', generated,
  'netlify/functions/admin.ts',
], { cwd: project, encoding: 'utf8' })
if (compile.status !== 0) throw new Error(compile.stderr || compile.stdout || 'TypeScript transpilation failed')

const core = require(path.join(generated, '_shared', 'core.js'))
const handler = require(path.join(generated, 'admin.js')).default
const { paymentConfiguration } = require(path.join(generated, '_shared', 'mpConfiguration.js'))
global.Netlify = { env: { get() { return undefined } } }

test('payment diagnostics report configuration presence without returning credential values', () => {
  const values = {
    MP_CLIENT_ID: 'dummy-client-id', MP_CLIENT_SECRET: 'dummy-client-secret',
    MP_OAUTH_REDIRECT_URI: 'https://barber-system-yqu5.netlify.app/api/mercadopago/oauth-callback',
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    MP_WEBHOOK_SECRET: 'dummy-shop-webhook',
    MP_CUSTOMER_BACK_URL: 'https://barber-system-yqu5.netlify.app/',
    MP_PLATFORM_ACCESS_TOKEN: 'dummy-platform-token', MP_PLATFORM_ACCOUNT_ID: '123456',
    MP_PLATFORM_WEBHOOK_SECRET: 'dummy-platform-webhook',
    MP_SAAS_BACK_URL: 'https://barber-system-yqu5.netlify.app/',
  }
  global.Netlify.env.get = name => values[name]
  const diagnostics = paymentConfiguration()
  assert.equal(Object.values(diagnostics).every(Boolean), true)
  assert.equal(JSON.stringify(diagnostics).includes('dummy-'), false)
  global.Netlify.env.get = name => name === 'MP_OAUTH_REDIRECT_URI'
    ? 'https://barber-system-yqu5.netlify.app/incorrect' : values[name]
  assert.equal(paymentConfiguration().shop_oauth_configured, false)
  global.Netlify.env.get = () => undefined
})

test('master overview uses all invoice pages and separates contracted, received and unpaid amounts', async () => {
  let authorized = false
  const currentMonth = new Date().toISOString().slice(0, 7)
  core.db = () => ({
    from(table) {
      assert.equal(authorized, true)
      const query = {
        select() { return query },
        eq() { return query },
        order() { return query },
        single: async () => ({ data: { seat_price_cents: 1200, billing_enabled: true }, error: null }),
        range: async (from, to) => {
          const records = {
            barbershops: [{ id: 'shop-1', name: 'Kingsman', slug: 'kingsman', active: true,
              base_monthly_cents: 1000, per_barber_monthly_cents: 1500 }],
            memberships: [{ id: 'member-1', barbershop_id: 'shop-1', role: 'barber', active: true }],
            platform_subscriptions: [{ barbershop_id: 'shop-1', status: 'authorized', amount_cents: 1200,
              seat_count: 1, updated_at: '2026-09-28T00:00:00Z' }],
            platform_invoices: Array.from({ length: 1001 }, (_, index) => ({
              id: `invoice-${index}`, barbershop_id: 'shop-1', period_start: `${currentMonth}-01`,
              period_end: '2026-09-30', seat_count: 1, amount_cents: 1200,
              status: index === 1000 ? 'rejected' : 'paid', created_at: '2026-09-28T00:00:00Z',
            })),
          }[table]
          if (!records) throw new Error(`Unexpected table ${table}`)
          return { data: records.slice(from, to + 1), error: null }
        },
      }
      return query
    },
  })
  core.userFromRequest = async () => ({ id: 'master-1' })
  core.requirePlatformAdmin = async (_, userId) => { assert.equal(userId, 'master-1'); authorized = true }
  const response = await handler(new Request('https://barber-system-yqu5.netlify.app/api/admin/overview'))
  assert.equal(response.status, 200)
  const data = await response.json()
  assert.equal(data.invoices.length, 100)
  assert.equal(data.summary.active_barbers, 1)
  assert.equal(data.summary.monthly_potential_cents, 2500)
  assert.equal(data.summary.monthly_expected_cents, 1200)
  assert.equal(data.summary.invoiced_cents, 1201200)
  assert.equal(data.summary.paid_cents, 1200000)
  assert.equal(data.summary.outstanding_cents, 0)
  assert.equal(data.summary.failed_cents, 1200)
  assert.equal(data.summary.refunded_cents, 0)
  assert.equal(data.summary.paid_invoice_count, 1000)
  assert.equal(data.summary.open_invoice_count, 0)
  assert.equal(data.summary.failed_invoice_count, 1)
  assert.equal(data.summary.active_subscription_count, 1)
  assert.equal(data.summary.unconfigured_shop_count, 0)
  assert.equal(data.payment_configuration.shop_oauth_configured, false)
  assert.equal(data.payment_configuration.platform_credentials_present, false)
  assert.equal(data.monthly.at(-1).month, currentMonth)
  assert.equal(data.monthly.at(-1).paid_cents, 1200000)
  assert.equal(data.monthly.at(-1).failed_cents, 1200)
})
