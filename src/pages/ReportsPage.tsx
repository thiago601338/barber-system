import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ArrowDownToLine, CalendarDays, CreditCard, TrendingUp, UserPlus } from 'lucide-react'
import type { PageProps } from '../App'
import { requireSupabase } from '../lib/supabase'
import { shiftCalendarDay, shopDateTime, shopDayStartUtc, shopMonthEnd, shopMonthStart, shopToday, shopWeekStart } from '../lib/shopTime'
import { useRows } from '../lib/useRows'
import { asText, date, money, type Row } from '../types'
import { DataTable, Field, Loading, Notice, PageHeader, Panel, Stat } from '../ui'
import { FlowReport } from './FlowReport'
import '../styles-report.css'

interface Metrics { new_clients: number; first_time_clients: number; completed_appointments: number; barber_retention: { barber_membership_id: string; barber_name: string; first_time_clients: number; eligible_for_30d: number; no_return_30d: number }[] }
function csvCell(value: unknown) { return `"${String(value ?? '').replace(/"/g,'""')}"` }

export function ReportsPage({ identity, role }: PageProps) {
  const shopId = identity.shop?.id ?? null
  const timezone = identity.shop?.timezone || 'America/Sao_Paulo'
  const members = useRows('memberships', shopId)
  const clients = useRows('clients', shopId)
  const [section, setSection] = useState<'finance' | 'clients' | 'flow'>('finance')
  const [from, setFrom] = useState(() => shopMonthStart(timezone))
  const [to, setTo] = useState(() => shopToday(timezone))
  const [applied, setApplied] = useState(() => ({ from: shopMonthStart(timezone), to: shopToday(timezone) }))
  const [activeQuickRange, setActiveQuickRange] = useState<string | null>('Mês atual')
  const [barberId, setBarberId] = useState('')
  const [origin, setOrigin] = useState('all')
  const [payments, setPayments] = useState<Row[]>([])
  const [appointmentById, setAppointmentById] = useState<Record<string, Row>>({})
  const [paymentClientNames, setPaymentClientNames] = useState<Record<string, string>>({})
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const barbers = role === 'barber' ? [] : members.rows.filter(row => row.role === 'barber' && row.active)
  useEffect(() => {
    const currentFrom = shopMonthStart(timezone)
    const currentTo = shopToday(timezone)
    setFrom(currentFrom); setTo(currentTo); setApplied({ from: currentFrom, to: currentTo }); setActiveQuickRange('Mês atual'); setBarberId(''); setOrigin('all')
  }, [shopId, timezone])
  useEffect(() => {
    if (!shopId || section === 'flow') return
    let cancelled = false
    async function load() {
      setLoading(true); setError(null)
      const client = requireSupabase()
      try {
        const metricResult = await client.rpc('dashboard_metrics', { p_barbershop_id: shopId, p_from: applied.from, p_to: applied.to })
        if (metricResult.error) throw metricResult.error
        const all: Row[] = []
        const fromIso = shopDayStartUtc(applied.from, timezone)
        const endIso = shopDayStartUtc(shiftCalendarDay(applied.to, 1), timezone)
        for (let page = 0; page < 100; page++) {
          const result = await client.from('payments').select('*').eq('barbershop_id', shopId).eq('status','paid').gte('paid_at',fromIso).lt('paid_at',endIso).order('paid_at', { ascending: false }).order('id').range(page*1000,page*1000+999)
          if (result.error) throw result.error
          all.push(...(result.data ?? []) as Row[])
          if ((result.data ?? []).length < 1000) break
          if (page === 99) throw new Error('O período tem mais de 100 mil pagamentos. Escolha um intervalo menor para obter totais completos.')
        }
        const appointmentIds = [...new Set(all.map(row => String(row.appointment_id || '')).filter(Boolean))]
        const associated: Record<string,Row> = {}
        for (let index=0; index<appointmentIds.length; index+=100) {
          const result = await client.from('appointments').select('id,barber_membership_id,client_id,starts_at').eq('barbershop_id',shopId).in('id',appointmentIds.slice(index,index+100))
          if (result.error) throw result.error
          for (const row of result.data ?? []) associated[row.id] = row as Row
        }
        if (!cancelled) { setMetrics(metricResult.data as Metrics); setPayments(all); setAppointmentById(associated) }
      } catch (err) { if (!cancelled) { setPayments([]); setMetrics(null); setAppointmentById({}); setError(err instanceof Error ? err.message : 'Falha ao carregar relatório.') } }
      finally { if (!cancelled) setLoading(false) }
    }
    void load()
    return () => { cancelled = true }
  }, [shopId, applied.from, applied.to, timezone, section])
  const shown = useMemo(() => payments.filter(row => {
    if (origin === 'subscription' && !row.subscription_id) return false
    if (origin === 'sale' && !row.sale_id) return false
    if (origin === 'appointment' && !row.appointment_id) return false
    if (barberId && appointmentById[String(row.appointment_id)]?.barber_membership_id !== barberId) return false
    return true
  }), [payments, origin, barberId, appointmentById])
  const visiblePayments = useMemo(() => shown.slice(0, 500), [shown])
  const visibleClientIds = useMemo(() => [...new Set(visiblePayments.map(row => String(row.client_id || '')).filter(Boolean))].sort().join(','), [visiblePayments])
  useEffect(() => {
    if (!shopId || !visibleClientIds) { setPaymentClientNames({}); return }
    let cancelled = false
    async function loadNames() {
      const ids = visibleClientIds.split(',')
      const names: Record<string, string> = {}
      for (let index = 0; index < ids.length; index += 100) {
        const response = await requireSupabase().from('clients').select('id,full_name').eq('barbershop_id', shopId).in('id', ids.slice(index, index + 100))
        if (response.error) return
        for (const client of response.data || []) names[client.id] = client.full_name
      }
      if (!cancelled) setPaymentClientNames(names)
    }
    void loadNames()
    return () => { cancelled = true }
  }, [shopId, visibleClientIds])
  const clientNames = useMemo(() => new Map(clients.rows.map(client => [String(client.id), asText(client.full_name)])), [clients.rows])
  function clientLabel(row: Row) {
    const name = paymentClientNames[String(row.client_id)] || clientNames.get(String(row.client_id))
    return name || (row.client_id ? `Cliente #${String(row.client_id).slice(0, 8)}` : 'Não identificado')
  }
  const total = shown.reduce((sum,row) => sum + Number(row.amount_cents || 0),0)
  const appointmentPaid = shown.filter(row => row.appointment_id)
  const ticketPerAppointment = appointmentPaid.length ? appointmentPaid.reduce((sum,row) => sum + Number(row.amount_cents || 0),0) / new Set(appointmentPaid.map(row => String(row.appointment_id))).size : 0
  const paymentsWithClient = shown.filter(row => row.client_id)
  const distinctClients = new Set(paymentsWithClient.map(row => String(row.client_id))).size
  const ticketPerClient = distinctClients ? paymentsWithClient.reduce((sum, row) => sum + Number(row.amount_cents || 0), 0) / distinctClients : 0
  const subscriptionTotal = shown.filter(row => row.subscription_id).reduce((sum,row) => sum + Number(row.amount_cents || 0),0)
  const saleTotal = shown.filter(row => row.sale_id).reduce((sum,row) => sum + Number(row.amount_cents || 0),0)
  function apply(event: FormEvent) { event.preventDefault(); const span = (new Date(`${to}T12:00:00Z`).getTime()-new Date(`${from}T12:00:00Z`).getTime())/86400000; const limit = section === 'flow' ? 370 : 60; if (span < 0 || span > limit) { setError(`Selecione um período de até ${limit} dias, com data final após a inicial.`); return } setError(null); setApplied({ from,to }) }
  function quick(start: string,end: string,label: string) { setFrom(start); setTo(end); setApplied({ from:start,to:end }); setActiveQuickRange(label) }
  function switchSection(next: 'finance' | 'clients' | 'flow') {
    setSection(next); setError(null)
    if (next !== 'flow' && (new Date(`${applied.to}T12:00:00Z`).getTime() - new Date(`${applied.from}T12:00:00Z`).getTime()) / 86400000 > 60) {
      quick(shopMonthStart(timezone), shopToday(timezone), 'Mês atual')
    }
  }
  function exportCsv() { const lines = [['Data','Cliente','ID do cliente','Origem','Forma','Valor (R$)'].map(csvCell).join(';'),...shown.map(row => [shopDateTime(row.paid_at, timezone),clientLabel(row),asText(row.client_id),row.subscription_id ? 'Assinatura' : row.sale_id ? 'Comanda' : 'Agendamento',asText(row.method),(Number(row.amount_cents||0)/100).toFixed(2).replace('.',',')].map(csvCell).join(';'))]; const blob = new Blob(['\ufeff'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'}); const url = URL.createObjectURL(blob); const link=document.createElement('a'); link.href=url; link.download=`faturamento-${applied.from}-${applied.to}.csv`; link.click(); URL.revokeObjectURL(url) }
  const retention = metrics?.barber_retention ?? []
  const quickRanges = [
    { label: 'Mês atual', start: shopMonthStart(timezone), end: shopToday(timezone) },
    { label: 'Mês passado', start: shopMonthStart(timezone, -1), end: shopMonthEnd(timezone, -1) },
    { label: 'Últimos 30 dias', start: shiftCalendarDay(shopToday(timezone), -29), end: shopToday(timezone) },
    { label: 'Semana atual', start: shopWeekStart(timezone), end: shopToday(timezone) },
    { label: 'Semana passada', start: shopWeekStart(timezone, -1), end: shiftCalendarDay(shopWeekStart(timezone), -1) },
    ...(section === 'flow' ? [{ label: 'Últimos 12 meses', start: shopMonthStart(timezone, -11), end: shopToday(timezone) }] : []),
  ]
  return <div className="page-stack reports-page"><PageHeader eyebrow="RELATÓRIOS" title="Resultados da barbearia" description="Filtre os recebimentos e acompanhe novos clientes, frequência e retorno por profissional."/><div className="segmented report-section-tabs" aria-label="Área do relatório">
  <button type="button" className={section === 'finance' ? 'selected' : ''} aria-pressed={section === 'finance'} onClick={() => switchSection('finance')}>Faturamento e ticket</button>
  <button type="button" className={section === 'clients' ? 'selected' : ''} aria-pressed={section === 'clients'} onClick={() => switchSection('clients')}>Clientes e retorno</button>
  <button type="button" className={section === 'flow' ? 'selected' : ''} aria-pressed={section === 'flow'} onClick={() => switchSection('flow')}>Fluxo da barbearia</button>
</div>
<Panel
  className="report-filter-panel"
  title="Filtros do relatório"
  subtitle={section === 'finance' ? 'Explore os recebimentos por período, profissional e origem.' : section === 'clients' ? 'Escolha o período para analisar novos clientes, visitas e retorno.' : 'Veja quando acontecem os atendimentos concluídos e descubra os períodos de pico.'}
  action={<span className="report-filter-badge"><CalendarDays size={14}/> Até {section === 'flow' ? '370' : '60'} dias</span>}
>
  <div className="report-filter-label">Períodos rápidos</div>
  <div className="report-quick-ranges" role="group" aria-label="Períodos rápidos">
    {quickRanges.map(range => {
      const active = activeQuickRange === range.label && applied.from === range.start && applied.to === range.end && from === range.start && to === range.end
      return <button
        key={range.label}
        type="button"
        className={`report-quick-range${active ? ' active' : ''}`}
        aria-pressed={active}
        onClick={() => quick(range.start, range.end, range.label)}
      >{range.label}</button>
    })}
  </div>
  <form className="report-filter-form" onSubmit={apply}>
    <Field label="De"><input type="date" required value={from} onChange={e => { setFrom(e.target.value); setActiveQuickRange(null) }}/></Field>
    <Field label="Até"><input type="date" required value={to} onChange={e => { setTo(e.target.value); setActiveQuickRange(null) }}/></Field>
    {section !== 'clients' && role !== 'barber' && <Field label="Profissional"><select value={barberId} onChange={e => { setBarberId(e.target.value); if (e.target.value && section === 'finance') setOrigin('appointment') }}><option value="">Todos</option>{barbers.map(row => <option value={row.id} key={row.id}>{asText(row.display_name)}</option>)}</select></Field>}
    {section === 'finance' && <Field label="Origem"><select value={origin} onChange={e => setOrigin(e.target.value)}><option value="all">Todas</option><option value="subscription" disabled={Boolean(barberId)}>Assinatura</option><option value="sale" disabled={Boolean(barberId)}>Comanda</option><option value="appointment">Agendamento</option></select></Field>}
    <div className="report-filter-actions">
      <div className="report-filter-current"><CalendarDays size={18}/><span><small>Período em análise</small><strong>{date(applied.from)} a {date(applied.to)}</strong></span></div>
      <button className="button primary" type="submit">Aplicar período</button>
    </div>
  </form>
  {section === 'finance' && <p className="report-filter-footnote">Ao escolher um profissional, o relatório mostra os pagamentos dos agendamentos dele.</p>}
  {section === 'flow' && <p className="report-filter-footnote">O fluxo usa o horário agendado dos atendimentos concluídos, no fuso da barbearia.</p>}
</Panel><Notice text={error || clients.error || members.error}/>{section === 'flow' ? <FlowReport shopId={shopId} timezone={timezone} from={applied.from} to={applied.to} barberId={barberId}/> : loading ? <Loading text="Calculando relatório..."/> : section === 'finance' ? <><div className="stats-grid"><Stat label="Faturamento recebido" value={money(total)} foot="Somente pagamentos confirmados" icon={<TrendingUp size={19}/>}/><Stat label="Ticket por pagamento" value={money(shown.length ? total/shown.length : 0)} foot="Média por cobrança paga" icon={<CreditCard size={19}/>}/><Stat label="Ticket por atendimento" value={money(ticketPerAppointment)} foot="Pagamentos ligados a agendamentos" icon={<CalendarDays size={19}/>}/><Stat label="Ticket por cliente distinto" value={money(ticketPerClient)} foot="Receita de clientes identificados / clientes pagantes" icon={<UserPlus size={19}/>}/><Stat label="Assinaturas" value={money(subscriptionTotal)} foot="Recebimentos ligados a planos" icon={<CalendarDays size={19}/>}/><Stat label="Comandas" value={money(saleTotal)} foot="Recebimentos ligados a vendas" icon={<CreditCard size={19}/>} /></div><Panel title="Movimentações pagas" subtitle={shown.length > 500 ? `${shown.length} transações no filtro · 500 mais recentes na tela` : `${shown.length} transação(ões) no filtro`} action={shown.length > 0 && <button className="button outline" onClick={exportCsv}><ArrowDownToLine size={16}/> Baixar CSV</button>}><DataTable rows={visiblePayments} empty="Nenhum pagamento confirmado" columns={[{ key: 'paid_at', label: 'Recebido em', render: row => shopDateTime(row.paid_at, timezone) }, { key: 'client_id', label: 'Cliente', render: row => clientLabel(row) }, { key: 'id', label: 'Origem', render: row => row.subscription_id ? 'Assinatura' : row.sale_id ? 'Comanda' : row.appointment_id ? 'Agendamento' : 'Outro' }, { key: 'method', label: 'Forma', render: row => asText(row.method) }, { key: 'amount_cents', label: 'Valor', render: row => money(row.amount_cents) }]} /></Panel></> : <><div className="stats-grid"><Stat label="Novos cadastros" value={metrics?.new_clients ?? '—'} foot={`${date(applied.from)} a ${date(applied.to)}`} icon={<UserPlus size={19}/>}/><Stat label="Primeiras visitas" value={metrics?.first_time_clients ?? '—'} foot={`${date(applied.from)} a ${date(applied.to)}`} icon={<UserPlus size={19}/>}/><Stat label="Atendimentos concluídos" value={metrics?.completed_appointments ?? '—'} foot="No período selecionado" icon={<CalendarDays size={19}/>}/><Stat label="Sem retorno em 30 dias" value={retention.reduce((sum,item) => sum+Number(item.no_return_30d||0),0)} foot="Apenas clientes já elegíveis" icon={<UserPlus size={19}/>} /></div><Panel title="Retorno por profissional" subtitle="Clientes novos atendidos pela primeira vez no período"><DataTable rows={retention.map(item => ({ ...item, id: item.barber_membership_id }))} empty="Sem clientes novos atendidos" columns={[{ key: 'barber_name', label: 'Profissional' }, { key: 'first_time_clients', label: 'Novos atendidos' }, { key: 'eligible_for_30d', label: 'Elegíveis (30 dias)' }, { key: 'no_return_30d', label: 'Sem retorno' }]} /><p className="panel-footnote">O indicador sem retorno só considera clientes com 30 dias desde a primeira visita concluída.</p></Panel></>}</div>
}
