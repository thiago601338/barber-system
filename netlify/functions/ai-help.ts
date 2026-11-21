import type { Config } from '@netlify/functions'
import { actionLabel, type ActionType, validateHelpAction } from './_shared/aiHelpActions.ts'
import { resolveHelpAccess as access } from './_shared/aiHelpAccess.ts'
import { loadHelpOptions, validateOperationalProposal } from './_shared/aiHelpOptions.ts'
import { body, db, failure, HttpError, json, optionalSetting, text, userFromRequest, uuid, requirePlatformAdmin } from './_shared/core.ts'
import { loadProduct, queueProductPhoto } from './_shared/productPhoto.ts'
import { brMoneyText } from './_shared/aiHelpTools.ts'
import { aiHelpInternalToken, modelInstructions, visibleInCurrentAccess } from './_shared/aiHelpRun.ts'

export { modelInstructions, visibleInCurrentAccess }

type Input = { barbershop_id?: unknown; prompt?: unknown; plan_id?: unknown; action?: unknown; idempotency_key?: unknown; values?: unknown }
type PlanRow = {
  id: string; barbershop_id: string | null; requester_user_id: string; prompt: string;
  summary: string; action_type: ActionType | null; action_values: Record<string, unknown> | null;
  status: string; result: unknown; expires_at: string; executed_at: string | null; created_at: string;
}

export function readHelpAnswer(candidate: unknown): string | null {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null
  const output = candidate as Record<string, unknown>
  if (output.type !== 'answer' && output.type !== 'unsupported') return null
  const answer = output.type === 'answer' ? output.answer : output.reason
  if (typeof answer !== 'string' || !answer.trim()) throw new HttpError(503, 'A IA retornou uma resposta incompleta. Tente novamente.')
  return answer.trim().slice(0, 4000)
}

function mappedExecutionError(error: { code?: string; message?: string }): HttpError {
  if (error.code === '42501') return new HttpError(403, brMoneyText(error.message || 'Permissão revogada para esta ação.'))
  if (error.code === '23505') return new HttpError(409, 'Já existe um registro com este endereço ou código. Peça um novo plano com outro valor.')
  if ((error.code === '23514' || error.code === '22023') && error.message) return new HttpError(422, brMoneyText(error.message))
  if (error.code === '23514' || error.code === '22P02' || error.code === '22023') return new HttpError(422, 'Os dados propostos não atendem às regras do cadastro. Peça outro plano.')
  if ((error.code === 'P0001' || error.code === 'P0002') && error.message) return new HttpError(409, brMoneyText(error.message))
  if (error.code === 'P0001') return new HttpError(409, 'Este plano não pode mais ser executado.')
  return new HttpError(500, 'Não foi possível executar a ação. Nenhum novo cadastro foi confirmado.')
}

function historyItem(row: PlanRow) {
  const status = row.status === 'pending' && new Date(row.expires_at).getTime() <= Date.now() ? 'expired' : row.status
  const result = row.result && typeof row.result === 'object' && !Array.isArray(row.result) ? row.result as Record<string, unknown> : null
  return {
    id: row.id, prompt: row.prompt, summary: row.summary,
    action: row.action_type ? { type: row.action_type, label: actionLabel(row.action_type), values: row.action_values } : null,
    status, result: row.result, answer: row.status === 'answered' && typeof result?.answer === 'string' ? result.answer : null,
    created_at: row.created_at,
    expires_at: row.expires_at, executed_at: row.executed_at,
  }
}

