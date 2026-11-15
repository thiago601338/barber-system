import { HttpError } from './core'

export interface SubscriptionContractTerms {
  version: 1
  captured_at: string
  plan_name: string
  description: string | null
  price_cents: number
  frequency_months: number
  visits_per_cycle: number
  services: { id: string; name: string; price_cents: number; duration_minutes: number }[]
}

/** Only server-captured terms can authorize money or subscription visits. */
export function subscriptionTerms(subscription: { contract_snapshot?: unknown; contract_review_required?: boolean }): SubscriptionContractTerms {
  const value = subscription.contract_snapshot as Partial<SubscriptionContractTerms> | null
  if (subscription.contract_review_required !== false || !value || value.version !== 1
    || typeof value.plan_name !== 'string' || !value.plan_name.trim()
    || !Number.isSafeInteger(value.price_cents) || value.price_cents! <= 0
    || !Number.isSafeInteger(value.frequency_months) || value.frequency_months! < 1 || value.frequency_months! > 12
    || !Number.isSafeInteger(value.visits_per_cycle) || value.visits_per_cycle! < 1 || value.visits_per_cycle! > 100
    || !Array.isArray(value.services) || !value.services.length
    || value.services.some(service => !service || typeof service.id !== 'string' || typeof service.name !== 'string')
    || typeof value.captured_at !== 'string' || Number.isNaN(Date.parse(value.captured_at))) {
    throw new HttpError(409, 'As condições originais deste contrato precisam ser verificadas antes da conciliação e da liberação de visitas.')
  }
  return value as SubscriptionContractTerms
}

/**
 * Barbearia com termo de aceite vigente só cria contrato com o aceite dessa mesma versão.
 * O aceite segue na criação do contrato e o banco o grava nas condições contratadas.
 */
export function contractAcceptance(active: { version?: unknown } | null | undefined, acceptedVersion: unknown, actorIsClient: boolean): { acceptance: { version: string; source: 'online' | 'staff_assisted' } } | null {
  if (!active) return null
  const version = typeof active.version === 'string' ? active.version : ''
  if (!version || acceptedVersion !== version) throw new HttpError(409, 'Para assinar, é preciso ler e aceitar o termo de aceite da barbearia.')
  return { acceptance: { version, source: actorIsClient ? 'online' : 'staff_assisted' } }
}

/** Jan 31 + one month ends Feb 28/29, never March 2/3. All times remain UTC. */
export function addContractMonths(startsAt: Date, months: number): Date {
  if (Number.isNaN(startsAt.getTime()) || !Number.isSafeInteger(months) || months < 1 || months > 12) {
    throw new HttpError(502, 'Ciclo de cobrança inválido.')
  }
  const end = new Date(startsAt)
  const day = end.getUTCDate()
  end.setUTCDate(1)
  end.setUTCMonth(end.getUTCMonth() + months)
  const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate()
  end.setUTCDate(Math.min(day, lastDay))
  return end
}
