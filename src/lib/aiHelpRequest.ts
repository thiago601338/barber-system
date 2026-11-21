import { authedApi, authedGet } from './supabase'

type Processing = { mode: 'processing'; plan_id: string }
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** Sends a request to the Ajuda de IA and waits while it consults the agenda, clients and cash register in the background. */
export async function requestAiHelp<T>(body: Record<string, unknown>): Promise<T> {
  let response = await authedApi<T | Processing>('/api/ai-help/plan', body)
  const started = Date.now()
  while (response && typeof response === 'object' && 'mode' in response && (response as Processing).mode === 'processing') {
    if (Date.now() - started > 170_000) throw new Error('A IA demorou demais para responder. Tente de novo.')
    await sleep(Date.now() - started < 6_000 ? 900 : 1_500)
    response = await authedGet<T | Processing>(`/api/ai-help/result?plan_id=${encodeURIComponent((response as Processing).plan_id)}`)
  }
  return response as T
}
