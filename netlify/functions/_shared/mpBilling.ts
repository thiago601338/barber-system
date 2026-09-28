import type { SupabaseClient } from '@supabase/supabase-js'
import { email, HttpError, setting, uuid } from './core'
import { mpId, mpPublicUrl, mpRequest, type MpPreapproval, shopToken, verifyCollector } from './mpApi'
import { requireStartActor, requireSubscriptionActor, savePreapprovalStatus, subscriptionById } from './mpStore'

function amount(cents: number): number {
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new HttpError(400, 'Valor da assinatura inválido.')
  return cents / 100
}

function checkoutLink(remote: MpPreapproval): string | null {
  if (!remote.init_point) return null
  const parsed = new URL(remote.init_point)
  if (parsed.protocol !== 'https:' || !/(^|\.)mercadopago\.com(\.br|\.ar|\.mx|\.uy)?$/.test(parsed.hostname)) {
    throw new HttpError(502, 'O Mercado Pago retornou um link de checkout inválido.')
  }
  return parsed.toString()
}

export async function startCustomerSubscription(request: Request, client: SupabaseClient, input: Record<string, unknown>) {
  const shopId = uuid(input.barbershop_id)
  const clientId = uuid(input.client_id)
  const planId = uuid(input.plan_id)
  await requireStartActor(request, client, shopId, clientId)
  const { data: shop, error: shopError } = await client.from('barbershops').select('id,active').eq('id', shopId).single()
  if (shopError) throw shopError
  if (!shop.active) throw new HttpError(409, 'Barbearia inativa.')
  const [{ data: person, error: personError }, { data: plan, error: planError }] = await Promise.all([
    client.from('clients').select('email').eq('barbershop_id', shopId).eq('id', clientId).single(),
    client.from('subscription_plans').select('name,price_cents,frequency_months,active').eq('barbershop_id', shopId).eq('id', planId).single(),
  ])
  if (personError) throw personError
  if (planError) throw planError
  if (!plan.active) throw new HttpError(409, 'Plano de assinatura inativo.')
  const payerEmail = email(person.email)
  const { token, accountId } = await shopToken(client, shopId)
  const { data: existing, error: existingError } = await client.from('subscriptions')
    .select('id,provider_subscription_id,status')
    .eq('barbershop_id', shopId).eq('client_id', clientId).eq('plan_id', planId)
    .in('status', ['pending', 'authorized', 'active', 'paused', 'past_due']).limit(1).maybeSingle()
  if (existingError) throw existingError
  if (existing) {
    if (!existing.provider_subscription_id) throw new HttpError(409, 'Assinatura em criação. Concilie o pedido antes de tentar novamente.')
    const remote = await mpRequest<MpPreapproval>(`/preapproval/${mpId(existing.provider_subscription_id)}`, token)
    verifyCollector(remote, accountId)
    if (remote.external_reference !== existing.id) throw new HttpError(409, 'Referência divergente no Mercado Pago.')
    return { subscription_id: existing.id, status: existing.status, checkout_url: checkoutLink(remote) }
  }
  const { data: created, error: createError } = await client.from('subscriptions').insert({
    barbershop_id: shopId, client_id: clientId, plan_id: planId, provider: 'mercadopago', status: 'pending',
  }).select('id').single()
  if (createError) throw createError
  const remote = await mpRequest<MpPreapproval>('/preapproval', token, 'POST', {
    reason: plan.name,
    external_reference: created.id,
    payer_email: payerEmail,
    auto_recurring: { frequency: plan.frequency_months, frequency_type: 'months', transaction_amount: amount(plan.price_cents), currency_id: 'BRL' },
    back_url: mpPublicUrl('MP_CUSTOMER_BACK_URL'),
    status: 'pending',
  }, created.id)
  if (!remote.id) throw new HttpError(502, 'O Mercado Pago não retornou o ID da assinatura. Concilie antes de repetir.')
  const { error: saveError } = await client.from('subscriptions').update({
    provider_subscription_id: remote.id, updated_at: new Date().toISOString(),
  }).eq('id', created.id).eq('barbershop_id', shopId)
  if (saveError) throw new HttpError(502, 'Assinatura criada no Mercado Pago, mas não salva localmente. Concilie antes de repetir.')
  return { subscription_id: created.id, status: 'pending', checkout_url: checkoutLink(remote) }
}

