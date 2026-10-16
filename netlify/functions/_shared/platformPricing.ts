export interface PlatformPricingSettings {
  base_monthly_cents?: number | null
  seat_price_cents: number
  monthly_cap_cents?: number | null
}

export interface ShopPricingOverrides {
  base_monthly_cents?: number | null
  per_barber_monthly_cents?: number | null
  monthly_cap_cents?: number | null
}

export const defaultPublicPricing = { base_cents: 2990, barber_cents: 790, monthly_cap_cents: 9690, currency: 'BRL' as const }

export function calculatePlatformPrice(settings: PlatformPricingSettings, shop: ShopPricingOverrides, seats: number) {
  const base = Number(shop.base_monthly_cents ?? settings.base_monthly_cents ?? 0)
  const unit = Number(shop.per_barber_monthly_cents ?? settings.seat_price_cents)
  const cap = Number(shop.monthly_cap_cents ?? settings.monthly_cap_cents ?? 0)
  const subtotal = base + seats * unit
  if (![base, unit, cap, seats, subtotal].every(Number.isSafeInteger) ||
      base < 0 || unit < 0 || cap < 0 || seats < 0 || subtotal > 2_147_483_647) {
    throw new Error('Valor de cobrança excede o limite.')
  }
  const total = cap > 0 ? Math.min(subtotal, cap) : subtotal
  return { base_monthly_cents: base, unit_price_cents: unit, monthly_cap_cents: cap,
    subtotal_cents: subtotal, discount_cents: subtotal - total, amount_cents: total }
}
