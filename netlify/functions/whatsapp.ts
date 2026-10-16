import type { Config } from '@netlify/functions'
import OpenAI from 'openai'
import type { SupabaseClient } from '@supabase/supabase-js'
import { body, db, failure, HttpError, json, optionalSetting, userFromRequest, uuid } from './_shared/core'
import { aiReply, type ChatTurn } from './_shared/whatsappAi'
import { exchangeSignupCode, graph, graphVersion, loadSecret, preview, saveSecret, sendText, whatsappReady } from './_shared/whatsapp'

type Input = Record<string, unknown>

async function requireAdmin(client: SupabaseClient, userId: string, shopId: string): Promise<void> {
  const [{ data: platform }, { data: member }] = await Promise.all([
    client.from('platform_admins').select('user_id').eq('user_id', userId).maybeSingle(),
    client.from('memberships').select('id').eq('barbershop_id', shopId).eq('user_id', userId).eq('role', 'admin').eq('active', true).maybeSingle(),
  ])
  if (!platform && !member) throw new HttpError(403, 'Acesso restrito ao administrador da barbearia.')
}

function digits(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{5,25}$/.test(value)) throw new HttpError(400, `${label} inválido.`)
  return value
}

async function sharedWabaId(token: string): Promise<string> {
  const appToken = `${optionalSetting('META_APP_ID')}|${optionalSetting('META_APP_SECRET')}`
  const info = await graph<{ data?: { granular_scopes?: { scope: string; target_ids?: string[] }[] } }>('debug_token', appToken, { query: { input_token: token } })
  const ids = info.data?.granular_scopes?.find(scope => scope.scope === 'whatsapp_business_management')?.target_ids ?? []
  if (!ids.length) throw new HttpError(400, 'Nenhuma conta do WhatsApp foi compartilhada na janela da Meta.')
  return digits(ids[0], 'Conta do WhatsApp')
}

async function firstPhoneNumberId(wabaId: string, token: string): Promise<string> {
  const list = await graph<{ data?: { id: string }[] }>(`${wabaId}/phone_numbers`, token, { query: { fields: 'id,display_phone_number,verified_name' } })
  const id = list.data?.[0]?.id
  if (!id) throw new HttpError(400, 'A conta do WhatsApp compartilhada ainda não tem número.')
  return digits(id, 'Número do WhatsApp')
}

async function connect(client: SupabaseClient, shopId: string, input: Input) {
  const ready = whatsappReady()
  if (!ready.ready) throw new HttpError(503, 'A integração com o WhatsApp ainda não foi configurada no sistema.')
  if (typeof input.code !== 'string' || input.code.length < 10 || input.code.length > 2000) throw new HttpError(400, 'Código de conexão inválido.')
  const coexistence = input.coexistence === true
  // O código vale por pouco tempo: troca primeiro, depois descobre a conta e o número se a janela da Meta não os enviou.
  const token = await exchangeSignupCode(input.code)
  const wabaId = input.waba_id ? digits(input.waba_id, 'Conta do WhatsApp') : await sharedWabaId(token)
  const phoneNumberId = input.phone_number_id ? digits(input.phone_number_id, 'Número do WhatsApp') : await firstPhoneNumberId(wabaId, token)
  const { data: taken } = await client.from('whatsapp_connections').select('barbershop_id').eq('phone_number_id', phoneNumberId).neq('barbershop_id', shopId).maybeSingle()
  if (taken) throw new HttpError(409, 'Este número já está conectado a outra barbearia.')
  const phone = await graph<{ display_phone_number?: string; verified_name?: string }>(phoneNumberId, token, { query: { fields: 'display_phone_number,verified_name' } })
  await graph(`${wabaId}/subscribed_apps`, token, { method: 'POST' })
  let pin: string | undefined
  if (!coexistence) {
    pin = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000))
    await graph(`${phoneNumberId}/register`, token, { method: 'POST', body: { messaging_product: 'whatsapp', pin } })
  } else {
    // Número que continua no app WhatsApp Business: a Meta exige sincronizar contatos e histórico logo após conectar.
    for (const syncType of ['smb_app_state_sync', 'history']) {
      try { await graph(`${phoneNumberId}/smb_app_data`, token, { method: 'POST', body: { messaging_product: 'whatsapp', sync_type: syncType } }) }
      catch (error) { console.warn('whatsapp coexistence sync', syncType, error) }
    }
  }
  await saveSecret(client, shopId, { token, pin })
  const now = new Date().toISOString()
  const { error } = await client.from('whatsapp_connections').upsert({
    barbershop_id: shopId, waba_id: wabaId, phone_number_id: phoneNumberId,
    display_phone_number: phone.display_phone_number || null, verified_name: phone.verified_name || null,
    coexistence, status: 'connected', last_error: null, connected_at: now, updated_at: now,
  })
  if (error) throw error
  return { connected: true, display_phone_number: phone.display_phone_number || null, verified_name: phone.verified_name || null }
}

