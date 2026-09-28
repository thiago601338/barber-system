import type { Config } from '@netlify/functions'
import OpenAI from 'openai'
import { body, db, failure, HttpError, json, optionalSetting, requireShopAdmin, text, userFromRequest, uuid } from './_shared/core'
import { instagramSnapshot } from './instagram'
import { canUseAiKind } from './_shared/aiAccess'

type RequestInput = { barbershop_id?: unknown; kind?: unknown; prompt?: unknown }
type FinancialData = {
  revenueCents: number
  paidTransactions: number
  ticketCents: number
  expensesCents: number
  structureCents: number
  estimatedProfitCents: number
  targetProfitPct: number | null
  targetRevenueCents: number | null
  procedures: number
  servicePrices: { name: string; priceCents: number; costCents: number; performed: number; suggestedFloorCents: number | null }[]
}

const money = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

async function financialSnapshot(client: ReturnType<typeof db>, shopId: string): Promise<FinancialData> {
  const today = new Date()
  const since = new Date(today.getTime() - 30 * 86_400_000)
  const sinceIso = since.toISOString()
  const sinceDate = sinceIso.slice(0, 10)
  const [shop, payments, expenses, services, procedures] = await Promise.all([
    client.from('barbershops').select('structure_monthly_cost_cents,target_profit_pct').eq('id', shopId).single(),
    client.from('payments').select('amount_cents').eq('barbershop_id', shopId).eq('status', 'paid').gte('paid_at', sinceIso).limit(10000),
    client.from('expenses').select('amount_cents').eq('barbershop_id', shopId).gte('occurred_on', sinceDate).limit(10000),
    client.from('services').select('id,name,price_cents,cost_cents').eq('barbershop_id', shopId).eq('active', true).limit(500),
    client.from('procedure_records').select('service_id').eq('barbershop_id', shopId).gte('performed_at', sinceIso).limit(10000),
  ])
  for (const result of [shop, payments, expenses, services, procedures]) if (result.error) throw result.error
  const paid = payments.data || []
  const revenueCents = paid.reduce((sum, row) => sum + Number(row.amount_cents || 0), 0)
  const expensesCents = (expenses.data || []).reduce((sum, row) => sum + Number(row.amount_cents || 0), 0)
  const structureCents = Number(shop.data?.structure_monthly_cost_cents || 0)
  const targetProfitPct = shop.data?.target_profit_pct == null ? null : Number(shop.data.target_profit_pct)
  const totalCost = expensesCents + structureCents
  const targetRevenueCents = targetProfitPct != null && targetProfitPct < 100 ? Math.ceil(totalCost / (1 - targetProfitPct / 100)) : null
  const counts = new Map<string, number>()
  for (const row of procedures.data || []) if (row.service_id) counts.set(row.service_id, (counts.get(row.service_id) || 0) + 1)
  const procedureCount = (procedures.data || []).length
  const overheadPerProcedure = procedureCount ? Math.ceil(totalCost / procedureCount) : null
  const prices = (services.data || []).map(row => {
    const cost = Number(row.cost_cents || 0)
    const suggestedFloorCents = overheadPerProcedure == null || targetProfitPct == null || targetProfitPct >= 100
      ? null : Math.ceil((cost + overheadPerProcedure) / (1 - targetProfitPct / 100))
    return { name: row.name, priceCents: Number(row.price_cents), costCents: cost, performed: counts.get(row.id) || 0, suggestedFloorCents }
  })
  return {
    revenueCents, paidTransactions: paid.length, ticketCents: paid.length ? Math.round(revenueCents / paid.length) : 0,
    expensesCents, structureCents, estimatedProfitCents: revenueCents - totalCost,
    targetProfitPct, targetRevenueCents, procedures: procedureCount, servicePrices: prices,
  }
}

