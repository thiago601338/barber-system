import type { SupabaseClient, User } from '@supabase/supabase-js'
import { HttpError, requirePlatformAdmin, requireShopAdmin, userFromRequest } from './core'
import type { MpPayment, MpPreapproval } from './mpApi'

export interface LocalSubscription {
  id: string
  barbershop_id: string
  client_id: string
  plan_id: string
  status: string
  provider_subscription_id: string | null
  current_period_start: string | null
  current_period_end: string | null
}

export async function subscriptionById(client: SupabaseClient, id: string): Promise<LocalSubscription> {
  const { data, error } = await client.from('subscriptions')
    .select('id,barbershop_id,client_id,plan_id,status,provider_subscription_id,current_period_start,current_period_end')
    .eq('id', id).maybeSingle()
  if (error) throw error
  if (!data) throw new HttpError(404, 'Assinatura não encontrada.')
  return data as LocalSubscription
}

export async function subscriptionByProviderId(client: SupabaseClient, providerId: string): Promise<LocalSubscription> {
  const { data, error } = await client.from('subscriptions')
    .select('id,barbershop_id,client_id,plan_id,status,provider_subscription_id,current_period_start,current_period_end')
    .eq('provider', 'mercadopago').eq('provider_subscription_id', providerId).maybeSingle()
  if (error) throw error
  if (!data) throw new HttpError(404, 'Assinatura do webhook não encontrada.')
  return data as LocalSubscription
}

export async function requireSubscriptionActor(request: Request, client: SupabaseClient, subscription: LocalSubscription): Promise<User> {
  const user = await userFromRequest(request, client)
  const { data: clientRecord, error } = await client.from('clients').select('user_id')
    .eq('barbershop_id', subscription.barbershop_id).eq('id', subscription.client_id).maybeSingle()
  if (error) throw error
  if (clientRecord?.user_id === user.id) return user
  try { await requireShopAdmin(client, user.id, subscription.barbershop_id) }
  catch { await requirePlatformAdmin(client, user.id) }
  return user
}

export async function requireStartActor(request: Request, client: SupabaseClient, shopId: string, clientId: string): Promise<User> {
  const user = await userFromRequest(request, client)
  const { data: clientRecord, error } = await client.from('clients').select('user_id')
    .eq('barbershop_id', shopId).eq('id', clientId).maybeSingle()
  if (error) throw error
  if (!clientRecord) throw new HttpError(404, 'Cliente não encontrado.')
  if (clientRecord.user_id === user.id) return user
  try { await requireShopAdmin(client, user.id, shopId) }
  catch { await requirePlatformAdmin(client, user.id) }
  return user
}

export function localPreapprovalStatus(status: string, current: string): string {
  switch (status) {
    case 'pending': return 'pending'
    case 'authorized': return current === 'active' ? 'active' : 'authorized'
    case 'paused': return 'paused'
    case 'canceled': return 'cancelled'
    case 'expired': return 'expired'
    default: throw new HttpError(502, 'Status de assinatura desconhecido no Mercado Pago.')
  }
}

export async function savePreapprovalStatus(client: SupabaseClient, subscription: LocalSubscription, remote: MpPreapproval): Promise<string> {
  if (remote.id !== subscription.provider_subscription_id || remote.external_reference !== subscription.id) {
    throw new HttpError(409, 'Referência da assinatura divergente no Mercado Pago.')
  }
  const status = localPreapprovalStatus(remote.status, subscription.status)
  const { error } = await client.from('subscriptions').update({
    status,
    cancelled_at: status === 'cancelled' ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }).eq('id', subscription.id).eq('barbershop_id', subscription.barbershop_id)
  if (error) throw error
  return status
}

export async function recordProviderEvent(client: SupabaseClient, provider: string, eventId: string): Promise<boolean> {
  const { error } = await client.from('provider_events').insert({ provider, event_id: eventId })
  if (!error) return true
  if (error.code !== '23505') throw error
  const { data, error: lookupError } = await client.from('provider_events').select('processed_at')
    .eq('provider', provider).eq('event_id', eventId).single()
  if (lookupError) throw lookupError
  return !data.processed_at
}

export async function markProviderEventProcessed(client: SupabaseClient, provider: string, eventId: string): Promise<void> {
  const { error } = await client.from('provider_events').update({ processed_at: new Date().toISOString() })
    .eq('provider', provider).eq('event_id', eventId)
  if (error) throw error
}

function paymentStatus(status: string): string {
  switch (status) {
    case 'approved': return 'paid'
    case 'authorized': return 'authorized'
    case 'pending':
    case 'in_process':
    case 'in_mediation': return 'pending'
    case 'rejected': return 'rejected'
    case 'cancelled': return 'cancelled'
    case 'refunded': return 'refunded'
    case 'charged_back': return 'charged_back'
    default: throw new HttpError(502, 'Status de pagamento desconhecido no Mercado Pago.')
  }
}

