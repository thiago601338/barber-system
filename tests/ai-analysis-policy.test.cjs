const assert = require('node:assert/strict')
const { test } = require('node:test')

test('master pode analisar uma barbearia sem depender das permissões de integrante', async () => {
  const { canAnalyzeWithAi, aiAnalysisDailyLimit } = await import('../netlify/functions/_shared/aiAnalysisPolicy.ts')
  for (const kind of ['financial', 'marketing', 'request']) {
    assert.equal(canAnalyzeWithAi(kind, 'master'), true)
  }
  assert.equal(aiAnalysisDailyLimit('master'), 50)
})

test('administrador da barbearia pode consultar os três tipos e tem limite próprio', async () => {
  const { canAnalyzeWithAi, aiAnalysisDailyLimit } = await import('../netlify/functions/_shared/aiAnalysisPolicy.ts')
  for (const kind of ['financial', 'marketing', 'request']) {
    assert.equal(canAnalyzeWithAi(kind, 'admin'), true)
  }
  assert.equal(aiAnalysisDailyLimit('admin'), 20)
})

test('barbeiro depende das abas liberadas e nunca consulta finanças gerais', async () => {
  const { canAnalyzeWithAi, aiAnalysisDailyLimit } = await import('../netlify/functions/_shared/aiAnalysisPolicy.ts')
  assert.equal(canAnalyzeWithAi('financial', 'barber', ['ai', 'marketing']), false)
  assert.equal(canAnalyzeWithAi('request', 'barber', []), false)
  assert.equal(canAnalyzeWithAi('request', 'barber', ['ai']), true)
  assert.equal(canAnalyzeWithAi('marketing', 'barber', ['ai']), false)
  assert.equal(canAnalyzeWithAi('marketing', 'barber', ['marketing']), false)
  assert.equal(canAnalyzeWithAi('marketing', 'barber', ['ai', 'marketing']), true)
  assert.equal(aiAnalysisDailyLimit('barber'), 10)
})

test('cliente não consulta a IA nem recebe cota', async () => {
  const { canAnalyzeWithAi, aiAnalysisDailyLimit } = await import('../netlify/functions/_shared/aiAnalysisPolicy.ts')
  for (const kind of ['financial', 'marketing', 'request']) {
    assert.equal(canAnalyzeWithAi(kind, 'client', ['ai', 'marketing']), false)
  }
  assert.equal(aiAnalysisDailyLimit('client'), 0)
})