function financialSummary(data: FinancialData): string {
  const lines = [
    'Análise dos últimos 30 dias, baseada nos lançamentos cadastrados:',
    `Recebimentos confirmados: ${money(data.revenueCents)} em ${data.paidTransactions} pagamentos.`,
    `Ticket médio por pagamento: ${money(data.ticketCents)}.`,
    `Despesas lançadas: ${money(data.expensesCents)}; custo mensal de estrutura informado: ${money(data.structureCents)}.`,
    `Resultado estimado: ${money(data.estimatedProfitCents)}.`,
  ]
  if (data.targetProfitPct != null && data.targetRevenueCents != null) {
    lines.push(`Para margem alvo de ${data.targetProfitPct}%, o faturamento estimado necessário é ${money(data.targetRevenueCents)} com os custos informados.`)
  } else lines.push('Cadastre a margem de lucro alvo para calcular o faturamento necessário.')
  if (!data.procedures) lines.push('Ainda não há procedimentos registrados nesse período; não é possível estimar preço por atendimento com segurança.')
  else {
    const candidates = data.servicePrices.filter(s => s.suggestedFloorCents != null).sort((a, b) => (b.performed || 0) - (a.performed || 0)).slice(0, 8)
    for (const s of candidates) lines.push(`${s.name}: preço ${money(s.priceCents)}; piso indicativo ${money(s.suggestedFloorCents!)} (${s.performed} atendimentos).`)
    lines.push('O piso distribui custos lançados igualmente pelos procedimentos do período; revise tempo, demanda e margem por serviço antes de alterar preços.')
  }
  return lines.join('\n')
}

async function marketingSummary(client: ReturnType<typeof db>, shopId: string): Promise<string> {
  const { data: connection, error } = await client.from('social_connections')
    .select('status').eq('barbershop_id', shopId).maybeSingle()
  if (error) throw error
  if (connection?.status !== 'connected') return 'Instagram não conectado. Dê orientações gerais e indique que métricas reais exigem uma conta profissional conectada.'
  const snapshot = await instagramSnapshot(client, shopId)
  const media = snapshot.recent_media
  const engagement = media.reduce((sum, item) => sum + Number(item.like_count || 0) + Number(item.comments_count || 0), 0)
  const ads = snapshot.ads_last_30_days || {}
  return [
    `Dados da conta profissional consultados em ${snapshot.analyzed_at}:`,
    `Seguidores: ${Number(snapshot.profile.followers_count || 0)}; total de publicações: ${Number(snapshot.profile.media_count || 0)}.`,
    `Amostra das ${media.length} publicações recentes: ${engagement} curtidas e comentários ao todo; média ${media.length ? Math.round(engagement / media.length) : 0} por publicação.`,
    'Anúncios nos últimos 30 dias: ' + (ads.error ? `indisponíveis (${String(ads.error)})` :
      Object.keys(ads).length ? `gasto ${ads.spend || '0'}; impressões ${ads.impressions || '0'}; alcance ${ads.reach || '0'}; cliques ${ads.clicks || '0'}; CTR ${ads.ctr || '0'}; CPC ${ads.cpc || '0'}.` : 'sem conta de anúncios conectada ou sem dados.'),
    'Esta amostra não mede vendas atribuídas ao Instagram; não infira ROI sem conversões verificadas.',
  ].join('\n')
}