async function settings(client: SupabaseClient, shopId: string, input: Input) {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof input.ai_enabled === 'boolean') patch.ai_enabled = input.ai_enabled
  if (typeof input.ai_can_book === 'boolean') patch.ai_can_book = input.ai_can_book
  if (input.ai_instructions !== undefined) {
    if (input.ai_instructions !== null && typeof input.ai_instructions !== 'string') throw new HttpError(400, 'Instruções inválidas.')
    const value = typeof input.ai_instructions === 'string' ? input.ai_instructions.trim() : ''
    if (value.length > 4000) throw new HttpError(400, 'As instruções podem ter até 4.000 caracteres.')
    patch.ai_instructions = value || null
  }
  if (input.human_pause_minutes !== undefined) {
    const minutes = Number(input.human_pause_minutes)
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) throw new HttpError(400, 'Tempo de pausa inválido.')
    patch.human_pause_minutes = minutes
  }
  const { data, error } = await client.from('whatsapp_connections').update(patch).eq('barbershop_id', shopId).select('barbershop_id').maybeSingle()
  if (error) throw error
  if (!data) throw new HttpError(409, 'Conecte o WhatsApp antes de configurar o atendimento.')
  return { saved: true }
}

async function conversationFor(client: SupabaseClient, shopId: string, value: unknown) {
  const id = uuid(value)
  const { data, error } = await client.from('whatsapp_conversations').select('id,wa_id,last_customer_message_at').eq('barbershop_id', shopId).eq('id', id).maybeSingle()
  if (error) throw error
  if (!data) throw new HttpError(404, 'Conversa não encontrada.')
  return data as { id: string; wa_id: string; last_customer_message_at: string | null }
}

async function conversationAction(client: SupabaseClient, shopId: string, action: string, input: Input) {
  const conversation = await conversationFor(client, shopId, input.conversation_id)
  if (action === 'read') {
    const { error } = await client.from('whatsapp_conversations').update({ unread_count: 0 }).eq('id', conversation.id)
    if (error) throw error
    return { ok: true }
  }
  if (action === 'pause' || action === 'resume') {
    const until = action === 'pause' ? new Date(Date.now() + 7 * 86_400_000).toISOString() : null
    const { error } = await client.from('whatsapp_conversations').update({ ai_paused_until: until }).eq('id', conversation.id)
    if (error) throw error
    return { ai_paused_until: until }
  }
  // send: resposta manual da equipe, apenas dentro das 24h após a última mensagem do cliente.
  const text = typeof input.text === 'string' ? input.text.trim() : ''
  if (!text || text.length > 4000) throw new HttpError(400, 'Escreva a mensagem (até 4.000 caracteres).')
  const last = conversation.last_customer_message_at ? Date.parse(conversation.last_customer_message_at) : 0
  if (Date.now() - last > 24 * 3_600_000) throw new HttpError(409, 'Passaram mais de 24h desde a última mensagem do cliente. O WhatsApp só permite responder dentro desse prazo.')
  const { data: connection, error: connectionError } = await client.from('whatsapp_connections').select('phone_number_id,human_pause_minutes,status').eq('barbershop_id', shopId).maybeSingle()
  if (connectionError) throw connectionError
  if (!connection || connection.status !== 'connected') throw new HttpError(409, 'WhatsApp não conectado.')
  const secret = await loadSecret(client, shopId)
  const messageId = await sendText(connection.phone_number_id, secret.token, conversation.wa_id, text)
  const now = new Date()
  const pauseUntil = new Date(now.getTime() + Math.max(connection.human_pause_minutes, 30) * 60_000).toISOString()
  const { error: insertError } = await client.from('whatsapp_messages').insert({ barbershop_id: shopId, conversation_id: conversation.id, wa_message_id: messageId, direction: 'out', author: 'staff', body: text, status: 'sent' })
  if (insertError) throw insertError
  const { error } = await client.from('whatsapp_conversations').update({ last_message_at: now.toISOString(), last_message_preview: preview(text), ai_paused_until: pauseUntil, unread_count: 0 }).eq('id', conversation.id)
  if (error) throw error
  return { sent: true, ai_paused_until: pauseUntil }
}

