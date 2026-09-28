import type { SupabaseClient } from '@supabase/supabase-js'
import { syncSaasAmount } from './mpBilling'

// Netlify scheduled functions have a 30-second limit. Four independent
// subscriptions run concurrently, so each MP GET + optional PUT fits inside it.
const batchSize = 4
const candidateSize = 12

interface Candidate {
  barbershop_id: string
  provider_subscription_id: string
  last_reconciled_at: string | null
}

export async function runSaasReconcileBatch(
  client: SupabaseClient,
  reconcile: (client: SupabaseClient, shopId: string) => Promise<unknown> = syncSaasAmount,
): Promise<{ claimed: number; succeeded: number; failed: number }> {
  const { data, error } = await client.from('platform_subscriptions')
    .select('barbershop_id,provider_subscription_id,last_reconciled_at')
    .not('provider_subscription_id', 'is', null)
    .not('status', 'in', '(cancelled,expired)')
    .order('last_reconciled_at', { ascending: true, nullsFirst: true })
    .limit(candidateSize)
  if (error) throw error
  const claimed: Candidate[] = []
  for (const row of (data || []) as Candidate[]) {
    if (claimed.length >= batchSize) break
    // Compare-and-swap prevents two overlapping runs from claiming the same
    // subscription. The timestamp also rotates failures instead of starving
    // all later shops; a subsequent run retries them.
    let claim = client.from('platform_subscriptions')
      .update({ last_reconciled_at: new Date().toISOString() })
      .eq('barbershop_id', row.barbershop_id)
      .eq('provider_subscription_id', row.provider_subscription_id)
    claim = row.last_reconciled_at
      ? claim.eq('last_reconciled_at', row.last_reconciled_at)
      : claim.is('last_reconciled_at', null)
    const result = await claim.select('barbershop_id').maybeSingle()
    if (result.error) throw result.error
    if (result.data) claimed.push(row)
  }
  const outcomes = await Promise.allSettled(claimed.map(row => reconcile(client, row.barbershop_id)))
  let failed = 0
  for (let index = 0; index < outcomes.length; index++) {
    const result = outcomes[index]
    if (result.status === 'rejected') {
      failed++
      const message = result.reason instanceof Error ? result.reason.message : 'Erro desconhecido'
      console.error('Falha ao conciliar SaaS', { barbershop_id: claimed[index].barbershop_id, error: message })
    }
  }
  return { claimed: claimed.length, succeeded: claimed.length - failed, failed }
}
