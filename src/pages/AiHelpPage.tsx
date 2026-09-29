import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { ArrowRight, BookOpen, Building2, Check, CheckCircle2, Clock3, Crown, History, Lightbulb, LoaderCircle, RotateCcw, Scissors, Send, ShieldCheck, Sparkles } from 'lucide-react'
import type { PageProps } from '../App'
import { authedApi, authedGet } from '../lib/supabase'
import { date, dateTime, money, type Shop } from '../types'
import { Notice, PageHeader } from '../ui'
import { AiPage } from './GrowthPage'

type Action = { type: string; label: string; values: Record<string, unknown> }
type Quota = { daily_limit: number; remaining: number }
type Plan = { plan_id: string; summary: string; action: Action; expires_at: string; quota?: Quota }
type Answer = { mode: 'answer'; answer: string; quota?: Quota }
type Execution = { status: 'completed'; result: Record<string, unknown> }
type Turn = { id: number; prompt: string; status: 'loading' | 'answer' | 'plan' | 'error'; answer?: string; plan?: Plan; execution?: Execution; error?: string }
type HistoryItem = { id: string; prompt: string; summary: string | null; action: Action | null; status: string; result: Record<string, unknown> | null; created_at: string; expires_at: string | null; executed_at: string | null }

const fieldNames: Record<string, string> = {
  name: 'Nome', slug: 'Endereço público', title: 'Título', description: 'Descrição', display_name: 'Nome exibido',
  category: 'Categoria', kind: 'Tipo', channel: 'Canal', sku: 'Código do produto', price_cents: 'Preço',
  cost_cents: 'Custo', amount_cents: 'Valor', target_cents: 'Valor da meta', target_value: 'Valor da meta',
  current_value: 'Valor atual', duration_minutes: 'Duração', stock_quantity: 'Quantidade em estoque',
  quantity: 'Quantidade', active: 'Ativo', metric: 'Indicador', starts_on: 'Início', ends_on: 'Prazo final',
  period_start: 'Início', period_end: 'Fim', due_on: 'Prazo', status: 'Status', notes: 'Observações',
  barbershop_id: 'Barbearia', barber_membership_id: 'Profissional', owner_user_id: 'Profissional',
}

function readableValue(key: string, value: unknown, shop: Shop | null, values: Record<string, unknown>): string {
  if (value === null || value === undefined || value === '') return 'Não informado'
  if (key === 'barbershop_id' && value === shop?.id) return shop.name
  if (key === 'metric') return ({ revenue: 'Receita', appointments: 'Agendamentos', new_clients: 'Clientes novos', client_return_pct: 'Retorno de clientes (%)', profit_pct: 'Lucro (%)' } as Record<string, string>)[String(value)] || String(value)
  if (key === 'channel') return value === 'organic' ? 'Orgânico' : value === 'paid' ? 'Pago' : String(value)
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não'
  if (typeof value === 'number' && key.endsWith('_cents')) return money(value)
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
  return <dl className="ai-help-fields">{fields.map(([key, value]) => <div key={key}><dt>{fieldNames[key] || key.replace(/_/g, ' ')}</dt><dd>{readableValue(key, value, shop, action.values)}</dd></div>)}</dl>
}

function capabilities(role: PageProps['role'], hasShop: boolean, permissions: Record<string, boolean>): string[] {
  if (role === 'master' && !hasShop) return ['Criar barbearia']
  if (role === 'master' || role === 'admin') return ['Cadastrar serviço', 'Cadastrar produto', 'Definir meta da barbearia', 'Criar tarefa de marketing']
  if (role === 'barber') return [permissions.goals && 'Criar meta pessoal', permissions.marketing && 'Criar tarefa de marketing'].filter((value): value is string => Boolean(value))
  return []
}