// Teste no painel: o dono escreve como se fosse um cliente e vê a resposta da IA. Nada é enviado nem gravado na agenda.
async function simulate(client: SupabaseClient, shopId: string, input: Input) {
  if (!optionalSetting('OPENAI_API_KEY')) throw new HttpError(503, 'A IA ainda não está ativa no servidor.')
  const raw = Array.isArray(input.turns) ? input.turns.slice(-12) : []
  const turns: ChatTurn[] = raw.flatMap(item => {
    const turn = item as { role?: unknown; content?: unknown }
    return (turn.role === 'user' || turn.role === 'assistant') && typeof turn.content === 'string' && turn.content.trim() ? [{ role: turn.role, content: turn.content.slice(0, 1000) }] : []
  })
  if (!turns.length || turns[turns.length - 1].role !== 'user') throw new HttpError(400, 'Escreva uma mensagem de cliente para testar.')
  const { data: connection } = await client.from('whatsapp_connections').select('ai_instructions,ai_can_book').eq('barbershop_id', shopId).maybeSingle()
  const settings = {
    ai_instructions: typeof input.ai_instructions === 'string' ? input.ai_instructions.slice(0, 4000) : connection?.ai_instructions ?? null,
    ai_can_book: typeof input.ai_can_book === 'boolean' ? input.ai_can_book : connection?.ai_can_book ?? true,
  }
  const reply = await aiReply(client, new OpenAI(), shopId, settings, turns, 'Cliente de teste', null)
  return { reply: reply || 'A IA não conseguiu responder agora. Tente de novo.' }
}

type Template = { id: string; name: string; status: string; category: string; language: string; components?: { type: string; text?: string }[] }

async function connectionWithToken(client: SupabaseClient, shopId: string) {
  const { data: connection, error } = await client.from('whatsapp_connections').select('waba_id,status').eq('barbershop_id', shopId).maybeSingle()
  if (error) throw error
  if (!connection || connection.status !== 'connected') throw new HttpError(409, 'WhatsApp não conectado.')
  return { wabaId: connection.waba_id as string, token: (await loadSecret(client, shopId)).token }
}

// Modelos de mensagem da conta do WhatsApp da barbearia (criados e aprovados pela Meta).
async function templates(client: SupabaseClient, shopId: string) {
  const { wabaId, token } = await connectionWithToken(client, shopId)
  const list = await graph<{ data?: Template[] }>(`${wabaId}/message_templates`, token, { query: { fields: 'id,name,status,category,language,components', limit: '50' } })
  return { templates: (list.data ?? []).map(t => ({ id: t.id, name: t.name, status: t.status, category: t.category, language: t.language, body: t.components?.find(c => c.type === 'BODY')?.text ?? '' })) }
}

