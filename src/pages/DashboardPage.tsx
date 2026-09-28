import { useEffect, useState } from 'react'
import { Activity, CalendarDays, CreditCard, TrendingUp, UserPlus, Users } from 'lucide-react'
import type { PageProps } from '../App'
import { requireSupabase } from '../lib/supabase'
import { dateTime, money, type Row } from '../types'
import { DataTable, Empty, Loading, Notice, PageHeader, Panel, Stat } from '../ui'

interface Retention { barber_membership_id: string; barber_name: string; first_time_clients: number; eligible_for_30d: number; no_return_30d: number }
interface Metrics { revenue_cents: number; paid_transactions: number; ticket_average_cents: number; completed_appointments: number; new_clients: number; first_time_clients: number; barber_retention: Retention[] }
interface DayRevenue { label: string; value: number }
function dayString(daysOffset = 0) { const d = new Date(); d.setDate(d.getDate() + daysOffset); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
function mondayString() { const d = new Date(); d.setDate(d.getDate() - ((d.getDay()+6)%7)); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }

export function DashboardPage({ identity, role }: PageProps) {
  const shopId = identity.shop?.id
  const [month, setMonth] = useState<Metrics | null>(null)
  const [week, setWeek] = useState<Metrics | null>(null)
  const [cohort, setCohort] = useState<Metrics | null>(null)
  const [days, setDays] = useState<DayRevenue[]>([])
  const [upcoming, setUpcoming] = useState<Row[]>([])
  const [busy, setBusy] = useState(true)
  const [reportError, setReportError] = useState<string | null>(null)
  const [agendaError, setAgendaError] = useState<string | null>(null)
  const canReport = role !== 'barber' || identity.permissions.reports === true
  useEffect(() => {
    if (!shopId) return
    let cancelled = false
    async function load() {
      setBusy(true); setReportError(null); setAgendaError(null)
      const client = requireSupabase()
      const appointmentResult = await client.from('appointments').select('*').eq('barbershop_id', shopId).gte('starts_at', new Date().toISOString()).order('starts_at').limit(8)
      if (cancelled) return
      if (appointmentResult.error) setAgendaError(appointmentResult.error.message)
      else setUpcoming((appointmentResult.data ?? []) as Row[])
      if (canReport) {
        const today = dayString()
        const dailyDates = Array.from({ length: 7 }, (_, index) => dayString(index-6))
        const [monthResult, weekResult, cohortResult, ...dailyResults] = await Promise.all([
          client.rpc('dashboard_metrics', { p_barbershop_id: shopId, p_from: `${today.slice(0,7)}-01`, p_to: today }),
          client.rpc('dashboard_metrics', { p_barbershop_id: shopId, p_from: mondayString(), p_to: today }),
          client.rpc('dashboard_metrics', { p_barbershop_id: shopId, p_from: dayString(-60), p_to: dayString(-31) }),
          ...dailyDates.map(day => client.rpc('dashboard_metrics', { p_barbershop_id: shopId, p_from: day, p_to: day })),
        ])
        if (cancelled) return
        const error = [monthResult.error, weekResult.error, cohortResult.error, ...dailyResults.map(result => result.error)].find(Boolean)
        if (error) setReportError(error.message)
        else {
          setMonth(monthResult.data as Metrics)
          setWeek(weekResult.data as Metrics)
          setCohort(cohortResult.data as Metrics)
          setDays(dailyDates.map((day, index) => ({ label: new Intl.DateTimeFormat('pt-BR', { weekday: 'short' }).format(new Date(`${day}T12:00:00`)).replace('.', ''), value: Number((dailyResults[index].data as Metrics)?.revenue_cents ?? 0) })))
        }
      }
      setBusy(false)
    }
    void load()
    return () => { cancelled = true }
  }, [shopId, canReport])
  if (busy) return <><PageHeader eyebrow="VISÃO GERAL" title="Seu negócio em números" description="Carregando indicadores do banco de dados."/><Loading/></>
  const retention = cohort?.barber_retention ?? []
  const noReturn = retention.reduce((sum, item) => sum + Number(item.no_return_30d || 0),0)
  return <div className="page-stack"><PageHeader eyebrow="VISÃO GERAL" title="Sua operação em perspectiva" description={`Acompanhe os resultados da ${identity.shop?.name} com dados registrados no sistema.`}/><div className="dashboard-hero"><span>BARBER SYSTEM · VISÃO GERAL</span><h2>Bem-vindo, {identity.membership?.display_name?.split(' ')[0] || 'equipe'}.</h2><p>Agenda, receita e retorno de clientes em um painel para decisões mais claras.</p></div><Notice text={reportError || agendaError}/>{canReport && month && week && <><div className="stats-grid"><Stat label="Receita recebida no mês" value={money(month.revenue_cents)} foot={`${month.paid_transactions} pagamentos confirmados`} icon={<TrendingUp size={19}/>}/><Stat label="Ticket médio recebido" value={money(month.ticket_average_cents)} foot="Por transação paga" icon={<CreditCard size={19}/>}/><Stat label="Primeiras visitas na semana" value={week.first_time_clients} foot={`${week.new_clients} clientes cadastrados`} icon={<UserPlus size={19}/>}/><Stat label="Atendimentos concluídos" value={month.completed_appointments} foot="Neste mês" icon={<CalendarDays size={19}/>} /></div><div className="dashboard-grid"><Panel title="Recebimentos dos últimos 7 dias" subtitle="Valores confirmados, calculados no banco" className="chart-panel"><div className="bar-chart">{days.map((day,index) => { const max = Math.max(...days.map(item => item.value),1); return <div className="chart-col" key={index}><div className="chart-value">{day.value ? money(day.value) : ''}</div><div className="chart-bar-wrap"><div className="chart-bar" style={{ height: `${Math.max(7,day.value/max*100)}%` }}/></div><span>{day.label}</span></div> })}</div></Panel><Panel title="Clientes novos sem retorno" subtitle="Por barbeiro, após uma janela de 30 dias"><div className="return-list">{retention.length ? retention.map(item => <div className="return-row" key={item.barber_membership_id}><div className="member-avatar">{item.barber_name.charAt(0)}</div><div><strong>{item.barber_name}</strong><small>{item.first_time_clients} cliente(s) novo(s) na coorte</small></div><div className={`return-count ${item.no_return_30d ? 'zero' : ''}`}><strong>{item.no_return_30d}</strong><small>sem retorno</small></div></div>) : <Empty title="Sem dados de retorno" text="Os resultados aparecerão após atendimentos concluídos."/>}</div><p className="panel-footnote">Coorte de primeiras visitas concluídas de 60 a 31 dias atrás; só entram os clientes que já completaram 30 dias de acompanhamento.</p></Panel></div></>}{!canReport && <Panel title="Relatórios não liberados"><p className="muted">Peça ao administrador para liberar a permissão de relatórios. Sua agenda continua disponível abaixo.</p></Panel>}<div className="dashboard-grid bottom"><Panel title="Próximos agendamentos" subtitle="Horários que você pode acompanhar"><DataTable rows={upcoming.filter(row => row.status !== 'cancelled')} empty="Sem agendamentos futuros" columns={[{ key: 'starts_at', label: 'Quando', render: row => dateTime(row.starts_at) }, { key: 'status', label: 'Status', render: row => String(row.status || '—') }]} /></Panel><Panel title="Em foco" subtitle="Acompanhamento da operação"><div className="insight-list"><div><div className="insight-icon"><Activity size={19}/></div><div><strong>{canReport && cohort ? `${noReturn} cliente(s) novo(s) sem retorno após 30 dias` : 'Retorno de clientes'}</strong><p>{canReport && cohort ? 'Acompanhe os profissionais com clientes que ainda não voltaram.' : 'A análise aparece quando relatórios estiverem liberados.'}</p></div></div><div><div className="insight-icon"><Users size={19}/></div><div><strong>{upcoming.length} próximo(s) horário(s)</strong><p>Consulte a agenda para ver disponibilidade e serviços.</p></div></div></div></Panel></div></div>
}
