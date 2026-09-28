import type { SupabaseClient } from '@supabase/supabase-js'
import { HttpError, setting } from './core'
import { seal, unseal } from './mpCrypto'

export interface MpTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
  user_id?: number | string
  scope?: string
}

export interface MpPreapproval {
  id: string
  status: string
  collector_id?: number | string
  external_reference?: string
  payer_email?: string
  init_point?: string
  next_payment_date?: string
  auto_recurring?: { transaction_amount?: number; currency_id?: string }
}

export interface MpPayment {
  id: number | string
  status: string
  collector_id?: number | string
  external_reference?: string
  transaction_amount?: number
  currency_id?: string
  payment_method_id?: string
  payment_type_id?: string
  date_approved?: string
  date_created?: string
  metadata?: Record<string, unknown>
  point_of_interaction?: { transaction_data?: Record<string, unknown> }
}

export interface MpAuthorizedPayment {
  id: number | string
  preapproval_id?: string
  external_reference?: string
  transaction_amount?: string | number
  currency_id?: string
  date_created?: string
  status?: string
  payment?: { id?: number | string; status?: string }
}

export function mpId(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') throw new HttpError(400, 'ID do Mercado Pago inválido.')
  const result = String(value)
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(result)) throw new HttpError(400, 'ID do Mercado Pago inválido.')
  return result
}

export function mpPublicUrl(name: string): string {
  const configured = setting(name)
  let url: URL
  try { url = new URL(configured) }
  catch { throw new HttpError(503, `${name} deve ser uma URL HTTPS pública.`) }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new HttpError(503, `${name} deve ser uma URL HTTPS pública.`)
  }
  return url.toString()
}

export async function mpRequest<T>(path: string, token: string, method = 'GET', payload?: unknown, idempotencyKey?: string): Promise<T> {
  if (!/^\/[A-Za-z0-9_/?=&.-]+$/.test(path)) throw new HttpError(500, 'Caminho do Mercado Pago inválido.')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12_000)
  try {
    const response = await fetch(`https://api.mercadopago.com${path}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        accept: 'application/json',
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
        ...(idempotencyKey ? { 'x-idempotency-key': idempotencyKey } : {}),
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: controller.signal,
    })
    if (!response.ok) throw new HttpError(502, `Mercado Pago recusou a operação (HTTP ${response.status}).`)
    return await response.json() as T
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(502, 'Não foi possível consultar o Mercado Pago. Verifique o estado antes de repetir a operação.')
  } finally {
    clearTimeout(timeout)
  }
}

export async function mpOauthToken(payload: Record<string, string>): Promise<MpTokenResponse> {
  const result = await mpRequest<MpTokenResponse>('/oauth/token', '', 'POST', {
    client_id: setting('MP_CLIENT_ID'),
    client_secret: setting('MP_CLIENT_SECRET'),
    ...payload,
  })
  if (!result.access_token || !result.user_id) throw new HttpError(502, 'O Mercado Pago não retornou credenciais completas.')
  return result
}

export async function saveShopToken(client: SupabaseClient, shopId: string, response: MpTokenResponse): Promise<void> {
  const expiresAt = Number.isFinite(response.expires_in) && (response.expires_in || 0) > 0
    ? new Date(Date.now() + Number(response.expires_in) * 1000).toISOString() : null
  const { error } = await client.from('integration_credentials').upsert({
    barbershop_id: shopId,
    provider: 'mercadopago',
    access_token_encrypted: await seal(response.access_token),
    refresh_token_encrypted: response.refresh_token ? await seal(response.refresh_token) : null,
    provider_account_id: String(response.user_id),
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'barbershop_id,provider' })
  if (error) throw error
}

export async function shopToken(client: SupabaseClient, shopId: string): Promise<{ token: string; accountId: string }> {
  const { data, error } = await client.from('integration_credentials')
    .select('access_token_encrypted,refresh_token_encrypted,provider_account_id,expires_at')
    .eq('barbershop_id', shopId).eq('provider', 'mercadopago').maybeSingle()
  if (error) throw error
  if (!data?.access_token_encrypted || !data.provider_account_id) {
    throw new HttpError(409, 'Conecte a conta Mercado Pago desta barbearia antes de criar assinaturas.')
  }
  const expiring = data.expires_at && new Date(data.expires_at).getTime() < Date.now() + 5 * 60_000
  if (!expiring) return { token: await unseal<string>(data.access_token_encrypted), accountId: String(data.provider_account_id) }
  if (!data.refresh_token_encrypted) throw new HttpError(409, 'Reconecte a conta Mercado Pago desta barbearia.')
  const refreshed = await mpOauthToken({ grant_type: 'refresh_token', refresh_token: await unseal<string>(data.refresh_token_encrypted) })
  if (String(refreshed.user_id) !== String(data.provider_account_id)) throw new HttpError(502, 'A conta renovada não corresponde à barbearia.')
  if (!refreshed.refresh_token) throw new HttpError(502, 'O Mercado Pago não retornou o novo token de renovação.')
  await saveShopToken(client, shopId, refreshed)
  return { token: refreshed.access_token, accountId: String(data.provider_account_id) }
}

export function verifyCollector(resource: { collector_id?: number | string }, expectedAccountId: string): void {
  if (!resource.collector_id || String(resource.collector_id) !== expectedAccountId) {
    throw new HttpError(409, 'O recurso pertence a outra conta Mercado Pago.')
  }
}
