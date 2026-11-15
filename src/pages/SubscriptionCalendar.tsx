import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, MessageCircle } from 'lucide-react'
import { shiftCalendarDay, shopToday } from '../lib/shopTime'
import { requireSupabase } from '../lib/supabase'
import { whatsappUrl } from '../lib/whatsapp'
import { asText, date, money, type Row } from '../types'
import { DataTable, Loading, Notice, Panel, Status } from '../ui'
import '../styles-extras.css'

interface Due extends Row {
  subscription_id: string; day: string; client_name: string; phone: string | null; plan_name: string
  amount_cents: number; status: string; projected: boolean; ending: boolean; overdue: boolean
}
interface CalendarData { today: string; due: Due[]; received: { day: string; amount_cents: number; count: number }[]; overdue?: { count: number; amount_cents: number } }

const weekdayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const monthStart = (day: string) => `${day.slice(0, 7)}-01`
function shiftMonth(month: string, offset: number): string {
  const value = new Date(`${month}T12:00:00Z`)
  value.setUTCMonth(value.getUTCMonth() + offset, 1)
  return value.toISOString().slice(0, 10)
}
function monthEnd(month: string): string { return shiftCalendarDay(shiftMonth(month, 1), -1) }
function monthLabel(month: string): string {
  const label = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}T12:00:00Z`))
  return label.charAt(0).toUpperCase() + label.slice(1)
}
const shortMoney = (cents: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(cents / 100)

/** Calendário mensal de assinaturas: o que vence em cada dia e o que já entrou. */
export function SubscriptionCalendar({ shopId, shopName, timezone, admin, revision, onInspect }: {
  shopId: string; shopName: string; timezone: string; admin: boolean; revision: number; onInspect: (subscriptionId: string) => void
}) {
  const today = shopToday(timezone)
  const [month, setMonth] = useState(() => monthStart(today))
  const [selected, setSelected] = useState(today)
  const [data, setData] = useState<CalendarData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    void requireSupabase().rpc('subscription_calendar', { p_barbershop_id: shopId, p_from: month, p_to: monthEnd(month) }).then(({ data: result, error: problem }) => {
      if (cancelled) return
      if (problem) { setError(problem.message); setData(null) } else setData(result as CalendarData)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [shopId, month, revision])
  const byDay = useMemo(() => {
    const map = new Map<string, Due[]>()
    for (const item of data?.due ?? []) map.set(item.day, [...(map.get(item.day) || []), item])
    return map
  }, [data])
  const receivedByDay = useMemo(() => new Map((data?.received ?? []).map(item => [item.day, item])), [data])
  const cells = useMemo(() => {
    const first = new Date(`${month}T12:00:00Z`)
    const total = new Date(`${monthEnd(month)}T12:00:00Z`).getUTCDate()
    return [...Array.from({ length: first.getUTCDay() }, () => null), ...Array.from({ length: total }, (_, index) => shiftCalendarDay(month, index))]
  }, [month])
  const due = data?.due ?? []
  const expected = due.filter(item => !item.overdue).reduce((sum, item) => sum + Number(item.amount_cents || 0), 0)
  const overdueCount = Number(data?.overdue?.count ?? due.filter(item => item.overdue).length)
  const overdueAmount = Number(data?.overdue?.amount_cents ?? due.filter(item => item.overdue).reduce((sum, item) => sum + Number(item.amount_cents || 0), 0))
  const received = (data?.received ?? []).reduce((sum, item) => sum + Number(item.amount_cents || 0), 0)
  const dayItems = byDay.get(selected) ?? []
  const dayReceived = receivedByDay.get(selected)
  function go(offset: number) {
    const next = shiftMonth(month, offset)
    setMonth(next)
    setSelected(next === monthStart(today) ? today : next)
  }
  const canGoBack = month > shiftMonth(monthStart(today), -12)
  const canGoForward = month < shiftMonth(monthStart(today), 3)
  return <>
    <Panel className="subscription-calendar" title="Calendário de assinaturas" subtitle="Vencimentos previstos por dia e mensalidades já recebidas"
      action={<div className="date-nav month-nav"><button className="icon-button" aria-label="Mês anterior" disabled={!canGoBack} onClick={() => go(-1)}><ChevronLeft size={18}/></button><strong>{monthLabel(month)}</strong><button className="icon-button" aria-label="Próximo mês" disabled={!canGoForward} onClick={() => go(1)}><ChevronRight size={18}/></button></div>}>
      <Notice text={error}/>
      <div className="calendar-summary">
        <div><span>A vencer no mês</span><strong>{money(expected)}</strong><small>{due.filter(item => !item.overdue).length} vencimento(s)</small></div>
        {admin && <div><span>Recebido no mês</span><strong>{money(received)}</strong><small>{(data?.received ?? []).reduce((sum, item) => sum + Number(item.count || 0), 0)} mensalidade(s)</small></div>}
        <div className={overdueCount ? 'alert' : ''}><span>Em atraso hoje</span><strong>{money(overdueAmount)}</strong><small>{overdueCount} contrato(s), em qualquer mês</small></div>
      </div>
      {loading && !data ? <Loading text="Montando o calendário..."/> : <div className={`month-grid ${loading ? 'is-loading' : ''}`} role="grid" aria-label={`Vencimentos de ${monthLabel(month)}`}>
        {weekdayNames.map(name => <div key={name} className="month-grid-weekday" role="columnheader">{name}</div>)}
        {cells.map((day, index) => {
          if (!day) return <div key={`blank-${index}`} className="month-grid-blank" aria-hidden="true"/>
          const items = byDay.get(day) ?? []
          const late = items.filter(item => item.overdue).length
          const amount = items.reduce((sum, item) => sum + Number(item.amount_cents || 0), 0)
          const paid = receivedByDay.get(day)
          return <button type="button" key={day} role="gridcell" aria-selected={selected === day}
            className={`month-grid-day ${day === today ? 'today' : ''} ${selected === day ? 'selected' : ''} ${items.length ? 'has-items' : ''} ${late ? 'late' : ''}`}
            onClick={() => setSelected(day)}>
            <span className="month-grid-number">{Number(day.slice(8))}</span>
            {items.length > 0 && <span className="month-grid-due"><b>{items.length}</b> {shortMoney(amount)}</span>}
            {paid && <span className="month-grid-paid">+ {shortMoney(paid.amount_cents)}</span>}
          </button>
        })}
      </div>}
      <p className="panel-footnote">Datas previstas não são pagamentos. O valor em verde é o que já foi recebido naquele dia.</p>
    </Panel>
    <Panel title={`Dia ${date(selected)}`} subtitle={dayItems.length ? `${dayItems.length} vencimento(s) · ${money(dayItems.reduce((sum, item) => sum + Number(item.amount_cents || 0), 0))}${dayReceived ? ` · recebido ${money(dayReceived.amount_cents)}` : ''}` : dayReceived ? `Recebido ${money(dayReceived.amount_cents)} em ${dayReceived.count} mensalidade(s)` : 'Nenhum vencimento neste dia'}>
      {dayItems.length > 0 && <DataTable rows={dayItems} empty="Nenhum vencimento" onRowClick={row => onInspect(String(row.subscription_id))} columns={[
        { key: 'client_name', label: 'Cliente', render: row => asText(row.client_name) },
        { key: 'plan_name', label: 'Plano', render: row => asText(row.plan_name) },
        { key: 'amount_cents', label: 'Valor', render: row => <span className="num">{money(row.amount_cents)}</span> },
        { key: 'status', label: 'Situação', render: row => row.overdue ? <Status value="past_due"/> : row.ending ? <Status value="ending"/> : row.projected ? <span className="status">Próximo ciclo</span> : <Status value="active"/> },
        { key: 'phone', label: 'Contato', render: row => {
          const link = whatsappUrl(row.phone, row.overdue
            ? `Olá, ${String(row.client_name).split(' ')[0]}! Aqui é da ${shopName}. A mensalidade do plano ${String(row.plan_name)} venceu em ${date(row.day)}. Podemos ajudar a regularizar?`
            : `Olá, ${String(row.client_name).split(' ')[0]}! Aqui é da ${shopName}. Passando para lembrar que a mensalidade do plano ${String(row.plan_name)} vence em ${date(row.day)}.`)
          return link ? <a className="whatsapp-link" href={link} target="_blank" rel="noreferrer"><MessageCircle size={14}/>{row.overdue ? 'Cobrar' : 'Avisar'}</a> : <span className="muted">—</span>
        } },
      ]}/>}
    </Panel>
  </>
}
