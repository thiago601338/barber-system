import { ChevronLeft, ChevronRight } from 'lucide-react'
import { shopToday } from './lib/shopTime'
import './styles-month-filter.css'

// Filtros por mês: qualquer mês (ou intervalo de meses) pode ser escolhido, não só "últimos N meses".
export type MonthRange = { start: string; end: string } // 'YYYY-MM'

export const monthOf = (day: string) => day.slice(0, 7)
export function addMonths(ym: string, offset: number): string {
  const [y, m] = ym.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1 + offset, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}
export function monthsBetween(start: string, end: string): number {
  const [ys, ms] = start.split('-').map(Number), [ye, me] = end.split('-').map(Number)
  return (ye - ys) * 12 + (me - ms) + 1
}
export function monthName(ym: string, withYear = true): string {
  const [y, m] = ym.split('-').map(Number)
  const text = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('pt-BR', withYear ? { month: 'long', year: 'numeric', timeZone: 'UTC' } : { month: 'long', timeZone: 'UTC' })
  return text.charAt(0).toUpperCase() + text.slice(1)
}
export const currentMonth = (timezone: string) => monthOf(shopToday(timezone))
// Primeiro e último dia do mês (o último é limitado a hoje no mês corrente).
export function monthDays(ym: string, timezone: string, capToday = true): { from: string; to: string } {
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
  const today = shopToday(timezone)
  return { from: `${ym}-01`, to: capToday && last > today ? today : last }
}
export function lastMonths(count: number, timezone: string): MonthRange {
  const end = currentMonth(timezone)
  return { start: addMonths(end, -(count - 1)), end }
}
export function rangeLabel(range: MonthRange): string {
  return range.start === range.end ? monthName(range.start) : `${monthName(range.start)} a ${monthName(range.end)}`
}

function monthOptions(latest: string, earliest: string) {
  const out: string[] = []
  for (let ym = latest; ym >= earliest; ym = addMonths(ym, -1)) out.push(ym)
  return out
}

// Seletor de um mês com setas: ‹ Outubro de 2026 ›. Com value vazio mostra "Escolher mês".
export function MonthPicker({ value, onChange, timezone, earliest, label = 'Mês' }: { value: string; onChange: (ym: string) => void; timezone: string; earliest?: string; label?: string }) {
  const latest = currentMonth(timezone)
  let first = earliest && earliest < latest ? earliest : addMonths(latest, -59)
  if (value && value < first) first = value
  const options = monthOptions(latest, first)
  const base = value || latest
  return <div className="month-picker" role="group" aria-label={label}>
    <button type="button" className="icon-button" aria-label="Mês anterior" disabled={!!value && value <= first} onClick={() => onChange(value ? addMonths(value, -1) : addMonths(latest, -1))}><ChevronLeft size={16}/></button>
    <select aria-label={label} value={value} onChange={event => event.target.value && onChange(event.target.value)}>
      {!value && <option value="">Escolher mês</option>}
      {options.map(ym => <option key={ym} value={ym}>{monthName(ym)}</option>)}
    </select>
    <button type="button" className="icon-button" aria-label="Próximo mês" disabled={base >= latest} onClick={() => onChange(addMonths(base, 1))}><ChevronRight size={16}/></button>
  </div>
}

// Mês que corresponde exatamente a um período de datas (1º dia até o último, ou até hoje no mês corrente).
export function monthFromRange(from: string, to: string, timezone: string): string {
  if (!from || !to || from.slice(8) !== '01' || monthOf(from) !== monthOf(to)) return ''
  const ym = monthOf(from)
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
  return to === last || to === monthDays(ym, timezone).to ? ym : ''
}

// Atalho "mês a mês" para filtros de De/Até: escolhe um mês e preenche o período inteiro dele.
export function MonthQuickPick({ from, to, timezone, onPick, label = 'Mês a mês', capToday = true }: { from: string; to: string; timezone: string; onPick: (range: { from: string; to: string }, ym: string) => void; label?: string; capToday?: boolean }) {
  return <div className="month-quick"><span>{label}</span><MonthPicker value={monthFromRange(from, to, timezone)} onChange={ym => onPick(monthDays(ym, timezone, capToday), ym)} timezone={timezone} label={label}/></div>
}

type Mode = 'month' | 3 | 6 | 12 | 'custom'

export function modeOf(range: MonthRange, timezone: string): Mode {
  const now = currentMonth(timezone)
  if (range.start === range.end) return 'month'
  if (range.end === now) { const n = monthsBetween(range.start, range.end); if (n === 3 || n === 6 || n === 12) return n }
  return 'custom'
}

// Filtro de período em meses: um mês específico, últimos 3/6/12 meses ou um intervalo de meses à escolha.
export function MonthRangeFilter({ value, onChange, timezone, earliest, maxMonths = 36 }: { value: MonthRange; onChange: (range: MonthRange) => void; timezone: string; earliest?: string; maxMonths?: number }) {
  const mode = modeOf(value, timezone)
  const latest = currentMonth(timezone)
  const first = earliest && earliest < latest ? earliest : addMonths(latest, -59)
  const options = monthOptions(latest, first)
  const setCustom = (start: string, end: string) => {
    if (start > end) [start, end] = [end, start]
    if (monthsBetween(start, end) > maxMonths) start = addMonths(end, -(maxMonths - 1))
    onChange({ start, end })
  }
  return <div className="month-range-filter">
    <div className="segmented" role="group" aria-label="Período">
      <button type="button" className={mode === 'month' ? 'selected' : ''} onClick={() => onChange({ start: value.end, end: value.end })}>Mês</button>
      {([3, 6, 12] as const).map(n => <button key={n} type="button" className={mode === n ? 'selected' : ''} onClick={() => onChange(lastMonths(n, timezone))}>{n} meses</button>)}
      <button type="button" className={mode === 'custom' ? 'selected' : ''} onClick={() => mode !== 'custom' && setCustom(value.start === value.end ? addMonths(value.end, -1) : value.start, value.end)}>Personalizado</button>
    </div>
    {mode === 'month' && <MonthPicker value={value.end} onChange={ym => onChange({ start: ym, end: ym })} timezone={timezone} earliest={first}/>}
    {mode === 'custom' && <div className="month-range-custom">
      <label><span>De</span><select value={value.start} onChange={event => setCustom(event.target.value, value.end)}>{options.map(ym => <option key={ym} value={ym}>{monthName(ym)}</option>)}</select></label>
      <label><span>até</span><select value={value.end} onChange={event => setCustom(value.start, event.target.value)}>{options.map(ym => <option key={ym} value={ym}>{monthName(ym)}</option>)}</select></label>
    </div>}
  </div>
}
