import { db } from './_shared/core.ts'
import { constantTimeEqual } from './_shared/mpCrypto.ts'
import { aiHelpInternalToken, runAiHelpPlan } from './_shared/aiHelpRun.ts'

// Ajuda de IA em segundo plano: consulta clientes, agenda, horários e caixa e grava a resposta ou a ação proposta no pedido.
// O painel acompanha o pedido por /api/ai-help/result até ficar pronto.
export default async (request: Request): Promise<void> => {
  let input: { plan_id?: unknown }
  try { input = await request.json() } catch { return }
  const planId = typeof input.plan_id === 'string' ? input.plan_id : ''
  if (!/^[0-9a-f-]{36}$/i.test(planId)) return
  if (!constantTimeEqual(request.headers.get('x-ai-help-internal') || '', await aiHelpInternalToken(planId))) return
  try { await runAiHelpPlan(db(), planId) }
  catch (error) {
    console.error('ai-help background', error)
    await db().from('ai_help_plans').update({ status: 'failed', summary: 'A IA não conseguiu responder agora. Tente de novo.' }).eq('id', planId).eq('status', 'processing')
  }
}