export default async (request: Request) => {
  try {
    if (request.method !== 'POST') throw new HttpError(405, 'Método não permitido.')
    const input = await body<RequestInput>(request)
    const shopId = uuid(input.barbershop_id)
    const kind = input.kind === 'financial' ? 'financial' : input.kind === 'marketing' ? 'marketing' : input.kind === 'request' ? 'request' : null
    if (!kind) throw new HttpError(400, 'Tipo de análise inválido.')
    const prompt = typeof input.prompt === 'string' && input.prompt.trim() ? text(input.prompt, 'Solicitação', 2000) : ''
    const client = db()
    const user = await userFromRequest(request, client)
    if (kind === 'financial') await requireShopAdmin(client, user.id, shopId)
    else {
      const { data: member, error } = await client.from('memberships').select('role').eq('barbershop_id', shopId).eq('user_id', user.id).eq('active', true).maybeSingle()
      if (error || !member) throw new HttpError(403, 'Sem acesso à barbearia.')
      if (member.role === 'barber') {
        const { data: permissions, error: permissionError } = await client.from('module_permissions')
          .select('module,allowed').eq('barbershop_id', shopId).eq('user_id', user.id)
          .in('module', ['ai', 'marketing'])
        if (permissionError) throw permissionError
        if (!canUseAiKind(kind, (permissions || []).filter(item => item.allowed).map(item => item.module))) {
          throw new HttpError(403, kind === 'marketing'
            ? 'As abas de IA e Marketing precisam estar liberadas para esta análise.'
            : 'A aba de IA não foi liberada para este barbeiro.')
        }
      }
    }
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString()
    const { count, error: countError } = await client.from('ai_requests').select('id', { count: 'exact', head: true }).eq('requester_user_id', user.id).gte('created_at', dayAgo)
    if (countError) throw countError
    if ((count || 0) >= 20) throw new HttpError(429, 'Limite diário de análises atingido.')

    const data = kind === 'financial' ? await financialSnapshot(client, shopId) : null
    const marketing = kind === 'marketing' ? await marketingSummary(client, shopId) : ''
    const raw = data ? financialSummary(data) : kind === 'marketing' ? `${marketing}\nSolicitação: ${prompt || 'Analise o Instagram e recomende ações orgânicas e pagas.'}` : prompt
    if (!raw) throw new HttpError(400, 'Descreva sua solicitação para a IA.')
    if (kind !== 'financial' && !optionalSetting('OPENAI_API_KEY')) {
      throw new HttpError(503, 'Ative a IA na Netlify para usar análises de marketing e solicitações livres.')
    }
    const { data: row, error: insertError } = await client.from('ai_requests').insert({
      barbershop_id: shopId, requester_user_id: user.id,
      request_type: kind === 'financial' ? 'finance' : kind === 'request' ? 'general' : 'marketing',
      prompt: prompt || kind, status: 'pending',
    }).select('id').single()
    if (insertError) throw insertError

    let response = raw
    let source: 'ai' | 'calculation' = 'calculation'
    try {
      if (optionalSetting('OPENAI_API_KEY')) {
      try {
        const openai = new OpenAI()
        const result = await openai.chat.completions.create({
          model: 'gpt-5.4-mini',
          max_completion_tokens: 1000,
          messages: [
            { role: 'developer', content: 'Você é um consultor de gestão para barbearias. Responda em português do Brasil, de forma objetiva. Use apenas os dados fornecidos. Separe fatos de hipóteses. Não invente métricas de Instagram, custos ou resultados de campanhas. Preços calculados são indicativos. Não inclua dados pessoais.' },
            { role: 'user', content: kind === 'financial' ? `Analise este resumo financeiro e recomende até 5 ações específicas, incluindo alertas de dados insuficientes:\n${raw}\nSolicitação adicional: ${prompt || 'nenhuma'}` : `Tema: ${kind}. Dados e solicitação:\n${raw}` },
          ],
        })
        response = result.choices[0]?.message?.content?.trim() || raw
        source = 'ai'
      } catch (error) {
        console.error('AI gateway unavailable', error)
        if (kind !== 'financial') throw new HttpError(503, 'IA indisponível no momento. Tente novamente mais tarde.')
      }
      }

      const { error: updateError } = await client.from('ai_requests').update({ response, status: 'completed' }).eq('id', row.id)
      if (updateError) throw updateError
      return json({ id: row.id, response, source, data })
    } catch (error) {
      await client.from('ai_requests').update({ status: 'failed' }).eq('id', row.id)
      throw error
    }
  } catch (error) { return failure(error) }
}

export const config: Config = { path: '/api/ai/analyze', method: 'POST' }