async function createTemplate(client: SupabaseClient, shopId: string, input: Input) {
  const name = typeof input.name === 'string' ? input.name.trim().toLowerCase() : ''
  if (!/^[a-z0-9_]{1,512}$/.test(name)) throw new HttpError(400, 'Nome do modelo: use só letras minúsculas, números e _ (ex.: lembrete_horario).')
  const category = input.category === 'MARKETING' ? 'MARKETING' : 'UTILITY'
  const text = typeof input.body === 'string' ? input.body.trim() : ''
  if (!text || text.length > 1024) throw new HttpError(400, 'Escreva o texto do modelo (até 1.024 caracteres).')
  const variables = [...text.matchAll(/\{\{(\d+)\}\}/g)].map(m => Number(m[1]))
  const examples = Array.isArray(input.examples) ? input.examples.filter((v): v is string => typeof v === 'string' && !!v.trim()).map(v => v.trim()) : []
  if (variables.length && examples.length < Math.max(...variables)) throw new HttpError(400, 'Informe um exemplo para cada variável {{1}}, {{2}}...')
  const { wabaId, token } = await connectionWithToken(client, shopId)
  const body = { type: 'BODY', text, ...(variables.length ? { example: { body_text: [examples.slice(0, Math.max(...variables))] } } : {}) }
  const result = await graph<{ id?: string; status?: string; category?: string }>(`${wabaId}/message_templates`, token, {
    method: 'POST', body: { name, category, language: 'pt_BR', components: [body] },
  })
  return { id: result.id ?? null, status: result.status ?? 'PENDING', category: result.category ?? category }
}

async function disconnect(client: SupabaseClient, shopId: string) {
  const { data: connection } = await client.from('whatsapp_connections').select('waba_id').eq('barbershop_id', shopId).maybeSingle()
  if (connection) {
    try {
      const secret = await loadSecret(client, shopId)
      await graph(`${connection.waba_id}/subscribed_apps`, secret.token, { method: 'DELETE' })
    } catch (error) { console.warn('whatsapp unsubscribe', error) }
  }
  const { error } = await client.from('whatsapp_connections').update({ status: 'disconnected', ai_enabled: false, updated_at: new Date().toISOString() }).eq('barbershop_id', shopId)
  if (error) throw error
  const { error: credentialError } = await client.from('whatsapp_credentials').delete().eq('barbershop_id', shopId)
  if (credentialError) throw credentialError
  return { disconnected: true }
}

export default async (request: Request) => {
  try {
    const action = new URL(request.url).pathname.split('/').pop() || ''
    if (action === 'config' && request.method === 'GET') {
      const ready = whatsappReady()
      return json({ ready: ready.ready, app_id: ready.ready ? optionalSetting('META_APP_ID') : null, config_id: ready.ready ? optionalSetting('WHATSAPP_ES_CONFIG_ID') : null, graph_version: graphVersion(), ai_ready: !!optionalSetting('OPENAI_API_KEY') })
    }
    if (request.method !== 'POST') throw new HttpError(405, 'Método não permitido.')
    const client = db()
    const user = await userFromRequest(request, client)
    const input = await body<Input>(request)
    const shopId = uuid(input.barbershop_id)
    await requireAdmin(client, user.id, shopId)
    if (action === 'connect') return json(await connect(client, shopId, input))
    if (action === 'settings') return json(await settings(client, shopId, input))
    if (action === 'simulate') return json(await simulate(client, shopId, input))
    if (action === 'templates') return json(await templates(client, shopId))
    if (action === 'template-create') return json(await createTemplate(client, shopId, input))
    if (action === 'disconnect') return json(await disconnect(client, shopId))
    if (['read', 'pause', 'resume', 'send'].includes(action)) return json(await conversationAction(client, shopId, action, input))
    throw new HttpError(404, 'Ação desconhecida.')
  } catch (error) { return failure(error) }
}

export const config: Config = { path: '/api/whatsapp/:action' }
