const assert = require('node:assert/strict')
const { test } = require('node:test')

const address = 'barbeiro@example.invalid'
const userId = '73000000-0000-4000-8000-000000000009'
const redirectTo = 'https://barber-system-yqu5.netlify.app/entrar'
const authOrigin = 'https://oyjiiqbsbshfdgdaxbus.supabase.co'
const inviteUrl = `${authOrigin}/auth/v1/verify?token=secret-test-token&type=invite&redirect_to=${encodeURIComponent(redirectTo)}`
const unexpectedLookup = async () => { throw new Error('Não deveria consultar usuário existente') }

async function subject() {
  return import('../netlify/functions/_shared/inviteFallback.ts')
}

test('envio normal vincula o mesmo usuário e não produz link manual', async () => {
  const { prepareAndSaveMemberInvite } = await subject()
  const saved = []
  const result = await prepareAndSaveMemberInvite({
    email: address, authOrigin, redirectTo,
    lookupExistingUser: unexpectedLookup,
    sendInvite: async () => ({ data: { user: { id: userId, email: address } }, error: null }),
    generateInvite: async () => { throw new Error('Não deveria gerar link') },
    saveMembership: async id => { saved.push(id); return { error: null } },
  })
  assert.deepEqual(saved, [userId])
  assert.deepEqual(result, { delivery: 'email', invited: true, email_sent: true })
})

test('limite de e-mail gera link manual sem disparar nova mensagem e salva membership', async () => {
  const { prepareAndSaveMemberInvite } = await subject()
  const calls = []
  const result = await prepareAndSaveMemberInvite({
    email: address, authOrigin, redirectTo,
    lookupExistingUser: unexpectedLookup,
    sendInvite: async () => { calls.push('email'); return { data: null, error: { status: 429, code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' } } },
    generateInvite: async () => { calls.push('link'); return { data: { user: { id: userId, email: address }, properties: { action_link: inviteUrl } }, error: null } },
    saveMembership: async id => { calls.push(`membership:${id}`); return { error: null } },
  })
  assert.deepEqual(calls, ['email', 'link', `membership:${userId}`])
  assert.deepEqual(result, { delivery: 'manual_link', invited: true, email_sent: false, invite_url: inviteUrl })
})

test('conta existente é vinculada sem novo Auth user, e sem link de acesso', async () => {
  const { prepareAndSaveMemberInvite } = await subject()
  const calls = []
  const result = await prepareAndSaveMemberInvite({
    email: address, existingUserId: userId, authOrigin, redirectTo,
    lookupExistingUser: async id => { calls.push(`lookup:${id}`); return { data: { user: { id: userId, email: address, email_confirmed_at: '2026-09-28T00:00:00Z' } }, error: null } },
    sendInvite: async () => { calls.push('email'); throw new Error('unexpected') },
    generateInvite: async () => { calls.push('link'); throw new Error('unexpected') },
    saveMembership: async id => { calls.push(id); return { error: null } },
  })
  assert.deepEqual(calls, [`lookup:${userId}`, userId])
  assert.deepEqual(result, { delivery: 'existing_account', invited: false, email_sent: false })
})

test('link manual perdido pode ser regenerado para a mesma conta ainda não confirmada', async () => {
  const { prepareAndSaveMemberInvite } = await subject()
  const calls = []
  let token = 0
  const args = {
    email: address, authOrigin, redirectTo,
    lookupExistingUser: async id => {
      calls.push(`lookup:${id}`)
      return { data: { user: { id: userId, email: address, email_confirmed_at: null } }, error: null }
    },
    sendInvite: async () => {
      calls.push('email')
      return { data: null, error: { status: 429, code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' } }
    },
    generateInvite: async () => {
      calls.push('link')
      token += 1
      return { data: { user: { id: userId, email: address }, properties: { action_link: `${authOrigin}/auth/v1/verify?token=secret-test-${token}&type=invite&redirect_to=${encodeURIComponent(redirectTo)}` } }, error: null }
    },
    saveMembership: async id => { calls.push(`membership:${id}`); return { error: null } },
  }
  const first = await prepareAndSaveMemberInvite(args)
  const retry = await prepareAndSaveMemberInvite({ ...args, existingUserId: userId })
  assert.deepEqual(calls, ['email', 'link', `membership:${userId}`, `lookup:${userId}`, 'link', `membership:${userId}`])
  assert.equal(first.delivery, 'manual_link')
  assert.equal(retry.delivery, 'manual_link')
  assert.equal(retry.email_sent, false)
  assert.notEqual(retry.invite_url, first.invite_url)
})

test('perfil existente divergente não recebe vínculo nem novo convite', async () => {
  const { prepareAndSaveMemberInvite, InviteFlowError } = await subject()
  let saved = false
  await assert.rejects(prepareAndSaveMemberInvite({
    email: address, existingUserId: userId, authOrigin, redirectTo,
    lookupExistingUser: async () => ({ data: { user: { id: userId, email: 'outra@example.invalid', email_confirmed_at: null } }, error: null }),
    sendInvite: async () => { throw new Error('unexpected') },
    generateInvite: async () => { throw new Error('unexpected') },
    saveMembership: async () => { saved = true; return { error: null } },
  }), error => error instanceof InviteFlowError && error.stage === 'lookup')
  assert.equal(saved, false)
})

test('outra falha 429 não gera link e não cria membership', async () => {
  const { prepareAndSaveMemberInvite, InviteFlowError } = await subject()
  let saved = false
  await assert.rejects(prepareAndSaveMemberInvite({
    email: address, authOrigin, redirectTo,
    lookupExistingUser: unexpectedLookup,
    sendInvite: async () => ({ data: null, error: { status: 429, code: 'over_request_rate_limit', message: 'too many requests' } }),
    generateInvite: async () => { throw new Error('unexpected') },
    saveMembership: async () => { saved = true; return { error: null } },
  }), error => error instanceof InviteFlowError && error.stage === 'send')
  assert.equal(saved, false)
})

test('link inválido ou vínculo com falha nunca é devolvido ao navegador', async () => {
  const { prepareAndSaveMemberInvite, InviteFlowError } = await subject()
  const base = {
    email: address, authOrigin, redirectTo,
    lookupExistingUser: unexpectedLookup,
    sendInvite: async () => ({ data: null, error: { status: 429, code: 'over_email_send_rate_limit' } }),
  }
  let saved = false
  await assert.rejects(prepareAndSaveMemberInvite({
    ...base,
    generateInvite: async () => ({ data: { user: { id: userId, email: address }, properties: { action_link: 'https://example.net/steal' } }, error: null }),
    saveMembership: async () => { saved = true; return { error: null } },
  }), error => error instanceof InviteFlowError && error.stage === 'generate')
  assert.equal(saved, false)
  await assert.rejects(prepareAndSaveMemberInvite({
    ...base,
    generateInvite: async () => ({ data: { user: { id: userId, email: address }, properties: { action_link: `${authOrigin}/auth/v1/verify?token=secret-test-token&type=invite&redirect_to=${encodeURIComponent(`${redirectTo}?shop=kingsman`)}` } }, error: null }),
    saveMembership: async () => { saved = true; return { error: null } },
  }), error => error instanceof InviteFlowError && error.stage === 'generate')
  assert.equal(saved, false)
  await assert.rejects(prepareAndSaveMemberInvite({
    ...base,
    generateInvite: async () => ({ data: { user: { id: userId, email: address }, properties: { action_link: inviteUrl } }, error: null }),
    saveMembership: async () => ({ error: { message: 'database unavailable' } }),
  }), error => error instanceof InviteFlowError && error.stage === 'membership')
})