export async function saveCustomerPayment(client: SupabaseClient, subscription: LocalSubscription, remote: MpPayment): Promise<void> {
  if (remote.currency_id !== 'BRL') throw new HttpError(409, 'Moeda do pagamento divergente.')
  const providerPaymentId = String(remote.id)
  const amount = Number(remote.transaction_amount)
  if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(502, 'Valor de pagamento inválido no Mercado Pago.')
  const amountCents = Math.round(amount * 100)
  const status = paymentStatus(remote.status)
  const method = remote.payment_method_id === 'pix' ? 'pix'
    : remote.payment_type_id?.includes('card') ? 'card' : 'other'
  const { data: existing, error: lookupError } = await client.from('payments').select('id,subscription_id,paid_at,status')
    .eq('provider', 'mercadopago').eq('provider_payment_id', providerPaymentId).maybeSingle()
  if (lookupError) throw lookupError
  if (existing && existing.subscription_id !== subscription.id) throw new HttpError(409, 'Pagamento já pertence a outra assinatura.')
  const terminalStatuses = ['refunded', 'charged_back', 'cancelled']
  if (existing && terminalStatuses.includes(existing.status) && !terminalStatuses.includes(status)) return
  const { data: plan, error: planError } = await client.from('subscription_plans').select('price_cents,frequency_months')
    .eq('barbershop_id', subscription.barbershop_id).eq('id', subscription.plan_id).single()
  if (planError) throw planError
  if (status === 'paid' && amountCents !== Number(plan.price_cents)) {
    throw new HttpError(409, 'Valor pago difere do plano. Conciliação manual necessária antes de liberar visitas.')
  }
  // Preserve the original approval date after a refund/chargeback so the
  // database can identify which billing cycle lost its supporting payment.
  const paidAt = remote.date_approved || existing?.paid_at || null
  if (status === 'paid' && !paidAt) throw new HttpError(502, 'Pagamento aprovado sem data de aprovação no Mercado Pago.')
  const record = {
    barbershop_id: subscription.barbershop_id,
    client_id: subscription.client_id,
    subscription_id: subscription.id,
    provider: 'mercadopago',
    provider_payment_id: providerPaymentId,
    amount_cents: amountCents,
    status,
    method,
    paid_at: paidAt,
    updated_at: new Date().toISOString(),
  }
  const result = existing
    ? await (terminalStatuses.includes(status)
      ? client.from('payments').update(record).eq('id', existing.id).select('id').maybeSingle()
      : client.from('payments').update(record).eq('id', existing.id)
        .not('status', 'in', '(refunded,charged_back,cancelled)').select('id').maybeSingle())
    : await client.from('payments').insert(record).select('id').single()
  if (result.error) throw result.error
  if (!result.data) return // A concurrent reversal won the race against an older approval.
  if (status !== 'paid' || ['cancelled', 'expired', 'paused'].includes(subscription.status)) return
  const paymentDate = new Date(paidAt!)
  if (Number.isNaN(paymentDate.getTime())) throw new HttpError(502, 'Data de pagamento inválida no Mercado Pago.')
  const currentStart = subscription.current_period_start ? new Date(subscription.current_period_start) : null
  const currentEnd = subscription.current_period_end ? new Date(subscription.current_period_end) : null
  if (currentEnd && currentEnd.getTime() > paymentDate.getTime()) {
    // A delayed webhook from a previous cycle cannot restore today's visits.
    if (!currentStart || paymentDate.getTime() < currentStart.getTime()) return
    const { error } = await client.from('subscriptions').update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('id', subscription.id).eq('barbershop_id', subscription.barbershop_id)
      .in('status', ['pending', 'authorized', 'active', 'past_due'])
      .eq('current_period_start', subscription.current_period_start)
      .eq('current_period_end', subscription.current_period_end)
    if (error) throw error
    const { error: reconcileError } = await client.rpc('reconcile_subscription_entitlement', { p_subscription_id: subscription.id })
    if (reconcileError) throw reconcileError
    return
  }
  const periodEnd = new Date(paymentDate)
  periodEnd.setUTCMonth(periodEnd.getUTCMonth() + Number(plan.frequency_months))
  let update = client.from('subscriptions').update({
    status: 'active',
    current_period_start: paymentDate.toISOString(),
    current_period_end: periodEnd.toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', subscription.id).eq('barbershop_id', subscription.barbershop_id)
    .in('status', ['pending', 'authorized', 'active', 'past_due'])
  update = subscription.current_period_start
    ? update.eq('current_period_start', subscription.current_period_start)
    : update.is('current_period_start', null)
  update = subscription.current_period_end
    ? update.eq('current_period_end', subscription.current_period_end)
    : update.is('current_period_end', null)
  const { error: subscriptionError } = await update
  if (subscriptionError) throw subscriptionError
  const { error: reconcileError } = await client.rpc('reconcile_subscription_entitlement', { p_subscription_id: subscription.id })
  if (reconcileError) throw reconcileError
}