function examples(role: PageProps['role'], hasShop: boolean, permissions: Record<string, boolean>): { label: string; prompt: string }[] {
  if (role === 'master' && !hasShop) return [
    { label: 'Entender a plataforma', prompt: 'Quais indicadores devo acompanhar no painel master para gerir as barbearias?' },
    { label: 'Planejar', prompt: 'Como organizar a cobrança mensal por barbearia e por barbeiro?' },
    { label: 'Criar barbearia', prompt: 'Crie uma barbearia chamada Estúdio Vila, com endereço público estudio-vila.' },
  ]
  if (role === 'barber') return [
    { label: 'Minha rotina', prompt: 'Como posso organizar minha agenda para atender melhor sem atrasos?' },
    { label: 'Meus resultados', prompt: 'Como definir uma meta pessoal realista para este mês?' },
    ...(permissions.goals ? [{ label: 'Criar meta', prompt: 'Crie uma meta pessoal de 30 atendimentos até o fim do mês.' }] : []),
    ...(permissions.marketing ? [{ label: 'Criar tarefa', prompt: 'Crie uma tarefa de marketing orgânico para publicar 3 vídeos nesta semana.' }] : []),
  ]
  return [
    { label: 'Clientes', prompt: 'Como acompanhar se os clientes novos estão voltando para a barbearia?' },
    { label: 'Operação', prompt: 'O que devo considerar para reduzir horários ociosos na agenda?' },
    { label: 'Criar serviço', prompt: 'Cadastre um serviço de corte masculino por R$ 50, com duração de 40 minutos.' },
    { label: 'Criar produto', prompt: 'Cadastre uma pomada de cabelo por R$ 35, com 10 unidades em estoque.' },
  ]
}

function statusLabel(status: string): string {
  if (status === 'answered') return 'Respondido'
  if (status === 'completed') return 'Concluído'
  if (status === 'unsupported') return 'Sem ação'
  if (status === 'expired') return 'Expirado'
  if (status === 'failed') return 'Não concluído'
  return 'Aguardando confirmação'
}

