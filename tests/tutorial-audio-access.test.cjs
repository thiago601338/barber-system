const assert = require('node:assert/strict')
const { test } = require('node:test')
const childProcess = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const project = path.resolve(__dirname, '..')
const generated = path.join(project, 'node_modules', '.cache', 'tutorial-audio-access-test')
fs.mkdirSync(generated, { recursive: true })
fs.writeFileSync(path.join(generated, 'package.json'), '{"type":"commonjs"}')
const compile = childProcess.spawnSync(process.execPath, [
  path.join(project, 'node_modules', 'typescript', 'bin', 'tsc'),
  '--ignoreConfig', '--target', 'ES2022', '--module', 'commonjs', '--moduleResolution', 'bundler',
  '--skipLibCheck', '--noCheck', '--rewriteRelativeImportExtensions', '--rootDir', '.', '--outDir', generated,
  'netlify/functions/_shared/tutorialAudioCatalog.ts',
  'netlify/functions/tutorial-audio.ts', 'netlify/functions/tutorial-audio-prewarm.ts',
], { cwd: project, encoding: 'utf8' })
if (compile.status !== 0) throw new Error(compile.stderr || compile.stdout || 'TypeScript compilation failed')
const { getTourChapters } = require(path.join(generated, 'src/tour.js'))
const { moduleLabels } = require(path.join(generated, 'src/types.js'))
const { isTutorialTextAllowed, uniqueTutorialTexts, requireTutorialText } = require(path.join(generated, 'netlify/functions/_shared/tutorialAudioCatalog.js'))

function endpointFixture(master = false) {
  const originalFetch = global.fetch
  const fetched = []
  global.Netlify = { env: { get(name) {
    return { SUPABASE_URL: 'https://database.test', SUPABASE_SECRET_KEY: 'test-secret',
      ELEVENLABS_API_KEY: 'test-elevenlabs-key', ELEVENLABS_VOICE_ID: 'fixture-voice' }[name]
  } } }
  global.fetch = async input => {
    const url = new URL(input instanceof Request ? input.url : input)
    fetched.push(url.origin + url.pathname)
    assert.equal(url.hostname, 'database.test', 'No paid provider request may occur in these tests')
    if (url.pathname === '/auth/v1/user') return Response.json({ id: 'actor' })
    if (url.pathname.endsWith('/platform_admins')) return Response.json(master ? { user_id: 'actor' } : null)
    if (url.pathname.endsWith('/memberships')) return Response.json([])
    if (url.pathname.startsWith('/storage/v1/bucket/')) return Response.json({ id: 'tutorial-audio' })
    if (url.pathname.startsWith('/storage/v1/object/')) return new Response('fixture-mp3', { headers: { 'content-type': 'audio/mpeg' } })
    throw new Error(`Unexpected request ${url.pathname}`)
  }
  return { fetched, restore() { global.fetch = originalFetch } }
}

