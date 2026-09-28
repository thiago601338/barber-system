import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ArrowRight, Check, CheckCircle2, Clock3, History, Lightbulb, LoaderCircle, RotateCcw, ShieldCheck, Sparkles } from 'lucide-react'
import type { PageProps } from '../App'
import { authedApi, authedGet } from '../lib/supabase'
import { date, dateTime, money, type Shop } from '../types'
import { Notice, PageHeader } from '../ui'
import { AiPage } from './GrowthPage'

type Action = { type: string; label: string; values: Record<string, unknown> }
type Plan = { plan_id: string; summary: string; action: Action; expires_at: string; quota?: { daily_limit: number; remaining: number } }
type Execution = { status: 'completed'; result: Record<string, unknown> }
type HistoryItem = {
  id: string
  prompt: string
  summary: string | null
  action: Action | null
  status: string
  result: Record<string, unknown> | null
  created_at: string
  expires_at: string | null
  executed_at: string | null
}

const fieldNames: Record<string, string> = {
  name: 'Nome', slug: 'Endereço público', title: 'Título', description: 'Descrição',
  display_name: 'Nome exibido', category: 'Categoria', kind: 'Tipo', channel: 'Canal', sku: 'Código do produto',
  price_cents: 'Preço', cost_cents: 'Custo', amount_cents: 'Valor', target_cents: 'Valor da meta',
  target_value: 'Valor da meta', current_value: 'Valor atual', duration_minutes: 'Duração',
  stock_quantity: 'Quantidade em estoque', quantity: 'Quantidade', active: 'Ativo',
  metric: 'Indicador', starts_on: 'Início', ends_on: 'Prazo final', period_start: 'Início', period_end: 'Fim', due_on: 'Prazo',
  status: 'Status', notes: 'Observações', barbershop_id: 'Barbearia', barber_membership_id: 'Profissional', owner_user_id: 'Profissional',
}

