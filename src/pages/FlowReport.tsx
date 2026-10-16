import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, Clock3, Flame, UsersRound } from 'lucide-react'
import { requireSupabase } from '../lib/supabase'
import { date } from '../types'
import { Empty, Loading, Notice, Panel, Stat } from '../ui'

interface FlowBucket { day: string; hour: number; completed_count: number; barber_id?: string | null; barber_name?: string | null }
interface Props { shopId: string | null; timezone: string; from: string; to: string; barberId: string }
const weekdays = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo']
// Escala de calor (do mais frio ao mais quente), com legenda abaixo do mapa.
const heatScale = ['#fff1c2', '#fed98a', '#fdb862', '#f8903f', '#ea6430', '#cc3f22', '#9c2516']
function heatLevel(count: number, max: number) { return count <= 0 ? -1 : Math.min(heatScale.length - 1, Math.max(0, Math.ceil(count / max * heatScale.length) - 1)) }
const hourLabel = (hour: number) => `${String(hour).padStart(2, '0')}h`

function weekdayIndex(day: string) {
  return (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7
}

function monthLabel(key: string) {
  const [year, month] = key.split('-').map(Number)
  return new Intl.DateTimeFormat('pt-BR', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 1))).replace('.', '')
}

export function FlowReport({ shopId, timezone, from, to, barberId }: Props) {
  const [buckets, setBuckets] = useState<FlowBucket[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!shopId) { setBuckets([]); return }
    let cancelled = false
    async function load() {
      setLoading(true); setError(null)
      try {
        const response = await requireSupabase().rpc('report_appointment_flow_by_barber', {
          p_barbershop_id: shopId,
          p_from: from,
          p_to: to,
          p_barber_membership_id: barberId || null,
        })
        if (response.error) throw response.error
        if (!Array.isArray(response.data)) throw new Error('A análise de fluxo retornou um formato inesperado.')
        if (!cancelled) setBuckets(response.data as FlowBucket[])
      } catch (problem) {
        if (!cancelled) { setBuckets([]); setError(problem instanceof Error ? problem.message : 'Não foi possível carregar o fluxo.') }
      } finally { if (!cancelled) setLoading(false) }
    }
    void load()
    return () => { cancelled = true }
  }, [shopId, from, to, barberId])

  const data = useMemo(() => {
    const byDate = new Map<string, number>()
    const byHour = Array.from({ length: 24 }, () => 0)
    const byWeekday = Array.from({ length: 7 }, () => 0)
    const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0))
    const cellBarbers = new Map<string, Map<string, number>>()
    const weekdayDates = Array.from({ length: 7 }, () => 0)
    for (let cursorDay = new Date(`${from}T12:00:00Z`); cursorDay.toISOString().slice(0, 10) <= to; cursorDay.setUTCDate(cursorDay.getUTCDate() + 1)) weekdayDates[weekdayIndex(cursorDay.toISOString().slice(0, 10))]++
    const byMonth = new Map<string, number>()
    const cursor = new Date(`${from.slice(0, 7)}-01T12:00:00Z`)
    const lastMonth = to.slice(0, 7)
    while (cursor.toISOString().slice(0, 7) <= lastMonth) {
      byMonth.set(cursor.toISOString().slice(0, 7), 0)
      cursor.setUTCMonth(cursor.getUTCMonth() + 1)
    }
    let count = 0
    for (const bucket of buckets) {
      const day = bucket.day
      const hour = Number(bucket.hour)
      const amount = Number(bucket.completed_count)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || hour < 0 || hour > 23 || !Number.isSafeInteger(amount) || amount < 0) continue
      const weekday = weekdayIndex(day)
      count += amount
      byDate.set(day, (byDate.get(day) || 0) + amount)
      byHour[hour] += amount
      byWeekday[weekday] += amount
      grid[weekday][hour] += amount
      const key = `${weekday}-${hour}`
      const people = cellBarbers.get(key) || new Map<string, number>()
      const name = bucket.barber_name || 'Sem profissional'
      people.set(name, (people.get(name) || 0) + amount)
      cellBarbers.set(key, people)
      byMonth.set(day.slice(0, 7), (byMonth.get(day.slice(0, 7)) || 0) + amount)
    }
    const peakHour = byHour.reduce((best, value, index) => value > byHour[best] ? index : best, 0)
    const peakWeekday = byWeekday.reduce((best, value, index) => value > byWeekday[best] ? index : best, 0)
    const peakDate = [...byDate.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
    const maxCell = Math.max(1, ...grid.flat())
    const maxMonth = Math.max(1, ...byMonth.values())
    const usedHours = byHour.map((count, hour) => count ? hour : -1).filter(hour => hour >= 0)
    const startHour = Math.min(8, ...usedHours)
    const endHour = Math.max(20, ...usedHours)
    const hours = Array.from({ length: endHour - startHour + 1 }, (_, index) => startHour + index)
    return { count, byDate, byHour, byWeekday, grid, byMonth, peakHour, peakWeekday, peakDate, maxCell, maxMonth, hours, cellBarbers, weekdayDates }
  }, [buckets, from, to])

  if (loading) return <Loading text="Analisando atendimentos por dia e horário..."/>
  if (error) return <Notice text={error}/>
  if (!data.count) return <Panel title="Fluxo da barbearia" subtitle="Atendimentos concluídos no período selecionado"><Empty title="Ainda não há atendimentos concluídos" text="Quando os agendamentos forem concluídos, os horários e dias de pico aparecerão aqui."/></Panel>

  return <div className="flow-report">
    <div className="stats-grid flow-stats">
      <Stat label="Atendimentos concluídos" value={data.count} foot={`${date(from)} a ${date(to)}`} icon={<UsersRound size={19}/>}/>
      <Stat label="Horário de pico" value={`${String(data.peakHour).padStart(2, '0')}h–${String(data.peakHour).padStart(2, '0')}h59`} foot={`${data.byHour[data.peakHour]} atendimento(s) nessa faixa`} icon={<Clock3 size={19}/>}/>
      <Stat label="Dia da semana de pico" value={weekdays[data.peakWeekday]} foot={`${data.byWeekday[data.peakWeekday]} atendimento(s) no período`} icon={<Flame size={19}/>}/>
      <Stat label="Data mais movimentada" value={data.peakDate ? date(data.peakDate[0]) : '—'} foot={data.peakDate ? `${data.peakDate[1]} atendimento(s) no dia` : ''} icon={<CalendarDays size={19}/>}/>
    </div>
    <Panel title="Mapa dos horários" subtitle="Mapa de calor dos atendimentos concluídos por dia da semana e hora de início. Passe o mouse (ou toque) para ver cada barbeiro.">
      <FlowHeatmap data={data}/>
      <p className="panel-footnote">Horários no fuso da barbearia ({timezone}).</p>
    </Panel>
    <div className="grid-two flow-secondary">
      <Panel title="Movimento por mês" subtitle="Evolução dos atendimentos no intervalo selecionado"><div className="flow-months">{[...data.byMonth].map(([month, count]) => <div className="flow-month-row" key={month}><span>{monthLabel(month)}</span><div className="flow-month-track"><div style={{ width: `${count ? Math.max(4, count / data.maxMonth * 100) : 0}%` }}/></div><strong>{count}</strong></div>)}</div></Panel>
      <Panel title="Leitura do movimento" subtitle="Os períodos mais procurados pela clientela"><div className="flow-insights"><div><span>Hora de maior demanda</span><strong>{String(data.peakHour).padStart(2, '0')}h às {String(data.peakHour).padStart(2, '0')}h59</strong><small>{Math.round(data.byHour[data.peakHour] / data.count * 100)}% dos atendimentos</small></div><div><span>Dia da semana mais forte</span><strong>{weekdays[data.peakWeekday]}</strong><small>{Math.round(data.byWeekday[data.peakWeekday] / data.count * 100)}% dos atendimentos</small></div><div><span>Dia corrido com maior fluxo</span><strong>{data.peakDate ? date(data.peakDate[0]) : '—'}</strong><small>{data.peakDate?.[1] || 0} atendimento(s)</small></div></div></Panel>
    </div>
    <p className="report-flow-footnote">Base: agendamentos marcados como concluídos, agrupados pela hora agendada. Vendas avulsas sem agendamento não entram no fluxo.</p>
  </div>
}

