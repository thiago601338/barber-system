import type { Config } from '@netlify/functions'
import { body, db, failure, HttpError, json, optionalSetting, requirePlatformAdmin, requireShopAdmin, setting, userFromRequest, uuid } from './_shared/core'
import { mpOauthToken, mpPublicUrl, mpRequest, saveShopToken, type MpPreapproval, verifyCollector } from './_shared/mpApi'
import { cancelCustomerSubscription, cancelSaasSubscription, customerSubscriptionStatus, saasQuote, startCustomerSubscription, startSaasSubscription, syncSaasAmount } from './_shared/mpBilling'
import { constantTimeEqual, randomToken, seal, sha256Base64Url, unseal } from './_shared/mpCrypto'
import { receiveMpWebhook } from './_shared/mpWebhook'

type Payload = Record<string, unknown>
interface OAuthCookie { state: string; verifier: string; shopId: string; userId: string; expiresAt: number }
const cookieName = 'barber_mp_oauth'

function cookieValue(request: Request): string | null {
  const part = (request.headers.get('cookie') || '').split(';').map(value => value.trim())
    .find(value => value.startsWith(`${cookieName}=`))
  return part ? part.slice(cookieName.length + 1) : null
}

function oauthCookie(value: string, maxAge = 600): string {
  return `${cookieName}=${value}; Max-Age=${maxAge}; Path=/api/mercadopago; HttpOnly; Secure; SameSite=Lax`
}

function callbackUri(): string {
  const uri = mpPublicUrl('MP_OAUTH_REDIRECT_URI')
  if (new URL(uri).pathname !== '/api/mercadopago/oauth-callback') {
    throw new HttpError(503, 'MP_OAUTH_REDIRECT_URI deve apontar para /api/mercadopago/oauth-callback.')
  }
  return uri
}

function shopOauthConfigured(): boolean {
  if (!['MP_CLIENT_ID', 'MP_CLIENT_SECRET', 'MP_OAUTH_REDIRECT_URI', 'TOKEN_ENCRYPTION_KEY']
    .every(name => Boolean(optionalSetting(name)))) return false
  try {
    callbackUri()
    const key = optionalSetting('TOKEN_ENCRYPTION_KEY') || ''
    if (!/^[A-Za-z0-9_+/-]+={0,2}$/.test(key)) return false
    const normalized = key.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/g, '')
    return atob(normalized + '='.repeat((4 - normalized.length % 4) % 4)).length === 32
  }
  catch { return false }
}

async function oauthStart(request: Request): Promise<Response> {
  const client = db()
  const user = await userFromRequest(request, client)
  const input = await body<Payload>(request)
  const shopId = uuid(input.barbershop_id)
  await requireShopAdmin(client, user.id, shopId)
  const [{ data: shop, error: shopError }, redirectUri] = await Promise.all([
    client.from('barbershops').select('active').eq('id', shopId).single(),
    Promise.resolve(callbackUri()),
  ])
  if (shopError) throw shopError
  if (!shop.active) throw new HttpError(409, 'Barbearia inativa.')
  const state = randomToken()
  const verifier = randomToken(64)
  const challenge = await sha256Base64Url(verifier)
  const encrypted = await seal({ state, verifier, shopId, userId: user.id, expiresAt: Date.now() + 10 * 60_000 } satisfies OAuthCookie)
  const authorization = new URL('https://auth.mercadopago.com/authorization')
  authorization.search = new URLSearchParams({
    response_type: 'code', client_id: setting('MP_CLIENT_ID'), platform_id: 'mp',
    redirect_uri: redirectUri, state, code_challenge: challenge, code_challenge_method: 'S256',
    scope: 'read write offline_access',
  }).toString()
  const response = json({ authorization_url: authorization.toString() })
  response.headers.set('set-cookie', oauthCookie(encrypted))
  return response
}

async function oauthCallback(request: Request): Promise<Response> {
  let response: Response
  try {
    const url = new URL(request.url)
    if (url.searchParams.has('error')) throw new HttpError(400, 'A conexão Mercado Pago foi recusada ou cancelada.')
    const state = url.searchParams.get('state') || ''
    const code = url.searchParams.get('code') || ''
    const cookie = cookieValue(request)
    if (!state || !code || !cookie) throw new HttpError(400, 'Conexão Mercado Pago expirada. Inicie novamente.')
    const saved = await unseal<OAuthCookie>(cookie)
    if (!constantTimeEqual(state, saved.state) || Date.now() > saved.expiresAt) {
      throw new HttpError(400, 'Estado OAuth inválido ou expirado.')
    }
    const client = db()
    await requireShopAdmin(client, saved.userId, saved.shopId)
    const token = await mpOauthToken({
      grant_type: 'authorization_code', code, code_verifier: saved.verifier, redirect_uri: callbackUri(),
    })
    if (!token.refresh_token || !token.scope?.split(' ').includes('offline_access')) {
      throw new HttpError(502, 'O Mercado Pago não concedeu acesso renovável. Verifique os escopos da aplicação.')
    }
    await saveShopToken(client, saved.shopId, token)
    const returnUrl = optionalSetting('MP_OAUTH_RETURN_URL')
    if (returnUrl) response = Response.redirect(mpPublicUrl('MP_OAUTH_RETURN_URL'), 303)
    else {
      const { data: shop, error: shopError } = await client.from('barbershops').select('slug').eq('id', saved.shopId).single()
      if (shopError) throw shopError
      const destination = new URL('/', request.url)
      destination.searchParams.set('shop', shop.slug)
      destination.searchParams.set('page', 'settings')
      response = Response.redirect(destination, 303)
    }
  } catch (error) {
    response = failure(error)
  }
  response.headers.set('set-cookie', oauthCookie('', 0))
  return response
}

