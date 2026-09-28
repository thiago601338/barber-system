const assert = require('node:assert/strict')
const { test } = require('node:test')

test('barbeiro precisa de IA e Marketing para consultar dados de marketing', async () => {
  const { canUseAiKind } = await import('../netlify/functions/_shared/aiAccess.ts')
  assert.equal(canUseAiKind('marketing', ['ai']), false)
  assert.equal(canUseAiKind('marketing', ['marketing']), false)
  assert.equal(canUseAiKind('marketing', ['ai', 'marketing']), true)
  assert.equal(canUseAiKind('request', ['ai']), true)
  assert.equal(canUseAiKind('request', []), false)
})
