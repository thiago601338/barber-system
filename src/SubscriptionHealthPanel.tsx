import { useEffect, useState } from 'react'
import { Activity, ArrowUpRight, CircleDollarSign, MessageCircle, RefreshCw, ShieldCheck, TrendingDown } from 'lucide-react'
import { requireSupabase } from './lib/supabase'
import { whatsappUrl } from './lib/whatsapp'
import { asText, date, money, type Row } from './types'
import { DataTable, Field, Loading, Modal, Notice, Panel, Stat } from './ui'
import './styles-subscriptions.css'
import { currentMonth, monthDays, MonthPicker } from './MonthRangeFilter'

interface Health {
  days: number; from: string; to: string; observed_since: string | null; history_complete: boolean
  active_contracts: number; authorized_contracts: number; review_contracts: number
  mrr_cents: number; overdue_contracts: number; overdue_cents: number; received_cents: number
  churn_pct: number | null; opening_paid_contracts: number; cancelled_contracts: number
  contribution_margin_cents: number | null; contribution_margin_pct: number | null
  missing_financial_records: number; completed_visits: number; plans: Row[]; recovery: Row[]
}

export function SubscriptionHealthPanel({ shopId, timezone = 'America/Sao_Paulo', revision, onInspect, onVerify }: {
  shopId: string; timezone?: string; revision: number; onInspect: (row: Row) => void; onVerify: (row: Row) => Promise<void>
}) {
  const [days, setDays] = useState(30)
  const [month, setMonth] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [contact, setContact] = useState<Row | null>(null)
  const [message, setMessage] = useState('')
  const [checking, setChecking] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setHealth(null); setError(null); setLoading(true); setContact(null)
    const range = month ? monthDays(month, timezone) : null
    void (range ? requireSupabase().rpc('subscription_health_range', { p_barbershop_id: shopId, p_from: range.from, p_to: range.to }) : requireSupabase().rpc('subscription_health', { p_barbershop_id: shopId, p_days: days }))
      .then(({ data, error: failure }) => {
        if (cancelled) return
        if (failure) setError(failure.message)
        else setHealth(data as Health)
        setLoading(false)
      }, () => { if (!cancelled) { setError('Não foi possível carregar a saúde dos planos.'); setLoading(false) } })
    return () => { cancelled = true }
  }, [shopId, days, month, timezone, revision, refresh])
  function prepare(row: Row) {
    setContact(row)
    setMessage(`Olá, ${asText(row.client_name)}! Vamos conferir a renovação do seu plano ${asText(row.plan_name)}?${row.amount_cents == null ? '' : ` O valor contratado por ciclo é ${money(row.amount_cents)}.`} Se já pagou, podemos verificar a confirmação com você.`)
  }
  async function check(row: Row) {
    setChecking(row.id)
    try { await onVerify(row); setRefresh(value => value + 1) }
    finally { setChecking(null) }
  }
  const contactUrl = contact ? whatsappUrl(contact.phone, message) : null
  return <div className="subscription-health page-stack">
    <Panel title="Saúde dos planos" subtitle="Receita recorrente, retenção, consumo e recuperação com as condições contratadas."
      action={<div className="button-row"><select aria-label="Período da saúde dos planos" value={month ? 'month' : days} onChange={event => { if (event.target.value === 'month') setMonth(currentMonth(timezone)); else { setMonth(''); setDays(Number(event.target.value)) } }}><option value={7}>7 dias</option><option value={30}>30 dias</option><option value={90}>90 dias</option><option value="month">Mês a mês</option></select>{month && <MonthPicker value={month} onChange={setMonth} timezone={timezone}/>}<button className="button outline" onClick={() => setRefresh(value => value + 1)} disabled={loading}><RefreshCw size={16}/> Atualizar</button></div>}>
      <Notice text={error}/>{loading && <Loading text="Conferindo contratos e consumo..."/>}
      {health && <><div className="stats-grid three">
        <Stat label="Receita recorrente mensal" value={money(health.mrr_cents)} foot="Valor contratado ÷ meses de cada ciclo; não é caixa recebido" icon={<CircleDollarSign size={19}/>}/>
        <Stat label="Assinantes com ciclo ativo" value={health.active_contracts} foot={`${health.authorized_contracts} autorizados aguardando confirmação do ciclo`} icon={<ShieldCheck size={19}/>}/>
        <Stat label="Inadimplência" value={money(health.overdue_cents)} foot={`${health.overdue_contracts} contratos em atraso ou com ciclo vencido`} icon={<Activity size={19}/>}/>
        <Stat label="Churn do período" value={health.churn_pct == null ? 'Em formação' : `${health.churn_pct}%`} foot={health.history_complete ? `${health.cancelled_contracts} cancelados da base de ${health.opening_paid_contracts} contratos no início` : `Histórico confiável iniciado em ${date(health.observed_since)}`} icon={<TrendingDown size={19}/>}/>
        <Stat label="Recebido no período" value={money(health.received_cents)} foot="Somente pagamentos confirmados; estornos excluídos" icon={<CircleDollarSign size={19}/>}/>
        <Stat label="Margem de contribuição" value={health.contribution_margin_cents == null ? 'Dados pendentes' : money(health.contribution_margin_cents)} foot={health.contribution_margin_pct == null ? 'Exige custos, impostos, taxas e comissões verificadas' : `${health.contribution_margin_pct}% após custos, impostos, taxas e comissões`} icon={<ArrowUpRight size={19}/>}/>
      </div>
      <p className="panel-footnote">A margem considera recebimentos e visitas realizadas neste período. Custos fixos da estrutura entram na Margem de Lucro do negócio.</p>
      {health.review_contracts > 0 && <Notice kind="info" text={`${health.review_contracts} contratos antigos aguardam comprovação das condições originais e não entram no cálculo de receita recorrente.`}/>} 
      {health.missing_financial_records > 0 && <Notice kind="info" text={`${health.missing_financial_records} registros sem custo, taxa ou comissão comprovada. A margem permanece indisponível até completar esses dados.`}/>}</>}
    </Panel>
    {health && <><Panel title="Consumo por plano" subtitle="Visitas realizadas e reservadas no ciclo atual dos contratos elegíveis.">
      <DataTable rows={health.plans} empty="Nenhum plano cadastrado" columns={[
        { key: 'name', label: 'Plano' }, { key: 'active_contracts', label: 'Ciclos ativos' }, { key: 'mrr_cents', label: 'Receita mensal', render: row => money(row.mrr_cents) },
        { key: 'visits_used', label: 'Realizadas' }, { key: 'visits_reserved', label: 'Reservadas' }, { key: 'cycle_visits', label: 'Visitas contratadas' },
        { key: 'consumption_pct', label: 'Consumo', render: row => <div className="subscription-consumption"><span>{row.consumption_pct == null ? 'Sem ciclo ativo' : `${row.consumption_pct}%`}</span><progress max="100" value={Math.min(100, Number(row.consumption_pct ?? 0))} aria-label={`Consumo do plano ${asText(row.name)}`}/></div> },
      ]}/>
    </Panel><Panel title="Recuperação manual" subtitle="Prepare o contato e confira o provedor. O sistema não envia mensagens nem confirma pagamentos por você.">
      <DataTable rows={health.recovery} empty="Nenhum contrato precisa de recuperação" columns={[
        { key: 'client_name', label: 'Cliente' }, { key: 'plan_name', label: 'Plano' }, { key: 'due_at', label: 'Ciclo vencido', render: row => date(row.due_at) },
        { key: 'amount_cents', label: 'Valor contratado', render: row => row.amount_cents == null ? 'Revisar condições' : money(row.amount_cents) },
        { key: 'id', label: 'Ações', render: row => <div className="button-row"><button className="button outline" onClick={() => onInspect(row)}>Contrato</button><button className="button outline" disabled={checking !== null} onClick={() => void check(row)}>{checking === row.id ? 'Conferindo...' : 'Conferir Mercado Pago'}</button><button className="button primary" onClick={() => prepare(row)}><MessageCircle size={16}/> Preparar contato</button></div> },
      ]}/>
    </Panel></>}
    {contact && <Modal title="Preparar contato de renovação" subtitle="Revise a mensagem antes de abrir o WhatsApp. Nenhuma mensagem é enviada automaticamente." onClose={() => setContact(null)}>
      <Field label="Mensagem"><textarea rows={5} maxLength={2000} value={message} onChange={event => setMessage(event.target.value)}/></Field>
      {!contactUrl && <Notice kind="info" text="Cadastre um telefone válido no cliente para abrir o WhatsApp."/>}
      <div className="form-actions"><button className="button ghost" onClick={() => setContact(null)}>Fechar</button>{contactUrl && <a className="button primary" href={contactUrl} target="_blank" rel="noreferrer"><MessageCircle size={16}/> Abrir rascunho no WhatsApp</a>}</div>
    </Modal>}
  </div>
}
