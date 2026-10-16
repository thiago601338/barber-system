import type { Config } from '@netlify/functions'
import type { SupabaseClient } from '@supabase/supabase-js'
import { db, optionalSetting } from './_shared/core'
import { constantTimeEqual } from './_shared/mpCrypto'
import { internalToken, isContactId, preview, verifyMetaSignature } from './_shared/whatsapp'

// Recebe as mensagens do WhatsApp (Cloud API). A IA só responde mensagens que o cliente envia:
// o webhook guarda a mensagem e chama a resposta em segundo plano.

type Contact = { wa_id?: string; user_id?: string; profile?: { name?: string; username?: string } }
type Message = {
  from?: string; from_user_id?: string; to?: string; to_user_id?: string; id?: string; timestamp?: string; type?: string
  text?: { body?: string }
  button?: { text?: string }
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } }
  audio?: { id?: string }; voice?: { id?: string }
  image?: { caption?: string }; video?: { caption?: string }; document?: { caption?: string; filename?: string }
  location?: { name?: string; address?: string }
}
type Status = { id?: string; status?: string; errors?: { title?: string; message?: string }[] }
type ChangeValue = { metadata?: { phone_number_id?: string }; contacts?: Contact[]; messages?: Message[]; statuses?: Status[]; message_echoes?: Message[] }
type Payload = { object?: string; entry?: { changes?: { field?: string; value?: ChangeValue }[] }[] }
type Connection = { barbershop_id: string; ai_enabled: boolean; human_pause_minutes: number }

function messageBody(message: Message): { kind: string; body: string } {
  switch (message.type) {
    case 'text': return { kind: 'text', body: message.text?.body || '' }
    case 'button': return { kind: 'text', body: message.button?.text || '' }
    case 'interactive': return { kind: 'text', body: message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || '' }
    case 'audio': case 'voice': return { kind: 'audio', body: '' }
    case 'image': return { kind: 'image', body: message.image?.caption ? `[imagem] ${message.image.caption}` : '[imagem]' }
    case 'video': return { kind: 'video', body: message.video?.caption ? `[vídeo] ${message.video.caption}` : '[vídeo]' }
    case 'document': return { kind: 'document', body: `[documento] ${message.document?.caption || message.document?.filename || ''}`.trim() }
    case 'location': return { kind: 'location', body: `[localização] ${message.location?.name || message.location?.address || ''}`.trim() }
    case 'sticker': return { kind: 'sticker', body: '[figurinha]' }
    case 'reaction': return { kind: 'reaction', body: '' }
    default: return { kind: message.type || 'unknown', body: `[${message.type || 'mensagem'}]` }
  }
}

// Conversa encontrada pelo telefone ou pelo BSUID (clientes com nome de usuário podem não ter telefone visível).
async function conversationFor(client: SupabaseClient, shopId: string, phone: string | null, userId: string | null, name: string | null) {
  const keys = [phone, userId].filter(isContactId)
  if (!keys.length) throw new Error('Contato sem identificação')
  let query = client.from('whatsapp_conversations').select('id,unread_count,contact_name,user_id,wa_id').eq('barbershop_id', shopId)
  query = phone && userId ? query.or(`wa_id.eq."${phone}",wa_id.eq."${userId}",user_id.eq."${userId}"`) : query.eq(phone ? 'wa_id' : 'user_id', (phone || userId)!)
  const { data: rows, error } = await query.limit(1)
  if (error) throw error
  type Row = { id: string; unread_count: number; contact_name: string | null; user_id: string | null; wa_id: string }
  let existing: Row | undefined = (rows?.[0] as Row | undefined)
  if (!existing && !phone && userId) {
    const { data: byKey } = await client.from('whatsapp_conversations').select('id,unread_count,contact_name,user_id,wa_id').eq('barbershop_id', shopId).eq('wa_id', userId).maybeSingle()
    existing = (byKey as Row | null) ?? undefined
  }
  if (existing) {
    const patch: Record<string, unknown> = {}
    if (name && name !== existing.contact_name) patch.contact_name = name
    if (userId && !existing.user_id) patch.user_id = userId
    if (Object.keys(patch).length) await client.from('whatsapp_conversations').update(patch).eq('id', existing.id)
    return existing as { id: string; unread_count: number }
  }
  const { data, error: insertError } = await client.from('whatsapp_conversations').upsert({ barbershop_id: shopId, wa_id: keys[0], user_id: userId, contact_name: name }, { onConflict: 'barbershop_id,wa_id' }).select('id,unread_count').single()
  if (insertError) throw insertError
  return data as { id: string; unread_count: number }
}

async function dispatchReply(origin: string, conversationId: string, messageId: string): Promise<void> {
  try {
    await fetch(`${origin}/.netlify/functions/whatsapp-reply-background`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-wa-internal': await internalToken(conversationId) },
      body: JSON.stringify({ conversation_id: conversationId, message_id: messageId }),
      signal: AbortSignal.timeout(5_000),
    })
  } catch (error) { console.error('whatsapp dispatch reply', error) }
}

