import type { Config } from '@netlify/functions'
import type { SupabaseClient } from '@supabase/supabase-js'
import { body, db, failure, HttpError, json, optionalSetting, requireShopAdmin, setting, userFromRequest, uuid } from './_shared/core'
import { constantTimeEqual, randomToken, seal, unseal } from './_shared/mpCrypto'

type JsonRecord = Record<string, unknown>
type MetaToken = { access_token: string; expires_in?: number; token_type?: string }
type MetaPage = { id: string; name?: string; instagram_business_account?: { id: string; username?: string } }
type MetaAdAccount = { id: string; name?: string; account_status?: number }
type MetaList<T> = { data?: T[]; error?: { message?: string; code?: number } }
type MetaError = { error?: { message?: string; code?: number } }
type StoredState = { state: string; shopId: string; userId: string; expiresAt: number }

const cookieName = 'barber_meta_oauth'
const graphVersionPattern = /^v\d+\.\d+$/

function version(): string {
  const value = setting('META_GRAPH_VERSION')
  if (!graphVersionPattern.test(value)) throw new HttpError(503, 'META_GRAPH_VERSION inválida.')
  return value
}

function callbackUri(): string {
  const value = setting('META_OAUTH_REDIRECT_URI')
  const parsed = new URL(value)
  if (parsed.protocol !== 'https:' || parsed.pathname !== '/api/instagram/callback') {
    throw new HttpError(503, 'META_OAUTH_REDIRECT_URI deve ser HTTPS e apontar para /api/instagram/callback.')
  }
  return value
}

function cookie(value: string, maxAge = 600): string {
  return `${cookieName}=${value}; Max-Age=${maxAge}; Path=/api/instagram; HttpOnly; Secure; SameSite=Lax`
}

function readCookie(request: Request): string | null {
  const match = (request.headers.get('cookie') || '').split(';').map(item => item.trim())
    .find(item => item.startsWith(`${cookieName}=`))
  return match?.slice(cookieName.length + 1) || null
}

async function graph<T>(path: string, token: string, query: Record<string, string> = {}): Promise<T> {
  const url = new URL(`https://graph.facebook.com/${version()}/${path.replace(/^\//, '')}`)
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(12_000),
  })
  const data = await response.json() as T & MetaError
  if (!response.ok || data.error) {
    const code = data.error?.code
    if (code === 190) throw new HttpError(401, 'A conexão com a Meta expirou. Conecte novamente.')
    throw new HttpError(502, 'A Meta não retornou os dados solicitados. Verifique as permissões da conta profissional.')
  }
  return data
}

async function exchangeCode(code: string): Promise<MetaToken> {
  const params = new URLSearchParams({
    client_id: setting('META_APP_ID'), client_secret: setting('META_APP_SECRET'),
    redirect_uri: callbackUri(), code,
  })
  const short = await fetch(`https://graph.facebook.com/${version()}/oauth/access_token?${params}`, {
    signal: AbortSignal.timeout(12_000),
  })
  const shortData = await short.json() as MetaToken & MetaError
  if (!short.ok || !shortData.access_token) throw new HttpError(502, 'Não foi possível concluir a conexão com a Meta.')
  const longParams = new URLSearchParams({
    grant_type: 'fb_exchange_token', client_id: setting('META_APP_ID'),
    client_secret: setting('META_APP_SECRET'), fb_exchange_token: shortData.access_token,
  })
  const long = await fetch(`https://graph.facebook.com/${version()}/oauth/access_token?${longParams}`, {
    signal: AbortSignal.timeout(12_000),
  })
  const result = await long.json() as MetaToken & MetaError
  if (!long.ok || !result.access_token) throw new HttpError(502, 'Não foi possível manter a conexão com a Meta.')
  return result
}

async function availableAccounts(token: string): Promise<{ pages: MetaPage[]; ad_accounts: MetaAdAccount[] }> {
  const [pageResult, adResult] = await Promise.all([
    graph<MetaList<MetaPage>>('me/accounts', token, { fields: 'id,name,instagram_business_account{id,username}', limit: '100' }),
    graph<MetaList<MetaAdAccount>>('me/adaccounts', token, { fields: 'id,name,account_status', limit: '100' })
      .catch(error => {
        if (error instanceof HttpError && error.status === 502) return { data: [] } as MetaList<MetaAdAccount>
        throw error
      }),
  ])
  return {
    pages: (pageResult.data || []).filter(page => page.instagram_business_account?.id),
    ad_accounts: adResult.data || [],
  }
}

