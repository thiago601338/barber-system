import type { SupabaseClient } from '@supabase/supabase-js'
import { HttpError, json, setting } from './core'
import { mpId, mpRequest, shopToken, type MpAuthorizedPayment, type MpPayment, type MpPreapproval, verifyCollector } from './mpApi'
import { sha256Hex, verifyWebhookSignature } from './mpCrypto'
import { markProviderEventProcessed, recordProviderEvent, saveCustomerPayment, savePreapprovalStatus, subscriptionByProviderId } from './mpStore'

interface Notification {
  id?: string | number
  type?: string
  topic?: string
  action?: string
  user_id?: string | number
  data?: { id?: string | number }
}

async function shopForAccount(client: SupabaseClient, accountId: string): Promise<string> {
  const { data, error } = await client.from('integration_credentials').select('barbershop_id')
    .eq('provider', 'mercadopago').eq('provider_account_id', accountId).limit(1)
  if (error) throw error
  if (!data?.length) throw new HttpError(404, 'Conta Mercado Pago do webhook não vinculada.')
  return data[0].barbershop_id
}

async function invoiceByPayment(token: string, paymentId: string): Promise<MpAuthorizedPayment | null> {
  const response = await mpRequest<{ results?: MpAuthorizedPayment[] }>(
    `/authorized_payments/search?payment_id=${mpId(paymentId)}`, token,
  )
  const matches = (response.results || []).filter(item => String(item.payment?.id) === paymentId)
  if (matches.length > 1) throw new HttpError(409, 'Pagamento associado a mais de uma fatura no Mercado Pago.')
  return matches[0] || null
}

async function syncShopPreapproval(client: SupabaseClient, providerId: string): Promise<void> {
  const local = await subscriptionByProviderId(client, providerId)
  const { token, accountId } = await shopToken(client, local.barbershop_id)
  const remote = await mpRequest<MpPreapproval>(`/preapproval/${mpId(providerId)}`, token)
  verifyCollector(remote, accountId)
  await savePreapprovalStatus(client, local, remote)
}

async function syncShopInvoice(client: SupabaseClient, invoiceId: string, accountId: string): Promise<void> {
  const candidateShop = await shopForAccount(client, accountId)
  const candidateToken = await shopToken(client, candidateShop)
  const invoice = await mpRequest<MpAuthorizedPayment>(`/authorized_payments/${mpId(invoiceId)}`, candidateToken.token)
  if (String(invoice.id) !== invoiceId || !invoice.preapproval_id) throw new HttpError(502, 'Fatura do Mercado Pago incompleta.')
  const local = await subscriptionByProviderId(client, invoice.preapproval_id)
  if (invoice.external_reference !== local.id) throw new HttpError(409, 'Fatura de outra assinatura.')
  const { token, accountId: actualAccount } = await shopToken(client, local.barbershop_id)
  if (actualAccount !== accountId) throw new HttpError(409, 'Conta da fatura divergente.')
  const preapproval = await mpRequest<MpPreapproval>(`/preapproval/${mpId(invoice.preapproval_id)}`, token)
  verifyCollector(preapproval, actualAccount)
  local.status = await savePreapprovalStatus(client, local, preapproval)
  if (!invoice.payment?.id) return
  const payment = await mpRequest<MpPayment>(`/v1/payments/${mpId(invoice.payment.id)}`, token)
  verifyCollector(payment, actualAccount)
  if (String(payment.id) !== String(invoice.payment.id)) throw new HttpError(409, 'ID de pagamento divergente.')
  await saveCustomerPayment(client, local, payment)
}

async function syncShopPayment(client: SupabaseClient, paymentId: string, accountId: string): Promise<void> {
  const candidateShop = await shopForAccount(client, accountId)
  const { token } = await shopToken(client, candidateShop)
  const payment = await mpRequest<MpPayment>(`/v1/payments/${mpId(paymentId)}`, token)
  verifyCollector(payment, accountId)
  if (String(payment.id) !== paymentId) throw new HttpError(409, 'ID de pagamento divergente.')
  const invoice = await invoiceByPayment(token, paymentId)
  if (!invoice?.preapproval_id) return // Payment outside this system's subscriptions.
  let local
  try { local = await subscriptionByProviderId(client, invoice.preapproval_id) }
  catch (error) { if (error instanceof HttpError && error.status === 404) return; throw error }
  const actual = await shopToken(client, local.barbershop_id)
  if (actual.accountId !== accountId) throw new HttpError(409, 'Conta do pagamento divergente.')
  if (invoice.external_reference !== local.id) throw new HttpError(409, 'Fatura de outra assinatura.')
  const preapproval = await mpRequest<MpPreapproval>(`/preapproval/${mpId(invoice.preapproval_id)}`, actual.token)
  verifyCollector(preapproval, accountId)
  local.status = await savePreapprovalStatus(client, local, preapproval)
  await saveCustomerPayment(client, local, payment)
}

