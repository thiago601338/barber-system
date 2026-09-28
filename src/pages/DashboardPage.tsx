import { useEffect, useState } from 'react'
import { ArrowRight, CalendarDays, CheckCircle2, Clock3, CreditCard, Scissors, TrendingUp, UserPlus, Users } from 'lucide-react'
import type { PageProps } from '../App'
import { shopClock, shopDateKey, shopDateTime, shopToday, shiftCalendarDay } from '../lib/shopTime'
import { requireSupabase } from '../lib/supabase'
import { money, type ModuleKey, type Row } from '../types'
import { Empty, Loading, Notice, PageHeader, Panel, Stat, Status } from '../ui'

interface Retention { barber_membership_id: string; barber_name: string; first_time_clients: number; eligible_for_30d: number; no_return_30d: number }
interface Metrics { revenue_cents: number; paid_transactions: number; ticket_average_cents: number; completed_appointments: number; new_clients: number; first_time_clients: number; barber_retention: Retention[] }
interface DayRevenue { label: string; value: number }

function mondayOf(day: string): string {
  const date = new Date(`${day}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
  return date.toISOString().slice(0, 10)
}
export function DashboardPage({ identity, role, onNavigate }: PageProps & { onNavigate?: (page: ModuleKey) => void }) {
  const shopId = identity.shop?.id
  const timezone = identity.shop?.timezone || 'America/Sao_Paulo'
  const [month, setMonth] = useState<Metrics | null>(null)
  const [week, setWeek] = useState<Metrics | null>(null)
  const [cohort, setCohort] = useState<Metrics | null>(null)
  const [days, setDays] = useState<DayRevenue[]>([])
  const [todayAppointments, setTodayAppointments] = useState<Row[]>([])
  const [upcoming, setUpcoming] = useState<Row[]>([])
  const [clientNames, setClientNames] = useState<Record<string, string>>({})
  const [setup, setSetup] = useState<{ barbers: number; services: number; hours: number } | null>(null)
  const [busy, setBusy] = useState(true)
  const [reportError, setReportError] = useState<string | null>(null)
  const [agendaError, setAgendaError] = useState<string | null>(null)
  const canReport = role !== 'barber' || identity.permissions.reports === true
  const admin = role === 'admin' || role === 'master'
  const canSeeAppointments = admin || identity.permissions.appointments === true

  useEffect(() => {
    if (!shopId) return
    let cancelled = false
    async function load() {
      setBusy(true); setReportError(null); setAgendaError(null)
      const client = requireSupabase()
      const now = new Date()
      const today = shopToday(timezone)
      if (canSeeAppointments) {
        const [appointmentResult, dayResult] = await Promise.all([
          client.from('appointments').select('id,client_id,barber_membership_id,starts_at,status,total_price_cents').eq('barbershop_id', shopId).gte('starts_at', now.toISOString()).neq('status', 'cancelled').order('starts_at').limit(8),
          client.from('appointments').select('id,client_id,barber_membership_id,starts_at,status,total_price_cents').eq('barbershop_id', shopId)
            .gte('starts_at', new Date(now.getTime() - 36 * 3_600_000).toISOString())
            .lt('starts_at', new Date(now.getTime() + 36 * 3_600_000).toISOString()).order('starts_at').limit(500),
        ])
        if (cancelled) return
        if (appointmentResult.error || dayResult.error) setAgendaError((appointmentResult.error || dayResult.error)!.message)
        const nextRows = (appointmentResult.data ?? []) as Row[]
        const todayRows = ((dayResult.data ?? []) as Row[]).filter(row => shopDateKey(new Date(String(row.starts_at)), timezone) === today)
        setUpcoming(nextRows); setTodayAppointments(todayRows)
        const ids = [...new Set([...nextRows, ...todayRows].map(row => String(row.client_id || '')).filter(Boolean))]
        if (ids.length) {
          const clientsResult = await client.from('clients').select('id,full_name').eq('barbershop_id', shopId).in('id', ids)
          if (!cancelled && !clientsResult.error) setClientNames(Object.fromEntries((clientsResult.data ?? []).map(row => [row.id, row.full_name])))
        } else setClientNames({})
      } else {
        setUpcoming([]); setTodayAppointments([]); setClientNames({})
      }
      if (admin) {
        const [barbers, services, hours] = await Promise.all([
          client.from('memberships').select('id', { count: 'exact', head: true }).eq('barbershop_id', shopId).eq('role', 'barber').eq('active', true),
          client.from('services').select('id', { count: 'exact', head: true }).eq('barbershop_id', shopId).eq('active', true),
          client.from('availability_rules').select('id', { count: 'exact', head: true }).eq('barbershop_id', shopId).eq('active', true),
        ])
        if (!cancelled && !barbers.error && !services.error && !hours.error) setSetup({ barbers: barbers.count || 0, services: services.count || 0, hours: hours.count || 0 })
      }
      if (canReport) {
        const dailyDates = Array.from({ length: 7 }, (_, index) => shiftCalendarDay(today, index - 6))
        const [monthResult, weekResult, cohortResult, ...dailyResults] = await Promise.all([
          client.rpc('dashboard_metrics', { p_barbershop_id: shopId, p_from: `${today.slice(0, 7)}-01`, p_to: today }),
          client.rpc('dashboard_metrics', { p_barbershop_id: shopId, p_from: mondayOf(today), p_to: today }),
          client.rpc('dashboard_metrics', { p_barbershop_id: shopId, p_from: shiftCalendarDay(today, -60), p_to: shiftCalendarDay(today, -31) }),
          ...dailyDates.map(day => client.rpc('dashboard_metrics', { p_barbershop_id: shopId, p_from: day, p_to: day })),
        ])
        if (cancelled) return
        const error = [monthResult.error, weekResult.error, cohortResult.error, ...dailyResults.map(result => result.error)].find(Boolean)
        if (error) setReportError(error.message)
        else {
          setMonth(monthResult.data as Metrics); setWeek(weekResult.data as Metrics); setCohort(cohortResult.data as Metrics)
          setDays(dailyDates.map((day, index) => ({ label: new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`)).replace('.', ''), value: Number((dailyResults[index].data as Metrics)?.revenue_cents ?? 0) })))
        }
      }
      setBusy(false)
    }
    void load()
    return () => { cancelled = true }
  }, [shopId, timezone, canReport, canSeeAppointments, admin])

  if (busy) return <><PageHeader eyebrow="VISÃO GERAL" title="Painel da barbearia" description="Preparando agenda e indicadores da operação."/><Loading/></>
  const activeToday = todayAppointments.filter(row => row.status !== 'cancelled')
  const completedToday = activeToday.filter(row => row.status === 'completed').length
  const pendingToday = activeToday.filter(row => row.status === 'pending' || row.status === 'confirmed' || row.status === 'in_progress').length
  const nextToday = activeToday.find(row => new Date(String(row.starts_at)).getTime() >= Date.now())
  const retention = cohort?.barber_retention ?? []
  const noReturn = retention.reduce((sum, item) => sum + Number(item.no_return_30d || 0), 0)
  const displayName = String(identity.membership?.display_name || identity.user.user_metadata?.full_name || '').trim()
  const firstNameCandidate = displayName.includes('@') ? '' : displayName.split(/\s+/)[0]
  const firstName = firstNameCandidate.length <= 18 ? firstNameCandidate : ''
  const readableDate = new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, day: 'numeric', month: 'long', weekday: 'long' }).format(new Date())
  const setupItems = setup ? [
    { done: setup.barbers > 0, label: 'Cadastrar pelo menos um barbeiro', page: 'settings' as ModuleKey },
    { done: setup.services > 0, label: 'Publicar serviços com preços', page: 'services' as ModuleKey },
    { done: setup.hours > 0, label: 'Definir os horários disponíveis', page: 'services' as ModuleKey },
  ] : []
  return <div className="page-stack dashboard-page">
    <PageHeader eyebrow="OPERAÇÃO EM TEMPO REAL" title="Painel da barbearia" description={`Dados da ${identity.shop?.name}, atualizados com os registros do sistema.`}/>
    <div className="dashboard-hero"><div className="dashboard-hero-copy"><span>SEU DIA, EM UMA VISÃO</span><h2>{firstName ? `Olá, ${firstName}.` : 'Olá, seja bem-vindo.'}</h2><p>{readableDate.charAt(0).toUpperCase() + readableDate.slice(1)}. {canSeeAppointments ? 'Organize os próximos atendimentos e acompanhe o resultado da equipe.' : 'Acompanhe os indicadores liberados para o seu perfil.'}</p>{canSeeAppointments && <button className="dashboard-hero-action" onClick={() => onNavigate?.('appointments')}>Abrir agenda <ArrowRight size={17}/></button>}</div>{canSeeAppointments && <div className="dashboard-day-card"><small>AGENDA DE HOJE</small><strong>{activeToday.length.toString().padStart(2, '0')}</strong><span>{activeToday.length === 1 ? 'atendimento marcado' : 'atendimentos marcados'}</span><div><span><CheckCircle2 size={15}/> {completedToday} concluído(s)</span><span><Clock3 size={15}/> {pendingToday} por atender</span></div></div>}</div>
    <Notice text={reportError || agendaError}/>
    {canReport && month && week ? <div className="stats-grid dashboard-metrics" data-tour-dashboard="metrics"><Stat label="Receita recebida no mês" value={money(month.revenue_cents)} foot={`${month.paid_transactions} pagamentos confirmados`} icon={<TrendingUp size={19}/>}/><Stat label="Ticket médio recebido" value={money(month.ticket_average_cents)} foot="Por transação paga" icon={<CreditCard size={19}/>}/><Stat label="Primeiras visitas na semana" value={week.first_time_clients} foot={`${week.new_clients} clientes cadastrados`} icon={<UserPlus size={19}/>}/><Stat label="Atendimentos concluídos" value={month.completed_appointments} foot="Neste mês" icon={<Scissors size={19}/>}/></div> : null}
    <div className="dashboard-grid dashboard-operational">
      {canSeeAppointments ? <Panel title="Próximos atendimentos" subtitle={nextToday ? `Próximo hoje às ${shopClock(nextToday.starts_at, timezone)}` : 'Agenda visível conforme seu acesso'} className="dashboard-agenda-panel"><div className="dashboard-agenda-list">{upcoming.length ? upcoming.slice(0, 5).map(row => <div className="dashboard-agenda-item" key={String(row.id)}><div className="dashboard-agenda-time"><strong>{shopClock(row.starts_at, timezone)}</strong><small>{new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, day: '2-digit', month: '2-digit' }).format(new Date(String(row.starts_at)))}</small></div><div className="dashboard-agenda-details"><strong>{clientNames[String(row.client_id)] || 'Atendimento agendado'}</strong><small>{shopDateTime(row.starts_at, timezone)}</small></div><Status value={row.status}/></div>) : <Empty title="Agenda livre por enquanto" text="Novos agendamentos aparecerão aqui automaticamente."/>}</div><button className="dashboard-text-link" onClick={() => onNavigate?.('appointments')}>Ver agenda completa <ArrowRight size={15}/></button></Panel> : <Panel title="Agenda" subtitle="Acesso individual"><p className="muted">Peça ao administrador para liberar a aba Agenda caso precise acompanhar atendimentos.</p></Panel>}
      {canReport && month ? <Panel title="Recebimentos dos últimos 7 dias" subtitle="Somente pagamentos confirmados" className="chart-panel"><div className="dashboard-chart-total"><span>Acumulado no período</span><strong>{money(days.reduce((sum, day) => sum + day.value, 0))}</strong></div><div className="bar-chart">{days.map((day, index) => { const max = Math.max(...days.map(item => item.value), 1); return <div className="chart-col" key={index}><div className="chart-value">{day.value ? money(day.value) : ''}</div><div className="chart-bar-wrap"><div className="chart-bar" style={{ height: `${Math.max(7, day.value / max * 100)}%` }}/></div><span>{day.label}</span></div> })}</div><button className="dashboard-text-link" onClick={() => onNavigate?.('reports')}>Abrir relatório detalhado <ArrowRight size={15}/></button></Panel> : <Panel title="Relatórios por permissão" subtitle="Seus atendimentos continuam disponíveis"><p className="muted">Peça ao administrador para liberar a aba Relatórios caso precise analisar ticket e faturamento.</p></Panel>}
    </div>
    <div className="dashboard-grid bottom dashboard-secondary">
      {admin && setupItems.some(item => !item.done) ? <Panel title="Prepare a agenda online" subtitle="Conclua estas etapas para receber clientes"><div className="dashboard-checklist">{setupItems.map(item => <button key={item.label} onClick={() => onNavigate?.(item.page)} className={item.done ? 'done' : ''}><span className="dashboard-check-icon"><CheckCircle2 size={17}/></span><strong>{item.label}</strong><ArrowRight size={15}/></button>)}</div></Panel> : canReport ? <Panel title="Clientes novos sem retorno" subtitle="Primeira visita há mais de 30 dias"><div className="return-list">{retention.length ? retention.map(item => <div className="return-row" key={item.barber_membership_id}><div className="member-avatar">{item.barber_name.charAt(0)}</div><div><strong>{item.barber_name}</strong><small>{item.first_time_clients} cliente(s) novo(s) na coorte</small></div><div className={`return-count ${item.no_return_30d ? 'zero' : ''}`}><strong>{item.no_return_30d}</strong><small>sem retorno</small></div></div>) : <Empty title="Sem dados de retorno" text="A análise começa após primeiras visitas concluídas."/>}</div><p className="panel-footnote">Primeiras visitas de 60 a 31 dias atrás, com 30 dias de acompanhamento.</p></Panel> : canSeeAppointments ? <Panel title="Seu próximo atendimento" subtitle="Acompanhe sua agenda"><p>{nextToday ? `Hoje às ${shopClock(nextToday.starts_at, timezone)}.` : 'Nenhum horário restante hoje.'}</p></Panel> : <Panel title="Seu acesso" subtitle="Permissões individuais"><p className="muted">As abas disponíveis foram definidas pelo administrador da barbearia.</p></Panel>}
      <Panel title="Ações rápidas" subtitle="Vá direto ao que precisa fazer"><div className="dashboard-shortcuts">{canSeeAppointments && <button onClick={() => onNavigate?.('appointments')}><CalendarDays size={19}/><span><strong>Agenda</strong><small>Horários e atendimentos</small></span><ArrowRight size={16}/></button>}{(admin || identity.permissions.clients) && <button onClick={() => onNavigate?.('clients')}><Users size={19}/><span><strong>Clientes</strong><small>Cadastro e histórico</small></span><ArrowRight size={16}/></button>}{(admin || identity.permissions.services) && <button onClick={() => onNavigate?.('services')}><Scissors size={19}/><span><strong>Serviços</strong><small>Procedimentos e preços</small></span><ArrowRight size={16}/></button>}{canReport && <button onClick={() => onNavigate?.('reports')}><TrendingUp size={19}/><span><strong>Relatórios</strong><small>Faturamento e retorno</small></span><ArrowRight size={16}/></button>}</div>{canReport && cohort && <p className="dashboard-retention-foot">{noReturn} cliente(s) novo(s) sem retorno observado após 30 dias.</p>}</Panel>
    </div>
  </div>
}
