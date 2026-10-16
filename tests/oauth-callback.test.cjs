const assert = require('node:assert/strict')
const { test } = require('node:test')
const childProcess = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const project = path.resolve(__dirname, '..')
const generated = path.join(project, 'node_modules', '.cache', 'oauth-callback-test')
fs.mkdirSync(generated, { recursive: true })
fs.writeFileSync(path.join(generated, 'package.json'), '{"type":"commonjs"}')
const compile = childProcess.spawnSync(process.execPath, [
  path.join(project, 'node_modules', 'typescript', 'bin', 'tsc'),
  '--ignoreConfig', '--target', 'ES2022', '--module', 'commonjs', '--moduleResolution', 'bundler',
  '--skipLibCheck', '--noCheck', '--rewriteRelativeImportExtensions', '--rootDir', '.', '--outDir', generated,
  'netlify/functions/mercadopago.ts', 'netlify/functions/instagram.ts',
], { cwd: project, encoding: 'utf8' })
if (compile.status !== 0) throw new Error(compile.stderr || compile.stdout || 'TypeScript compilation failed')
const { seal } = require(path.join(generated, 'netlify/functions/_shared/mpCrypto.js'))

const settings = {
  SUPABASE_URL: 'https://database.test', SUPABASE_SECRET_KEY: 'test-secret-key',
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  MP_CLIENT_ID: 'test-client', MP_CLIENT_SECRET: 'test-client-secret',
  MP_OAUTH_REDIRECT_URI: 'https://system.test/api/mercadopago/oauth-callback',
  MP_OAUTH_RETURN_URL: 'https://system.test/?page=settings',
  META_GRAPH_VERSION: 'v23.0', META_APP_ID: 'test-app', META_APP_SECRET: 'test-app-secret',
  META_OAUTH_REDIRECT_URI: 'https://system.test/api/instagram/callback',
  META_OAUTH_RETURN_URL: 'https://system.test/?page=marketing',
}
global.Netlify = { env: { get: name => settings[name] } }

function response(data) {
  return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } })
}

test('callback Mercado Pago conclui o redirecionamento e limpa o cookie OAuth', async () => {
  const { default: handler } = require(path.join(generated, 'netlify/functions/mercadopago.js'))
  const writes = []
  const originalFetch = global.fetch
  global.fetch = async (url, options = {}) => {
    const address = new URL(url)
    if (address.hostname === 'database.test' && address.pathname.endsWith('/memberships')) return response({ id: 'member' })
    if (address.hostname === 'database.test' && address.pathname.endsWith('/integration_credentials')) {
      writes.push(JSON.parse(options.body)); return response(null)
    }
    assert.equal(address.href, 'https://api.mercadopago.com/oauth/token')
    return response({ access_token: 'fixture-token', refresh_token: 'fixture-refresh', user_id: '123', scope: 'offline_access', expires_in: 3600 })
  }
  try {
    const encrypted = await seal({ state: 'fixture-state', verifier: 'fixture-verifier', shopId: 'shop', userId: 'actor', expiresAt: Date.now() + 60_000 })
    const result = await handler(new Request('https://system.test/api/mercadopago/oauth-callback?state=fixture-state&code=fixture-code', {
      headers: { cookie: `barber_mp_oauth=${encrypted}` },
    }))
    assert.equal(result.status, 303)
    assert.equal(result.headers.get('location'), settings.MP_OAUTH_RETURN_URL)
    assert.match(result.headers.get('set-cookie'), /barber_mp_oauth=; Max-Age=0/)
    assert.equal(writes.length, 1)
    assert.equal(writes[0].provider, 'mercadopago')
  } finally { global.fetch = originalFetch }
})

test('callback Instagram conclui o redirecionamento e limpa o cookie OAuth', async () => {
  const { default: handler } = require(path.join(generated, 'netlify/functions/instagram.js'))
  const writes = []
  const originalFetch = global.fetch
  global.fetch = async (url, options = {}) => {
    const address = new URL(url)
    if (address.hostname === 'database.test' && address.pathname.endsWith('/memberships')) return response({ id: 'member' })
    if (address.hostname === 'database.test') { writes.push([address.pathname, JSON.parse(options.body)]); return response(null) }
    if (address.pathname.endsWith('/oauth/access_token')) return response({ access_token: 'fixture-meta-token', expires_in: 3600 })
    if (address.pathname.endsWith('/me/accounts')) return response({ data: [{ id: 'page', instagram_business_account: { id: 'ig', username: 'fixture' } }] })
    if (address.pathname.endsWith('/me/adaccounts')) return response({ data: [] })
    throw new Error(`Unexpected URL ${address.origin}${address.pathname}`)
  }
  try {
    const encrypted = await seal({ state: 'fixture-state', shopId: 'shop', userId: 'actor', expiresAt: Date.now() + 60_000 })
    const result = await handler(new Request('https://system.test/api/instagram/callback?state=fixture-state&code=fixture-code', {
      headers: { cookie: `barber_meta_oauth=${encrypted}` },
    }))
    assert.equal(result.status, 303)
    assert.equal(result.headers.get('location'), settings.META_OAUTH_RETURN_URL)
    assert.match(result.headers.get('set-cookie'), /barber_meta_oauth=; Max-Age=0/)
    assert.equal(writes.length, 2)
  } finally { global.fetch = originalFetch }
})