function readableValue(key: string, value: unknown, shop: Shop | null, values: Record<string, unknown>): string {
  if (value === null || value === undefined || value === '') return 'Não informado'
  if (key === 'barbershop_id' && value === shop?.id) return shop.name
  if (key === 'metric') return ({ revenue: 'Receita', appointments: 'Agendamentos', new_clients: 'Clientes novos', client_return_pct: 'Retorno de clientes (%)', profit_pct: 'Lucro (%)' } as Record<string, string>)[String(value)] || String(value)
  if (key === 'channel') return value === 'organic' ? 'Orgânico' : value === 'paid' ? 'Pago' : String(value)
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não'
  if (typeof value === 'number' && (key.endsWith('_cents') || key === 'amount_cents')) return money(value)
  if (key === 'target_value' && values.metric === 'revenue') return money(Number(value) * 100)
  if (key === 'duration_minutes' && typeof value === 'number') return `${value} min`
  if (/(_on|_date|period_start|period_end)$/.test(key) && typeof value === 'string') return date(value)
  if (Array.isArray(value)) return value.map(item => String(item)).join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function ActionFields({ action, shop }: { action: Action; shop: Shop | null }) {
  const fields = Object.entries(action.values || {})
  if (!fields.length) return <p className="ai-help-muted">A proposta não trouxe campos para revisar. Faça outro pedido antes de confirmar.</p>
  return <dl className="ai-help-fields">{fields.map(([key, value]) =>
    <div key={key}><dt>{fieldNames[key] || key.replace(/_/g, ' ')}</dt><dd>{readableValue(key, value, shop, action.values)}</dd></div>,
  )}</dl>
}

function capabilities(role: PageProps['role'], hasShop: boolean, permissions: Record<string, boolean>): string[] {
  if (role === 'master' && !hasShop) return ['Criar barbearia']
  if (role === 'master') return ['Cadastrar serviço', 'Cadastrar produto', 'Definir meta da barbearia', 'Criar tarefa de marketing']
  if (role === 'admin') return ['Cadastrar serviço', 'Cadastrar produto', 'Definir meta da barbearia', 'Criar tarefa de marketing']
  if (role === 'barber') return [permissions.goals && 'Criar meta pessoal', permissions.marketing && 'Criar tarefa de marketing'].filter((value): value is string => Boolean(value))
  return []
}

function examples(role: PageProps['role'], hasShop: boolean, permissions: Record<string, boolean>): string[] {
  if (role === 'master' && !hasShop) return ['Crie uma barbearia chamada Estúdio Vila, com endereço público estudio-vila.']
  if (role === 'barber') return [
    permissions.goals && 'Crie uma meta pessoal de 30 atendimentos até o fim do mês.',
    permissions.marketing && 'Crie uma tarefa de marketing orgânico para publicar 3 vídeos nesta semana.',
  ].filter((value): value is string => Boolean(value))
  return [
    'Cadastre um serviço de corte masculino por R$ 50, com duração de 40 minutos.',
    'Cadastre uma pomada de cabelo por R$ 35, com 10 unidades em estoque.',
    'Crie uma meta de faturamento da barbearia de R$ 25.000 para este mês.',
  ]
}

function statusLabel(status: string): string {
  if (status === 'completed') return 'Concluído'
  if (status === 'unsupported') return 'Fora do catálogo'
  if (status === 'expired') return 'Expirado'
  if (status === 'failed') return 'Não concluído'
  return 'Aguardando confirmação'
}

export function AiHelpPage({ identity, role, notify }: PageProps) {
  const shop = identity.shop
  const shopId = shop?.id ?? null
  const [scope, setScope] = useState<'platform' | 'shop'>(shopId ? 'shop' : 'platform')
  const effectiveShopId = scope === 'shop' ? shopId : null
  const [tab, setTab] = useState<'actions' | 'analysis'>('actions')
  const [prompt, setPrompt] = useState('')
  const [submittedPrompt, setSubmittedPrompt] = useState('')
  const [plan, setPlan] = useState<Plan | null>(null)
  const [execution, setExecution] = useState<Execution | null>(null)
  const [busy, setBusy] = useState<'plan' | 'execute' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [historyBusy, setHistoryBusy] = useState(true)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const historyRequestId = useRef(0)
  const [now, setNow] = useState(Date.now())
  const available = useMemo(() => capabilities(role, Boolean(effectiveShopId), identity.permissions), [role, effectiveShopId, identity.permissions])
  const suggested = useMemo(() => examples(role, Boolean(effectiveShopId), identity.permissions), [role, effectiveShopId, identity.permissions])
  const expired = Boolean(plan && new Date(plan.expires_at).getTime() <= now)
  const canReview = Boolean(plan?.action?.values && Object.keys(plan.action.values).length)

  const loadHistory = useCallback(async () => {
    const requestId = ++historyRequestId.current
    setHistoryBusy(true)
    setHistoryError(null)
    try {
      const query = effectiveShopId ? `?barbershop_id=${encodeURIComponent(effectiveShopId)}` : ''
      const response = await authedGet<{ items: HistoryItem[] }>(`/api/ai-help/history${query}`)
      if (requestId === historyRequestId.current) setHistory(Array.isArray(response.items) ? response.items : [])
    } catch (problem) {
      if (requestId === historyRequestId.current) setHistoryError(problem instanceof Error ? problem.message : 'Não foi possível carregar o histórico.')
    } finally { if (requestId === historyRequestId.current) setHistoryBusy(false) }
  }, [effectiveShopId])

  useEffect(() => { if (role !== 'client') void loadHistory() }, [loadHistory, role])
  useEffect(() => {
    if (!plan) return
    const timer = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(timer)
  }, [plan])

  async function requestPlan(event: FormEvent) {
    event.preventDefault()
    const text = prompt.trim()
    if (!text || !available.length) return
    setBusy('plan'); setError(null); setPlan(null); setExecution(null)
    try {
      const response = await authedApi<Plan>('/api/ai-help/plan', { ...(effectiveShopId ? { barbershop_id: effectiveShopId } : {}), prompt: text })
      if (!response.plan_id || !response.action || !response.action.values) throw new Error(response.summary || 'Este pedido não gerou uma ação disponível. Tente um dos exemplos abaixo.')
      setSubmittedPrompt(text)
      setPlan(response)
      setNow(Date.now())
      if (role === 'master' && response.action.type === 'create_shop' && effectiveShopId) {
        setHistory([])
        setScope('platform')
      } else void loadHistory()
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Não foi possível preparar a ação.') }
    finally { setBusy(null) }
  }

  async function executePlan() {
    if (!plan || busy || expired || !canReview) return
    setBusy('execute'); setError(null)
    try {
      const response = await authedApi<Execution>('/api/ai-help/execute', { plan_id: plan.plan_id })
      if (response.status !== 'completed') throw new Error('A ação ainda não foi confirmada pelo servidor. Consulte o histórico antes de tentar novamente.')
      setExecution(response)
      notify('Ação criada e registrada no histórico.')
      void loadHistory()
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Não foi possível concluir a ação. Consulte o histórico antes de repetir.')
      void loadHistory()
    } finally { setBusy(null) }
  }

  if (role === 'client') return null
  return <div className="page-stack ai-help-page">
    <PageHeader eyebrow="ASSISTENTE COM REVISÃO" title="Ajuda de IA" description="Descreva o que deseja cadastrar. Você vê a proposta completa antes de confirmar qualquer alteração."/>
    <div className="ai-help-tabs" role="tablist" aria-label="Áreas da ajuda de IA">
      <button type="button" role="tab" aria-selected={tab === 'actions'} className={tab === 'actions' ? 'active' : ''} onClick={() => setTab('actions')}><Sparkles size={16}/> Criar com ajuda</button>
      {shopId && <button type="button" role="tab" aria-selected={tab === 'analysis'} className={tab === 'analysis' ? 'active' : ''} onClick={() => setTab('analysis')}><Lightbulb size={16}/> Análises</button>}
    </div>
    {tab === 'analysis' && shopId ? <div role="tabpanel" className="ai-help-legacy" aria-label="Análises da IA"><AiPage identity={identity} role={role} notify={notify}/></div> : <div role="tabpanel" className="ai-help-content" aria-label="Criar com ajuda da IA">
      {role === 'master' && shop && <div className="ai-help-scope" role="group" aria-label="Onde a ação será criada"><span>Escopo da ação</span><div><button type="button" disabled={busy !== null} className={scope === 'shop' ? 'active' : ''} aria-pressed={scope === 'shop'} onClick={() => { ++historyRequestId.current; setHistory([]); setScope('shop'); setPrompt(''); setPlan(null); setExecution(null); setError(null) }}>{shop.name}</button><button type="button" disabled={busy !== null} className={scope === 'platform' ? 'active' : ''} aria-pressed={scope === 'platform'} onClick={() => { ++historyRequestId.current; setHistory([]); setScope('platform'); setPrompt(''); setPlan(null); setExecution(null); setError(null) }}>Plataforma · nova barbearia</button></div></div>}
      <div className="ai-help-intro"><div className="ai-help-intro-icon"><Sparkles size={24}/></div><div><span>{effectiveShopId ? shop?.name : 'Plataforma'}</span><h2>Do pedido à ação, com você no controle.</h2><p>A IA prepara um cadastro permitido para seu perfil. Confira os campos e confirme somente se estiverem corretos.</p></div><div className="ai-help-intro-count"><strong>{available.length}</strong><small>{available.length === 1 ? 'tipo de ação' : 'tipos de ação'}</small></div></div>
      <div className="ai-help-grid"><section className="panel ai-help-composer" aria-labelledby="ai-help-compose-title"><div className="ai-help-section-head"><span className="ai-help-step">01</span><div><h2 id="ai-help-compose-title">Descreva sua ação</h2><p>Use linguagem natural e inclua valores, prazos e nomes.</p></div></div>
        <div className="ai-help-capabilities"><strong>O que você pode pedir aqui</strong><ul>{available.map(item => <li key={item}><Check size={15}/>{item}</li>)}</ul>{!available.length && <p>Para criar metas ou tarefas, peça ao administrador que libere a aba correspondente em Configurações.</p>}</div>
        <form onSubmit={requestPlan}><label className="field"><span>Seu pedido</span><textarea value={prompt} onChange={event => { setPrompt(event.target.value); setPlan(null); setExecution(null); setError(null) }} rows={5} maxLength={1500} minLength={10} required placeholder="Ex.: Cadastre um serviço de corte por R$ 50 com duração de 40 minutos." disabled={busy !== null || !available.length}/></label><div className="ai-help-compose-foot"><small>{prompt.length}/1500 caracteres</small><button type="submit" className="button primary" disabled={busy !== null || prompt.trim().length < 10 || !available.length}>{busy === 'plan' ? <><LoaderCircle size={16} className="spin"/> Preparando...</> : <><Sparkles size={16}/> Preparar proposta <ArrowRight size={16}/></>}</button></div></form>
        {suggested.length > 0 && <div className="ai-help-examples"><span>Exemplos de pedidos</span>{suggested.map(example => <button type="button" key={example} onClick={() => { setPrompt(example); setPlan(null); setExecution(null); setError(null) }} disabled={busy !== null}>{example}<ArrowRight size={15}/></button>)}</div>}
      </section>
      <section className="panel ai-help-preview" aria-labelledby="ai-help-preview-title" aria-live="polite"><div className="ai-help-section-head"><span className="ai-help-step">02</span><div><h2 id="ai-help-preview-title">Revise antes de salvar</h2><p>Somente “Confirmar ação” grava o registro.</p></div></div><Notice text={error}/>
        {busy === 'plan' ? <div className="ai-help-empty"><LoaderCircle size={29} className="spin"/><h3>Montando a proposta</h3><p>Os campos aparecerão aqui para sua conferência.</p></div> : plan ? <div className="ai-help-plan"><div className="ai-help-plan-type"><span>PROPOSTA DE AÇÃO</span><strong>{plan.action.label}</strong></div><p className="ai-help-summary">{plan.summary}</p><div className="ai-help-request"><span>Seu pedido</span><p>{submittedPrompt}</p></div><ActionFields action={plan.action} shop={effectiveShopId ? shop : null}/><div className="ai-help-confirm"><div><Clock3 size={16}/><span>{expired ? 'Esta proposta expirou. Prepare outra.' : `Disponível até ${dateTime(plan.expires_at)}`}</span></div>{plan.quota && <small className="ai-help-quota">{plan.quota.remaining} de {plan.quota.daily_limit} pedidos restantes nas próximas 24 horas</small>}{execution ? <div className="ai-help-done"><CheckCircle2 size={19}/><strong>Ação concluída</strong><span>O registro foi criado e aparece no histórico.</span>{execution.result?.id != null && <small>Identificador: {String(execution.result.id)}</small>}</div> : <button className="button primary" type="button" onClick={() => void executePlan()} disabled={busy !== null || expired || !canReview}>{busy === 'execute' ? <><LoaderCircle size={16} className="spin"/> Salvando...</> : <><ShieldCheck size={17}/> Confirmar ação</>}</button>}</div></div> : <div className="ai-help-empty"><div className="ai-help-empty-orbit"><ShieldCheck size={29}/></div><h3>Sua proposta aparecerá aqui</h3><p>Prepare um pedido para ver exatamente o que será criado. Nada será salvo sem sua confirmação.</p></div>}
      </section></div>
      <section className="panel ai-help-history" aria-labelledby="ai-help-history-title"><div className="ai-help-history-head"><div className="ai-help-section-head"><span className="ai-help-step"><History size={17}/></span><div><h2 id="ai-help-history-title">Histórico de ações</h2><p>{effectiveShopId ? `Registros da ${shop?.name}` : 'Registros da plataforma'}</p></div></div><button type="button" className="button outline" onClick={() => void loadHistory()} disabled={historyBusy}><RotateCcw size={15}/> Atualizar</button></div><Notice text={historyError}/>{historyBusy && !history.length ? <div className="ai-help-history-empty"><LoaderCircle size={19} className="spin"/> Carregando histórico...</div> : history.length ? <div className="ai-help-history-list">{history.map(item => <details key={item.id} className="ai-help-history-item"><summary><span className={`ai-help-status ${item.status}`}>{statusLabel(item.status)}</span><span className="ai-help-history-main"><strong>{item.action?.label || item.summary || 'Pedido à IA'}</strong><small>{item.prompt}</small></span><time dateTime={item.created_at}>{dateTime(item.created_at)}</time></summary><div className="ai-help-history-details">{item.summary && <p>{item.summary}</p>}{item.action && <ActionFields action={item.action} shop={effectiveShopId ? shop : null}/>}<div className="ai-help-history-meta"><span>Criado em {dateTime(item.created_at)}</span>{item.executed_at && <span>Confirmado em {dateTime(item.executed_at)}</span>}{item.result?.id != null && <span>Identificador: {String(item.result.id)}</span>}</div></div></details>)}</div> : <div className="ai-help-history-empty"><History size={24}/><strong>Nenhuma ação por aqui ainda</strong><span>Seus pedidos e os resultados confirmados aparecerão nesta lista.</span></div>}</section>
      <p className="ai-help-safety"><ShieldCheck size={15}/> Esta área não realiza cobranças, altera permissões, exclui dados nem envia mensagens a clientes.</p>
    </div>}
  </div>
}
