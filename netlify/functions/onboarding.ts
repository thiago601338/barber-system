import type { Config } from '@netlify/functions'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { body, db, failure, HttpError, json, optionalSetting, requireShopAdmin, text, userFromRequest, uuid } from './_shared/core'
import { saasQuote, startSaasSubscription } from './_shared/mpBilling'
import { mpRequest, verifyCollector } from './_shared/mpApi'
import { shopOauthConfigured } from './_shared/mpConfiguration'

type Payload = Record<string, unknown>
const reservedSlugs = new Set(['app','api','b','blog','entrar','comecar','inicio','precos','sobre','contato','master','admin','conta','termos-de-uso','politica-de-privacidade','politica-de-cookies','politica-de-cancelamento-e-reembolso'])
const shopColumns = 'id,name,slug,whatsapp,phone,address,instagram_url,bio_title,bio_description,logo_url,active,created_via,onboarding_completed_at'

function paymentConfigured(): boolean {
  if (!optionalSetting('MP_PLATFORM_ACCESS_TOKEN') || !optionalSetting('MP_PLATFORM_ACCOUNT_ID')) return false
  try { const url = new URL(optionalSetting('MP_SAAS_BACK_URL') || ''); return url.protocol === 'https:' }
  catch { return false }
}

async function ownedShops(client: SupabaseClient, userId: string) {
  const { data, error } = await client.from('memberships').select('barbershop_id').eq('user_id', userId).eq('role', 'admin').eq('active', true)
  if (error) throw error
  return (data || []).map(row => String(row.barbershop_id))
}

async function refreshSubscription(client: SupabaseClient, shopId: string) {
  const { data, error } = await client.from('platform_subscriptions')
    .select('provider_subscription_id,status,amount_cents,seat_count,payer_email,updated_at').eq('barbershop_id', shopId).maybeSingle()
  if (error) throw error
  if (!data?.provider_subscription_id || !paymentConfigured() || data.status === 'authorized' || data.status === 'cancelled') return data
  try {
    const remote = await mpRequest<{ id?: string; status?: string; external_reference?: string; collector_id?: number | string }>(`/preapproval/${String(data.provider_subscription_id)}`, optionalSetting('MP_PLATFORM_ACCESS_TOKEN')!)
    verifyCollector(remote, optionalSetting('MP_PLATFORM_ACCOUNT_ID')!)
    if (remote.external_reference !== `saas-${shopId}` || !remote.status) return data
    const status = remote.status === 'canceled' ? 'cancelled' : remote.status
    if (status !== data.status) {
      const { error: updateError } = await client.from('platform_subscriptions').update({ status, updated_at: new Date().toISOString() }).eq('barbershop_id', shopId)
      if (updateError) throw updateError
    }
    return { ...data, status }
  } catch { return data }
}

async function status(client: SupabaseClient, user: User, requested: string | null) {
  const { data: settings, error: settingsError } = await client.from('platform_settings').select('base_monthly_cents,seat_price_cents,monthly_cap_cents,billing_enabled').eq('id', 1).single()
  if (settingsError) throw settingsError
  const ids = await ownedShops(client, user.id)
  const account = { email: user.email || null, name: typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : null }
  const pricing = { base_cents: settings.base_monthly_cents, barber_cents: settings.seat_price_cents, monthly_cap_cents: settings.monthly_cap_cents, billing_enabled: settings.billing_enabled }
  if (!ids.length) return { stage: 'shop', account, pricing, shop: null }
  const shopId = requested && ids.includes(requested) ? requested : ids[0]
  const [{ data: shop, error: shopError }, quote, subscription, services, members, rules, connection] = await Promise.all([
    client.from('barbershops').select(shopColumns).eq('id', shopId).single(),
    saasQuote(client, shopId),
    refreshSubscription(client, shopId),
    client.from('services').select('id,name,duration_minutes,price_cents').eq('barbershop_id', shopId).eq('active', true).order('created_at'),
    client.from('memberships').select('id,role,display_name,user_id,active').eq('barbershop_id', shopId).eq('active', true).order('created_at'),
    client.from('availability_rules').select('id,barber_membership_id,weekday,start_time,end_time').eq('barbershop_id', shopId).eq('active', true),
    client.from('integration_credentials').select('provider_account_id').eq('barbershop_id', shopId).eq('provider', 'mercadopago').maybeSingle(),
  ])
  for (const result of [{ error: shopError }, services, members, rules, connection]) if (result.error) throw result.error
  const free = !quote.billing_enabled || quote.amount_cents <= 0
  const paid = free || subscription?.status === 'authorized'
  // Barbearia criada pela inscrição só fica liberada (painel e página pública) depois do pagamento confirmado.
  if (shop!.created_via === 'self_service' && !shop!.onboarding_completed_at && Boolean(shop!.active) !== paid) {
    const { error: activeError } = await client.from('barbershops').update({ active: paid, updated_at: new Date().toISOString() }).eq('id', shopId)
    if (activeError) throw activeError
    shop!.active = paid
  }
  return {
    stage: shop!.onboarding_completed_at ? 'done' : paid ? 'setup' : 'payment',
    account, pricing, shop, quote,
    payment: { configured: paymentConfigured(), free, paid, status: subscription?.status || null },
    services: services.data || [],
    barbers: (members.data || []).filter(row => row.role === 'barber'),
    availability: rules.data || [],
    receiving: { configured: shopOauthConfigured(), connected: Boolean(connection.data) },
    shops: ids.length,
  }
}

