import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ArrowDownToLine, CalendarDays, CreditCard, TrendingUp, UserPlus } from 'lucide-react'
import type { PageProps } from '../App'
import { requireSupabase } from '../lib/supabase'
import { useRows } from '../lib/useRows'
import { asText, date, dateTime, money, type Row } from '../types'
import { DataTable, Field, Loading, Notice, PageHeader, Panel, Stat } from '../ui'

interface Metrics { new_clients: number; first_time_clients: number; completed_appointments: number; barber_retention: { barber_membership_id: string; barber_name: string; first_time_clients: number; eligible_for_30d: number; no_return_30d: number }[] }
function localDate(offset = 0) { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
function monthStart(offset = 0) { const d = new Date(); d.setMonth(d.getMonth()+offset,1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01` }
function monthEnd(offset = 0) { const d = new Date(); d.setMonth(d.getMonth()+offset+1,0); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
function weekStart(offset = 0) { const d = new Date(); d.setDate(d.getDate()-((d.getDay()+6)%7)+offset*7); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
function csvCell(value: unknown) { return `"${String(value ?? '').replace(/"/g,'""')}"` }

export function ReportsPage({ identity }: PageProps) {
  const shopId = identity.shop?.id ?? null
  const members = useRows('memberships', shopId)
  const clients = useRows('clients', shopId)
  const [section, setSection] = useState<'finance' | 'clients'>('finance')
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(localDate())
  const [applied, setApplied] = useState({ from: monthStart(), to: localDate() })
  const [barberId, setBarberId] = useState('')
  const [origin, setOrigin] = useState('all')
  const [payments, setPayments] = useState<Row[]>([])
  const [appointmentById, setAppointmentById] = useState<Record<string, Row>>({})
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const barbers = members.rows.filter(row => row.role === 'barber' && row.active)
  useEffect(() => {
    if (!shopId) return
    let cancelled = false
    async function load() {
      setLoading(true); setError(null)
      const client = requireSupabase()
      try {
        const metricResult = await client.rpc('dashboard_metrics', { p_barbershop_id: shopId, p_from: applied.from, p_to: applied.to })
        if (metricResult.error) throw metricResult.error
        const all: Row[] = []
        const fromIso = new Date(`${applied.from}T00:00:00`).toISOString()
        const end = new Date(`${applied.to}T12:00:00`); end.setDate(end.getDate()+1); end.setHours(0,0,0,0)
        for (let page = 0; page < 100; page++) {
          const result = await client.from('payments').select('*').eq('barbershop_id', shopId).eq('status','paid').gte('paid_at',fromIso).lt('paid_at',end.toISOString()).order('paid_at').range(page*1000,page*1000+999)
          if (result.error) throw result.error
          all.push(...(result.data ?? []) as Row[])
          if ((result.data ?? []).length < 1000) break
        }
        const appointmentIds = [...new Set(all.map(row => String(row.appointment_id || '')).filter(Boolean))]
        const associated: Record<string,Row> = {}
        for (let index=0; index<appointmentIds.length; index+=100) {
          const result = await client.from('appointments').select('id,barber_membership_id,client_id,starts_at').eq('barbershop_id',shopId).in('id',appointmentIds.slice(index,index+100))
          if (result.error) throw result.error
          for (const row of result.data ?? []) associated[row.id] = row as Row
        }
        if (!cancelled) { setMetrics(metricResult.data as Metrics); setPayments(all); setAppointmentById(associated) }
      } catch (err) { if (!cancelled) setError(err instanceof Error ? err.message : 'Falha ao carregar relatório.') }
      finally { if (!cancelled) setLoading(false) }
    }
    void load()
    return () => { cancelled = true }
  }, [shopId, applied.from, applied.to])
  const shown = useMemo(() => payments.filter(row => {
    if (origin === 'subscription' && !row.subscription_id) return false
    if (origin === 'sale' && !row.sale_id) return false
    if (origin === 'appointment' && !row.appointment_id) return false
    if (barberId && appointmentById[String(row.appointment_id)]?.barber_membership_id !== barberId) return false
    return true
  }), [payments, origin, barberId, appointmentById])
  const total = shown.reduce((sum,row) => sum + Number(row.amount_cents || 0),0)
  const appointmentPaid = shown.filter(row => row.appointment_id)
  const ticketPerAppointment = appointmentPaid.length ? appointmentPaid.reduce((sum,row) => sum + Number(row.amount_cents || 0),0) / new Set(appointmentPaid.map(row => String(row.appointment_id))).size : 0
  const ticketPerClient = shown.length ? total / new Set(shown.map(row => String(row.client_id))).size : 0
  const subscriptionTotal = shown.filter(row => row.subscription_id).reduce((sum,row) => sum + Number(row.amount_cents || 0),0)
  const saleTotal = shown.filter(row => row.sale_id).reduce((sum,row) => sum + Number(row.amount_cents || 0),0)
  function apply(event: FormEvent) { event.preventDefault(); const span = (new Date(`${to}T12:00:00`).getTime()-new Date(`${from}T12:00:00`).getTime())/86400000; if (span < 0 || span > 60) { setError('Selecione um período de até 60 dias, com data final após a inicial.'); return } setApplied({ from,to }) }
  function quick(start: string,end: string) { setFrom(start); setTo(end); setApplied({ from:start,to:end }) }
  function exportCsv() { const lines = [['Data','Cliente','Origem','Forma','Valor (R$)'].map(csvCell).join(';'),...shown.map(row => [dateTime(row.paid_at),asText(clients.rows.find(c => c.id === row.client_id)?.full_name),row.subscription_id ? 'Assinatura' : row.sale_id ? 'Comanda' : 'Agendamento',asText(row.method),(Number(row.amount_cents||0)/100).toFixed(2).replace('.',',')].map(csvCell).join(';'))]; const blob = new Blob(['\ufeff'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'}); const url = URL.createObjectURL(blob); const link=document.createElement('a'); link.href=url; link.download=`faturamento-${applied.from}-${applied.to}.csv`; link.click(); URL.revokeObjectURL(url) }
  const retention = metrics?.barber_retention ?? []
  return <div className="page-stack"><PageHeader eyebrow="RELATÓRIOS" title="Resultados da barbearia" description="Filtre os recebimentos e acompanhe novos clientes, frequência e retorno por profissional."/><div className="segmented"><button className={section === 'finance' ? 'selected' : ''} onClick={() => setSection('finance')}>Faturamento e ticket</button><button className={section === 'clients' ? 'selected' : ''} onClick={() => setSection('clients')}>Clientes e retorno</button></div><Panel title="Filtros" subtitle="Período máximo de 60 dias"><div className="quick-ranges"><button onClick={() => quick(monthStart(),localDate())}>Mês atual</button><button onClick={() => quick(monthStart(-1),monthEnd(-1))}>Mês passado</button><button onClick={() => quick(localDate(-29),localDate())}>Últimos 30 dias</button><button onClick={() => quick(weekStart(),localDate())}>Semana atual</button><button onClick={() => quick(weekStart(-1),localDate(-((new Date().getDay()+6)%7)-1))}>Semana passada</button></div><form className="filter-grid" onSubmit={apply}><Field label="De"><input type="date" required value={from} onChange={e => setFrom(e.target.value)}/></Field><Field label="Até"><input type="date" required value={to} onChange={e => setTo(e.target.value)}/></Field><Field label="Profissional"><select value={barberId} onChange={e => setBarberId(e.target.value)}><option value="">Todos</option>{barbers.map(row => <option value={row.id} key={row.id}>{asText(row.display_name)}</option>)}</select></Field><Field label="Origem"><select value={origin} onChange={e => setOrigin(e.target.value)}><option value="all">Todas</option><option value="subscription">Assinatura</option><option value="sale">Comanda</option><option value="appointment">Agendamento</option></select></Field><button className="button primary" type="submit">Aplicar período</button></form><p className="panel-footnote">O filtro de profissional considera apenas cobranças ligadas a agendamentos desse barbeiro.</p></Panel><Notice text={error || clients.error || members.error}/>{loading ? <Loading text="Calculando relatório..."/> : section === 'finance' ? <><div className="stats-grid"><Stat label="Faturamento recebido" value={money(total)} foot="Somente pagamentos confirmados" icon={<TrendingUp size={19}/>}/><Stat label="Ticket por pagamento" value={money(shown.length ? total/shown.length : 0)} foot="Média por cobrança paga" icon={<CreditCard size={19}/>}/><Stat label="Ticket por atendimento" value={money(ticketPerAppointment)} foot="Pagamentos ligados a agendamentos" icon={<CalendarDays size={19}/>}/><Stat label="Ticket por cliente distinto" value={money(ticketPerClient)} foot="Receita / clientes pagantes" icon={<UserPlus size={19}/>}/><Stat label="Assinaturas" value={money(subscriptionTotal)} foot="Recebimentos ligados a planos" icon={<CalendarDays size={19}/>}/><Stat label="Comandas" value={money(saleTotal)} foot="Recebimentos ligados a vendas" icon={<CreditCard size={19}/>} /></div><Panel title="Movimentações pagas" subtitle={`${shown.length} transação(ões) no filtro`} action={shown.length > 0 && <button className="button outline" onClick={exportCsv}><ArrowDownToLine size={16}/> Baixar CSV</button>}><DataTable rows={shown} empty="Nenhum pagamento confirmado" columns={[{ key: 'paid_at', label: 'Recebido em', render: row => dateTime(row.paid_at) }, { key: 'client_id', label: 'Cliente', render: row => asText(clients.rows.find(c => c.id === row.client_id)?.full_name) }, { key: 'id', label: 'Origem', render: row => row.subscription_id ? 'Assinatura' : row.sale_id ? 'Comanda' : row.appointment_id ? 'Agendamento' : 'Outro' }, { key: 'method', label: 'Forma', render: row => asText(row.method) }, { key: 'amount_cents', label: 'Valor', render: row => money(row.amount_cents) }]} /></Panel></> : <><div className="stats-grid"><Stat label="Novos cadastros" value={metrics?.new_clients ?? '—'} foot={`${date(applied.from)} a ${date(applied.to)}`} icon={<UserPlus size={19}/>}/><Stat label="Primeiras visitas" value={metrics?.first_time_clients ?? '—'} foot={`${date(applied.from)} a ${date(applied.to)}`} icon={<UserPlus size={19}/>}/><Stat label="Atendimentos concluídos" value={metrics?.completed_appointments ?? '—'} foot="No período selecionado" icon={<CalendarDays size={19}/>}/><Stat label="Sem retorno em 30 dias" value={retention.reduce((sum,item) => sum+Number(item.no_return_30d||0),0)} foot="Apenas clientes já elegíveis" icon={<UserPlus size={19}/>} /></div><Panel title="Retorno por profissional" subtitle="Clientes novos atendidos pela primeira vez no período"><DataTable rows={retention.map(item => ({ ...item, id: item.barber_membership_id }))} empty="Sem clientes novos atendidos" columns={[{ key: 'barber_name', label: 'Profissional' }, { key: 'first_time_clients', label: 'Novos atendidos' }, { key: 'eligible_for_30d', label: 'Elegíveis (30 dias)' }, { key: 'no_return_30d', label: 'Sem retorno' }]} /><p className="panel-footnote">O indicador sem retorno só considera clientes com 30 dias desde a primeira visita concluída.</p></Panel></>}</div>
}
