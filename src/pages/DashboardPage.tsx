import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowRight, CalendarDays, CheckCircle2, CircleDollarSign, CreditCard, MessageCircle, Percent, RefreshCw, TrendingUp, Users } from 'lucide-react'
import type { PageProps } from '../App'
import { requireSupabase } from '../lib/supabase'
import { useRows } from '../lib/useRows'
import { shiftCalendarDay, shopMonthEnd, shopMonthStart, shopToday } from '../lib/shopTime'
import { percent } from '../lib/profitability'
import { whatsappUrl } from '../lib/whatsapp'
import { cents, date, money, type ModuleKey, type Row } from '../types'
import { AddButton, Empty, Field, Loading, Modal, Notice, PageHeader, Panel, PrimaryButton, Stat } from '../ui'
import { DailyActions } from '../DailyActions'
import { ManagementSummary } from '../ManagementSummary'
import { MonthQuickPick } from '../MonthRangeFilter'
import '../styles-management.css'
import '../styles-financial.css'

interface Debt { id: string; client_name: string; phone: string | null; description: string; amount_cents: number | null; due_on: string | null; legacy?: boolean }
interface Dashboard { revenue_cents: number | null; paid_transactions: number | null; ticket_average_cents: number; active_plans: number | null;
  available_minutes: number | null; occupied_minutes: number; occupancy_pct: number | null; days: { day: string; value: number }[] | null; debts: Debt[] | null }