async function shopConnection(request: Request): Promise<Response> {
  const client = db()
  const user = await userFromRequest(request, client)
  const shopId = uuid(new URL(request.url).searchParams.get('barbershop_id'))
  await requireShopAdmin(client, user.id, shopId)
  const { data, error } = await client.from('integration_credentials')
    .select('provider_account_id,expires_at,updated_at').eq('barbershop_id', shopId).eq('provider', 'mercadopago').maybeSingle()
  if (error) throw error
  return json({ connected: !!data, configured: shopOauthConfigured(), account_id: data?.provider_account_id || null,
    expires_at: data?.expires_at || null, updated_at: data?.updated_at || null })
}

async function saasStatus(request: Request): Promise<Response> {
  const client = db()
  const user = await userFromRequest(request, client)
  await requirePlatformAdmin(client, user.id)
  const shopId = uuid(new URL(request.url).searchParams.get('barbershop_id'))
  const quote = await saasQuote(client, shopId)
  const { data, error } = await client.from('platform_subscriptions')
    .select('provider_subscription_id,status,seat_count,unit_price_cents,amount_cents,payer_email')
    .eq('barbershop_id', shopId).maybeSingle()
  if (error) throw error
  if (!data?.provider_subscription_id) return json({ quote, subscription: data })
  const providerId = String(data.provider_subscription_id)
  const remote = await mpRequest<MpPreapproval>(`/preapproval/${providerId}`, setting('MP_PLATFORM_ACCESS_TOKEN'))
  verifyCollector(remote, setting('MP_PLATFORM_ACCOUNT_ID'))
  if (remote.external_reference !== `saas-${shopId}`) throw new HttpError(409, 'Referência SaaS divergente.')
  const status = remote.status === 'canceled' ? 'cancelled' : remote.status
  const { error: updateError } = await client.from('platform_subscriptions').update({ status, updated_at: new Date().toISOString() })
    .eq('barbershop_id', shopId)
  if (updateError) throw updateError
  return json({ quote, subscription: { ...data, status, provider_status: remote.status } })
}

export default async (request: Request): Promise<Response> => {
  try {
    const action = new URL(request.url).pathname.split('/').pop()
    if (request.method === 'POST' && action === 'webhook') return await receiveMpWebhook(request, db(), 'shop')
    if (request.method === 'POST' && action === 'platform-webhook') return await receiveMpWebhook(request, db(), 'platform')
    if (request.method === 'POST' && action === 'oauth-start') return await oauthStart(request)
    if (request.method === 'GET' && action === 'oauth-callback') return await oauthCallback(request)
    if (request.method === 'GET' && action === 'connection') return await shopConnection(request)
    if (request.method === 'GET' && action === 'subscription-status') {
      const id = new URL(request.url).searchParams.get('subscription_id') || ''
      return json(await customerSubscriptionStatus(request, db(), id))
    }
    if (request.method === 'POST' && action === 'subscription-start') {
      return json(await startCustomerSubscription(request, db(), await body<Payload>(request)), 201)
    }
    if (request.method === 'POST' && action === 'subscription-cancel') {
      const input = await body<Payload>(request)
      return json(await cancelCustomerSubscription(request, db(), uuid(input.subscription_id)))
    }
    if (request.method === 'GET' && action === 'saas-quote') {
      const client = db()
      const user = await userFromRequest(request, client)
      await requirePlatformAdmin(client, user.id)
      return json(await saasQuote(client, uuid(new URL(request.url).searchParams.get('barbershop_id'))))
    }
    if (request.method === 'GET' && action === 'saas-status') return await saasStatus(request)
    if (request.method === 'POST' && ['saas-start', 'saas-sync', 'saas-cancel'].includes(action || '')) {
      const client = db()
      const user = await userFromRequest(request, client)
      await requirePlatformAdmin(client, user.id)
      const input = await body<Payload>(request)
      const shopId = uuid(input.barbershop_id)
      if (action === 'saas-start') return json(await startSaasSubscription(client, shopId, input.payer_email), 201)
      if (action === 'saas-sync') return json(await syncSaasAmount(client, shopId))
      return json(await cancelSaasSubscription(client, shopId))
    }
    throw new HttpError(404, 'Ação Mercado Pago não encontrada.')
  } catch (error) { return failure(error) }
}

export const config: Config = { path: '/api/mercadopago/:action' }
