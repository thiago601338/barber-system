interface ShopRow { id: string; active: boolean; base_monthly_cents?: number; per_barber_monthly_cents?: number | null }
interface MembershipRow { barbershop_id: string; role: string; active: boolean }
interface SubscriptionRow { barbershop_id: string; status: string; amount_cents: number }
interface InvoiceRow { period_start: string; status: string; amount_cents: number }

export interface PlatformOverviewRows {
  shops: ShopRow[]
  memberships: MembershipRow[]
  subscriptions: SubscriptionRow[]
  invoices: InvoiceRow[]
  settings: { seat_price_cents: number }
}

export async function readAllPages<T>(readPage: (from: number, to: number) => Promise<{
  data: T[] | null
  error: { message: string } | null
}>, pageSize = 1000): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await readPage(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    const page = data || []
    rows.push(...page)
    if (page.length < pageSize) return rows
  }
}

export function summarizePlatformOverview(rows: PlatformOverviewRows, today = new Date()) {
  const currentMonth = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)
  const monthly = Array.from({ length: 12 }, (_, index) => {
    const month = new Date(currentMonth)
    month.setUTCMonth(month.getUTCMonth() - 11 + index)
    return { month: month.toISOString().slice(0, 7), invoiced_cents: 0, paid_cents: 0,
      unpaid_cents: 0, pending_cents: 0, failed_cents: 0, refunded_cents: 0,
      other_cents: 0, invoice_count: 0 }
  })
  const byMonth = new Map(monthly.map(item => [item.month, item]))
  const subscriptionShops = new Set(rows.subscriptions.map(row => row.barbershop_id))
  const activeSubscriptions = rows.subscriptions.filter(row => ['authorized', 'active'].includes(row.status))
  const seatsByShop = new Map<string, number>()
  for (const member of rows.memberships) {
    if (member.role === 'barber' && member.active) {
      seatsByShop.set(member.barbershop_id, (seatsByShop.get(member.barbershop_id) || 0) + 1)
    }
  }
  const monthlyPotential = rows.shops.filter(row => row.active).reduce((sum, shop) => {
    const base = Number(shop.base_monthly_cents || 0)
    const unit = Number(shop.per_barber_monthly_cents ?? rows.settings.seat_price_cents)
    return sum + base + (seatsByShop.get(shop.id) || 0) * unit
  }, 0)
  let invoicedCents = 0
  let paidCents = 0
  let outstandingCents = 0
  let failedCents = 0
  let refundedCents = 0
  let otherCents = 0
  let paidInvoiceCount = 0
  let openInvoiceCount = 0
  let failedInvoiceCount = 0
  let refundedInvoiceCount = 0
  let otherInvoiceCount = 0

  for (const invoice of rows.invoices) {
    const cents = Number(invoice.amount_cents)
    if (!Number.isSafeInteger(cents) || cents < 0) throw new Error('Valor de fatura inválido no resumo master.')
    const status = invoice.status
    const isPaid = status === 'paid'
    const isPending = ['pending', 'in_process', 'in_mediation', 'authorized'].includes(status)
    const isFailed = ['rejected', 'cancelled', 'canceled'].includes(status)
    const isRefunded = ['refunded', 'charged_back'].includes(status)
    invoicedCents += cents
    if (isPaid) { paidCents += cents; paidInvoiceCount++ }
    else if (isPending) { outstandingCents += cents; openInvoiceCount++ }
    else if (isFailed) { failedCents += cents; failedInvoiceCount++ }
    else if (isRefunded) { refundedCents += cents; refundedInvoiceCount++ }
    else { otherCents += cents; otherInvoiceCount++ }
    const bucket = byMonth.get(invoice.period_start.slice(0, 7))
    if (bucket) {
      bucket.invoiced_cents += cents
      bucket.invoice_count++
      if (isPaid) bucket.paid_cents += cents
      else {
        bucket.unpaid_cents += cents
        if (isPending) bucket.pending_cents += cents
        else if (isFailed) bucket.failed_cents += cents
        else if (isRefunded) bucket.refunded_cents += cents
        else bucket.other_cents += cents
      }
    }
  }

  return {
    summary: {
      active_shops: rows.shops.filter(row => row.active).length,
      active_barbers: rows.memberships.filter(row => row.role === 'barber' && row.active).length,
      monthly_potential_cents: monthlyPotential,
      monthly_expected_cents: activeSubscriptions.reduce((sum, row) => sum + Number(row.amount_cents || 0), 0),
      invoiced_cents: invoicedCents,
      paid_cents: paidCents,
      outstanding_cents: outstandingCents,
      failed_cents: failedCents,
      refunded_cents: refundedCents,
      other_cents: otherCents,
      paid_invoice_count: paidInvoiceCount,
      open_invoice_count: openInvoiceCount,
      failed_invoice_count: failedInvoiceCount,
      refunded_invoice_count: refundedInvoiceCount,
      other_invoice_count: otherInvoiceCount,
      active_subscription_count: activeSubscriptions.length,
      pending_subscription_count: rows.subscriptions.filter(row => row.status === 'pending').length,
      paused_subscription_count: rows.subscriptions.filter(row => row.status === 'paused').length,
      cancelled_subscription_count: rows.subscriptions.filter(row => ['cancelled', 'canceled', 'expired'].includes(row.status)).length,
      unconfigured_shop_count: rows.shops.filter(row => !subscriptionShops.has(row.id)).length,
    },
    monthly,
  }
}
