import type { Config } from '@netlify/functions'
import { db } from './_shared/core'
import { runSaasReconcileBatch } from './_shared/mpSaasSchedule'

export default async () => {
  const result = await runSaasReconcileBatch(db())
  console.info('Conciliação SaaS concluída', result)
}

// Runs on the published deploy only; there is no public HTTP route.
export const config: Config = { schedule: '*/5 * * * *' }