export default async (request: Request) => {
  try {
    const action = new URL(request.url).pathname.split('/').pop()
    if (!['plan', 'prepare', 'execute', 'history', 'options', 'slots', 'config', 'result'].includes(action || '')) throw new HttpError(404, 'Ação não encontrada.')
    if (['history','options','slots','result'].includes(action!) && request.method !== 'GET') throw new HttpError(405, 'Método não permitido.')
    if (['plan','prepare','execute'].includes(action!) && request.method !== 'POST') throw new HttpError(405, 'Método não permitido.')
    const client = db()
    const user = await userFromRequest(request, client)

    if(action==='config') {
      await requirePlatformAdmin(client,user.id)
      if(request.method==='GET') {
        const {data,error}=await client.rpc('ai_help_admin_usage',{p_actor_id:user.id})
        if(error) throw error
        return json(data)
      }
      if(request.method!=='POST') throw new HttpError(405,'Método não permitido.')
      const input=await body<Input>(request)
      const shopId=input.barbershop_id==null?null:uuid(input.barbershop_id)
      const values=input.values
      if(!values || typeof values!=='object' || Array.isArray(values)) throw new HttpError(400,'Configuração inválida.')
      const {data,error}=await client.rpc('configure_ai_help_limits',{p_actor_id:user.id,p_barbershop_id:shopId,p_values:values})
      if(error) throw mappedExecutionError(error)
      return json({settings:data})
    }
    if(action==='options' || action==='slots') {
      const query=new URL(request.url).searchParams
      const shopId=query.has('barbershop_id')?uuid(query.get('barbershop_id')):null
      const current=await access(client,user.id,shopId)
      if(action==='options') return json({...await loadHelpOptions(client,current),daily_limit:current.dailyLimit,timezone:current.timezone})
      if(!shopId || !current.allowed.includes('book_appointment')) throw new HttpError(403,'Seu perfil não permite agendamentos por IA.')
      const serviceIds=(query.get('service_ids')||'').split(',').filter(Boolean).map(uuid)
      if(!serviceIds.length || serviceIds.length>30) throw new HttpError(400,'Selecione os serviços.')
      const day=query.get('day');if(!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new HttpError(400,'Selecione uma data válida.')
      const {data,error}=await client.rpc('ai_help_available_slots',{p_actor_id:user.id,p_barbershop_id:shopId,
        p_client_id:uuid(query.get('client_id')),p_member_id:uuid(query.get('barber_id')),p_service_ids:serviceIds,p_day:day})
      if(error) throw mappedExecutionError(error)
      return json({slots:data,timezone:current.timezone})
    }

    if (action === 'result') {
      const planId = uuid(new URL(request.url).searchParams.get('plan_id'))
      const { data: row, error } = await client.from('ai_help_plans').select('id,barbershop_id,requester_user_id,prompt,summary,action_type,action_values,status,result,expires_at,executed_at,created_at')
        .eq('id', planId).eq('requester_user_id', user.id).maybeSingle()
      if (error) throw error
      if (!row) throw new HttpError(404, 'Pedido não encontrado.')
      if (row.status === 'processing') {
        if (Date.now() - Date.parse(row.created_at) > 180_000) {
          await client.from('ai_help_plans').update({ status: 'failed', summary: 'A IA demorou demais para responder. Tente de novo.' }).eq('id', row.id).eq('status', 'processing')
          throw new HttpError(504, 'A IA demorou demais para responder. Tente de novo.')
        }
        return json({ mode: 'processing', plan_id: row.id })
      }
      const currentAccess = await access(client, user.id, row.barbershop_id)
      const { count } = await client.from('ai_help_plans').select('id', { count: 'exact', head: true })
        .eq('requester_user_id', user.id).gte('created_at', new Date(Date.now() - 86_400_000).toISOString())
      const quota = { daily_limit: currentAccess.dailyLimit, remaining: Math.max(0, currentAccess.dailyLimit - (count || 0)) }
      if (row.status === 'answered') {
        const result = row.result && typeof row.result === 'object' && !Array.isArray(row.result) ? row.result as Record<string, unknown> : {}
        return json({ mode: 'answer', answer: String(result.answer || row.summary), quota })
      }
      if (row.status === 'pending' || row.status === 'completed') {
        return json({ plan_id: row.id, summary: row.summary, action: { type: row.action_type, label: actionLabel(row.action_type as ActionType), values: row.action_values },
          expires_at: row.expires_at, quota, ...(row.status === 'completed' ? { executed: true } : {}) })
      }
      throw new HttpError(422, row.summary || 'Não foi possível preparar a resposta.')
    }

    if (action === 'history') {
      const query = new URL(request.url).searchParams
      const shopId = query.has('barbershop_id') ? uuid(query.get('barbershop_id')) : null
      const currentAccess = await access(client, user.id, shopId)
      let requestQuery = client.from('ai_help_plans').select('id,barbershop_id,requester_user_id,prompt,summary,action_type,action_values,status,result,expires_at,executed_at,created_at')
        .eq('requester_user_id', user.id).order('created_at', { ascending: false }).limit(50)
      requestQuery = shopId ? requestQuery.eq('barbershop_id', shopId) : requestQuery.is('barbershop_id', null)
      const { data, error } = await requestQuery
      if (error) throw error
      return json({ items: (data || []).filter(row => visibleInCurrentAccess(row, currentAccess))
        .map(row => historyItem(row as PlanRow)) })
    }

    const input = await body<Input>(request)
    if (action === 'execute') {
      const planId = uuid(input.plan_id)
      const { data: plan, error: planError } = await client.from('ai_help_plans')
        .select('id,barbershop_id,action_type,status,expires_at')
        .eq('id', planId).eq('requester_user_id', user.id).maybeSingle()
      if (planError) throw planError
      if (!plan) throw new HttpError(404, 'Plano não encontrado.')
      const currentAccess = await access(client, user.id, plan.barbershop_id)
      if (!plan.action_type || !currentAccess.allowed.includes(plan.action_type as ActionType)) throw new HttpError(403, 'Seu perfil não permite esta ação.')
      if (!['pending','completed'].includes(plan.status)) throw new HttpError(409, 'Este plano não está pronto.')
      if (plan.status==='pending' && new Date(plan.expires_at).getTime() <= Date.now()) throw new HttpError(409, 'Este plano expirou. Peça outro à IA.')
      const { data, error } = await client.rpc('execute_ai_help_plan', { p_plan_id: planId, p_actor_id: user.id })
      if (error) throw mappedExecutionError(error)
      if (plan.action_type === 'create_product') {
        const created = data as { id?: unknown; result?: { id?: unknown } } | null
        const productId = typeof created?.result?.id === 'string' ? created.result.id : typeof created?.id === 'string' ? created.id : null
        if (productId) {
          try {
            const product = await loadProduct(client, productId)
            if (product && product.barbershop_id === plan.barbershop_id) await queueProductPhoto(client, product, optionalSetting('URL') || new URL(request.url).origin)
          } catch (photoError) { console.warn('ai-help product photo', photoError) }
        }
      }
      return json(data)
    }

    const shopId = input.barbershop_id == null ? null : uuid(input.barbershop_id)
    const prompt = text(input.prompt ?? (action==='prepare'?'Preparar ação operacional selecionada.':null), 'Pedido', 2000)
    if (prompt.length < 3) throw new HttpError(400, 'Descreva sua dúvida ou pedido com pelo menos 3 caracteres.')
    const initialAccess = await access(client, user.id, shopId)
    if(action==='prepare') {
      const {action:proposal,summary}=validateHelpAction(input.action,initialAccess.allowed)
      const values=await validateOperationalProposal(client,user.id,initialAccess,proposal.type,proposal.values)
      const {data:attempt,error:startError}=await client.rpc('start_ai_help_attempt',{p_actor_id:user.id,p_barbershop_id:shopId,p_prompt:prompt,
        p_daily_limit:initialAccess.dailyLimit,p_token_reservation:0,p_idempotency_key:input.idempotency_key==null?null:uuid(input.idempotency_key)})
      if(startError) throw new HttpError(startError.code==='P0001'?429:422,startError.message)
      if(attempt.reused) {
        if(attempt.status!=='pending') throw new HttpError(409,'Esse pedido já está em andamento ou foi concluído. Consulte o histórico.')
        const canonical=(record:Record<string,unknown>)=>JSON.stringify(Object.fromEntries(Object.entries(record).sort(([a],[b])=>a.localeCompare(b))))
        if(attempt.action_type!==proposal.type || canonical(attempt.action_values)!==canonical(values)) throw new HttpError(409,'Essa chave já foi usada para outra proposta. Prepare um novo pedido.')
        return json({plan_id:attempt.id,summary:attempt.summary,action:{...proposal,values:attempt.action_values},expires_at:attempt.expires_at})
      }
      const {data:plan,error:saveError}=await client.from('ai_help_plans').update({summary,action_type:proposal.type,action_values:values,status:'pending'})
        .eq('id',attempt.id).eq('requester_user_id',user.id).in('status',['processing','pending']).select('id,expires_at').single()
      if(saveError) throw saveError
      return json({plan_id:plan.id,summary,action:{...proposal,values},expires_at:plan.expires_at})
    }
    if (!optionalSetting('OPENAI_API_KEY')) throw new HttpError(503, 'Ative a IA na Netlify para usar a Ajuda de IA.')
    // Estimativa de tokens reservada até a função em segundo plano registrar o uso real.
    const reservation=60_000+new TextEncoder().encode(prompt).length*2
    const { data: attempt, error: attemptError } = await client.rpc('start_ai_help_attempt', {
      p_actor_id: user.id, p_barbershop_id: shopId, p_prompt: prompt, p_daily_limit: initialAccess.dailyLimit,
      p_token_reservation:reservation,p_idempotency_key:input.idempotency_key==null?null:uuid(input.idempotency_key),
    })
    if (attemptError) {
      if (attemptError.code === 'P0001') throw new HttpError(429, attemptError.message || 'Limite configurado da Ajuda de IA atingido.')
      throw attemptError
    }
    const attemptId = (attempt as PlanRow).id
    if(attempt.reused) {
      if(attempt.status==='answered') return json({mode:'answer',answer:attempt.result?.answer})
      if(attempt.status==='pending') return json({plan_id:attempt.id,summary:attempt.summary,action:{type:attempt.action_type,label:actionLabel(attempt.action_type),values:attempt.action_values},expires_at:attempt.expires_at})
      if(attempt.status==='processing') return json({mode:'processing',plan_id:attempt.id})
      throw new HttpError(409,'Esse pedido já está em andamento ou foi concluído. Consulte o histórico.')
    }
    try {
      const origin = optionalSetting('URL') || new URL(request.url).origin
      const response = await fetch(`${origin}/.netlify/functions/ai-help-background`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-ai-help-internal': await aiHelpInternalToken(attemptId) },
        body: JSON.stringify({ plan_id: attemptId }), signal: AbortSignal.timeout(8_000),
      })
      if (!response.ok) throw new Error(`background ${response.status}`)
    } catch (dispatchError) {
      console.error('ai-help dispatch', dispatchError)
      await client.from('ai_help_plans').update({ status: 'failed', summary: 'A IA não conseguiu começar agora. Tente de novo.' }).eq('id', attemptId).eq('status', 'processing')
      throw new HttpError(503, 'A IA não conseguiu começar agora. Tente de novo.')
    }
    return json({ mode: 'processing', plan_id: attemptId })
  } catch (error) { return failure(error) }
}

export const config: Config = { path: '/api/ai-help/:action', method: ['GET', 'POST'] }