async function accessToken(client: SupabaseClient, shopId: string): Promise<string> {
  const { data, error } = await client.from('integration_credentials')
    .select('access_token_encrypted,expires_at').eq('barbershop_id', shopId).eq('provider', 'meta').maybeSingle()
  if (error) throw error
  if (!data) throw new HttpError(409, 'Conecte a conta profissional do Instagram.')
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now() + 60_000) {
    await client.from('social_connections').update({ status: 'expired', updated_at: new Date().toISOString() })
      .eq('barbershop_id', shopId)
    throw new HttpError(409, 'A conexão com o Instagram expirou. Conecte novamente.')
  }
  const decoded = await unseal<{ token: string }>(data.access_token_encrypted)
  return decoded.token
}

async function authorizedShop(request: Request): Promise<{ client: SupabaseClient; shopId: string }> {
  const client = db()
  const user = await userFromRequest(request, client)
  const url = new URL(request.url)
  const input = request.method === 'POST' ? await body<JsonRecord>(request.clone()) : {}
  const shopId = uuid(input.barbershop_id || url.searchParams.get('barbershop_id'))
  await requireShopAdmin(client, user.id, shopId)
  return { client, shopId }
}

async function start(request: Request): Promise<Response> {
  const { shopId } = await authorizedShop(request)
  const client = db()
  const user = await userFromRequest(request, client)
  const state = randomToken()
  const encrypted = await seal({ state, shopId, userId: user.id, expiresAt: Date.now() + 600_000 } satisfies StoredState)
  const url = new URL(`https://www.facebook.com/${version()}/dialog/oauth`)
  url.search = new URLSearchParams({
    client_id: setting('META_APP_ID'), redirect_uri: callbackUri(), state, response_type: 'code',
    scope: 'pages_show_list,pages_read_engagement,instagram_basic,instagram_manage_insights,ads_read',
  }).toString()
  const response = json({ authorization_url: url.toString() })
  response.headers.set('set-cookie', cookie(encrypted))
  return response
}

async function callback(request: Request): Promise<Response> {
  let response: Response
  try {
    const params = new URL(request.url).searchParams
    const state = params.get('state') || ''
    const code = params.get('code') || ''
    const raw = readCookie(request)
    if (params.has('error')) throw new HttpError(400, 'A conexão com a Meta foi recusada ou cancelada.')
    if (!state || !code || !raw) throw new HttpError(400, 'Conexão expirada. Inicie novamente.')
    const stored = await unseal<StoredState>(raw)
    if (!constantTimeEqual(state, stored.state) || Date.now() > stored.expiresAt) {
      throw new HttpError(400, 'Estado de conexão inválido ou expirado.')
    }
    const client = db()
    await requireShopAdmin(client, stored.userId, stored.shopId)
    const token = await exchangeCode(code)
    const accounts = await availableAccounts(token.access_token)
    if (accounts.pages.length === 0) {
      throw new HttpError(409, 'Nenhuma Página vinculada a uma conta profissional do Instagram foi encontrada.')
    }
    const sealed = await seal({ token: token.access_token })
    const expires = token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null
    const { error: credentialError } = await client.from('integration_credentials').upsert({
      barbershop_id: stored.shopId, provider: 'meta', access_token_encrypted: sealed,
      refresh_token_encrypted: null, provider_account_id: null, expires_at: expires,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'barbershop_id,provider' })
    if (credentialError) throw credentialError
    const selected = accounts.pages.length === 1 ? accounts.pages[0].instagram_business_account : undefined
    const ad = accounts.ad_accounts.length === 1 ? accounts.ad_accounts[0] : undefined
    const { error: connectionError } = await client.from('social_connections').upsert({
      barbershop_id: stored.shopId, instagram_user_id: selected?.id || null,
      username: selected?.username || null, ad_account_id: ad?.id || null,
      status: selected ? 'connected' : 'disconnected', updated_at: new Date().toISOString(),
    }, { onConflict: 'barbershop_id' })
    if (connectionError) throw connectionError
    const returnUrl = optionalSetting('META_OAUTH_RETURN_URL')
    if (returnUrl) {
      const parsed = new URL(returnUrl)
      if (parsed.protocol !== 'https:') throw new HttpError(503, 'META_OAUTH_RETURN_URL deve ser HTTPS.')
      response = Response.redirect(parsed, 303)
    } else {
      response = new Response('Instagram conectado. Volte ao Barber System para escolher a conta.', {
        status: 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
      })
    }
  } catch (error) { response = failure(error) }
  response.headers.set('set-cookie', cookie('', 0))
  return response
}

async function accounts(request: Request): Promise<Response> {
  const { client, shopId } = await authorizedShop(request)
  return json(await availableAccounts(await accessToken(client, shopId)))
}

