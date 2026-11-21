import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { CalendarClock, Check, Clock3, Phone, Scissors, ShieldCheck, UserRound, Zap } from 'lucide-react'
import type { PageProps } from '../App'
import { requireSupabase } from '../lib/supabase'
import { cashMethods } from '../lib/operations'
import { shopDateTime } from '../lib/shopTime'
import { cents, money, type Row } from '../types'
import { Empty, Field, Loading, Notice, PageHeader, Panel, PrimaryButton } from '../ui'
import '../styles-quick.css'

interface Recent { id: string; starts_at: string; status?: string; total_price_cents: number; client_name: string; phone: string | null; barber_name: string; services: string | null; paid: boolean; plan_name?: string | null }
interface QuickPlan { id: string; plan_name: string; uncovered_price_cents?: number; covers_all?: boolean }

const digitsOf = (value: string) => value.replace(/\D/g, '')
function localDigits(value: string) { const d = digitsOf(value); return d.startsWith('55') && (d.length === 12 || d.length === 13) ? d.slice(2) : d }
function formatPhone(value: string) {
  const d = localDigits(value).slice(0, 11)
  if (d.length <= 2) return d.length ? `(${d}` : ''
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}
const emptyForm = { name: '', phone: '', barber: '', services: [] as string[], total: '', when: 'now', at: '', method: '', notes: '' }

