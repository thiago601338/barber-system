import OpenAI from 'openai'
import { db, optionalSetting } from './_shared/core'
import { constantTimeEqual } from './_shared/mpCrypto'
import { internalToken, loadSecret, markReadTyping, preview, sendText, type WhatsappConnection } from './_shared/whatsapp'
import { aiReply, transcribe, type ChatTurn, type Conversation } from './_shared/whatsappAi'

// Resposta da IA no WhatsApp (função em segundo plano, até 15 min).
// Só roda depois de uma mensagem do cliente: a IA nunca inicia conversa.

const MAX_AI_REPLIES_PER_HOUR = 30
const DEBOUNCE_MS = 5_000
type StoredMessage = { id: string; wa_message_id: string | null; direction: 'in' | 'out'; author: string; kind: string; body: string | null; created_at: string }
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export default async (request: Request): Promise<void> => {
  const client = db()
  let input: { conversation_id?: string; message_id?: string }
  try { input = await request.json() } catch { return }
  if (!input.conversation_id || !input.message_id) return
  const token = request.headers.get('x-wa-internal') || ''
  if (!constantTimeEqual(token, await internalToken(input.conversation_id))) return

  await sleep(DEBOUNCE_MS)
  const { data: conversationRow } = await client.from('whatsapp_conversations').select('id,barbershop_id,wa_id,contact_name,client_id,ai_paused_until').eq('id', input.conversation_id).maybeSingle()
  if (!conversationRow) return
  const conversation = conversationRow as Conversation
  if (conversation.ai_paused_until && Date.parse(conversation.ai_paused_until) > Date.now()) return

  const { data: connectionRow } = await client.from('whatsapp_connections').select('*').eq('barbershop_id', conversation.barbershop_id).maybeSingle()
  const connection = connectionRow as WhatsappConnection | null
  if (!connection || connection.status !== 'connected' || !connection.ai_enabled) return

  // Junta mensagens seguidas: só a última mensagem do cliente dispara a resposta.
  const { data: latest } = await client.from('whatsapp_messages').select('id,created_at').eq('conversation_id', conversation.id).eq('direction', 'in').order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!latest || latest.id !== input.message_id) return
  const { count: alreadyAnswered } = await client.from('whatsapp_messages').select('id', { count: 'exact', head: true }).eq('conversation_id', conversation.id).eq('direction', 'out').gt('created_at', latest.created_at)
  if (alreadyAnswered) return
  const { count: recentAi } = await client.from('whatsapp_messages').select('id', { count: 'exact', head: true }).eq('conversation_id', conversation.id).eq('author', 'ai').gte('created_at', new Date(Date.now() - 3_600_000).toISOString())
  if ((recentAi || 0) >= MAX_AI_REPLIES_PER_HOUR) {
    await client.from('whatsapp_conversations').update({ ai_paused_until: new Date(Date.now() + 3_600_000).toISOString() }).eq('id', conversation.id)
    return
  }
  if (!optionalSetting('OPENAI_API_KEY')) {
    await client.from('whatsapp_connections').update({ last_error: 'IA indisponível no servidor (OPENAI_API_KEY ausente).' }).eq('barbershop_id', conversation.barbershop_id)
    return
  }

  try {
    const secret = await loadSecret(client, conversation.barbershop_id)
    const openai = new OpenAI()
    const { data: history } = await client.from('whatsapp_messages').select('id,wa_message_id,direction,author,kind,body,created_at').eq('conversation_id', conversation.id).order('created_at', { ascending: false }).limit(24)
    const messages = ((history ?? []) as StoredMessage[]).reverse()
    const lastInbound = [...messages].reverse().find(m => m.direction === 'in')
    if (lastInbound?.wa_message_id) await markReadTyping(connection.phone_number_id, secret.token, lastInbound.wa_message_id)

    for (const message of messages) {
      if (message.direction === 'in' && message.body?.startsWith('media:')) {
        const text = await transcribe(openai, message.body.slice(6), secret.token)
        message.body = text ? `(áudio) ${text}` : '[áudio não transcrito]'
        await client.from('whatsapp_messages').update({ body: message.body }).eq('id', message.id)
      }
    }

    const turns: ChatTurn[] = messages.filter(m => m.body).map(m => ({ role: m.direction === 'in' ? 'user' : 'assistant', content: m.body! }))
    const reply = await aiReply(client, openai, conversation.barbershop_id, connection, turns, conversation.contact_name, conversation)
    if (!reply) return

    // Se o cliente mandou outra mensagem enquanto a IA pensava, a próxima execução responde tudo junto.
    const { data: newest } = await client.from('whatsapp_messages').select('id').eq('conversation_id', conversation.id).eq('direction', 'in').order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (newest && newest.id !== input.message_id) return

    const sentId = await sendText(connection.phone_number_id, secret.token, conversation.wa_id, reply)
    const now = new Date().toISOString()
    await client.from('whatsapp_messages').insert({ barbershop_id: conversation.barbershop_id, conversation_id: conversation.id, wa_message_id: sentId, direction: 'out', author: 'ai', body: reply, status: 'sent' })
    await client.from('whatsapp_conversations').update({ last_message_at: now, last_message_preview: preview(reply) }).eq('id', conversation.id)
    if (connectionRow && (connectionRow as { last_error?: string | null }).last_error) await client.from('whatsapp_connections').update({ last_error: null }).eq('barbershop_id', conversation.barbershop_id)
  } catch (error) {
    console.error('whatsapp ai reply', error)
    await client.from('whatsapp_connections').update({ last_error: `Falha ao responder: ${error instanceof Error ? error.message.slice(0, 300) : 'erro desconhecido'}` }).eq('barbershop_id', conversation.barbershop_id)
  }
}
