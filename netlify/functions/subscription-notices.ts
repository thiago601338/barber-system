import type { Config } from '@netlify/functions'
import { db } from './_shared/core'
import { runSubscriptionNotices } from './_shared/subscriptionNotices'

// Envia os avisos de assinatura pendentes pelo WhatsApp da barbearia. Sem rota HTTP pública.
export default async () => {
  const result = await runSubscriptionNotices(db())
  console.info('Avisos de assinatura', result)
}

export const config: Config = { schedule: '*/10 * * * *' }