async function platformBillingOwner(client: SupabaseClient, providerId: string) {
  const { data: current, error: currentError } = await client.from('platform_subscriptions')
    .select('barbershop_id,provider_subscription_id,seat_count,unit_price_cents,amount_cents')
    .eq('provider_subscription_id', providerId).maybeSingle()
  if (currentError) throw currentError
  if (current) return { ...current, historical_only: false }
  // A cancelled subscription can be replaced before its last invoice webhook
  // arrives. The append-only rate history still identifies the old owner.
  const { data: former, error: historyError } = await client.from('platform_subscription_rates')
    .select('barbershop_id,provider_subscription_id,seat_count,unit_price_cents,amount_cents')
    .eq('provider_subscription_id', providerId)
    .order('observed_at', { ascending: false }).limit(1).maybeSingle()
  if (historyError) throw historyError
  if (!former) throw new HttpError(404, 'Assinatura SaaS da fatura não encontrada.')
  return { ...former, historical_only: true }
}

function platformCredentials(): { token: string; accountId: string } {
  return { token: setting('MP_PLATFORM_ACCESS_TOKEN'), accountId: setting('MP_PLATFORM_ACCOUNT_ID') }
}

export async function syncPlatformPreapproval(client: SupabaseClient, providerId: string): Promise<void> {
  const local = await platformBillingOwner(client, providerId)
  const { token, accountId } = platformCredentials()
  const remote = await mpRequest<MpPreapproval>(`/preapproval/${mpId(providerId)}`, token)
  verifyCollector(remote, accountId)
  if (remote.id !== providerId || remote.external_reference !== `saas-${local.barbershop_id}`) {
    throw new HttpError(409, 'Referência da assinatura SaaS divergente.')
  }
  if (local.historical_only) return // Do not overwrite a replacement subscription.
  const status = remote.status === 'canceled' ? 'cancelled' : remote.status
  const { error } = await client.from('platform_subscriptions').update({ status, updated_at: new Date().toISOString() })
    .eq('barbershop_id', local.barbershop_id)
  if (error) throw error
}

function invoicePeriod(approvedAt: string): { start: string; end: string } {
  const date = new Date(approvedAt)
  if (Number.isNaN(date.getTime())) throw new HttpError(502, 'Data do pagamento SaaS inválida.')
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0))
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}

export async function savePlatformPayment(client: SupabaseClient, providerId: string,
  invoice: MpAuthorizedPayment, payment: MpPayment): Promise<void> {
  const providerInvoiceId = mpId(invoice.id)
  const local = await platformBillingOwner(client, providerId)
  if (invoice.preapproval_id !== providerId || invoice.external_reference !== `saas-${local.barbershop_id}` ||
      String(invoice.payment?.id) !== String(payment.id)) throw new HttpError(409, 'Fatura SaaS divergente.')
  if (payment.currency_id !== 'BRL' || invoice.currency_id !== 'BRL') throw new HttpError(409, 'Moeda da cobrança SaaS divergente.')
  const cents = Math.round(Number(payment.transaction_amount) * 100)
  const invoiceCents = Math.round(Number(invoice.transaction_amount) * 100)
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents !== invoiceCents) {
    throw new HttpError(409, 'Valor do pagamento SaaS difere da fatura oficial.')
  }
  const invoiceDate = invoice.date_created ? new Date(invoice.date_created) : null
  if (!invoiceDate || Number.isNaN(invoiceDate.getTime())) throw new HttpError(502, 'Fatura SaaS sem data de criação válida.')
  const { data: historical, error: historyError } = await client.from('platform_subscription_rates')
    .select('seat_count,unit_price_cents,amount_cents')
    .eq('barbershop_id', local.barbershop_id).eq('provider_subscription_id', providerId)
    .eq('amount_cents', cents).lte('observed_at', invoiceDate.toISOString())
    .order('observed_at', { ascending: false }).limit(1).maybeSingle()
  if (historyError) throw historyError
  // An initial invoice can be created before the first local rate snapshot.
  const rate = historical || (!local.historical_only && cents === local.amount_cents ? local : null)
  if (!rate) throw new HttpError(409, 'Tarifa histórica da fatura SaaS não encontrada. Conciliação manual necessária.')
  const status = payment.status === 'approved' ? 'paid' : payment.status
  const { start, end } = invoicePeriod(invoiceDate.toISOString())
  const record = {
    barbershop_id: local.barbershop_id, period_start: start, period_end: end,
    seat_count: rate.seat_count, unit_price_cents: rate.unit_price_cents,
    amount_cents: cents, status,
    provider_subscription_id: providerId, provider_invoice_id: providerInvoiceId,
    provider_payment_id: String(payment.id), updated_at: new Date().toISOString(),
  }
  const { data: existing, error: lookupError } = await client.from('platform_invoices').select('id,provider_payment_id,status')
    .eq('provider_invoice_id', providerInvoiceId).maybeSingle()
  if (lookupError) throw lookupError
  if (existing?.provider_payment_id && existing.provider_payment_id !== String(payment.id) && existing.status === 'paid') {
    throw new HttpError(409, 'Fatura SaaS já possui pagamento aprovado. Conciliação manual necessária.')
  }
  const result = existing
    ? await client.from('platform_invoices').update(record).eq('id', existing.id)
    : await client.from('platform_invoices').insert(record)
  if (result.error) throw result.error
}