interface Insights { current: Dashboard; comparison_current: Dashboard|null; comparison_from: string|null; comparison_to: string|null; comparison_method: 'month_to_date'|'previous_equal_length'|'unavailable'; previous: Dashboard|null; previous_from: string|null; previous_to: string|null; sold_cents: number | null; forecast_cents: number | null; goals: Row[]; provenance: Record<string,string> }
export function DashboardPage({ identity, role, notify, onNavigate }: PageProps & { onNavigate?: (page: ModuleKey) => void }) {
  const shopId = identity.shop?.id || null, timezone = identity.shop?.timezone || 'America/Sao_Paulo'
  const admin = role === 'admin' || role === 'master'
  const can = (key: ModuleKey) => admin || identity.permissions[key] === true
  const [data, setData] = useState<Dashboard | null>(null)
  const [insights, setInsights] = useState<Insights | null>(null)
  const [period, setPeriod] = useState({ from: shopMonthStart(timezone), to: shopMonthEnd(timezone) })
  const [periodDraft, setPeriodDraft] = useState(period)
  const requestRevision = useRef(0)
  const [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null)
  const [editor, setEditor] = useState(false), [saving, setSaving] = useState(false), [formError, setFormError] = useState<string | null>(null)
  const [form, setForm] = useState({ client: '', description: '', amount: '', due: shopToday(timezone) })
  const clients = useRows('clients', shopId, admin && editor)
  const refresh = useCallback(async () => {
    if (!shopId) return
    const revision = ++requestRevision.current
    setLoading(true); setError(null)
    try {
      const result = await requireSupabase().rpc('management_insights', { p_shop: shopId, p_from: period.from, p_to: period.to })
      if (revision !== requestRevision.current) return
      if (result.error) throw result.error
      setInsights(result.data as Insights); setData((result.data as Insights).current)
    } catch (problem) { if (revision === requestRevision.current) { setError(String((problem as { message?: string }).message || 'Não foi possível carregar os indicadores.')); setData(null); setInsights(null) } }
    finally { if (revision === requestRevision.current) setLoading(false) }
  }, [shopId, period.from, period.to])
  useEffect(() => { void refresh(); return () => { requestRevision.current++ } }, [refresh])
  async function saveDebt(event: FormEvent) {
    event.preventDefault(); setSaving(true); setFormError(null)
    try {
      const result = await requireSupabase().from('receivables').insert({ barbershop_id: shopId, client_id: form.client, description: form.description.trim(), amount_cents: cents(form.amount), due_on: form.due })
      if (result.error) throw result.error
      setEditor(false); setForm({ client: '', description: '', amount: '', due: shopToday(timezone) }); notify('Pendência registrada.'); await refresh()
    } catch (problem) { setFormError(problem instanceof Error ? problem.message : 'Não foi possível registrar a pendência.') }
    finally { setSaving(false) }
  }
  async function settle(debt: Debt) {
    setSaving(true)
    try { const result = await requireSupabase().rpc('settle_receivable', { p_barbershop_id: shopId, p_receivable_id: debt.id }); if (result.error) throw result.error; notify('Recebimento registrado e pendência quitada.'); await refresh() }
    catch (problem) { notify(problem instanceof Error ? problem.message : 'Falha ao registrar recebimento.', 'error') }
    finally { setSaving(false) }
  }
  const debts = data?.debts || [], overdue = debts.reduce((sum, debt) => sum + Number(debt.amount_cents || 0), 0)
  const chartEnd=period.to<shopToday(timezone)?period.to:shopToday(timezone)
  const days = Array.from({ length: 7 }, (_, index) => { const day = shiftCalendarDay(chartEnd, index - 6); return { day, value: Number(data?.days?.find(item => item.day === day)?.value || 0) } }).filter(day=>day.day>=period.from&&day.day<=period.to)
  const chartMax = Math.max(...days.map(day => day.value), 1)
  const displayName = String(identity.membership?.display_name || '').trim()
  const name = displayName.includes('@') ? '' : displayName.split(/\s+/)[0]
  return <div className="page-stack dashboard-page management-dashboard">
    <PageHeader eyebrow={admin ? 'GESTÃO DO NEGÓCIO' : 'SEUS RESULTADOS'} title="Painel da barbearia" description={`Indicadores da ${identity.shop?.name}, com dados registrados no sistema.`} action={<button className="button outline" onClick={() => void refresh()} disabled={loading}><RefreshCw size={16}/> Atualizar</button>}/>
    <form className="management-period" onSubmit={e=>{e.preventDefault();setPeriod(periodDraft)}}><Field label="De"><input type="date" required max={periodDraft.to} value={periodDraft.from} onChange={e=>setPeriodDraft({...periodDraft,from:e.target.value})}/></Field><Field label="Até"><input type="date" required min={periodDraft.from} value={periodDraft.to} onChange={e=>setPeriodDraft({...periodDraft,to:e.target.value})}/></Field><PrimaryButton type="submit" disabled={loading}>Aplicar período</PrimaryButton><button type="button" className="button outline" onClick={()=>{const current={from:shopMonthStart(timezone),to:shopMonthEnd(timezone)};setPeriodDraft(current);setPeriod(current)}}>Mês atual</button><MonthQuickPick from={period.from} to={period.to} timezone={timezone} capToday={false} onPick={range=>{setPeriodDraft(range);setPeriod(range)}}/></form>
    <div className="dashboard-hero"><div className="dashboard-hero-copy"><span>RESULTADOS QUE ORIENTAM SUAS DECISÕES</span><h2>{name ? `Olá, ${name}.` : 'Seu negócio, em uma visão.'}</h2><p>Planos, recebimentos e capacidade da agenda para acompanhar a saúde da operação.</p>{can('appointments') && <button className="dashboard-hero-action" onClick={() => onNavigate?.('appointments')}>Abrir agenda <ArrowRight size={17}/></button>}</div><div className="dashboard-day-card"><small>OCUPAÇÃO NO PERÍODO</small><strong>{percent(data?.occupancy_pct)}</strong><span>Tempo reservado / tempo disponível</span><div><span><CalendarDays size={15}/>{data?.available_minutes ? `${Math.round(data.occupied_minutes / 60)}h ocupadas de ${Math.round(data.available_minutes / 60)}h` : 'Defina a disponibilidade da equipe'}</span></div></div></div>
    <Notice text={error}/>{loading && <Loading text="Apurando seus indicadores..."/>}
    {data && <><div className="stats-grid management-kpis" data-tour-dashboard="metrics">
      {data.revenue_cents != null && <Stat label="Receita recebida" value={money(data.revenue_cents)} foot="Período selecionado · pagamentos confirmados" icon={<TrendingUp size={19}/>}/>}
      <Stat label="Planos ativos" value={data.active_plans ?? '—'} foot={can('subscriptions') ? 'Contratos vigentes · inclui ativos da origem' : 'Requer acesso a Assinaturas'} icon={<CreditCard size={19}/>}/>
      <Stat label="Ticket médio" value={data.revenue_cents != null ? money(data.ticket_average_cents) : '—'} foot={data.paid_transactions != null ? `${data.paid_transactions} pagamentos com valor no período` : 'Requer acesso a Relatórios'} icon={<CircleDollarSign size={19}/>}/>
      <Stat label="Ocupação da agenda" value={percent(data.occupancy_pct)} foot="Período selecionado · regras e folgas da equipe" icon={<Percent size={19}/>}/>
      {admin && <Stat label="Inadimplência" value={debts.some(d=>d.legacy)&&overdue===0 ? debts.length : money(overdue)} foot={`${debts.length} contrato(s) com pendência · inclui saldos a conferir`} icon={<CircleDollarSign size={19}/>}/>}
    </div>{insights&&shopId&&<ManagementSummary shopId={shopId} timezone={timezone} period={period} data={insights} can={can} onNavigate={onNavigate}/>}<DailyActions identity={identity} role={role} notify={notify} onNavigate={onNavigate}/><div className="dashboard-grid dashboard-operational">
      {data.days && <Panel title="Recebimentos dos últimos 7 dias" subtitle="Pagamentos confirmados no fuso da barbearia" className="chart-panel"><div className="dashboard-chart-total"><span>Acumulado</span><strong>{money(days.reduce((sum, day) => sum + day.value, 0))}</strong></div><div className="bar-chart">{days.map(day => <div className="chart-col" key={day.day}><div className="chart-value">{day.value ? money(day.value) : ''}</div><div className="chart-bar-wrap"><div className="chart-bar" style={{ height: `${day.value / chartMax * 100}%` }}/></div><span>{new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${day.day}T12:00:00Z`))}</span></div>)}</div><button className="dashboard-text-link" onClick={() => onNavigate?.('reports')}>Abrir relatórios <ArrowRight size={15}/></button></Panel>}
      <Panel title="Saúde da operação" subtitle="Pontos para acompanhar no período"><div className="health-list"><div><CreditCard/><span>Planos em vigor<strong>{data.active_plans ?? 'Acesso não liberado'}</strong></span>{can('subscriptions') && <button className="button outline" onClick={() => onNavigate?.('subscriptions')}>Ver planos</button>}</div><div><CalendarDays/><span>Capacidade da agenda<strong>{data.occupancy_pct == null ? 'Disponibilidade não cadastrada' : `${percent(data.occupancy_pct)} de ocupação`}</strong></span>{can('services') && <button className="button outline" onClick={() => onNavigate?.('services')}>Horários</button>}</div>{admin && <div><TrendingUp/><span>Rentabilidade<strong>Custos, impostos e margem por item</strong></span><button className="button outline" onClick={() => onNavigate?.('profit')}>Ver margem</button></div>}</div></Panel>
    </div>{admin && <Panel title="Inadimplência e contato" subtitle="Pendências vencidas e contratos com falha de cobrança na origem" action={<AddButton onClick={() => { setFormError(null); setEditor(true) }}>Cadastrar pendência</AddButton>}>
      {debts.length ? <div className="debt-list">{debts.map(debt => { const link = whatsappUrl(debt.phone, debt.legacy ? `Olá, ${debt.client_name}! Aqui é da ${identity.shop?.name}. Seu plano ${debt.description} apresentou uma pendência de cobrança. Podemos conferir juntos?` : `Olá, ${debt.client_name}! Aqui é da ${identity.shop?.name}. Identificamos uma pendência de ${money(debt.amount_cents)}, referente a ${debt.description}, com vencimento em ${date(debt.due_on)}. Podemos ajudar a regularizar?`); return <div className="debt-card" key={debt.id}><div className="debt-person"><span className="member-avatar">{debt.client_name.charAt(0)}</span><div><strong>{debt.client_name}</strong><small>{debt.description} · {debt.legacy ? 'Saldo e vencimento a conferir' : `venceu em ${date(debt.due_on)}`}</small></div></div><strong className="debt-amount">{debt.amount_cents==null ? 'A conferir' : money(debt.amount_cents)}</strong><div className="button-row">{link ? <a className="button outline" href={link} target="_blank" rel="noreferrer"><MessageCircle size={16}/> WhatsApp</a> : <span className="muted">Sem telefone válido</span>}{!debt.legacy && <button className="button outline" disabled={saving} onClick={() => { if (window.confirm(`Confirmar que recebeu ${money(debt.amount_cents)} de ${debt.client_name}? Isso registra o pagamento.`)) void settle(debt) }}><CheckCircle2 size={16}/> Recebido</button>}</div></div> })}</div> : <Empty title="Nenhuma pendência vencida" text="Cadastre valores a receber com cliente e vencimento para acompanhar a inadimplência."/>}
    </Panel>}<Panel title="Ações rápidas" subtitle="Acesso direto às rotinas"><div className="financial-shortcuts">{[{ key: 'appointments', icon: CalendarDays, title: 'Agenda', text: 'Horários e reservas' }, { key: 'clients', icon: Users, title: 'Clientes', text: 'Cadastro e histórico' }, { key: 'subscriptions', icon: CreditCard, title: 'Assinaturas', text: 'Planos e contratos' }, { key: 'profit', icon: TrendingUp, title: 'Margem de Lucro', text: 'Custo e resultado' }].filter(item => item.key === 'profit' ? admin : can(item.key as ModuleKey)).map(item => <button key={item.key} onClick={() => onNavigate?.(item.key as ModuleKey)}><item.icon size={21}/><span><strong>{item.title}</strong><small>{item.text}</small></span><ArrowRight size={17}/></button>)}</div></Panel></>}
    {editor && <Modal title="Cadastrar valor a receber" subtitle="O vencimento define quando a pendência aparece na inadimplência." onClose={() => { if (!saving) setEditor(false) }}><form className="form-grid" onSubmit={saveDebt}><Field label="Cliente"><select required value={form.client} onChange={e => setForm({ ...form, client: e.target.value })}><option value="">Selecione o cliente</option>{clients.rows.map(client => <option key={client.id} value={client.id}>{String(client.full_name)}</option>)}</select></Field><Field label="Referência da cobrança"><input required maxLength={300} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Ex.: mensalidade do plano"/></Field><div className="form-row"><Field label="Valor (R$)"><input type="number" required min="0.01" step="0.01" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })}/></Field><Field label="Vencimento"><input type="date" required value={form.due} onChange={e => setForm({ ...form, due: e.target.value })}/></Field></div><Notice text={formError || clients.error}/><PrimaryButton type="submit" disabled={saving || clients.loading}>{saving ? 'Salvando...' : 'Salvar pendência'}</PrimaryButton></form></Modal>}
  </div>
}