async function createShop(client: SupabaseClient, user: User, input: Payload) {
  if (!user.email_confirmed_at) throw new HttpError(403, 'Confirme seu e-mail antes de cadastrar a barbearia.')
  const existing = await ownedShops(client, user.id)
  if (existing.length) return { barbershop_id: existing[0], existing: true }
  const name = text(input.name, 'Nome da barbearia', 120)
  const slug = text(input.slug, 'Endereço da página', 60).toLowerCase()
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length < 3) throw new HttpError(400, 'O endereço da página aceita letras, números e hífens (mínimo 3 caracteres).')
  if (reservedSlugs.has(slug)) throw new HttpError(409, 'Esse endereço é reservado. Escolha outro.')
  const whatsapp = String(input.whatsapp || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '')
  if (!/^\d{10,11}$/.test(whatsapp)) throw new HttpError(400, 'Informe o WhatsApp com DDD.')
  const city = text(input.city, 'Cidade', 80)
  const ownerName = text(input.owner_name, 'Seu nome', 100)
  const attends = input.owner_attends === true
  const taken = await client.from('barbershops').select('id').eq('slug', slug).maybeSingle()
  if (taken.error) throw taken.error
  if (taken.data) throw new HttpError(409, 'Esse endereço já está em uso. Escolha outro.')
  const { data: shop, error } = await client.from('barbershops').insert({ name, slug, whatsapp, phone: whatsapp, address: city, created_via: 'self_service', active: false }).select('id').single()
  if (error) {
    if (error.code === '23505') throw new HttpError(409, 'Esse endereço já está em uso. Escolha outro.')
    throw error
  }
  const admin = await client.from('memberships').insert({ barbershop_id: shop.id, user_id: user.id, role: 'admin', display_name: ownerName, active: true })
  if (admin.error) {
    await client.from('barbershops').delete().eq('id', shop.id)
    throw admin.error
  }
  if (attends) {
    const barber = await client.from('memberships').insert({ barbershop_id: shop.id, user_id: null, role: 'barber', display_name: ownerName, active: true })
    if (barber.error) throw barber.error
  }
  if (typeof user.user_metadata?.full_name !== 'string' || !user.user_metadata.full_name.trim()) {
    await client.auth.admin.updateUserById(user.id, { user_metadata: { ...user.user_metadata, full_name: ownerName } })
  }
  return { barbershop_id: shop.id, existing: false }
}

export default async (request: Request) => {
  try {
    const client = db()
    const user = await userFromRequest(request, client)
    const url = new URL(request.url)
    const action = url.pathname.split('/').pop()
    if (request.method === 'GET' && action === 'status') return json(await status(client, user, url.searchParams.get('barbershop_id')))
    if (request.method === 'GET' && action === 'slug') {
      const slug = (url.searchParams.get('slug') || '').toLowerCase()
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length < 3 || reservedSlugs.has(slug)) return json({ available: false })
      const { data, error } = await client.from('barbershops').select('id').eq('slug', slug).maybeSingle()
      if (error) throw error
      return json({ available: !data })
    }
    if (request.method !== 'POST') throw new HttpError(405, 'Método não permitido.')
    const input = await body<Payload>(request)
    if (action === 'create-shop') return json(await createShop(client, user, input), 201)
    const shopId = uuid(input.barbershop_id)
    await requireShopAdmin(client, user.id, shopId)
    if (action === 'checkout') {
      if (!paymentConfigured()) throw new HttpError(503, 'O pagamento online ainda está sendo liberado. Chame a gente no WhatsApp para concluir sua assinatura.')
      if (!user.email) throw new HttpError(400, 'Sua conta precisa de um e-mail para o pagamento.')
      const result = await startSaasSubscription(client, shopId, user.email)
      if (!result.checkout_url) throw new HttpError(409, 'Sua assinatura já está registrada. Atualize a página para ver a situação do pagamento.')
      return json({ checkout_url: result.checkout_url })
    }
    if (action === 'complete') {
      const current = await status(client, user, shopId)
      if (current.stage === 'payment') throw new HttpError(409, 'Conclua o pagamento antes de finalizar a configuração.')
      const { error } = await client.from('barbershops').update({ onboarding_completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', shopId)
      if (error) throw error
      return json({ ok: true })
    }
    throw new HttpError(404, 'Ação não encontrada.')
  } catch (error) { return failure(error) }
}

export const config: Config = { path: '/api/onboarding/:action' }
