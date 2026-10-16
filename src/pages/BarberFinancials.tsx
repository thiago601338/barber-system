import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { BadgePercent, CircleDollarSign, Package, Plus, Receipt, Scissors, ShoppingBag, Trash2, TrendingUp, Users, Wallet } from 'lucide-react'
import type { PageProps } from '../App'
import { requireSupabase } from '../lib/supabase'
import { shopToday } from '../lib/shopTime'
import { cents, date, money, type ModuleKey } from '../types'
import { Field, Loading, Notice } from '../ui'
import { lastMonths, MonthRangeFilter, rangeLabel, type MonthRange } from '../MonthRangeFilter'

interface MonthRow {
  month: string
  completed: number
  clients: number
  revenue_services_cents: number
  revenue_products_cents: number
  estimated_revenue_cents: number
  direct_costs_cents: number
  taxes_fees_cents: number
  commission_cents: number
  barber_expenses_cents: number
  accessories_cents: number
  accessory_items: number
}
interface Financials {
  months: MonthRow[]
  top_services: { name: string; count: number }[]
  clients_unique: number
  settings: { configured: boolean; tax_pct: number | null; fee_pct: number | null; commission_pct: number | null; commission_source: 'entries' | 'settings' | 'none' }
  can_manage_expenses?: boolean
}
interface BarberExpense { id: string; description: string; item_kind: string | null; quantity: number | null; unit_cost_cents: number | null; amount_cents: number; occurred_on: string }

export const expenseKinds: { value: string; label: string }[] = [
  { value: 'accessory', label: 'Acessório' },
  { value: 'uniform', label: 'Uniforme' },
  { value: 'equipment', label: 'Equipamento' },
  { value: 'training', label: 'Curso e treinamento' },
  { value: 'allowance', label: 'Ajuda de custo' },
  { value: 'other', label: 'Outro gasto' },
]
const kindLabel = (kind: string | null) => expenseKinds.find(item => item.value === kind)?.label || 'Outro gasto'
interface Computed extends MonthRow { label: string; longLabel: string; revenue: number; result: number }

// Validated categorical order (dataviz validator, light surface): result, commission, costs, taxes, barber expenses.
const series = [
  { key: 'result', label: 'Resultado da barbearia', color: '#008300' },
  { key: 'commission_cents', label: 'Comissão do barbeiro', color: '#6250d6' },
  { key: 'direct_costs_cents', label: 'Custos diretos', color: '#eb6834' },
  { key: 'taxes_fees_cents', label: 'Impostos e taxas', color: '#2a78d6' },
  { key: 'barber_expenses_cents', label: 'Gastos com o barbeiro', color: '#eda100' },
] as const
type SeriesKey = typeof series[number]['key']

const shortMonth = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 15).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '') }
const longMonth = (ym: string) => { const [y, m] = ym.split('-').map(Number); const text = new Date(y, m - 1, 15).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }); return text.charAt(0).toUpperCase() + text.slice(1) }
const compactMoney = (cents: number) => {
  const reais = cents / 100
  if (Math.abs(reais) >= 1000) return `R$ ${(reais / 1000).toLocaleString('pt-BR', { maximumFractionDigits: reais >= 10000 ? 0 : 1 })} mil`
  return `R$ ${Math.round(reais).toLocaleString('pt-BR')}`
}
const pct = (part: number, whole: number) => whole > 0 ? `${Math.round(part / whole * 100)}%` : '—'

