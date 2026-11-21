import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Crown, LockKeyhole } from 'lucide-react'
import { requireSupabase } from '../lib/supabase'
import { shiftCalendarDay, shopDayStartUtc, shopToday } from '../lib/shopTime'
import { clientStage, stageLabels } from '../lib/appointmentStage'
import { TeamAvatar } from '../TeamAvatar'
import { asText, type Row } from '../types'

// Agenda do dia em colunas por profissional, no estilo da tela de agendamentos do CashBarber.

const ROW_MINUTES = 10
const ROW_HEIGHT = 22
type Block = { barber_membership_id: string; starts_at: string; ends_at: string; kind: string; title: string }
type Filter = 'all' | 'plan' | 'single' | 'arrived' | 'no_show'
type Staffing = 'working' | 'all' | 'busy'

const toMinutes = (clock: string) => { const [h, m] = clock.split(':').map(Number); return h * 60 + (m || 0) }
const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
const weekdayOf = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay()
const bigDate = (day: string) => {
  const d = new Date(`${day}T12:00:00Z`)
  const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: 'UTC' }).format(d)
  const month = new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'UTC' }).format(d).replace('.', '')
  return { weekday: weekday.charAt(0).toUpperCase() + weekday.slice(1).replace('-feira', ''), day: d.getUTCDate(), month: month.charAt(0).toUpperCase() + month.slice(1), year: d.getUTCFullYear() }
}