async function select(request: Request): Promise<Response> {
  const { client, shopId } = await authorizedShop(request)
  const input = await body<JsonRecord>(request)
  const selectedIgId = String(input.instagram_user_id || '')
  const selectedAdId = input.ad_account_id ? String(input.ad_account_id) : null
  const available = await availableAccounts(await accessToken(client, shopId))
  const selected = available.pages.find(page => page.instagram_business_account?.id === selectedIgId)
  if (!selected) throw new HttpError(400, 'Conta profissional do Instagram não disponível para este acesso.')
  if (selectedAdId && !available.ad_accounts.some(ad => ad.id === selectedAdId)) {
    throw new HttpError(400, 'Conta de anúncios não disponível para este acesso.')
  }
  const { error } = await client.from('social_connections').upsert({
    barbershop_id: shopId, instagram_user_id: selectedIgId,
    username: selected.instagram_business_account?.username || null,
    ad_account_id: selectedAdId, status: 'connected', updated_at: new Date().toISOString(),
  }, { onConflict: 'barbershop_id' })
  if (error) throw error
  return json({ connected: true, instagram_user_id: selectedIgId,
    username: selected.instagram_business_account?.username || null, ad_account_id: selectedAdId })
}

async function status(request: Request): Promise<Response> {
  const { client, shopId } = await authorizedShop(request)
  const { data, error } = await client.from('social_connections')
    .select('instagram_user_id,username,ad_account_id,status,updated_at').eq('barbershop_id', shopId).maybeSingle()
  if (error) throw error
  return json({ connected: data?.status === 'connected', connection: data })
}

export async function instagramSnapshot(client: SupabaseClient, shopId: string): Promise<{
  profile: JsonRecord; recent_media: JsonRecord[]; ads_last_30_days: JsonRecord | null;
  analyzed_at: string
}> {
  const { data: connection, error } = await client.from('social_connections')
    .select('instagram_user_id,username,ad_account_id,status').eq('barbershop_id', shopId).maybeSingle()
  if (error) throw error
  if (!connection?.instagram_user_id || connection.status !== 'connected') {
    throw new HttpError(409, 'Escolha uma conta profissional do Instagram.')
  }
  const token = await accessToken(client, shopId)
  const instagramId = encodeURIComponent(connection.instagram_user_id)
  const [profile, media, ads] = await Promise.all([
    graph<JsonRecord>(instagramId, token, { fields: 'id,username,followers_count,media_count' }),
    graph<MetaList<JsonRecord>>(`${instagramId}/media`, token, {
      fields: 'id,timestamp,media_type,like_count,comments_count,permalink', limit: '25',
    }),
    connection.ad_account_id ? graph<MetaList<JsonRecord>>(`${encodeURIComponent(connection.ad_account_id)}/insights`, token, {
      fields: 'spend,impressions,reach,clicks,ctr,cpc', date_preset: 'last_30d', level: 'account',
    }).then(result => result.data?.[0] || null).catch(error => ({ error: error instanceof Error ? error.message : 'Dados indisponíveis' })) : null,
  ])
  return { profile, recent_media: media.data || [], ads_last_30_days: ads,
    analyzed_at: new Date().toISOString() }
}

async function insights(request: Request): Promise<Response> {
  const { client, shopId } = await authorizedShop(request)
  return json(await instagramSnapshot(client, shopId))
}

async function disconnect(request: Request): Promise<Response> {
  const { client, shopId } = await authorizedShop(request)
  const { error: tokenError } = await client.from('integration_credentials')
    .delete().eq('barbershop_id', shopId).eq('provider', 'meta')
  if (tokenError) throw tokenError
  const { error } = await client.from('social_connections').upsert({
    barbershop_id: shopId, instagram_user_id: null, username: null, ad_account_id: null,
    status: 'disconnected', updated_at: new Date().toISOString(),
  }, { onConflict: 'barbershop_id' })
  if (error) throw error
  return json({ connected: false })
}

export default async (request: Request): Promise<Response> => {
  try {
    const action = new URL(request.url).pathname.split('/').pop()
    if (request.method === 'POST' && action === 'start') return await start(request)
    if (request.method === 'GET' && action === 'callback') return await callback(request)
    if (request.method === 'GET' && action === 'accounts') return await accounts(request)
    if (request.method === 'POST' && action === 'select') return await select(request)
    if (request.method === 'GET' && action === 'status') return await status(request)
    if (request.method === 'GET' && action === 'insights') return await insights(request)
    if (request.method === 'POST' && action === 'disconnect') return await disconnect(request)
    throw new HttpError(404, 'Ação Instagram não encontrada.')
  } catch (error) { return failure(error) }
}

export const config: Config = { path: '/api/instagram/:action' }
