import type { SupabaseClient } from '@supabase/supabase-js'
import { graph, loadSecret } from './whatsapp'

// Avisos de assinatura enviados por modelos aprovados pela Meta (mensagem iniciada pela barbearia).
export type NoticeKind = 'welcome' | 'payment_failed' | 'payment_reminder' | 'cancelled'

export interface NoticeTemplate { kind: NoticeKind; name: string; label: string; body: string; examples: string[] }

// Os nomes são fixos: a função de envio procura o modelo por eles na conta do WhatsApp da barbearia.
export const noticeTemplates: NoticeTemplate[] = [
  {
    kind: 'welcome', name: 'assinatura_confirmada', label: 'Assinatura confirmada',
    body: 'Olá, {{1}}! Sua assinatura do plano {{2}} na {{3}} está ativa. O valor de {{4}} {{5}} é cobrado automaticamente no cartão. Qualquer dúvida, é só responder esta mensagem.',
    examples: ['João', 'Classic Corte', 'Kingsman', 'R$ 134,99', 'por mês'],
  },
  {
    kind: 'payment_failed', name: 'assinatura_cobranca_recusada', label: 'Cobrança recusada',
    body: 'Olá, {{1}}. A cobrança de {{2}} da sua assinatura {{3}} na {{4}} foi recusada pelo cartão. Vamos tentar de novo nos próximos dias. Confira o limite do cartão ou responda esta mensagem se precisar de ajuda.',
    examples: ['João', 'R$ 134,99', 'Classic Corte', 'Kingsman'],
  },
  {
    kind: 'payment_reminder', name: 'assinatura_cobranca_pendente', label: 'Lembrete antes do cancelamento',
    body: 'Olá, {{1}}. A mensalidade de {{2}} da sua assinatura {{3}} na {{4}} continua em aberto e as tentativas de cobrança no cartão estão terminando. Sem o pagamento, a assinatura será cancelada. Responda esta mensagem para resolvermos.',
    examples: ['João', 'R$ 134,99', 'Classic Corte', 'Kingsman'],
  },
  {
    kind: 'cancelled', name: 'assinatura_cancelada', label: 'Assinatura cancelada',
    body: 'Olá, {{1}}. Sua assinatura {{2}} na {{3}} foi cancelada porque as cobranças no cartão não foram aprovadas. Para voltar a assinar, é só responder esta mensagem.',
    examples: ['João', 'Classic Corte', 'Kingsman'],
  },
]

export function templateFor(kind: NoticeKind): NoticeTemplate {
  const found = noticeTemplates.find(item => item.kind === kind)
  if (!found) throw new Error(`Aviso desconhecido: ${kind}`)
  return found
}