export function AgendaBoard({ shopId, timezone, day, setDay, barbers, appointments, appointmentServices, clients, services, subscriptions, rules, onSelect, onNew, toolbar }: {
  shopId: string; timezone: string; day: string; setDay: (day: string) => void
  barbers: Row[]; appointments: Row[]; appointmentServices: Row[]; clients: Row[]; services: Row[]; subscriptions: Row[]; rules: Row[]
  onSelect: (appointment: Row) => void; onNew: () => void; toolbar?: ReactNode
}) {
  const [blocks, setBlocks] = useState<Block[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [staffing, setStaffing] = useState<Staffing>('working')
  const [compact, setCompact] = useState(false)
  const [showCancelled, setShowCancelled] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t) }, [])

  useEffect(() => {
    let alive = true
    const from = shopDayStartUtc(day, timezone), to = shopDayStartUtc(shiftCalendarDay(day, 1), timezone)
    void requireSupabase().rpc('agenda_day_blocks', { p_shop: shopId, p_from: from, p_to: to }).then(({ data }) => { if (alive) setBlocks((data ?? []) as Block[]) })
    return () => { alive = false }
  }, [shopId, day, timezone])

  const dayStartMs = useMemo(() => new Date(shopDayStartUtc(day, timezone)).getTime(), [day, timezone])
  const minuteOf = (value: unknown) => Math.round((new Date(String(value)).getTime() - dayStartMs) / 60000)
  const weekday = weekdayOf(day)
  const rulesOf = (barberId: unknown) => rules.filter(r => r.barber_membership_id === barberId && Number(r.weekday) === weekday && r.active !== false)
  const livePlan = (clientId: unknown) => subscriptions.some(s => s.client_id === clientId && ['active', 'past_due', 'authorized'].includes(String(s.status)))
  const isPlan = (a: Row) => !!a.subscription_id || livePlan(a.client_id)

  const visible = appointments.filter(a => showCancelled || a.status !== 'cancelled')
  const live = appointments.filter(a => a.status !== 'cancelled')
  const stats = {
    all: live.length,
    plan: live.filter(isPlan).length,
    single: live.filter(a => !isPlan(a)).length,
    arrived: live.filter(a => ['arrived', 'in_progress', 'completed'].includes(clientStage(a))).length,
    no_show: live.filter(a => a.status === 'no_show').length,
  }
  const matches = (a: Row) => filter === 'all' || (filter === 'plan' ? isPlan(a) : filter === 'single' ? !isPlan(a) : filter === 'arrived' ? ['arrived', 'in_progress', 'completed'].includes(clientStage(a)) : a.status === 'no_show')

  const perBarber = barbers.map(barber => {
    const own = visible.filter(a => a.barber_membership_id === barber.id)
    const work = rulesOf(barber.id).map(r => [toMinutes(String(r.start_time)), toMinutes(String(r.end_time))] as const)
    const off = blocks.filter(b => b.barber_membership_id === barber.id)
    const workMinutes = work.reduce((s, [a, b]) => s + Math.max(0, b - a), 0) - off.filter(b => b.kind !== 'day_off').reduce((s, b) => s + Math.max(0, minuteOf(b.ends_at) - minuteOf(b.starts_at)), 0)
    const busy = own.filter(a => a.status !== 'cancelled').reduce((s, a) => s + Math.max(0, minuteOf(a.ends_at) - minuteOf(a.starts_at)), 0)
    const dayOff = off.some(b => b.kind === 'day_off')
    return { barber, own, work, off, dayOff, count: own.filter(a => a.status !== 'cancelled').length, occupancy: workMinutes > 0 ? Math.min(100, Math.round(busy / workMinutes * 100)) : 0 }
  })
  const columns = perBarber.filter(c => staffing === 'all' ? true : staffing === 'busy' ? c.count > 0 : (c.work.length > 0 && !c.dayOff) || c.count > 0)

  const range = (() => {
    const starts = [8 * 60, ...columns.flatMap(c => c.work.map(w => w[0])), ...visible.map(a => minuteOf(a.starts_at))]
    const ends = [20 * 60, ...columns.flatMap(c => c.work.map(w => w[1])), ...visible.map(a => minuteOf(a.ends_at))]
    const start = Math.max(0, Math.floor(Math.min(...starts) / 60) * 60)
    const end = Math.min(24 * 60, Math.ceil(Math.max(...ends) / 60) * 60)
    return { start, end }
  })()
  const rows = Array.from({ length: (range.end - range.start) / ROW_MINUTES }, (_, i) => range.start + i * ROW_MINUTES)
  const y = (minute: number) => (minute - range.start) / ROW_MINUTES * ROW_HEIGHT
  const isToday = day === shopToday(timezone)
  const nowMinute = Math.round((now - dayStartMs) / 60000)
  const date = bigDate(day)

  // Encaixes no mesmo horário ficam lado a lado.
  const lanes = (items: Row[]) => {
    const sorted = [...items].sort((a, b) => minuteOf(a.starts_at) - minuteOf(b.starts_at))
    const laneEnds: number[] = []; const placed = new Map<unknown, { lane: number; of: number }>()
    let group: Row[] = []; let groupEnd = -1
    const flush = () => { const of = Math.max(1, ...group.map(g => (placed.get(g.id)?.lane ?? 0) + 1)); group.forEach(g => placed.set(g.id, { lane: placed.get(g.id)!.lane, of })); group = []; laneEnds.length = 0 }
    for (const a of sorted) {
      const s = minuteOf(a.starts_at), e = minuteOf(a.ends_at)
      if (s >= groupEnd && group.length) flush()
      let lane = laneEnds.findIndex(end => end <= s); if (lane < 0) { lane = laneEnds.length; laneEnds.push(e) } else laneEnds[lane] = e
      placed.set(a.id, { lane, of: 1 }); group.push(a); groupEnd = Math.max(groupEnd, e)
    }
    if (group.length) flush()
    return placed
  }

  const kpis: [Filter, number, string, string][] = [
    ['all', stats.all, 'Agendamentos', 'dot-blue'], ['plan', stats.plan, 'Com plano', 'dot-gold'], ['single', stats.single, 'Avulsos', 'dot-ink'],
    ['arrived', stats.arrived, 'Chegaram', 'dot-green'], ['no_show', stats.no_show, 'Faltaram', 'dot-red'],
  ]

  return <div className="agenda-board">
    <div className="ab-head">
      <div className="ab-date">
        <h1>{date.weekday}, <em>{date.day} {date.month}.</em> {date.year}</h1>
        <label className="ab-icon" title="Escolher data"><CalendarDays size={16}/><input type="date" value={day} onChange={e => e.target.value && setDay(e.target.value)}/></label>
        <button className="ab-icon" aria-label="Dia anterior" onClick={() => setDay(shiftCalendarDay(day, -1))}><ChevronLeft size={16}/></button>
        <button className="ab-icon" aria-label="Próximo dia" onClick={() => setDay(shiftCalendarDay(day, 1))}><ChevronRight size={16}/></button>
        {!isToday && <button className="ab-pill" onClick={() => setDay(shopToday(timezone))}>Hoje</button>}
      </div>
      {toolbar}
    </div>

    <div className="ab-kpis">{kpis.map(([key, value, label, dot]) =>
      <button key={key} className={`ab-kpi ${filter === key ? 'on' : ''}`} onClick={() => setFilter(filter === key && key !== 'all' ? 'all' : key)}>
        <strong>{value}</strong><span className={dot}>{label}</span>
      </button>)}
    </div>

    <div className="ab-filters">
      <div className="ab-seg">
        <button className={staffing === 'working' ? 'on' : ''} onClick={() => setStaffing('working')}>Quem trabalha hoje</button>
        <button className={staffing === 'all' ? 'on' : ''} onClick={() => setStaffing('all')}>Todos <b>{barbers.length}</b></button>
        <button className={staffing === 'busy' ? 'on' : ''} onClick={() => setStaffing('busy')}>Com agenda</button>
      </div>
      <label className="ab-check"><input type="checkbox" checked={showCancelled} onChange={e => setShowCancelled(e.target.checked)}/> Mostrar cancelados</label>
      <div className="ab-seg right">
        <button className={!compact ? 'on' : ''} onClick={() => setCompact(false)}>Detalhado</button>
        <button className={compact ? 'on' : ''} onClick={() => setCompact(true)}>Resumo</button>
      </div>
    </div>

    {columns.length === 0 ? <div className="ab-empty">Ninguém trabalha neste dia. Use “Todos” para ver a equipe inteira.</div> :
    <div className="ab-scroll">
      <div className="ab-grid" style={{ gridTemplateColumns: `58px repeat(${columns.length}, minmax(${compact ? 120 : 160}px, 1fr))` }}>
        <div className="ab-corner"/>
        {columns.map(c => <div key={String(c.barber.id)} className="ab-barber">
          <TeamAvatar path={c.barber.avatar_path} name={String(c.barber.display_name || 'B')} shopId={shopId} memberId={String(c.barber.id)} className="ab-avatar"/>
          <div><strong title={asText(c.barber.display_name)}>{asText(c.barber.display_name)}</strong>
            <small>{c.dayOff ? 'Folga' : <>{c.count} agend. · <b className={c.occupancy >= 80 ? 'hot' : ''}>{c.occupancy}%</b> ocupado</>}</small>
            <i className="ab-occ"><span style={{ width: `${c.occupancy}%` }}/></i></div>
        </div>)}

        <div className="ab-times" style={{ height: rows.length * ROW_HEIGHT }}>
          {rows.map(m => <span key={m} className={m % 60 === 0 ? 'hour' : ''} style={{ top: y(m) }}>{m % 30 === 0 ? clock(m) : ''}</span>)}
        </div>

        {columns.map(c => {
          const placed = lanes(c.own)
          const closed: [number, number][] = []
          let cursor = range.start
          for (const [s, e] of [...c.work].sort((a, b) => a[0] - b[0])) { if (s > cursor) closed.push([cursor, s]); cursor = Math.max(cursor, e) }
          if (cursor < range.end) closed.push([cursor, range.end])
          return <div key={String(c.barber.id)} className="ab-col" style={{ height: rows.length * ROW_HEIGHT }} onClick={onNew}>
            {rows.map(m => <i key={m} className={`ab-line ${m % 60 === 0 ? 'hour' : m % 30 === 0 ? 'half' : ''}`} style={{ top: y(m) }}/>)}
            {(c.dayOff || !c.work.length ? [[range.start, range.end] as [number, number]] : closed).map(([s, e], i) =>
              <div key={`off${i}`} className="ab-closed" style={{ top: y(s), height: y(e) - y(s) }}>{e - s >= 30 && <span>{c.dayOff ? 'Folga' : 'Não atende'}<small>{clock(s)} - {clock(e)}</small></span>}</div>)}
            {c.off.filter(b => b.kind !== 'day_off').map((b, i) => { const s = minuteOf(b.starts_at), e = minuteOf(b.ends_at); return <div key={`b${i}`} className={`ab-block ${b.kind}`} style={{ top: y(s), height: Math.max(ROW_HEIGHT, y(e) - y(s)) }} onClick={ev => ev.stopPropagation()}>
              <span><LockKeyhole size={11}/>{b.kind === 'interval' ? 'Intervalo' : 'Bloqueado'}</span>{e - s >= 20 && <small>{clock(s)} - {clock(e)}</small>}</div> })}
            {c.own.map(a => {
              const s = minuteOf(a.starts_at), e = Math.max(s + ROW_MINUTES, minuteOf(a.ends_at))
              const lane = placed.get(a.id) ?? { lane: 0, of: 1 }
              const client = clients.find(x => x.id === a.client_id)
              const names = appointmentServices.filter(x => x.appointment_id === a.id).map(x => asText(services.find(sv => sv.id === x.service_id)?.name)).filter(Boolean)
              const stage = clientStage(a); const plan = isPlan(a)
              return <button key={String(a.id)} title={`${asText(client?.full_name)} · ${stageLabels[stage]}`}
                className={`ab-appt ${plan ? 'plan' : 'single'} st-${stage} ${matches(a) ? '' : 'dim'} ${compact || e - s <= 20 ? 'tight' : ''}`}
                style={{ top: y(s) + 1, height: y(e) - y(s) - 2, left: `calc(${lane.lane / lane.of * 100}% + 3px)`, width: `calc(${100 / lane.of}% - 6px)` }}
                onClick={ev => { ev.stopPropagation(); onSelect(a) }}>
                <span className="ab-name">{plan && <Crown size={11}/>}{asText(client?.full_name) || 'Cliente'}</span>
                {!compact && <small>{names.join(', ') || 'Procedimento'}</small>}
                <small className="ab-when">{clock(s)} - {clock(e)}</small>
                <i className="ab-stage" title={stageLabels[stage]}/>
              </button>
            })}
            {isToday && nowMinute > range.start && nowMinute < range.end && <i className="ab-now" style={{ top: y(nowMinute) }}/>}
          </div>
        })}
      </div>
    </div>}
    <div className="ab-legend"><span className="lg plan">Plano</span><span className="lg single">Avulso</span><span className="lg block">Bloqueado</span><span className="lg interval">Intervalo</span><span className="lg closed">Não atende</span><span className="lg now">Agora</span></div>
  </div>
}