export function AiHelpPage({ identity, role, notify }: PageProps) {
  const shop = identity.shop
  const shopId = shop?.id ?? null
  const [scope, setScope] = useState<'platform' | 'shop'>(shopId ? 'shop' : 'platform')
  const effectiveShopId = scope === 'shop' ? shopId : null
  const canShowAnalysis = Boolean(effectiveShopId)
  const [tab, setTab] = useState<'conversation' | 'analysis'>('conversation')
  const [prompt, setPrompt] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [quota, setQuota] = useState<Quota | null>(null)
  const [busy, setBusy] = useState<'request' | 'execute' | null>(null)
  const [executingTurnId, setExecutingTurnId] = useState<number | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [historyBusy, setHistoryBusy] = useState(true)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const historyRequestId = useRef(0)
  const nextTurnId = useRef(0)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [now, setNow] = useState(Date.now())
  const available = useMemo(() => capabilities(role, Boolean(effectiveShopId), identity.permissions), [role, effectiveShopId, identity.permissions])
  const suggested = useMemo(() => examples(role, Boolean(effectiveShopId), identity.permissions), [role, effectiveShopId, identity.permissions])
  const profileLabel = role === 'master' ? 'Master' : role === 'admin' ? 'Barbearia' : 'Barbeiro'
  const profileTitle = role === 'master' ? effectiveShopId ? `Seu assistente na ${shop?.name}` : 'Seu assistente da plataforma' : role === 'admin' ? 'Seu assistente da barbearia' : 'Seu assistente profissional'
  const profileDescription = role === 'master'
    ? effectiveShopId ? `Pergunte sobre a operação da ${shop?.name} ou peça um cadastro permitido para ela.` : 'Pergunte sobre a gestão da plataforma ou peça a criação de uma barbearia.'
    : role === 'admin' ? `Tire dúvidas sobre a operação da ${shop?.name || 'barbearia'} e peça cadastros para sua equipe.`
      : 'Tire dúvidas sobre sua rotina e crie metas ou tarefas quando tiver permissão.'
  const ProfileIcon = role === 'master' ? Crown : role === 'admin' ? Building2 : Scissors

  const loadHistory = useCallback(async () => {
    const requestId = ++historyRequestId.current
    setHistoryBusy(true); setHistoryError(null)
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
    if (!turns.some(turn => turn.plan && !turn.execution)) return
    const timer = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(timer)
  }, [turns])
  useEffect(() => { if (turns.length) bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }, [turns])

  function useSuggestion(value: string) { setPrompt(value); composerRef.current?.focus() }
  function changeScope(next: 'platform' | 'shop') {
    if (busy || scope === next) return
    ++historyRequestId.current
    setHistory([]); setTurns([]); setQuota(null); setPrompt(''); setTab('conversation'); setScope(next)
  }

  async function sendPrompt(event: FormEvent) {
    event.preventDefault()
    const text = prompt.trim()
    if (text.length < 3 || busy) return
    const id = ++nextTurnId.current
    setTurns(current => [...current, { id, prompt: text, status: 'loading' }])
    setPrompt(''); setBusy('request')
    try {
      const response = await authedApi<Plan | Answer>('/api/ai-help/plan', { ...(effectiveShopId ? { barbershop_id: effectiveShopId } : {}), prompt: text })
      if (response.quota) setQuota(response.quota)
      if ('mode' in response && response.mode === 'answer' && typeof response.answer === 'string') {
        setTurns(current => current.map(turn => turn.id === id ? { ...turn, status: 'answer', answer: response.answer } : turn))
      } else if ('plan_id' in response && response.plan_id && response.action?.values) {
        setTurns(current => current.map(turn => turn.id === id ? { ...turn, status: 'plan', plan: response } : turn))
        setNow(Date.now())
      } else throw new Error('A IA não conseguiu preparar uma resposta. Tente reformular seu pedido.')
      void loadHistory()
    } catch (problem) {
      const message = problem instanceof Error ? problem.message : 'Não foi possível responder agora.'
      setTurns(current => current.map(turn => turn.id === id ? { ...turn, status: 'error', error: message } : turn))
    } finally { setBusy(null) }
  }

  async function executePlan(turnId: number) {
    const turn = turns.find(item => item.id === turnId)
    if (!turn?.plan || turn.execution || busy || new Date(turn.plan.expires_at).getTime() <= now || !Object.keys(turn.plan.action.values).length) return
    setBusy('execute'); setExecutingTurnId(turnId)
    try {
      const response = await authedApi<Execution>('/api/ai-help/execute', { plan_id: turn.plan.plan_id })
      if (response.status !== 'completed') throw new Error('A ação não foi confirmada pelo servidor. Consulte o histórico antes de tentar novamente.')
      setTurns(current => current.map(item => item.id === turnId ? { ...item, execution: response, error: undefined } : item))
      notify('Ação criada e registrada no histórico.')
      void loadHistory()
    } catch (problem) {
      const message = problem instanceof Error ? problem.message : 'Não foi possível concluir a ação. Consulte o histórico antes de repetir.'
      setTurns(current => current.map(item => item.id === turnId ? { ...item, error: message } : item))
      void loadHistory()
    } finally { setBusy(null); setExecutingTurnId(null) }
  }

  function composerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault(); event.currentTarget.form?.requestSubmit()
    }
  }

  if (role === 'client') return null
  return <div className="page-stack ai-help-page">
    <PageHeader eyebrow="ASSISTENTE INTELIGENTE" title="Ajuda de IA" description="Converse sobre sua rotina, peça orientações ou prepare cadastros com revisão antes de salvar."/>
    {canShowAnalysis && <div className="ai-help-tabs" role="tablist" aria-label="Áreas da ajuda de IA"><button type="button" role="tab" aria-selected={tab === 'conversation'} className={tab === 'conversation' ? 'active' : ''} onClick={() => setTab('conversation')}><Sparkles size={16}/> Conversar com a IA</button><button type="button" role="tab" aria-selected={tab === 'analysis'} className={tab === 'analysis' ? 'active' : ''} onClick={() => setTab('analysis')}><Lightbulb size={16}/> Análise com dados</button></div>}
    {tab === 'analysis' && canShowAnalysis ? <div role="tabpanel" className="ai-help-legacy" aria-label="Análise com dados da barbearia"><AiPage identity={identity} role={role} notify={notify}/></div> : <div role="tabpanel" className="ai-help-content" aria-label="Conversa com a IA">
      {role === 'master' && shop && <div className="ai-help-scope" role="group" aria-label="Contexto da conversa"><span>Você está falando como master em</span><div><button type="button" disabled={busy !== null} className={scope === 'platform' ? 'active' : ''} aria-pressed={scope === 'platform'} onClick={() => changeScope('platform')}>Plataforma</button><button type="button" disabled={busy !== null} className={scope === 'shop' ? 'active' : ''} aria-pressed={scope === 'shop'} onClick={() => changeScope('shop')}>{shop.name}</button></div></div>}
      <div className="ai-help-workspace">
        <section className="panel ai-help-chat" aria-labelledby="ai-help-chat-title">
          <div className="ai-help-chat-head"><div className="ai-help-profile-icon"><ProfileIcon size={22}/></div><div><span className="ai-help-kicker">ACESSO {profileLabel.toUpperCase()}{effectiveShopId ? ` · ${shop?.name.toUpperCase()}` : ' · PLATAFORMA'}</span><h2 id="ai-help-chat-title">{profileTitle}</h2><p>{profileDescription}</p></div><span className="ai-help-online"><span/> Pronto para conversar</span></div>
          <div className="ai-help-thread" aria-live="polite">
            {turns.length === 0 && <div className="ai-help-welcome"><div className="ai-help-welcome-symbol"><Sparkles size={26}/></div><h3>O que você quer resolver hoje?</h3><p>Escreva do seu jeito. Posso explicar, sugerir caminhos e preparar os cadastros que seu perfil permite.</p><div className="ai-help-starters">{suggested.map(example => <button type="button" key={example.prompt} onClick={() => useSuggestion(example.prompt)}><strong>{example.label}</strong><span>{example.prompt}</span><ArrowRight size={17}/></button>)}</div></div>}
            {turns.map(turn => {
              const plan = turn.plan
              const expired = Boolean(plan && new Date(plan.expires_at).getTime() <= now)
              const canReview = Boolean(plan?.action.values && Object.keys(plan.action.values).length)
              return <div className="ai-help-turn" key={turn.id}><div className="ai-help-message user"><span>Você</span><p>{turn.prompt}</p></div><div className="ai-help-message assistant"><div className="ai-help-message-title"><span className="ai-help-message-icon"><Sparkles size={15}/></span><strong>Ajuda de IA</strong>{turn.status === 'answer' && <small>Orientação</small>}{turn.status === 'plan' && <small>Ação para revisar</small>}</div>
                {turn.status === 'loading' && <div className="ai-help-thinking"><LoaderCircle size={17} className="spin"/> Pensando na sua solicitação...</div>}
                {turn.status === 'answer' && <p className="ai-help-answer">{turn.answer}</p>}
                {turn.status === 'error' && <><Notice text={turn.error}/><button type="button" className="ai-help-retry" onClick={() => useSuggestion(turn.prompt)}>Editar e tentar novamente <ArrowRight size={14}/></button></>}
                {plan && <div className="ai-help-plan"><p className="ai-help-answer">{plan.summary}</p><div className="ai-help-plan-title"><ShieldCheck size={17}/><div><span>REVISÃO OBRIGATÓRIA</span><strong>{plan.action.label}</strong></div></div><ActionFields action={plan.action} shop={effectiveShopId ? shop : null}/><div className="ai-help-plan-footer"><span><Clock3 size={15}/>{expired ? 'Proposta expirada. Faça um novo pedido.' : `Disponível até ${dateTime(plan.expires_at)}`}</span>{turn.execution ? <div className="ai-help-done"><CheckCircle2 size={17}/><strong>Cadastro confirmado e salvo</strong></div> : <button type="button" className="button primary" onClick={() => void executePlan(turn.id)} disabled={busy !== null || expired || !canReview}>{busy === 'execute' && executingTurnId === turn.id ? <><LoaderCircle size={16} className="spin"/> Salvando...</> : <><Check size={16}/> Confirmar e salvar</>}</button>}</div>{turn.error && <Notice text={turn.error}/>}</div>}
              </div></div>
            })}
            <div ref={bottomRef}/>
          </div>
          <form className="ai-help-input" onSubmit={sendPrompt}><label htmlFor="ai-help-prompt">Escreva sua pergunta ou solicitação</label><div className="ai-help-input-box"><textarea id="ai-help-prompt" ref={composerRef} value={prompt} onChange={event => setPrompt(event.target.value)} onKeyDown={composerKeyDown} rows={2} maxLength={1500} minLength={3} placeholder={role === 'master' ? 'Ex.: Como organizar o crescimento das barbearias?' : role === 'admin' ? 'Ex.: Como melhorar o retorno dos clientes novos?' : 'Ex.: Como atingir minha meta de atendimentos?'} disabled={busy !== null}/><button type="submit" className="button primary" aria-label="Enviar mensagem" disabled={busy !== null || prompt.trim().length < 3}>{busy === 'request' ? <LoaderCircle size={19} className="spin"/> : <Send size={19}/>}</button></div><div className="ai-help-input-foot"><span>Enter envia · Shift + Enter pula linha</span>{quota && <span>{quota.remaining} de {quota.daily_limit} pedidos disponíveis nas próximas 24 horas</span>}</div></form>
        </section>
        <aside className="ai-help-aside" aria-label="Recursos do assistente"><section className="ai-help-context-card"><span className="ai-help-context-icon"><ProfileIcon size={19}/></span><small>PERFIL ATUAL</small><h3>{profileLabel}</h3><p>{role === 'master' ? 'Pode conversar sobre a plataforma. Na visão de uma barbearia, também pode pedir cadastros para ela.' : role === 'admin' ? 'Pode conversar sobre a gestão da sua barbearia e pedir os cadastros abaixo.' : 'Pode conversar sobre sua rotina. Cadastros dependem das permissões concedidas pela barbearia.'}</p></section><section className="panel ai-help-permissions"><div className="ai-help-aside-head"><BookOpen size={18}/><h3>O que posso criar</h3></div>{available.length ? <ul>{available.map(item => <li key={item}><Check size={15}/>{item}</li>)}</ul> : <p>Você pode conversar e pedir orientações. Para criar metas ou tarefas, solicite a permissão ao administrador.</p>}</section><section className="ai-help-trust"><ShieldCheck size={18}/><div><strong>Você decide antes de salvar</strong><p>Perguntas recebem respostas. Cadastros mostram todos os campos e só são feitos após sua confirmação. Esta área não realiza cobranças nem altera permissões.</p></div></section></aside>
      </div>
      <section className="panel ai-help-history" aria-labelledby="ai-help-history-title"><div className="ai-help-history-head"><div className="ai-help-section-head"><span className="ai-help-step"><History size={17}/></span><div><h2 id="ai-help-history-title">Histórico de conversas e ações</h2><p>{effectiveShopId ? `Seus pedidos na ${shop?.name}` : 'Seus pedidos na plataforma'}</p></div></div><button type="button" className="button outline" onClick={() => void loadHistory()} disabled={historyBusy}><RotateCcw size={15}/> Atualizar</button></div><Notice text={historyError}/>{historyBusy && !history.length ? <div className="ai-help-history-empty"><LoaderCircle size={19} className="spin"/> Carregando histórico...</div> : history.length ? <div className="ai-help-history-list">{history.map(item => <details key={item.id} className="ai-help-history-item"><summary><span className={`ai-help-status ${item.status}`}>{statusLabel(item.status)}</span><span className="ai-help-history-main"><strong>{item.action?.label || (item.status === 'answered' ? 'Resposta da IA' : 'Pedido à IA')}</strong><small>{item.prompt}</small></span><time dateTime={item.created_at}>{dateTime(item.created_at)}</time></summary><div className="ai-help-history-details">{item.status === 'answered' && typeof item.result?.answer === 'string' ? <p>{item.result.answer}</p> : item.summary && <p>{item.summary}</p>}{item.action && <ActionFields action={item.action} shop={effectiveShopId ? shop : null}/>}<div className="ai-help-history-meta"><span>Criado em {dateTime(item.created_at)}</span>{item.executed_at && <span>Confirmado em {dateTime(item.executed_at)}</span>}{item.result?.id != null && <span>Identificador: {String(item.result.id)}</span>}</div></div></details>)}</div> : <div className="ai-help-history-empty"><History size={24}/><strong>Seu histórico começa aqui</strong><span>As perguntas, respostas e ações aparecerão nesta lista.</span></div>}</section>
    </div>}
  </div>
}