function niceMax(value: number) {
  if (value <= 0) return 1
  const exp = Math.pow(10, Math.floor(Math.log10(value)))
  const f = value / exp
  return ([1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find(step => f <= step) ?? 10) * exp
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(640)
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    setWidth(node.clientWidth)
    const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

// Bar path with rounded top corners only (data-end), square at the baseline side.
function topRounded(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, h, w / 2))
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`
}

export function BarberFinancials({ shopId, timezone, membershipId, firstName, notify, onNavigate }: { shopId: string; timezone: string; membershipId: string; firstName: string; notify: PageProps['notify']; onNavigate?: (page: ModuleKey) => void }) {
  const [range, setRange] = useState<MonthRange>(() => lastMonths(6, timezone))
  const [reload, setReload] = useState(0)
  const [data, setData] = useState<Financials | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'chart' | 'table'>('chart')

  useEffect(() => {
    let alive = true
    setLoading(true); setError(null)
    void requireSupabase().rpc('barber_financials_range', { p_barbershop_id: shopId, p_membership_id: membershipId, p_start: `${range.start}-01`, p_end: `${range.end}-01` }).then(({ data: result, error: rpcError }) => {
      if (!alive) return
      if (rpcError) setError(rpcError.message); else setData(result as Financials)
      setLoading(false)
    })
    return () => { alive = false }
  }, [shopId, membershipId, range.start, range.end, reload])

  const rows: Computed[] = useMemo(() => (data?.months ?? []).map(row => {
    const revenue = row.revenue_services_cents + row.revenue_products_cents
    const spent = row.barber_expenses_cents || 0
    return { ...row, barber_expenses_cents: spent, accessories_cents: row.accessories_cents || 0, accessory_items: row.accessory_items || 0, label: shortMonth(row.month), longLabel: longMonth(row.month), revenue, result: revenue - row.commission_cents - row.direct_costs_cents - row.taxes_fees_cents - spent }
  }), [data])

  const totals = useMemo(() => rows.reduce((acc, row) => ({
    revenue: acc.revenue + row.revenue, services: acc.services + row.revenue_services_cents, products: acc.products + row.revenue_products_cents,
    commission: acc.commission + row.commission_cents, costs: acc.costs + row.direct_costs_cents, taxes: acc.taxes + row.taxes_fees_cents,
    result: acc.result + row.result, completed: acc.completed + row.completed,
    spent: acc.spent + row.barber_expenses_cents, accessories: acc.accessories + row.accessories_cents, accessoryItems: acc.accessoryItems + row.accessory_items,
  }), { revenue: 0, services: 0, products: 0, commission: 0, costs: 0, taxes: 0, result: 0, completed: 0, spent: 0, accessories: 0, accessoryItems: 0 }), [rows])
  const manage = data?.can_manage_expenses === true
  const monthsCount = rows.length || 1

  const best = rows.reduce<Computed | null>((top, row) => !top || row.revenue > top.revenue ? row : top, null)
  const current = rows[rows.length - 1]
  const previous = rows[rows.length - 2]
  const settings = data?.settings
  const noCommission = settings?.commission_source === 'none'
  const noTaxes = !settings?.configured || (!(settings.tax_pct ?? 0) && !(settings.fee_pct ?? 0))
  const noCosts = totals.costs === 0

  return <section className="barber-fin" aria-label={`Rendimentos de ${firstName}`}>
    <div className="barber-fin-head">
      <div><h3>Rendimentos</h3><p>Faturamento gerado por {firstName}, quanto fica com o profissional e quanto sobra para a barbearia.</p></div>
      <MonthRangeFilter value={range} onChange={setRange} timezone={timezone}/>
    </div>
    <Notice text={error}/>
    {loading && !data ? <Loading text="Calculando rendimentos..."/> : data && <>
      <div className="barber-fin-kpis">
        <Kpi icon={<CircleDollarSign size={17}/>} label="Faturamento" value={money(totals.revenue)} foot={totals.products ? `${money(totals.services)} serviços · ${money(totals.products)} produtos` : 'Recebido nos atendimentos'}/>
        <Kpi icon={<Wallet size={17}/>} label="Comissão do barbeiro" value={noCommission ? '—' : money(totals.commission)} foot={noCommission ? 'Comissão não configurada' : `${pct(totals.commission, totals.revenue)} do faturamento`} swatch="#6250d6"/>
        <Kpi icon={<Receipt size={17}/>} label="Custos diretos" value={money(totals.costs)} foot={noCosts ? 'Sem custo cadastrado nos serviços' : `${pct(totals.costs, totals.revenue)} do faturamento`} swatch="#eb6834"/>
        <Kpi icon={<BadgePercent size={17}/>} label="Impostos e taxas" value={money(totals.taxes)} foot={noTaxes ? 'Percentuais não configurados' : `${(settings?.tax_pct ?? 0) + (settings?.fee_pct ?? 0)}% sobre o recebido`} swatch="#2a78d6"/>
        {manage && <Kpi icon={<ShoppingBag size={17}/>} label="Gastos com o barbeiro" value={money(totals.spent)} foot={totals.spent ? `${pct(totals.spent, totals.revenue)} do faturamento` : 'Nenhum gasto lançado'} swatch="#eda100"/>}
        {manage && <Kpi icon={<Package size={17}/>} label="Custo com acessórios" value={money(totals.accessories)} foot={totals.accessoryItems ? `${totals.accessoryItems.toLocaleString('pt-BR')} ${totals.accessoryItems === 1 ? 'item' : 'itens'} · ${money(Math.round(totals.accessories / monthsCount))}/mês` : 'Nenhum acessório lançado'}/>}
        <Kpi icon={<TrendingUp size={17}/>} label="Resultado da barbearia" value={money(totals.result)} foot={`Margem ${pct(totals.result, totals.revenue)}`} swatch="#008300" strong/>
        <Kpi icon={<Scissors size={17}/>} label="Ticket médio" value={totals.completed ? money(Math.round(totals.revenue / totals.completed)) : '—'} foot={`${totals.completed.toLocaleString('pt-BR')} atendimentos`}/>
        <Kpi icon={<Users size={17}/>} label="Clientes atendidos" value={data.clients_unique.toLocaleString('pt-BR')} foot={totals.completed && data.clients_unique ? `${(totals.completed / data.clients_unique).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} visitas por cliente` : 'No período'}/>
        <Kpi icon={<TrendingUp size={17}/>} label="Melhor mês" value={best && best.revenue ? money(best.revenue) : '—'} foot={best && best.revenue ? best.longLabel : 'Sem faturamento no período'}/>
      </div>

      {(noCommission || noTaxes || noCosts) && <div className="barber-fin-setup">
        <span>{[noCommission && 'a comissão', noTaxes && 'os impostos e taxas', noCosts && 'os custos dos serviços'].filter(Boolean).join(', ').replace(/, ([^,]*)$/, ' e $1').replace(/^./, c => c.toUpperCase())} ainda não {[noCommission, noTaxes, noCosts].filter(Boolean).length > 1 ? 'foram configurados' : 'foi configurado'}. Por isso entram como zero e o resultado aparece igual ao faturamento.</span>
        {onNavigate && <button type="button" className="button outline" onClick={() => onNavigate('profit')}>Configurar em Margem de lucro</button>}
      </div>}

      <div className="barber-fin-panel">
        <div className="barber-fin-panel-head">
          <div><strong>Para onde vai o faturamento, mês a mês</strong><small>{rangeLabel(range)} · cada barra é o total recebido no mês, dividido entre comissão, custos, impostos{manage ? ', gastos com o barbeiro' : ''} e o que sobra.</small></div>
          <div className="segmented" role="group" aria-label="Visualização"><button type="button" className={view === 'chart' ? 'selected' : ''} onClick={() => setView('chart')}>Gráfico</button><button type="button" className={view === 'table' ? 'selected' : ''} onClick={() => setView('table')}>Tabela</button></div>
        </div>
        {view === 'chart' ? <>
          <ul className="barber-fin-legend">{series.filter(s => manage || s.key !== 'barber_expenses_cents').map(s => <li key={s.key}><i style={{ background: s.color }}/>{s.label}</li>)}</ul>
          <StackedChart rows={rows}/>
        </> : <MonthTable rows={rows} totals={totals} manage={manage}/>}
      </div>

      {manage && <BarberExpenses shopId={shopId} membershipId={membershipId} firstName={firstName} timezone={timezone} range={range} notify={notify} onChanged={() => setReload(value => value + 1)}/>}

      <div className="barber-fin-split">
        <div className="barber-fin-panel">
          <div className="barber-fin-panel-head"><div><strong>Atendimentos por mês</strong><small>{current ? `${current.completed} em ${current.longLabel.toLowerCase()}${previous ? ` · ${previous.completed} no mês anterior` : ''}` : ''}</small></div></div>
          <CountChart rows={rows}/>
        </div>
        <div className="barber-fin-panel">
          <div className="barber-fin-panel-head"><div><strong>Serviços mais feitos</strong><small>No período selecionado</small></div></div>
          {data.top_services.length ? <ol className="barber-fin-services">{data.top_services.map(service => <li key={service.name}>
            <div><span>{service.name}</span><b>{service.count.toLocaleString('pt-BR')}</b></div>
            <i><em style={{ width: `${Math.max(4, service.count / data.top_services[0].count * 100)}%` }}/></i>
          </li>)}</ol> : <p className="barber-fin-empty">Nenhum atendimento concluído no período.</p>}
        </div>
      </div>
      <p className="barber-fin-note">Faturamento = pagamentos recebidos em atendimentos deste barbeiro (inclui o histórico trazido do Cashbarber). {settings?.commission_source === 'entries' ? 'Comissão = lançamentos de comissão registrados.' : settings?.commission_source === 'settings' ? `Comissão = ${settings.commission_pct}% sobre serviços, conforme Margem de lucro.` : ''}</p>
    </>}
  </section>
}

function Kpi({ icon, label, value, foot, swatch, strong }: { icon: ReactNode; label: string; value: string; foot: string; swatch?: string; strong?: boolean }) {
  return <div className={`barber-fin-kpi ${strong ? 'strong' : ''}`}>
    <span>{swatch ? <i style={{ background: swatch }}/> : icon}{label}</span>
    <b>{value}</b>
    <small>{foot}</small>
  </div>
}

function Tooltip({ x, width, children }: { x: number; width: number; children: ReactNode }) {
  const left = Math.min(Math.max(x, 110), width - 110)
  return <div className="barber-fin-tip" style={{ left }} role="status">{children}</div>
}

function StackedChart({ rows }: { rows: Computed[] }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const height = 250, top = 16, bottom = 28, left = 64, right = 8
  const plotH = height - top - bottom, plotW = Math.max(0, width - left - right)
  const max = niceMax(Math.max(...rows.map(r => r.revenue), 0))
  const ticks = [0, .25, .5, .75, 1].map(f => f * max)
  const step = rows.length ? plotW / rows.length : 0
  const barW = Math.min(46, step * .56)
  const y = (v: number) => top + plotH - v / max * plotH
  const segValue = (row: Computed, key: SeriesKey) => Math.max(0, key === 'result' ? row.result : row[key])
  const hovered = hover == null ? null : rows[hover]

  return <div className="barber-fin-chart" ref={ref} onMouseLeave={() => setHover(null)}>
    <svg width={width} height={height} role="img" aria-label="Faturamento mensal dividido entre resultado, comissão, custos e impostos">
      {ticks.map(t => <g key={t}><line x1={left} x2={width - right} y1={y(t)} y2={y(t)} className={t === 0 ? 'axis' : 'grid'}/><text x={left - 8} y={y(t) + 4} textAnchor="end" className="tick">{compactMoney(t)}</text></g>)}
      {rows.map((row, i) => {
        const cx = left + step * i + step / 2
        let acc = 0
        const parts = series.map(s => ({ s, v: segValue(row, s.key) })).filter(p => p.v > 0)
        return <g key={row.month} className={hover != null && hover !== i ? 'dim' : ''}>
          {parts.map((p, j) => {
            const y0 = y(acc), y1 = y(acc + p.v)
            acc += p.v
            const h = Math.max(0, y0 - y1 - (j > 0 ? 2 : 0))
            return j === parts.length - 1 ? <path key={p.s.key} d={topRounded(cx - barW / 2, y1, barW, h, 4)} fill={p.s.color}/> : <rect key={p.s.key} x={cx - barW / 2} y={y1} width={barW} height={h} fill={p.s.color}/>
          })}
          <text x={cx} y={height - 9} textAnchor="middle" className="tick month">{row.label}</text>
          <rect x={left + step * i} y={top} width={step} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onClick={() => setHover(i)} tabIndex={0} aria-label={`${row.longLabel}: ${money(row.revenue)}`}/>
        </g>
      })}
    </svg>
    {hovered && hover != null && <Tooltip x={left + step * hover + step / 2} width={width}>
      <strong>{hovered.longLabel}</strong>
      <div className="row total"><span>Faturamento</span><b>{money(hovered.revenue)}</b></div>
      {series.filter(s => s.key !== 'barber_expenses_cents' || hovered.barber_expenses_cents > 0).map(s => <div className="row" key={s.key}><span><i style={{ background: s.color }}/>{s.label}</span><b>{money(s.key === 'result' ? hovered.result : hovered[s.key])}</b></div>)}
      <div className="row muted"><span>Atendimentos</span><b>{hovered.completed}</b></div>
    </Tooltip>}
  </div>
}

function CountChart({ rows }: { rows: Computed[] }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const height = 190, top = 14, bottom = 26, left = 34, right = 6
  const plotH = height - top - bottom, plotW = Math.max(0, width - left - right)
  const max = niceMax(Math.max(...rows.map(r => r.completed), 0))
  const step = rows.length ? plotW / rows.length : 0
  const barW = Math.min(34, step * .5)
  const y = (v: number) => top + plotH - v / max * plotH
  const hovered = hover == null ? null : rows[hover]
  return <div className="barber-fin-chart" ref={ref} onMouseLeave={() => setHover(null)}>
    <svg width={width} height={height} role="img" aria-label="Atendimentos concluídos por mês">
      {[0, .5, 1].map(f => <g key={f}><line x1={left} x2={width - right} y1={y(f * max)} y2={y(f * max)} className={f === 0 ? 'axis' : 'grid'}/><text x={left - 7} y={y(f * max) + 4} textAnchor="end" className="tick">{(f * max).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</text></g>)}
      {rows.map((row, i) => { const cx = left + step * i + step / 2; return <g key={row.month} className={hover != null && hover !== i ? 'dim' : ''}>
        {row.completed > 0 && <path d={topRounded(cx - barW / 2, y(row.completed), barW, y(0) - y(row.completed), 4)} fill="#2a78d6"/>}
        <text x={cx} y={height - 8} textAnchor="middle" className="tick month">{row.label}</text>
        <rect x={left + step * i} y={top} width={step} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)}/>
      </g> })}
    </svg>
    {hovered && hover != null && <Tooltip x={left + step * hover + step / 2} width={width}>
      <strong>{hovered.longLabel}</strong>
      <div className="row"><span>Atendimentos</span><b>{hovered.completed}</b></div>
      <div className="row"><span>Clientes diferentes</span><b>{hovered.clients}</b></div>
      <div className="row"><span>Ticket médio</span><b>{hovered.completed ? money(Math.round(hovered.revenue / hovered.completed)) : '—'}</b></div>
    </Tooltip>}
  </div>
}

function MonthTable({ rows, totals, manage }: { rows: Computed[]; totals: { revenue: number; commission: number; costs: number; taxes: number; result: number; completed: number; spent: number; accessories: number }; manage: boolean }) {
  return <div className="table-scroll"><table className="barber-fin-table">
    <thead><tr><th>Mês</th><th>Atend.</th><th>Faturamento</th><th>Comissão</th><th>Custos</th><th>Impostos e taxas</th>{manage && <th>Gastos c/ barbeiro</th>}{manage && <th>Acessórios</th>}<th>Resultado</th></tr></thead>
    <tbody>{[...rows].reverse().map(row => <tr key={row.month}><td>{row.longLabel}</td><td>{row.completed}</td><td>{money(row.revenue)}</td><td>{money(row.commission_cents)}</td><td>{money(row.direct_costs_cents)}</td><td>{money(row.taxes_fees_cents)}</td>{manage && <td>{money(row.barber_expenses_cents)}</td>}{manage && <td>{money(row.accessories_cents)}</td>}<td><b>{money(row.result)}</b></td></tr>)}</tbody>
    <tfoot><tr><td>Total</td><td>{totals.completed}</td><td>{money(totals.revenue)}</td><td>{money(totals.commission)}</td><td>{money(totals.costs)}</td><td>{money(totals.taxes)}</td>{manage && <td>{money(totals.spent)}</td>}{manage && <td>{money(totals.accessories)}</td>}<td><b>{money(totals.result)}</b></td></tr></tfoot>
  </table></div>
}

const emptyForm = (timezone: string) => ({ kind: 'accessory', item: '', quantity: '1', unit: '', occurred_on: shopToday(timezone) })

// Gastos com o barbeiro: cada acessório ou item comprado para ele vira uma despesa da barbearia ligada ao profissional.
function BarberExpenses({ shopId, membershipId, firstName, timezone, range, notify, onChanged }: { shopId: string; membershipId: string; firstName: string; timezone: string; range: MonthRange; notify: PageProps['notify']; onChanged: () => void }) {
  const [rows, setRows] = useState<BarberExpense[]>([])
  const [names, setNames] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(() => emptyForm(timezone))
  const [busy, setBusy] = useState(false)
  const [kindFilter, setKindFilter] = useState('all')

  const endDay = useMemo(() => { const [y, m] = range.end.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) }, [range.end])
  const load = useCallback(async () => {
    setLoading(true); setError(null)
    const client = requireSupabase()
    const [list, history] = await Promise.all([
      client.from('expenses').select('id,description,item_kind,quantity,unit_cost_cents,amount_cents,occurred_on').eq('barbershop_id', shopId).eq('barber_membership_id', membershipId).gte('occurred_on', `${range.start}-01`).lte('occurred_on', endDay).order('occurred_on', { ascending: false }).limit(500),
      client.from('expenses').select('description').eq('barbershop_id', shopId).not('barber_membership_id', 'is', null).eq('item_kind', 'accessory').order('occurred_on', { ascending: false }).limit(300),
    ])
    if (list.error) setError(list.error.message); else setRows((list.data ?? []) as BarberExpense[])
    if (!history.error) setNames([...new Set((history.data ?? []).map(row => String(row.description)))].slice(0, 60))
    setLoading(false)
  }, [shopId, membershipId, range.start, endDay])
  useEffect(() => { void load() }, [load])

  const quantity = Math.max(1, Math.floor(Number(form.quantity) || 1))
  const unitCents = form.unit ? cents(form.unit) : 0
  const totalCents = quantity * unitCents
  const byKind = useMemo(() => expenseKinds.map(kind => {
    const items = rows.filter(row => (row.item_kind || 'other') === kind.value)
    return { ...kind, total: items.reduce((sum, row) => sum + row.amount_cents, 0), count: items.reduce((sum, row) => sum + (row.quantity || 1), 0) }
  }).filter(kind => kind.count > 0), [rows])
  const shown = kindFilter === 'all' ? rows : rows.filter(row => (row.item_kind || 'other') === kindFilter)
  const total = rows.reduce((sum, row) => sum + row.amount_cents, 0)

  async function save(event: FormEvent) {
    event.preventDefault()
    const item = form.item.trim()
    if (!item) { setError('Informe o item ou o gasto.'); return }
    if (!(unitCents > 0)) { setError('Informe o valor.'); return }
    setBusy(true); setError(null)
    const { error: insertError } = await requireSupabase().from('expenses').insert({
      barbershop_id: shopId, barber_membership_id: membershipId, category: 'staff', cost_kind: 'operating',
      description: item.slice(0, 200), item_kind: form.kind, quantity, unit_cost_cents: unitCents, amount_cents: totalCents, occurred_on: form.occurred_on,
    })
    setBusy(false)
    if (insertError) { setError(insertError.message); return }
    notify(`${kindLabel(form.kind)} lançado para ${firstName}.`)
    setForm({ ...emptyForm(timezone), kind: form.kind, occurred_on: form.occurred_on })
    await load(); onChanged()
  }

  async function remove(row: BarberExpense) {
    if (!window.confirm(`Excluir "${row.description}" (${money(row.amount_cents)})?`)) return
    const { error: deleteError } = await requireSupabase().from('expenses').delete().eq('id', row.id).eq('barbershop_id', shopId)
    if (deleteError) { notify(deleteError.message, 'error'); return }
    notify('Gasto excluído.')
    await load(); onChanged()
  }

  return <div className="barber-fin-panel barber-expenses">
    <div className="barber-fin-panel-head">
      <div><strong>Gastos com {firstName}</strong><small>{rangeLabel(range)} · acessórios e outros itens comprados para o barbeiro. Entram no resultado acima e nas despesas da barbearia.</small></div>
      <button type="button" className="button primary" onClick={() => { setOpen(value => !value); setError(null) }}><Plus size={16}/> {open ? 'Fechar' : 'Adicionar gasto'}</button>
    </div>
    {open && <form className="barber-expense-form" onSubmit={save}>
      <Field label="Tipo"><select value={form.kind} onChange={event => setForm({ ...form, kind: event.target.value })}>{expenseKinds.map(kind => <option key={kind.value} value={kind.value}>{kind.label}</option>)}</select></Field>
      <Field label={form.kind === 'accessory' ? 'Acessório' : 'Item ou gasto'}><input required maxLength={200} list="barber-accessory-names" placeholder={form.kind === 'accessory' ? 'Ex.: Tesoura fio navalha 6"' : 'Ex.: Camiseta da barbearia'} value={form.item} onChange={event => setForm({ ...form, item: event.target.value })}/></Field>
      <Field label="Quantidade"><input type="number" min="1" max="10000" step="1" required value={form.quantity} onChange={event => setForm({ ...form, quantity: event.target.value })}/></Field>
      <Field label="Valor unitário (R$)"><input type="number" min="0.01" step="0.01" required value={form.unit} onChange={event => setForm({ ...form, unit: event.target.value })}/></Field>
      <Field label="Data da compra"><input type="date" required max={shopToday(timezone)} value={form.occurred_on} onChange={event => setForm({ ...form, occurred_on: event.target.value })}/></Field>
      <div className="barber-expense-total"><span>Total</span><b>{money(totalCents)}</b></div>
      <div className="barber-expense-actions"><button type="submit" className="button primary" disabled={busy}>{busy ? 'Salvando...' : 'Salvar gasto'}</button></div>
      <datalist id="barber-accessory-names">{names.map(name => <option key={name} value={name}/>)}</datalist>
    </form>}
    <Notice text={error}/>
    {byKind.length > 0 && <div className="barber-expense-kinds" role="group" aria-label="Filtrar por tipo">
      <button type="button" className={kindFilter === 'all' ? 'on' : ''} onClick={() => setKindFilter('all')}><span>Todos</span><b>{money(total)}</b></button>
      {byKind.map(kind => <button type="button" key={kind.value} className={kindFilter === kind.value ? 'on' : ''} onClick={() => setKindFilter(kind.value)}><span>{kind.label}</span><b>{money(kind.total)}</b><small>{kind.count} {kind.count === 1 ? 'item' : 'itens'}</small></button>)}
    </div>}
    {loading ? <Loading text="Carregando gastos..."/> : shown.length === 0 ? <p className="barber-fin-empty">Nenhum gasto lançado para {firstName} neste período.</p> :
      <div className="table-scroll"><table className="barber-fin-table barber-expense-table">
        <thead><tr><th>Data</th><th>Item</th><th>Tipo</th><th>Qtd.</th><th>Valor unit.</th><th>Total</th><th aria-label="Ações"/></tr></thead>
        <tbody>{shown.map(row => <tr key={row.id}><td>{date(row.occurred_on)}</td><td className="item">{row.description}</td><td>{kindLabel(row.item_kind)}</td><td>{row.quantity || 1}</td><td>{money(row.unit_cost_cents ?? row.amount_cents)}</td><td><b>{money(row.amount_cents)}</b></td><td><button type="button" className="icon-button" aria-label={`Excluir ${row.description}`} title="Excluir" onClick={() => void remove(row)}><Trash2 size={15}/></button></td></tr>)}</tbody>
      </table></div>}
  </div>
}