export async function customerSubscriptionStatus(request: Request, client: SupabaseClient, id: string) {
  const subscription = await subscriptionById(client, uuid(id))
  await requireSubscriptionActor(request, client, subscription)
  if (!subscription.provider_subscription_id) throw new HttpError(409, 'Assinatura ainda não vinculada. Conciliação necessária.')
  const { token, accountId } = await shopToken(client, subscription.barbershop_id)
  const remote = await mpRequest<MpPreapproval>(`/preapproval/${mpId(subscription.provider_subscription_id)}`, token)
  verifyCollector(remote, accountId)
  const status = await savePreapprovalStatus(client, subscription, remote)
  return { subscription_id: subscription.id, status, provider_status: remote.status, checkout_url: checkoutLink(remote) }
}

export async function cancelCustomerSubscription(request: Request, client: SupabaseClient, id: string) {
  const subscription = await subscriptionById(client, uuid(id))
  await requireSubscriptionActor(request, client, subscription)
  if (!subscription.provider_subscription_id) throw new HttpError(409, 'Assinatura ainda não vinculada.')
  const { token, accountId } = await shopToken(client, subscription.barbershop_id)
  const providerId = mpId(subscription.provider_subscription_id)
  const before = await mpRequest<MpPreapproval>(`/preapproval/${providerId}`, token)
  verifyCollector(before, accountId)
  if (before.external_reference !== subscription.id) throw new HttpError(409, 'Referência divergente no Mercado Pago.')
  if (before.status !== 'canceled') await mpRequest<MpPreapproval>(`/preapproval/${providerId}`, token, 'PUT', { status: 'canceled' })
  const remote = await mpRequest<MpPreapproval>(`/preapproval/${providerId}`, token)
  verifyCollector(remote, accountId)
  const status = await savePreapprovalStatus(client, subscription, remote)
  return { subscription_id: subscription.id, status }
}

export interface SaasQuote {
  barbershop_id: string
  billing_enabled: boolean
  shop_active: boolean
  seat_count: number
  unit_price_cents: number
  amount_cents: number
}

export async function saasQuote(client: SupabaseClient, shopId: string): Promise<SaasQuote> {
  const [{ data: settings, error: settingsError }, { data: shop, error: shopError }, seats] = await Promise.all([
    client.from('platform_settings').select('seat_price_cents,billing_enabled').eq('id', 1).single(),
    client.from('barbershops').select('active').eq('id', shopId).single(),
    client.from('memberships').select('id', { count: 'exact', head: true })
      .eq('barbershop_id', shopId).eq('role', 'barber').eq('active', true),
  ])
  if (settingsError) throw settingsError
  if (shopError) throw shopError
  if (seats.error) throw seats.error
  const seatCount = seats.count || 0
  const total = seatCount * Number(settings.seat_price_cents)
  if (!Number.isSafeInteger(total)) throw new HttpError(409, 'Valor de cobrança excede o limite.')
  return { barbershop_id: shopId, billing_enabled: settings.billing_enabled, shop_active: shop.active, seat_count: seatCount,
    unit_price_cents: settings.seat_price_cents, amount_cents: total }
}

function requireSaasEnabled(quote: SaasQuote): void {
  if (!quote.billing_enabled) throw new HttpError(409, 'Cobrança SaaS desativada em platform_settings.')
  if (!quote.shop_active) throw new HttpError(409, 'Barbearia inativa.')
  if (quote.seat_count <= 0 || quote.amount_cents <= 0) throw new HttpError(409, 'É preciso ter barbeiros ativos e preço positivo para cobrar.')
}

function centralCredentials(): { token: string; accountId: string } {
  return { token: setting('MP_PLATFORM_ACCESS_TOKEN'), accountId: setting('MP_PLATFORM_ACCOUNT_ID') }
}