async function syncPlatformInvoice(client: SupabaseClient, invoiceId: string): Promise<void> {
  const { token, accountId } = platformCredentials()
  const invoice = await mpRequest<MpAuthorizedPayment>(`/authorized_payments/${mpId(invoiceId)}`, token)
  if (String(invoice.id) !== invoiceId || !invoice.preapproval_id) throw new HttpError(502, 'Fatura SaaS incompleta.')
  const local = await platformBillingOwner(client, invoice.preapproval_id)
  if (invoice.external_reference !== `saas-${local.barbershop_id}`) throw new HttpError(409, 'Referência da fatura SaaS divergente.')
  const preapproval = await mpRequest<MpPreapproval>(`/preapproval/${mpId(invoice.preapproval_id)}`, token)
  verifyCollector(preapproval, accountId)
  if (preapproval.external_reference !== `saas-${local.barbershop_id}`) throw new HttpError(409, 'Assinatura SaaS divergente.')
  if (!invoice.payment?.id) return
  const payment = await mpRequest<MpPayment>(`/v1/payments/${mpId(invoice.payment.id)}`, token)
  verifyCollector(payment, accountId)
  if (String(payment.id) !== String(invoice.payment.id)) throw new HttpError(409, 'Pagamento SaaS divergente.')
  await savePlatformPayment(client, invoice.preapproval_id, invoice, payment)
}

async function syncPlatformPayment(client: SupabaseClient, paymentId: string): Promise<void> {
  const { token, accountId } = platformCredentials()
  const payment = await mpRequest<MpPayment>(`/v1/payments/${mpId(paymentId)}`, token)
  verifyCollector(payment, accountId)
  if (String(payment.id) !== paymentId) throw new HttpError(409, 'ID do pagamento SaaS divergente.')
  const invoice = await invoiceByPayment(token, paymentId)
  if (!invoice?.preapproval_id) return
  let local
  try { local = await platformBillingOwner(client, invoice.preapproval_id) }
  catch (error) { if (error instanceof HttpError && error.status === 404) return; throw error }
  if (invoice.external_reference !== `saas-${local.barbershop_id}`) throw new HttpError(409, 'Fatura SaaS divergente.')
  await savePlatformPayment(client, invoice.preapproval_id, invoice, payment)
}

export async function receiveMpWebhook(request: Request, client: SupabaseClient, scope: 'shop' | 'platform'): Promise<Response> {
  const url = new URL(request.url)
  const dataId = url.searchParams.get('data.id') || url.searchParams.get('data_id')
  if (!dataId) throw new HttpError(400, 'Webhook sem data.id.')
  const secret = setting(scope === 'shop' ? 'MP_WEBHOOK_SECRET' : 'MP_PLATFORM_WEBHOOK_SECRET')
  await verifyWebhookSignature(request, secret, dataId)
  const raw = await request.text()
  let notification: Notification
  try { notification = JSON.parse(raw) as Notification }
  catch { throw new HttpError(400, 'Webhook com JSON inválido.') }
  if (String(notification.data?.id || '') !== dataId) throw new HttpError(400, 'ID do webhook divergente.')
  const type = notification.type || notification.topic
  if (!type) throw new HttpError(400, 'Webhook sem tipo.')
  const eventId = `${type}:${notification.id ? String(notification.id) : await sha256Hex(raw)}`
  const provider = scope === 'shop' ? 'mercadopago-shop' : 'mercadopago-platform'
  if (!await recordProviderEvent(client, provider, eventId)) return json({ ok: true, duplicate: true })
  if (scope === 'shop') {
    if (type === 'subscription_preapproval') await syncShopPreapproval(client, mpId(dataId))
    else if (type === 'subscription_authorized_payment') {
      if (!notification.user_id) throw new HttpError(400, 'Webhook sem conta do vendedor.')
      await syncShopInvoice(client, mpId(dataId), String(notification.user_id))
    } else if (type === 'payment') {
      if (!notification.user_id) throw new HttpError(400, 'Webhook sem conta do vendedor.')
      await syncShopPayment(client, mpId(dataId), String(notification.user_id))
    }
  } else {
    if (type === 'subscription_preapproval') await syncPlatformPreapproval(client, mpId(dataId))
    else if (type === 'subscription_authorized_payment') await syncPlatformInvoice(client, mpId(dataId))
    else if (type === 'payment') await syncPlatformPayment(client, mpId(dataId))
  }
  await markProviderEventProcessed(client, provider, eventId)
  return json({ ok: true })
}