type FlowData = { grid: number[][]; hours: number[]; maxCell: number; byWeekday: number[]; cellBarbers: Map<string, Map<string, number>>; weekdayDates: number[] }

function FlowHeatmap({ data }: { data: FlowData }) {
  const wrap = useRef<HTMLDivElement>(null)
  const [tip, setTip] = useState<{ weekday: number; hour: number; x: number; y: number; below: boolean } | null>(null)
  function show(weekday: number, hour: number, target: HTMLElement) {
    const box = wrap.current?.getBoundingClientRect(), cell = target.getBoundingClientRect()
    if (!box) return
    const below = cell.top - box.top < 170
    setTip({ weekday, hour, x: cell.left - box.left + cell.width / 2, y: below ? cell.bottom - box.top + 8 : cell.top - box.top - 8, below })
  }
  const tipCount = tip ? data.grid[tip.weekday][tip.hour] : 0
  const tipBarbers = tip ? [...(data.cellBarbers.get(`${tip.weekday}-${tip.hour}`) || new Map<string, number>())].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR')) : []
  const tipLeft = tip && wrap.current ? Math.min(Math.max(tip.x, 130), wrap.current.clientWidth - 130) : 0
  const steps = heatScale.map((color, index) => ({ color, from: Math.floor(index * data.maxCell / heatScale.length) + 1, to: Math.ceil((index + 1) * data.maxCell / heatScale.length) })).filter(step => step.to >= step.from)

  return <div className="flow-heat" ref={wrap} onMouseLeave={() => setTip(null)}>
    <div className="flow-map-scroll" onScroll={() => setTip(null)}><div className="flow-map" style={{ gridTemplateColumns: `84px repeat(${data.hours.length}, minmax(35px, 1fr)) 50px` }}>
      <span className="flow-map-corner">Dia / hora</span>
      {data.hours.map(hour => <span className="flow-map-hour" key={hour}>{hourLabel(hour)}</span>)}
      <span className="flow-map-hour">Total</span>
      {weekdays.map((day, weekday) => <div className="flow-map-row" key={day} style={{ display: 'contents' }}>
        <strong className="flow-map-day">{day.slice(0, 3)}</strong>
        {data.hours.map(hour => {
          const count = data.grid[weekday][hour]
          const level = heatLevel(count, data.maxCell)
          const active = tip?.weekday === weekday && tip.hour === hour
          return <button type="button" key={hour} className={`flow-map-cell heat${count ? ' filled' : ''}${active ? ' active' : ''}`}
            style={level >= 0 ? { background: heatScale[level], color: level >= 4 ? '#fff' : '#4a2a0c' } : undefined}
            aria-label={`${day}, ${hourLabel(hour)}: ${count} atendimento(s)`}
            onMouseEnter={event => show(weekday, hour, event.currentTarget)} onFocus={event => show(weekday, hour, event.currentTarget)} onBlur={() => setTip(null)}
            onClick={event => active ? setTip(null) : show(weekday, hour, event.currentTarget)}>{count || ''}</button>
        })}
        <strong className="flow-map-total">{data.byWeekday[weekday]}</strong>
      </div>)}
    </div></div>
    <div className="flow-heat-legend" aria-label="Escala do mapa de calor"><span>Menos</span><i className="zero" title="Nenhum atendimento"/>{steps.map(step => <i key={step.color} style={{ background: step.color }} title={step.from === step.to ? `${step.from} atendimento(s)` : `${step.from} a ${step.to} atendimentos`}/>)}<span>Mais · até {data.maxCell} por horário</span></div>
    {tip && <div className={`flow-heat-tip${tip.below ? ' below' : ''}`} style={{ left: tipLeft, top: tip.y }} role="status">
      <strong>{weekdays[tip.weekday]}, das {hourLabel(tip.hour)} às {hourLabel(tip.hour)}59</strong>
      <div className="flow-heat-tip-total"><span>Atendimentos no período</span><b>{tipCount}</b></div>
      {data.weekdayDates[tip.weekday] > 0 && tipCount > 0 && <small>Média de {(tipCount / data.weekdayDates[tip.weekday]).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} por {weekdays[tip.weekday].toLowerCase()} ({data.weekdayDates[tip.weekday]} no período)</small>}
      {tipBarbers.length ? <ul>{tipBarbers.map(([name, value]) => <li key={name}><span>{name}</span><em><i style={{ width: `${Math.max(6, value / tipBarbers[0][1] * 100)}%` }}/></em><b>{value}</b></li>)}</ul> : <p>Nenhum atendimento nesse horário.</p>}
    </div>}
  </div>
}