/** Telefone brasileiro no formato do WhatsApp (55 + DDD + número), ou null quando não dá para usar. */
export function whatsappNumber(phone: unknown): string | null {
  let digits = String(phone ?? '').replace(/\D/g, '')
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`
  return /^55\d{10,11}$/.test(digits) ? digits : null
}

/** A Meta recusa parâmetros com quebra de linha, tabulação ou muitos espaços seguidos. */
export function templateText(value: unknown, fallback: string): string {
  const text = String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim()
  return (text || fallback).slice(0, 200)
}

export function brl(cents: unknown): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(cents || 0) / 100).replace(/ /g, ' ')
}

export function firstName(name: unknown): string {
  return templateText(String(name ?? '').trim().split(/\s+/)[0], 'cliente')
}

export interface NoticeContext { client: string; plan: string; shop: string; priceCents: number; months: number }

export function noticeParameters(kind: NoticeKind, context: NoticeContext): string[] {
  const name = firstName(context.client)
  const plan = templateText(context.plan, 'de assinatura')
  const shop = templateText(context.shop, 'barbearia')
  const price = brl(context.priceCents)
  if (kind === 'welcome') return [name, plan, shop, price, context.months > 1 ? `a cada ${context.months} meses` : 'por mês']
  if (kind === 'cancelled') return [name, plan, shop]
  return [name, price, plan, shop]
}

type Notice = { id: string; barbershop_id: string; subscription_id: string; kind: NoticeKind; send_after: string; created_at: string; attempts: number }
type Subscription = { id: string; client_id: string; status: string; contract_snapshot: { plan_name?: string; price_cents?: number; frequency_months?: number } | null }

const MAX_ATTEMPTS = 3
// Aviso que não saiu em 2 dias perdeu o sentido (por exemplo, WhatsApp conectado depois): não é enviado.
const EXPIRES_AFTER_MS = 2 * 24 * 60 * 60_000
// Envio que começou e não terminou não é repetido, para o cliente não receber a mensagem duas vezes.
const STUCK_AFTER_MS = 15 * 60_000

async function finish(client: SupabaseClient, id: string, values: Record<string, unknown>) {
  const { error } = await client.from('subscription_notices').update({ ...values, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

/** Motivo para não enviar mais este aviso, ou null quando ele continua valendo. */
async function obsolete(client: SupabaseClient, notice: Notice, subscription: Subscription): Promise<string | null> {
  if (notice.kind === 'welcome' && !['active', 'authorized', 'past_due'].includes(subscription.status)) return 'Contrato já não está ativo.'
  if (notice.kind === 'payment_failed' || notice.kind === 'payment_reminder') {
    if (['cancelled', 'expired'].includes(subscription.status)) return 'Contrato encerrado; o aviso de cancelamento substitui este.'
    const { data, error } = await client.from('payments').select('id').eq('subscription_id', subscription.id).eq('status', 'paid').gt('paid_at', notice.created_at).limit(1)
    if (error) throw error
    if (data?.length) return 'Mensalidade paga depois da recusa.'
  }
  return null
}

export async function sendTemplate(phoneNumberId: string, token: string, to: string, name: string, parameters: string[]): Promise<string | null> {
  const result = await graph<{ messages?: { id: string }[] }>(`${phoneNumberId}/messages`, token, {
    method: 'POST',
    body: {
      messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'template',
      template: { name, language: { code: 'pt_BR' }, components: [{ type: 'body', parameters: parameters.map(text => ({ type: 'text', text })) }] },
    },
  })
  return result.messages?.[0]?.id ?? null
}

export async function runSubscriptionNotices(client: SupabaseClient, now = new Date(), deps: { send: typeof sendTemplate; token: (client: SupabaseClient, shopId: string) => Promise<string> } = { send: sendTemplate, token: async (db, shopId) => (await loadSecret(db, shopId)).token }) {
  const send = deps.send
  const result = { sent: 0, skipped: 0, expired: 0, failed: 0, waiting: 0 }
  const stuckBefore = new Date(now.getTime() - STUCK_AFTER_MS).toISOString()
  const { error: stuckError } = await client.from('subscription_notices')
    .update({ status: 'failed', last_error: 'Envio interrompido; não repetido para evitar mensagem duplicada.', updated_at: now.toISOString() })
    .eq('status', 'sending').lt('updated_at', stuckBefore)
  if (stuckError) throw stuckError

  const { data: queue, error } = await client.from('subscription_notices')
    .select('id,barbershop_id,subscription_id,kind,send_after,created_at,attempts')
    .eq('status', 'pending').lte('send_after', now.toISOString()).order('send_after').limit(25)
  if (error) throw error
  const connections = new Map<string, { phone_number_id: string; token: string } | null>()

  for (const notice of (queue ?? []) as Notice[]) {
    try {
      if (now.getTime() - new Date(notice.send_after).getTime() > EXPIRES_AFTER_MS) {
        await finish(client, notice.id, { status: 'expired', last_error: 'Não foi enviado a tempo.' }); result.expired++; continue
      }
      if (!connections.has(notice.barbershop_id)) {
        const { data: connection, error: connectionError } = await client.from('whatsapp_connections').select('phone_number_id,status').eq('barbershop_id', notice.barbershop_id).maybeSingle()
        if (connectionError) throw connectionError
        connections.set(notice.barbershop_id, connection?.status === 'connected'
          ? { phone_number_id: connection.phone_number_id, token: await deps.token(client, notice.barbershop_id) } : null)
      }
      const connection = connections.get(notice.barbershop_id)
      if (!connection) { result.waiting++; continue } // Fica na fila até conectar ou vencer.

      const { data: subscription, error: subscriptionError } = await client.from('subscriptions').select('id,client_id,status,contract_snapshot').eq('id', notice.subscription_id).single()
      if (subscriptionError) throw subscriptionError
      const reason = await obsolete(client, notice, subscription as Subscription)
      if (reason) { await finish(client, notice.id, { status: 'skipped', last_error: reason }); result.skipped++; continue }

      const [{ data: person, error: personError }, { data: shop, error: shopError }] = await Promise.all([
        client.from('clients').select('full_name,phone').eq('id', subscription.client_id).single(),
        client.from('barbershops').select('name').eq('id', notice.barbershop_id).single(),
      ])
      if (personError) throw personError
      if (shopError) throw shopError
      const to = whatsappNumber(person.phone)
      if (!to) { await finish(client, notice.id, { status: 'skipped', last_error: 'Cliente sem telefone válido.' }); result.skipped++; continue }

      // Reserva o aviso antes de enviar: duas execuções ao mesmo tempo não mandam a mesma mensagem.
      const { data: claimed, error: claimError } = await client.from('subscription_notices')
        .update({ status: 'sending', attempts: notice.attempts + 1, updated_at: new Date().toISOString() })
        .eq('id', notice.id).eq('status', 'pending').select('id').maybeSingle()
      if (claimError) throw claimError
      if (!claimed) continue

      const terms = (subscription as Subscription).contract_snapshot || {}
      const template = templateFor(notice.kind)
      try {
        const messageId = await send(connection.phone_number_id, connection.token, to, template.name, noticeParameters(notice.kind, {
          client: person.full_name, plan: terms.plan_name || '', shop: shop.name, priceCents: Number(terms.price_cents || 0), months: Number(terms.frequency_months || 1),
        }))
        await finish(client, notice.id, { status: 'sent', sent_at: new Date().toISOString(), provider_message_id: messageId, last_error: null })
        result.sent++
      } catch (problem) {
        const message = (problem instanceof Error ? problem.message : String(problem)).slice(0, 500)
        const retry = notice.attempts + 1 < MAX_ATTEMPTS
        await finish(client, notice.id, retry
          ? { status: 'pending', last_error: message, send_after: new Date(now.getTime() + 30 * 60_000).toISOString() }
          : { status: 'failed', last_error: message })
        result.failed++
      }
    } catch (problem) {
      console.error('subscription notice', notice.id, problem)
      result.failed++
    }
  }
  return result
}