// Cadastro rápido: atendimento feito (agora ou antes) ou agendamento em dia/horário futuro, sem barrar por bloqueio de agenda.
// Cliente com plano ativo: o plano cobre os serviços dele e o resto é cobrado.
export function QuickServicePage({ identity, role, notify }: PageProps) {
  const shop = identity.shop!
  const timezone = shop.timezone || 'America/Sao_Paulo'
  const admin = role === 'admin' || role === 'master'
  const ownMember = identity.membership?.role === 'barber' ? identity.membership.id : null
  const [services, setServices] = useState<Row[]>([])
  const [barbers, setBarbers] = useState<Row[]>([])
  const [recent, setRecent] = useState<Recent[]>([])
  const [cashOpen, setCashOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ ...emptyForm, barber: ownMember || '' })
  const [totalEdited, setTotalEdited] = useState(false)
  const [found, setFound] = useState<{ id: string; full_name: string } | null>(null)
  const [plan, setPlan] = useState<QuickPlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadRecent = useCallback(async () => {
    const { data } = await requireSupabase().rpc('quick_service_recent', { p_shop: shop.id, p_limit: 15 })
    setRecent((data ?? []) as Recent[])
  }, [shop.id])

  useEffect(() => {
    let alive = true
    const client = requireSupabase()
    void Promise.all([
      client.from('services').select('id,name,price_cents,duration_minutes').eq('barbershop_id', shop.id).eq('active', true).order('name'),
      client.from('memberships').select('id,display_name,role,active').eq('barbershop_id', shop.id).eq('role', 'barber').eq('active', true).order('display_name'),
      admin ? client.from('cash_sessions').select('id').eq('barbershop_id', shop.id).is('closed_at', null).limit(1) : Promise.resolve({ data: [] }),
      loadRecent(),
    ]).then(([serviceRows, barberRows, cash]) => {
      if (!alive) return
      setServices((serviceRows.data ?? []) as Row[])
      setBarbers((barberRows.data ?? []) as Row[])
      setCashOpen(Boolean((cash as { data: unknown[] | null }).data?.length))
      setLoading(false)
    })
    return () => { alive = false }
  }, [shop.id, admin, loadRecent])

  const selected = useMemo(() => services.filter(service => form.services.includes(String(service.id))), [services, form.services])
  const listed = selected.reduce((sum, service) => sum + Number(service.price_cents || 0), 0)
  const suggested = plan ? Number(plan.uncovered_price_cents || 0) : listed
  const atMs = form.when === 'other' && form.at ? new Date(form.at).getTime() : NaN
  const isFuture = Number.isFinite(atMs) && atMs > Date.now() + 10 * 60000
  const duration = selected.reduce((sum, service) => sum + Number(service.duration_minutes || 0), 0)
  useEffect(() => { if (!totalEdited) setForm(current => ({ ...current, total: selected.length ? (suggested / 100).toFixed(2) : '' })) }, [suggested, totalEdited, selected.length])

  // Procura o cliente pelo número enquanto digita.
  const phoneDigits = localDigits(form.phone)
  useEffect(() => {
    setFound(null)
    if (phoneDigits.length < 10) return
    let alive = true
    const formatted = formatPhone(phoneDigits)
    void requireSupabase().from('clients').select('id,full_name,phone').eq('barbershop_id', shop.id)
      .or(`phone.eq.${phoneDigits},phone.eq.55${phoneDigits},phone.eq."${formatted}",phone.eq."+55 ${formatted}"`).limit(1)
      .then(({ data }) => { if (alive && data?.[0]) setFound({ id: String(data[0].id), full_name: String(data[0].full_name) }) })
    return () => { alive = false }
  }, [phoneDigits, shop.id])

  // Plano ativo do cliente: confere a cobertura dos serviços escolhidos no horário do atendimento.
  const serviceKey = form.services.join(',')
  const whenKey = form.when === 'other' ? form.at : 'now'
  useEffect(() => {
    setPlan(null)
    if (!found || !serviceKey || (form.when === 'other' && !form.at)) return
    let alive = true
    const startsAt = form.when === 'other' && form.at ? new Date(form.at).toISOString() : new Date().toISOString()
    void Promise.resolve(requireSupabase().rpc('booking_subscription_eligibility', { p_barbershop_id: shop.id, p_client_id: found.id, p_service_ids: serviceKey.split(','), p_starts_at: startsAt }))
      .then(({ data }) => {
        const list = ((data as { subscriptions?: QuickPlan[] } | null)?.subscriptions ?? [])
        if (alive) setPlan(list.find(item => item.covers_all !== false) || list[0] || null)
      }).catch(() => { if (alive) setPlan(null) })
    return () => { alive = false }
  }, [found, serviceKey, whenKey, shop.id]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggleService(id: string) {
    setForm(current => ({ ...current, services: current.services.includes(id) ? current.services.filter(item => item !== id) : [...current.services, id] }))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (form.name.trim().length < 2 && !found) { setError('Informe o nome do cliente.'); return }
    if (phoneDigits.length < 10 || phoneDigits.length > 11) { setError('Informe o número do cliente com DDD.'); return }
    if (!form.barber) { setError('Escolha o profissional.'); return }
    if (!form.services.length) { setError('Escolha pelo menos um serviço.'); return }
    const typed = form.total.trim() ? cents(form.total) : suggested
    // Valor não editado vai vazio: o sistema aplica o plano do cliente na hora de salvar.
    const total = totalEdited ? typed : null
    if (total !== null && (!Number.isFinite(total) || total < 0)) { setError('Informe um valor válido.'); return }
    let startsAt: string | null = null
    if (form.when === 'other') {
      if (!form.at) { setError('Informe o dia e o horário.'); return }
      startsAt = new Date(form.at).toISOString()
    }
    setBusy(true)
    const { data, error: rpcError } = await requireSupabase().rpc('quick_service_entry', {
      p_shop: shop.id, p_client_name: (form.name.trim() || found?.full_name || ''), p_phone: phoneDigits, p_barber: form.barber,
      p_service_ids: form.services, p_starts_at: startsAt, p_total_cents: total, p_method: admin && form.method && !isFuture ? form.method : null,
      p_request: crypto.randomUUID(), p_notes: form.notes.trim() || null,
    })
    setBusy(false)
    if (rpcError) { setError(rpcError.message); return }
    const result = data as { client_name: string; client_created: boolean; total_cents: number; paid: boolean; scheduled?: boolean; starts_at?: string; overlap?: boolean; plan_name?: string | null }
    const value = result.plan_name ? (result.total_cents > 0 ? `plano ${result.plan_name} + ${money(result.total_cents)}` : `coberto pelo plano ${result.plan_name}`) : money(result.total_cents)
    notify(result.scheduled
      ? `Agendado: ${result.client_name} em ${shopDateTime(String(result.starts_at), timezone)} (${value}).${result.overlap ? ' Atenção: o profissional já tinha atendimento nesse horário.' : ''}${result.client_created ? ' Cliente cadastrado.' : ''}`
      : `Atendimento de ${result.client_name} registrado (${value})${result.paid ? ' e recebido' : ''}.${result.client_created ? ' Cliente cadastrado.' : ''}`)
    setForm({ ...emptyForm, barber: ownMember || form.barber, method: form.method })
    setTotalEdited(false); setFound(null); setPlan(null)
    await loadRecent()
  }

  if (loading) return <Loading text="Preparando o cadastro rápido..."/>
  return <div className="page-stack quick-page">
    <PageHeader eyebrow="ATENDIMENTO" title="Cadastro rápido" description="Registre um serviço feito ou agende um horário em poucos segundos. Nome e número do cliente são obrigatórios; se o número já existir, usamos o cadastro dele. Cliente com plano ativo tem os serviços do plano cobertos."/>
    <div className="quick-layout">
      <Panel title="Novo atendimento" subtitle="Agora ou horário passado entra como concluído. Dia ou horário futuro vira agendamento na agenda, sem bloqueio.">
        <form className="form-grid quick-form" onSubmit={submit}>
          <div className="form-row">
            <Field label="Número do cliente (WhatsApp)"><div className="quick-input"><Phone size={16}/><input required inputMode="tel" autoComplete="off" placeholder="(82) 99999-9999" value={form.phone} onChange={event => setForm({ ...form, phone: formatPhone(event.target.value) })}/></div></Field>
            <Field label="Nome do cliente"><div className="quick-input"><UserRound size={16}/><input required={!found} maxLength={160} autoComplete="off" placeholder={found ? found.full_name : 'Nome e sobrenome'} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })}/></div></Field>
          </div>
          {found && <p className="quick-found"><Check size={15}/> Cliente já cadastrado: <strong>{found.full_name}</strong>. O atendimento vai para o histórico dele.</p>}
          {found && plan && <p className="quick-found"><ShieldCheck size={15}/> Plano ativo: <strong>{plan.plan_name}</strong>. {plan.covers_all === false ? `Cobre parte dos serviços; a cobrar ${money(plan.uncovered_price_cents || 0)}.` : 'Serviços cobertos pelo plano.'}</p>}
          {admin ? <Field label="Profissional"><select required value={form.barber} onChange={event => setForm({ ...form, barber: event.target.value })}><option value="">Escolha quem atendeu</option>{barbers.map(barber => <option key={String(barber.id)} value={String(barber.id)}>{String(barber.display_name)}</option>)}</select></Field>
            : <p className="quick-found muted"><Scissors size={15}/> O atendimento fica no seu nome.</p>}
          <div className="field"><span>Serviços</span>
            {services.length ? <div className="quick-services">{services.map(service => { const on = form.services.includes(String(service.id)); return <button type="button" key={String(service.id)} className={on ? 'on' : ''} aria-pressed={on} onClick={() => toggleService(String(service.id))}><strong>{String(service.name)}</strong><small>{money(service.price_cents)} · {String(service.duration_minutes)} min</small></button> })}</div>
              : <Empty title="Nenhum serviço ativo" text="Cadastre os serviços em Serviços e horários."/>}
          </div>
          <div className="form-row">
            <Field label="Valor cobrado (R$)" hint={selected.length ? (plan ? `Plano ${plan.plan_name} cobre ${plan.covers_all === false ? 'parte' : 'tudo'} · tabela ${money(listed)} · ${duration} min` : `Tabela: ${money(listed)} · ${duration} min`) : undefined}><input type="number" min="0" step="0.01" inputMode="decimal" value={form.total} onChange={event => { setTotalEdited(true); setForm({ ...form, total: event.target.value }) }}/></Field>
            <Field label="Quando"><select value={form.when} onChange={event => setForm({ ...form, when: event.target.value })}><option value="now">Agora</option><option value="other">Outro dia ou horário (passado ou futuro)</option></select></Field>
          </div>
          {form.when === 'other' && <Field label="Data e hora" hint={isFuture ? 'Horário futuro: vira agendamento na agenda do profissional.' : 'Horário passado: entra como atendimento concluído.'}><input type="datetime-local" required value={form.at} onChange={event => setForm({ ...form, at: event.target.value })}/></Field>}
          {admin && <Field label="Recebimento" hint={isFuture ? 'Agendamento: o pagamento fica para o dia do atendimento.' : cashOpen ? 'Lança o pagamento no caixa aberto.' : 'O caixa está fechado: o atendimento fica para receber no Caixa.'}><select value={cashOpen && !isFuture ? form.method : ''} disabled={!cashOpen || isFuture} onChange={event => setForm({ ...form, method: event.target.value })}><option value="">Receber depois</option>{Object.entries(cashMethods).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>}
          <Field label="Observação (opcional)"><input maxLength={300} value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })}/></Field>
          <Notice text={error}/>
          <div className="form-actions"><PrimaryButton type="submit" disabled={busy}><Zap size={16}/> {busy ? 'Salvando...' : isFuture ? 'Agendar' : 'Registrar atendimento'}</PrimaryButton></div>
        </form>
      </Panel>
      <Panel title="Últimos cadastros rápidos" subtitle="Atendimentos e agendamentos feitos por esta aba">
        {recent.length ? <ul className="quick-recent">{recent.map(row => <li key={row.id}>
          <div><strong>{row.client_name}</strong><small>{row.phone || 'Sem número'} · {row.barber_name}</small><small>{row.services || 'Serviço'}</small></div>
          <div><b>{money(row.total_price_cents)}</b><small><Clock3 size={12}/> {shopDateTime(row.starts_at, timezone)}</small>{row.status === 'confirmed' || row.status === 'pending' ? <span className="status"><CalendarClock size={12}/> Agendado</span> : row.plan_name && row.total_price_cents === 0 ? <span className="status good">Plano</span> : <span className={`status ${row.paid ? 'good' : 'warn'}`}>{row.paid ? 'Recebido' : 'A receber'}</span>}</div>
        </li>)}</ul> : <p className="muted">Nenhum atendimento registrado por aqui ainda.</p>}
      </Panel>
    </div>
  </div>
}