export async function startSaasSubscription(client: SupabaseClient, shopId: string, payer: unknown) {
  const quote = await saasQuote(client, shopId)
  requireSaasEnabled(quote)
  const payerEmail = email(payer)
  const { token, accountId } = centralCredentials()
  const { data: existing, error: existingError } = await client.from('platform_subscriptions')
    .select('provider_subscription_id,status,amount_cents,payer_email').eq('barbershop_id', shopId).maybeSingle()
  if (existingError) throw existingError
  if (existing?.provider_subscription_id && existing.status !== 'cancelled') {
    const remote = await mpRequest<MpPreapproval>(`/preapproval/${mpId(existing.provider_subscription_id)}`, token)
    verifyCollector(remote, accountId)
    if (remote.external_reference !== `saas-${shopId}`) throw new HttpError(409, 'Cobrança SaaS vinculada a outra referência.')
    if (existing.amount_cents !== quote.amount_cents) throw new HttpError(409, 'Quantidade/preço mudou. Aguarde a conciliação automática ou atualize a assinatura existente.')
    return { ...quote, status: existing.status, checkout_url: checkoutLink(remote) }
  }
  if (existing && !existing.provider_subscription_id && existing.status === 'pending') {
    throw new HttpError(409, 'Cobrança SaaS em criação. Concilie antes de tentar novamente.')
  }
  const { error: pendingError } = await client.from('platform_subscriptions').upsert({
    barbershop_id: shopId, payer_email: payerEmail, provider_subscription_id: null,
    status: 'pending', seat_count: quote.seat_count, unit_price_cents: quote.unit_price_cents,
    amount_cents: quote.amount_cents, auto_paused: false, last_reconciled_at: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'barbershop_id' })
  if (pendingError) throw pendingError
  const remote = await mpRequest<MpPreapproval>('/preapproval', token, 'POST', {
    reason: `Barber System — ${quote.seat_count} barbeiro(s) ativo(s)`,
    external_reference: `saas-${shopId}`,
    payer_email: payerEmail,
    auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: amount(quote.amount_cents), currency_id: 'BRL' },
    back_url: mpPublicUrl('MP_SAAS_BACK_URL'),
    status: 'pending',
  }, shopId)
  if (!remote.id) throw new HttpError(502, 'O Mercado Pago não retornou o ID da cobrança SaaS. Concilie antes de repetir.')
  const { error: saveError } = await client.from('platform_subscriptions').update({
    provider_subscription_id: remote.id, updated_at: new Date().toISOString(),
  }).eq('barbershop_id', shopId)
  if (saveError) throw new HttpError(502, 'Cobrança SaaS criada no Mercado Pago, mas não salva localmente. Concilie antes de repetir.')
  return { ...quote, status: 'pending', checkout_url: checkoutLink(remote) }
}

