import type { SupabaseClient } from '@supabase/supabase-js'
import { HttpError, optionalSetting, setting } from './core'
import { constantTimeEqual, seal, sha256Hex, unseal } from './mpCrypto'

// WhatsApp Cloud API (oficial da Meta), conectado por barbearia via Embedded Signup.
export type WhatsappSecret = { token: string; pin?: string }
export type WhatsappConnection = {
  barbershop_id: string
  waba_id: string
  phone_number_id: string
  display_phone_number: string | null
  verified_name: string | null
  coexistence: boolean
  status: 'connected' | 'disconnected' | 'error'
  ai_enabled: boolean
  ai_instructions: string | null
  ai_can_book: boolean
  human_pause_minutes: number
}

const graphVersionPattern = /^v\d+\.\d+$/

export function graphVersion(): string {
  const value = optionalSetting('META_GRAPH_VERSION') || 'v24.0'
  if (!graphVersionPattern.test(value)) throw new HttpError(503, 'META_GRAPH_VERSION inválida.')
  return value
}

export function whatsappReady(): { ready: boolean; missing: string[] } {
  const missing = ['META_APP_ID', 'META_APP_SECRET', 'WHATSAPP_ES_CONFIG_ID', 'WHATSAPP_VERIFY_TOKEN', 'TOKEN_ENCRYPTION_KEY'].filter(name => !optionalSetting(name))
  return { ready: missing.length === 0, missing }
}

type GraphError = { error?: { message?: string; code?: number; error_subcode?: number; error_user_msg?: string } }

export async function graph<T>(path: string, token: string, init: { method?: string; body?: unknown; query?: Record<string, string> } = {}): Promise<T> {
  const url = new URL(`https://graph.facebook.com/${graphVersion()}/${path.replace(/^\//, '')}`)
  for (const [key, value] of Object.entries(init.query || {})) url.searchParams.set(key, value)
  const response = await fetch(url, {
    method: init.method || 'GET',
    headers: { authorization: `Bearer ${token}`, ...(init.body ? { 'content-type': 'application/json' } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15_000),
  })
  const data = await response.json().catch(() => ({})) as T & GraphError
  if (!response.ok || data.error) {
    const message = data.error?.error_user_msg || data.error?.message || `HTTP ${response.status}`
    if (data.error?.code === 190) throw new HttpError(401, 'A conexão com o WhatsApp expirou. Conecte novamente.')
    throw new HttpError(502, `WhatsApp: ${message}`)
  }
  return data
}

export async function exchangeSignupCode(code: string): Promise<string> {
  const params = new URLSearchParams({ client_id: setting('META_APP_ID'), client_secret: setting('META_APP_SECRET'), code })
  const response = await fetch(`https://graph.facebook.com/${graphVersion()}/oauth/access_token?${params}`, { signal: AbortSignal.timeout(15_000) })
  const data = await response.json().catch(() => ({})) as { access_token?: string } & GraphError
  if (!response.ok || !data.access_token) throw new HttpError(502, `Não foi possível concluir a conexão com o WhatsApp${data.error?.message ? `: ${data.error.message}` : '.'}`)
  return data.access_token
}

export async function saveSecret(client: SupabaseClient, shopId: string, secret: WhatsappSecret): Promise<void> {
  const { error } = await client.from('whatsapp_credentials').upsert({ barbershop_id: shopId, access_token_encrypted: await seal(secret), updated_at: new Date().toISOString() })
  if (error) throw error
}

export async function loadSecret(client: SupabaseClient, shopId: string): Promise<WhatsappSecret> {
  const { data, error } = await client.from('whatsapp_credentials').select('access_token_encrypted').eq('barbershop_id', shopId).maybeSingle()
  if (error) throw error
  if (!data) throw new HttpError(409, 'WhatsApp não conectado.')
  return unseal<WhatsappSecret>(data.access_token_encrypted)
}

export const isPhoneId = (value: string) => /^\d{8,20}$/.test(value)
export const isContactId = (value: string | undefined | null): value is string => !!value && /^(\d{8,20}|[A-Z]{2}\.[0-9A-Za-z_-]{4,64})$/.test(value)

// O cliente pode ser identificado pelo telefone ou, se usa nome de usuário no WhatsApp, pelo ID da conta comercial (BSUID).
export async function sendText(phoneNumberId: string, token: string, to: string, body: string): Promise<string | null> {
  const target = isPhoneId(to) ? { to } : { recipient: to }
  const result = await graph<{ messages?: { id: string }[] }>(`${phoneNumberId}/messages`, token, {
    method: 'POST',
    body: { messaging_product: 'whatsapp', recipient_type: 'individual', ...target, type: 'text', text: { preview_url: false, body: body.slice(0, 4000) } },
  })
  return result.messages?.[0]?.id ?? null
}

// Marca como lida e mostra "digitando..." enquanto a IA prepara a resposta.
export async function markReadTyping(phoneNumberId: string, token: string, messageId: string): Promise<void> {
  try {
    await graph(`${phoneNumberId}/messages`, token, { method: 'POST', body: { messaging_product: 'whatsapp', status: 'read', message_id: messageId, typing_indicator: { type: 'text' } } })
  } catch (error) { console.warn('whatsapp typing indicator', error) }
}

export async function verifyMetaSignature(raw: string, header: string | null): Promise<boolean> {
  const secret = optionalSetting('META_APP_SECRET')
  if (!secret || !header?.startsWith('sha256=')) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)))
  const expected = Array.from(signature, byte => byte.toString(16).padStart(2, '0')).join('')
  return constantTimeEqual(expected, header.slice(7).toLowerCase())
}

// Assinatura interna entre o webhook e a função em segundo plano.
export async function internalToken(conversationId: string): Promise<string> {
  return sha256Hex(`${setting('TOKEN_ENCRYPTION_KEY')}:whatsapp:${conversationId}`)
}

export async function downloadMedia(mediaId: string, token: string): Promise<{ bytes: ArrayBuffer; mime: string }> {
  const meta = await graph<{ url?: string; mime_type?: string }>(mediaId, token)
  if (!meta.url) throw new HttpError(502, 'Mídia indisponível.')
  const response = await fetch(meta.url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) })
  if (!response.ok) throw new HttpError(502, 'Não foi possível baixar a mídia.')
  return { bytes: await response.arrayBuffer(), mime: meta.mime_type || response.headers.get('content-type') || 'application/octet-stream' }
}

export function preview(text: string | null | undefined): string {
  return (text || '').replace(/\s+/g, ' ').trim().slice(0, 140)
}