async function handleValue(client: SupabaseClient, value: ChangeValue, field: string, origin: string): Promise<void> {
  const phoneNumberId = value.metadata?.phone_number_id
  if (!phoneNumberId) return
  const { data: connection } = await client.from('whatsapp_connections').select('barbershop_id,ai_enabled,human_pause_minutes').eq('phone_number_id', phoneNumberId).eq('status', 'connected').maybeSingle()
  if (!connection) return
  const shop = connection as Connection

  for (const status of value.statuses || []) {
    if (!status.id || !status.status) continue
    await client.from('whatsapp_messages').update({ status: status.status, error: status.errors?.[0]?.message || status.errors?.[0]?.title || null }).eq('wa_message_id', status.id).eq('barbershop_id', shop.barbershop_id)
  }

  // Mensagens que a própria barbearia enviou pelo app WhatsApp Business (número em coexistência):
  // alguém da equipe assumiu a conversa, então a IA pausa nela.
  if (field === 'smb_message_echoes') {
    for (const echo of value.message_echoes || []) {
      const phone = isContactId(echo.to) && /^\d+$/.test(echo.to) ? echo.to : null
      const userId = isContactId(echo.to_user_id) ? echo.to_user_id : null
      if (!phone && !userId) continue
      const conversation = await conversationFor(client, shop.barbershop_id, phone, userId, null)
      const { body } = messageBody(echo)
      const { error } = await client.from('whatsapp_messages').insert({ barbershop_id: shop.barbershop_id, conversation_id: conversation.id, wa_message_id: echo.id || null, direction: 'out', author: 'phone', kind: echo.type || 'text', body, status: 'sent' })
      if (error && error.code !== '23505') throw error
      const now = new Date()
      await client.from('whatsapp_conversations').update({
        last_message_at: now.toISOString(), last_message_preview: preview(body),
        ai_paused_until: new Date(now.getTime() + Math.max(shop.human_pause_minutes, 30) * 60_000).toISOString(),
      }).eq('id', conversation.id)
    }
    return
  }

  const nameOf = (phone: string | null, userId: string | null) => {
    const contact = (value.contacts || []).find(c => (phone && c.wa_id === phone) || (userId && c.user_id === userId))
    return contact?.profile?.name?.slice(0, 120) || contact?.profile?.username?.slice(0, 120) || null
  }
  for (const message of value.messages || []) {
    const phone = message.from && /^\d{8,20}$/.test(message.from) ? message.from : null
    const userId = isContactId(message.from_user_id) ? message.from_user_id : null
    if ((!phone && !userId) || !message.id) continue
    const { kind, body } = messageBody(message)
    if (kind === 'reaction') continue
    const conversation = await conversationFor(client, shop.barbershop_id, phone, userId, nameOf(phone, userId))
    const mediaId = message.audio?.id || message.voice?.id || null
    const { data: inserted, error } = await client.from('whatsapp_messages').insert({
      barbershop_id: shop.barbershop_id, conversation_id: conversation.id, wa_message_id: message.id,
      direction: 'in', author: 'customer', kind, body: mediaId ? `media:${mediaId}` : body, status: 'received',
    }).select('id').single()
    if (error) { if (error.code === '23505') continue; throw error }
    const at = message.timestamp ? new Date(Number(message.timestamp) * 1000) : new Date()
    await client.from('whatsapp_conversations').update({
      last_customer_message_at: at.toISOString(), last_message_at: at.toISOString(),
      last_message_preview: preview(kind === 'audio' ? '🎤 Áudio' : body), unread_count: (conversation.unread_count || 0) + 1,
    }).eq('id', conversation.id)
    if (shop.ai_enabled) await dispatchReply(origin, conversation.id, inserted.id)
  }
}

export default async (request: Request): Promise<Response> => {
  const url = new URL(request.url)
  if (request.method === 'GET') {
    const expected = optionalSetting('WHATSAPP_VERIFY_TOKEN')
    const token = url.searchParams.get('hub.verify_token') || ''
    if (url.searchParams.get('hub.mode') === 'subscribe' && expected && constantTimeEqual(token, expected)) {
      return new Response(url.searchParams.get('hub.challenge') || '', { status: 200, headers: { 'content-type': 'text/plain' } })
    }
    return new Response('Forbidden', { status: 403 })
  }
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const raw = await request.text()
  if (!await verifyMetaSignature(raw, request.headers.get('x-hub-signature-256'))) return new Response('Invalid signature', { status: 401 })
  let payload: Payload
  try { payload = JSON.parse(raw) as Payload } catch { return new Response('Bad request', { status: 400 }) }
  if (payload.object !== 'whatsapp_business_account') return new Response('ok')
  const origin = optionalSetting('URL') || url.origin
  try {
    const client = db()
    for (const entry of payload.entry || []) {
      for (const change of entry.changes || []) {
        if (!change.value || !['messages', 'smb_message_echoes'].includes(change.field || '')) continue
        await handleValue(client, change.value, change.field!, origin)
      }
    }
  } catch (error) {
    console.error('whatsapp webhook', error)
    return new Response('Temporary failure', { status: 500 })
  }
  return new Response('ok')
}

export const config: Config = { path: '/api/whatsapp-webhook' }