export async function syncSaasAmount(client: SupabaseClient, shopId: string) {
  const quote = await saasQuote(client, shopId)
  const { data: existing, error } = await client.from('platform_subscriptions')
    .select('provider_subscription_id,status,seat_count,unit_price_cents,amount_cents,auto_paused').eq('barbershop_id', shopId).single()
  if (error) throw error
  if (!existing.provider_subscription_id) throw new HttpError(409, 'Não existe assinatura SaaS vinculada para conciliar.')
  const { token, accountId } = centralCredentials()
  const id = mpId(existing.provider_subscription_id)
  const before = await mpRequest<MpPreapproval>(`/preapproval/${id}`, token)
  verifyCollector(before, accountId)
  if (before.id !== id || before.external_reference !== `saas-${shopId}`) throw new HttpError(409, 'Referência da cobrança SaaS divergente.')
  if (!['pending', 'authorized', 'paused', 'canceled', 'expired'].includes(before.status)) {
    throw new HttpError(502, 'Status desconhecido da cobrança SaaS no Mercado Pago.')
  }
  const billable = quote.billing_enabled && quote.shop_active && quote.seat_count > 0 && quote.amount_cents > 0
  const beforeAmount = Math.round(Number(before.auto_recurring?.transaction_amount) * 100)
  if (billable && ['pending', 'authorized'].includes(before.status) &&
      (!Number.isSafeInteger(beforeAmount) || beforeAmount <= 0 || before.auto_recurring?.currency_id !== 'BRL')) {
    throw new HttpError(502, 'Valor ou moeda da cobrança SaaS inválido no Mercado Pago.')
  }
  let after = before
  let action = 'unchanged'
  let autoPaused = Boolean(existing.auto_paused)
  if (!billable && before.status === 'pending') {
    after = await mpRequest<MpPreapproval>(`/preapproval/${id}`, token, 'PUT', { status: 'canceled' })
    action = 'cancelled_pending'
    autoPaused = false
  } else if (!billable && before.status === 'authorized') {
    after = await mpRequest<MpPreapproval>(`/preapproval/${id}`, token, 'PUT', { status: 'paused' })
    action = 'paused'
    autoPaused = true
  } else if (billable && before.status === 'paused' && autoPaused) {
    after = await mpRequest<MpPreapproval>(`/preapproval/${id}`, token, 'PUT', {
      status: 'authorized', auto_recurring: { transaction_amount: amount(quote.amount_cents), currency_id: 'BRL' },
    })
    action = 'resumed'
    autoPaused = false
  } else if (billable && ['pending', 'authorized'].includes(before.status) && beforeAmount !== quote.amount_cents) {
    after = await mpRequest<MpPreapproval>(`/preapproval/${id}`, token, 'PUT', {
      auto_recurring: { transaction_amount: amount(quote.amount_cents), currency_id: 'BRL' },
    })
    action = 'amount_updated'
    autoPaused = false
  } else if (billable && before.status === 'authorized') {
    autoPaused = false
  } else if (before.status === 'canceled' || before.status === 'expired') {
    autoPaused = false
  }
  verifyCollector(after, accountId)
  if (after.id !== id || after.external_reference !== `saas-${shopId}`) throw new HttpError(409, 'Resposta da cobrança SaaS divergente.')
  const expectedStatus = action === 'paused' ? 'paused' : action === 'resumed' ? 'authorized'
    : action === 'cancelled_pending' ? 'canceled' : before.status
  if (after.status !== expectedStatus) throw new HttpError(502, 'O Mercado Pago não confirmou o estado da assinatura. Verifique antes de repetir.')
  const amountChanged = action === 'resumed' || action === 'amount_updated'
  if (amountChanged && (after.auto_recurring?.currency_id !== 'BRL' ||
      Math.round(Number(after.auto_recurring?.transaction_amount) * 100) !== quote.amount_cents)) {
    throw new HttpError(502, 'O Mercado Pago não confirmou o novo valor. Verifique antes de repetir.')
  }
  // Keep the last authorized amount while paused; delayed invoice webhooks can
  // still refer to that amount. The current quote is returned separately.
  const persistQuote = amountChanged || (billable && ['pending', 'authorized'].includes(after.status))
  const localAmount = persistQuote
    ? { seat_count: quote.seat_count, unit_price_cents: quote.unit_price_cents, amount_cents: quote.amount_cents } : {}
  const status = after.status === 'canceled' ? 'cancelled' : after.status
  const localMatches = existing.status === status && Boolean(existing.auto_paused) === autoPaused &&
    (!persistQuote || (Number(existing.seat_count) === quote.seat_count &&
      Number(existing.unit_price_cents) === quote.unit_price_cents && Number(existing.amount_cents) === quote.amount_cents))
  if (localMatches) return { ...quote, status, action }
  const { error: saveError } = await client.from('platform_subscriptions').update({
    ...localAmount, status, auto_paused: autoPaused, updated_at: new Date().toISOString(),
  }).eq('barbershop_id', shopId).eq('provider_subscription_id', id)
  if (saveError) throw saveError
  return { ...quote, status, action }
}

export async function cancelSaasSubscription(client: SupabaseClient, shopId: string) {
  const { data, error } = await client.from('platform_subscriptions')
    .select('provider_subscription_id').eq('barbershop_id', shopId).single()
  if (error) throw error
  if (!data.provider_subscription_id) throw new HttpError(409, 'Cobrança SaaS não vinculada.')
  const { token, accountId } = centralCredentials()
  const id = mpId(data.provider_subscription_id)
  const before = await mpRequest<MpPreapproval>(`/preapproval/${id}`, token)
  verifyCollector(before, accountId)
  if (before.external_reference !== `saas-${shopId}`) throw new HttpError(409, 'Referência da cobrança SaaS divergente.')
  if (before.status !== 'canceled') await mpRequest<MpPreapproval>(`/preapproval/${id}`, token, 'PUT', { status: 'canceled' })
  const after = await mpRequest<MpPreapproval>(`/preapproval/${id}`, token)
  verifyCollector(after, accountId)
  if (after.status !== 'canceled') throw new HttpError(502, 'Cancelamento ainda não confirmado pelo Mercado Pago.')
  const { error: saveError } = await client.from('platform_subscriptions').update({
    status: 'cancelled', auto_paused: false, updated_at: new Date().toISOString(),
  })
    .eq('barbershop_id', shopId)
  if (saveError) throw saveError
  return { barbershop_id: shopId, status: 'cancelled' }
}