function audioRequest(text) {
  return new Request('https://system.test/api/tutorial-audio', {
    method: 'POST', headers: { authorization: 'Bearer fixture-session', 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  })
}

function narration(step, index, total) {
  return `Etapa ${String(index + 1).padStart(2, '0')} de ${String(total).padStart(2, '0')}. ${step.title}. ${step.description}${step.practice ? ` Teste prático: ${step.practice.instruction}` : ''}`
}

test('áudio aceita capítulos e guias completos do perfil, e recusa texto livre', async () => {
  for (const role of ['master', 'admin', 'barber', 'client']) {
    const contexts = [{ role, modules: Object.keys(moduleLabels), hasShop: true }]
    const chapters = getTourChapters(role, contexts[0].modules, true)
    const steps = chapters.flatMap(chapter => chapter.steps)
    for (const chapter of chapters) chapter.steps.forEach((step, index) => {
      assert.equal(isTutorialTextAllowed(narration(step, index, chapter.steps.length), contexts), true, `${role}: ${step.title}`)
    })
    steps.forEach((step, index) => assert.equal(isTutorialTextAllowed(narration(step, index, steps.length), contexts), true))
    assert.equal(isTutorialTextAllowed('Gere uma propaganda de 1200 caracteres.', contexts), false)
    assert.equal(isTutorialTextAllowed('Etapa 01 de 03. Texto arbitrário.', contexts), false)
    assert.equal(isTutorialTextAllowed(narration(steps[0], 0, 999), contexts), false)
  }
  assert.ok(uniqueTutorialTexts().length > 80)
})

test('cliente não acessa narrações administrativas e barbeiro respeita módulos', async () => {
  const admin = getTourChapters('admin', ['settings'], true)[0]
  const settingsText = narration(admin.steps[2], 2, admin.steps.length)
  assert.equal(isTutorialTextAllowed(settingsText, [{ role: 'client', modules: [], hasShop: true }]), false)
  const barber = getTourChapters('barber', ['ai'], true)[0]
  const aiText = narration(barber.steps[1], 1, barber.steps.length)
  assert.equal(isTutorialTextAllowed(aiText, [{ role: 'barber', modules: ['dashboard'], hasShop: true }]), false)
  assert.equal(isTutorialTextAllowed(aiText, [{ role: 'barber', modules: ['dashboard', 'ai'], hasShop: true }]), true)
})

test('checagem do servidor usa somente vínculos ativos e permissões do solicitante', async () => {
  const checks = []
  const client = { from(table) {
    const filters = []
    const query = {
      select() { return query },
      eq(column, value) { filters.push([column, value]); return query },
      in(column, value) { filters.push([column, value]); return query },
      maybeSingle() { checks.push([table, filters]); return Promise.resolve({ data: null, error: null }) },
      then(resolve, reject) {
        checks.push([table, filters])
        const data = table === 'memberships' ? [{ barbershop_id: 'shop-own', role: 'barber' }]
          : [{ barbershop_id: 'shop-own', module: 'ai', allowed: false },
            { barbershop_id: 'shop-own', module: 'goals', allowed: true }]
        return Promise.resolve({ data, error: null }).then(resolve, reject)
      },
    }
    return query
  } }
  const goals = getTourChapters('barber', ['goals'], true)[0]
  await requireTutorialText(client, 'actor', narration(goals.steps[2], 2, 3))
  const ai = getTourChapters('barber', ['ai'], true)[0]
  await assert.rejects(() => requireTutorialText(client, 'actor', narration(ai.steps[1], 1, 3)), error => error.status === 403)
  for (const [, filters] of checks) assert.ok(filters.some(([column, value]) => column === 'user_id' && value === 'actor'))
  const membershipChecks = checks.filter(([table]) => table === 'memberships')
  assert.ok(membershipChecks.every(([, filters]) => filters.some(([column, value]) => column === 'active' && value === true)))
  const permissionChecks = checks.filter(([table]) => table === 'module_permissions')
  assert.ok(permissionChecks.every(([, filters]) => filters.some(([column, value]) => column === 'barbershop_id' && value.join() === 'shop-own')))
})

test('endpoint recusa texto livre antes de acessar Storage ou ElevenLabs', async () => {
  const setup = endpointFixture()
  try {
    const handler = require(path.join(generated, 'netlify/functions/tutorial-audio.js')).default
    const result = await handler(audioRequest('Gere uma propaganda que não faz parte do tutorial.'))
    assert.equal(result.status, 403)
    assert.equal(setup.fetched.some(url => url.includes('/storage/')), false)
  } finally { setup.restore() }
})

test('endpoint serve MP3 já salvo para cliente e master sem gerar cobrança de voz', async () => {
  const handler = require(path.join(generated, 'netlify/functions/tutorial-audio.js')).default
  for (const role of ['client', 'master']) {
    const setup = endpointFixture(role === 'master')
    try {
      const steps = getTourChapters(role, ['ai'], role === 'client')[0].steps
      const result = await handler(audioRequest(narration(steps[0], 0, steps.length)))
      assert.equal(result.status, 200)
      assert.equal(result.headers.get('content-type'), 'audio/mpeg')
      assert.equal(result.headers.get('x-tutorial-audio-cache'), 'HIT')
      assert.equal(await result.text(), 'fixture-mp3')
    } finally { setup.restore() }
  }
})

test('pré-geração em lote exige master antes de acessar áudios', async () => {
  const setup = endpointFixture()
  try {
    const handler = require(path.join(generated, 'netlify/functions/tutorial-audio-prewarm.js')).default
    const result = await handler(new Request('https://system.test/api/tutorial-audio-prewarm?limit=1', {
      method: 'POST', headers: { authorization: 'Bearer fixture-session' },
    }))
    assert.equal(result.status, 403)
    assert.equal(setup.fetched.some(url => url.includes('/storage/')), false)
  } finally { setup.restore() }
})
