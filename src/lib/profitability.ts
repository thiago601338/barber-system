export interface FinancialSettings {
  tax_pct: number; payment_fee_pct: number; service_commission_pct: number
  product_commission_pct: number; structure_in_expenses: boolean; reviewed: boolean
  structure_monthly_cost_cents: number; target_profit_pct: number | null
}
export interface CostItem {
  id: string; kind: 'service' | 'product' | 'subscription'; name: string; category: string
  price_cents: number; cost_cents: number; extra_cost_cents: number; cost_confirmed: boolean
  tax_pct: number; fee_pct: number; commission_pct: number; extra_service: boolean
}
export interface FinancialLine {
  item_id: string | null; kind: string; name: string; category: string
  revenue_cents: number; quantity: number; direct_cost_cents: number; extra_cost_cents: number
  tax_pct: number; fee_pct: number; commission_pct: number; estimated: boolean
}
export interface ProfitabilityData {
  settings: FinancialSettings; catalog: CostItem[]; lines: FinancialLine[]
  subscription_costs: { cost_cents: number; estimated: boolean }[]
  expenses: { cost_kind: string; amount_cents: number }[]; structure_period_cents: number
}
export const percent = (value: number | null | undefined) => value == null ? '—' : `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value)}%`
export function priceEconomics(cost: number, extra: number, price: number, tax: number, fee: number, commission: number, fixed = 0, target = 0) {
  const direct = cost + extra
  const variable = price * (tax + fee + commission) / 100
  const total = direct + variable + fixed
  const divisor = 1 - (tax + fee + commission + target) / 100
  return { total, profit: price - total, margin: price > 0 ? (price - total) / price * 100 : null,
    markup: direct > 0 ? price / direct : null,
    suggested: divisor > 0 && direct + fixed > 0 ? Math.ceil((direct + fixed) / divisor) : null }
}
export function calculateProfitability(data: ProfitabilityData) {
  let revenue = 0, direct = 0, extras = 0, calculatedTax = 0, calculatedFees = 0, calculatedCommission = 0
  let estimatedLines = 0
  const groups = new Map<string, FinancialLine & { total_cost_cents: number; contribution_cents: number }>()
  for (const line of data.lines) {
    const gross = Number(line.revenue_cents)
    const cost = Number(line.direct_cost_cents), extra = Number(line.extra_cost_cents)
    const tax = Math.round(gross * Number(line.tax_pct) / 100)
    const fee = Math.round(gross * Number(line.fee_pct) / 100)
    const commission = Math.round(gross * Number(line.commission_pct) / 100)
    const total = cost + extra + tax + fee + commission
    revenue += gross; direct += cost; extras += extra; calculatedTax += tax; calculatedFees += fee; calculatedCommission += commission
    if (line.estimated) estimatedLines++
    const key = `${line.kind}:${line.item_id || line.name}`
    const existing = groups.get(key)
    if (existing) {
      existing.revenue_cents += gross; existing.quantity += Number(line.quantity)
      existing.direct_cost_cents += cost; existing.extra_cost_cents += extra
      existing.total_cost_cents += total; existing.contribution_cents += gross - total
      existing.estimated ||= line.estimated
    } else groups.set(key, { ...line, revenue_cents: gross, quantity: Number(line.quantity), direct_cost_cents: cost,
      extra_cost_cents: extra, total_cost_cents: total, contribution_cents: gross - total })
  }
  const usageCosts = data.subscription_costs.reduce((sum, usage) => sum + Number(usage.cost_cents), 0)
  estimatedLines += data.subscription_costs.filter(usage => usage.estimated).length
  const byKind = (kind: string) => data.expenses.filter(expense => expense.cost_kind === kind).reduce((sum, expense) => sum + Number(expense.amount_cents), 0)
  const hasKind = (kind: string) => data.expenses.some(expense => expense.cost_kind === kind)
  // Actual tax/fee/commission entries replace their estimates; purchases are not counted again as COGS.
  const tax = hasKind('tax') ? byKind('tax') : calculatedTax, fees = hasKind('fees') ? byKind('fees') : calculatedFees, commission = hasKind('commission') ? byKind('commission') : calculatedCommission
  const operating = data.expenses.filter(expense => ['operating', 'structure'].includes(expense.cost_kind || 'operating')).reduce((sum, expense) => sum + Number(expense.amount_cents), 0)
  const structure = data.settings.structure_in_expenses ? 0 : Number(data.structure_period_cents)
  const contribution = revenue - direct - extras - tax - fees - commission - usageCosts
  const fixed = operating + structure
  const profit = contribution - fixed
  const contributionRate = revenue > 0 ? contribution / revenue : null
  return { revenue, direct, extras, tax, fees, commission, usageCosts, fixed, totalCost: revenue - profit,
    contribution, profit, netMargin: revenue > 0 ? profit / revenue * 100 : null,
    breakEven: contributionRate != null && contributionRate > 0 ? Math.ceil(fixed / contributionRate) : null,
    estimatedLines, actualTax: hasKind('tax'), actualFees: hasKind('fees'), actualCommission: hasKind('commission'),
    inventoryPurchases: byKind('inventory'), rows: [...groups.values()].sort((a, b) => b.contribution_cents - a.contribution_cents) }
}
