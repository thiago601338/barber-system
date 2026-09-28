import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ChevronLeft, ChevronRight, Clock3, LockKeyhole, Scissors } from 'lucide-react'
import type { PageProps } from '../App'
import { createRow, updateRow, useRows } from '../lib/useRows'
import { requireSupabase } from '../lib/supabase'
import { shiftCalendarDay, shopClock, shopDateTime, shopDayStartUtc, shopToday } from '../lib/shopTime'
import { asText, cents, money, today, type Row } from '../types'
import { AddButton, DataTable, Empty, Field, Loading, Modal, Notice, PageHeader, Panel, PrimaryButton, Status } from '../ui'

const weekdays = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado']
function localDay(value: string) { return new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`)) }

export function AppointmentsPage({ identity, role, notify }: PageProps) {
  const shopId = identity.shop?.id ?? null
  const timezone = identity.shop?.timezone || 'America/Sao_Paulo'
  const [day, setDay] = useState(() => shopToday(timezone))
  const [appointments, setAppointments] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [booking, setBooking] = useState(false)
  const [selected, setSelected] = useState<Row | null>(null)
  const members = useRows('memberships', shopId)
  const clients = useRows('clients', shopId)
  const services = useRows('services', shopId)
  const subscriptions = useRows('subscriptions', shopId)
  const appointmentServices = useRows('appointment_services', shopId, true, null)
  const barbers = members.rows.filter(row => row.role === 'barber' && row.active)
  useEffect(() => { setDay(shopToday(timezone)) }, [shopId, timezone])
  async function refresh() {
    if (!shopId) return
    setLoading(true); setError(null)
    const from = shopDayStartUtc(day, timezone)
    const until = shopDayStartUtc(shiftCalendarDay(day, 1), timezone)
    const { data, error } = await requireSupabase().from('appointments').select('*').eq('barbershop_id', shopId).gte('starts_at', from).lt('starts_at', until).order('starts_at').limit(1000)
    if (error) setError(error.message)
    else setAppointments((data ?? []) as Row[])
    setLoading(false)
  }
  useEffect(() => { void refresh() }, [shopId, day, timezone])
  const slots = useMemo(() => [...new Set([
    ...Array.from({ length: 73 }, (_, i) => { const minutes = 8 * 60 + i * 10; return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}` }),
    ...appointments.map(item => shopClock(item.starts_at, timezone)),
  ])].sort(), [appointments, timezone])
  const appointmentsBySlot = useMemo(() => {
    const grouped = new Map<string, Row[]>()
    for (const appointment of appointments) {
      const key = `${String(appointment.barber_membership_id)}|${shopClock(appointment.starts_at, timezone)}`
      grouped.set(key, [...(grouped.get(key) || []), appointment])
    }
    return grouped
  }, [appointments, timezone])
  const serviceName = (id: unknown) => asText(services.rows.find(s => s.id === id)?.name)
  async function changeStatus(value: string) {
    if (!selected) return
    try { await updateRow('appointments', selected.id, { status: value }); notify('Agendamento atualizado.'); setSelected(null); await refresh() }
    catch (err) { notify(err instanceof Error ? err.message : 'Falha ao atualizar.', 'error') }
  }
  return <div className="page-stack"><PageHeader eyebrow="AGENDA DA EQUIPE" title="Agendamentos" description="Visão por profissional com intervalos de 10 minutos e horários disponíveis conferidos no banco." action={<AddButton onClick={() => setBooking(true)}>Novo agendamento</AddButton>}/><div className="calendar-toolbar"><div className="date-nav"><button className="icon-button" aria-label="Dia anterior" onClick={() => setDay(shiftCalendarDay(day,-1))}><ChevronLeft size={19}/></button><strong>{localDay(day)}</strong><button className="icon-button" aria-label="Próximo dia" onClick={() => setDay(shiftCalendarDay(day,1))}><ChevronRight size={19}/></button></div><input type="date" value={day} onChange={e => setDay(e.target.value)}/><button className="button outline" onClick={() => setDay(shopToday(timezone))}>Hoje</button></div><Notice text={error || members.error || services.error || clients.error}/>{loading ? <Loading/> : barbers.length ? <div className="calendar-shell"><div className="calendar-grid" style={{ gridTemplateColumns: `72px repeat(${barbers.length}, minmax(190px, 1fr))` }}><div className="calendar-time header">HORA</div>{barbers.map(barber => <div className="calendar-barber" key={barber.id}><div className="member-avatar">{String(barber.display_name || 'B').charAt(0)}</div><strong>{asText(barber.display_name)}</strong></div>)}{slots.map(time => <div className="calendar-row-fragment" key={time}><div className="calendar-time">{time}</div>{barbers.map(barber => { const match = appointmentsBySlot.get(`${String(barber.id)}|${time}`) || []; return <div className="calendar-cell" key={`${barber.id}-${time}`} onClick={() => setBooking(true)}>{match.map(a => { const minutes = Math.max(10, Math.round((new Date(String(a.ends_at)).getTime() - new Date(String(a.starts_at)).getTime())/60000)); const serviceIds = appointmentServices.rows.filter(item => item.appointment_id === a.id).map(item => item.service_id); const client = clients.rows.find(item => item.id === a.client_id); return <button key={a.id} className={`appointment-block ${a.status === 'cancelled' ? 'cancelled' : ''}`} style={{ height: `${Math.max(31, minutes / 10 * 32 - 3)}px` }} onClick={e => { e.stopPropagation(); setSelected(a) }}><strong>{asText(client?.full_name)}</strong><small>{serviceIds.map(serviceName).join(', ') || 'Procedimento'}</small><span>{time} · {money(a.total_price_cents)}</span></button> })}</div> })}</div>)}</div></div> : <Panel><Empty title="Nenhum barbeiro ativo" text="Cadastre profissionais para organizar a agenda por pessoa."/></Panel>}{booking && <BookingModal shopId={shopId!} timezone={timezone} initialDay={day} barbers={barbers} clients={clients.rows} services={services.rows.filter(row => row.active)} subscriptions={subscriptions.rows} onClose={() => setBooking(false)} onSaved={async () => { setBooking(false); notify('Agendamento registrado.'); await refresh() }}/>} {selected && <Modal title="Detalhes do agendamento" onClose={() => setSelected(null)}><div className="detail-list"><div><span>Cliente</span><strong>{asText(clients.rows.find(c => c.id === selected.client_id)?.full_name)}</strong></div><div><span>Profissional</span><strong>{asText(barbers.find(b => b.id === selected.barber_membership_id)?.display_name)}</strong></div><div><span>Início</span><strong>{shopDateTime(selected.starts_at, timezone)}</strong></div><div><span>Total</span><strong>{money(selected.total_price_cents)}</strong></div><div><span>Status</span><Status value={selected.status}/></div></div>{role !== 'barber' && <div className="form-actions status-actions"><button className="button outline" onClick={() => void changeStatus('completed')}>Concluir</button><button className="button danger-text" onClick={() => void changeStatus('cancelled')}>Cancelar</button></div>}</Modal>}</div>
}

export function BookingModal({ shopId, timezone, initialDay, barbers, clients, services, subscriptions, onClose, onSaved }: { shopId: string; timezone: string; initialDay: string; barbers: Row[]; clients: Row[]; services: Row[]; subscriptions: Row[]; onClose: () => void; onSaved: () => void }) {
  const [clientId, setClientId] = useState('')
  const [barberId, setBarberId] = useState('')
  const [serviceIds, setServiceIds] = useState<string[]>([])
  const [day, setDay] = useState(initialDay)
  const [slot, setSlot] = useState('')
  const [subscriptionId, setSubscriptionId] = useState('')
  const [available, setAvailable] = useState<{ starts_at: string; ends_at: string }[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!barberId || !serviceIds.length || !day) { setAvailable([]); setSlot(''); return }
    let cancelled = false
    async function load() {
      setLoadingSlots(true); setError(null); setSlot('')
      const { data, error } = await requireSupabase().rpc('available_slots', { p_barbershop_id: shopId, p_barber_membership_id: barberId, p_service_ids: serviceIds, p_day: day })
      if (cancelled) return
      if (error) { setError(error.message); setAvailable([]) }
      else setAvailable((data ?? []) as { starts_at: string; ends_at: string }[])
      setLoadingSlots(false)
    }
    void load()
    return () => { cancelled = true }
  }, [shopId, barberId, serviceIds.join(','), day])
  const selectedTotal = services.filter(s => serviceIds.includes(s.id)).reduce((sum,s) => sum + Number(s.price_cents || 0), 0)
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null)
    try {
      const { error } = await requireSupabase().rpc('book_appointment', { p_barbershop_id: shopId, p_client_id: clientId, p_barber_membership_id: barberId, p_service_ids: serviceIds, p_starts_at: slot, p_subscription_id: subscriptionId || null })
      if (error) throw error
      onSaved()
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível agendar.') }
    finally { setBusy(false) }
  }
  return <Modal title="Novo agendamento" subtitle="Os horários são calculados conforme disponibilidade e conflitos." onClose={onClose} wide><form className="form-grid" onSubmit={submit}><div className="form-row"><Field label="Cliente"><select required value={clientId} onChange={e => setClientId(e.target.value)}><option value="">Selecione</option>{clients.map(row => <option key={row.id} value={row.id}>{asText(row.full_name)}</option>)}</select></Field><Field label="Profissional"><select required value={barberId} onChange={e => setBarberId(e.target.value)}><option value="">Selecione</option>{barbers.map(row => <option key={row.id} value={row.id}>{asText(row.display_name)}</option>)}</select></Field></div><Field label="Procedimentos"><div className="choice-grid">{services.length ? services.map(row => <label className={`choice-card ${serviceIds.includes(row.id) ? 'selected' : ''}`} key={row.id}><input type="checkbox" checked={serviceIds.includes(row.id)} onChange={e => setServiceIds(e.target.checked ? [...serviceIds,row.id] : serviceIds.filter(id => id !== row.id))}/><span><strong>{asText(row.name)}</strong><small>{String(row.duration_minutes)} min · {money(row.price_cents)}</small></span></label>) : <p className="muted">Cadastre serviços ativos antes de agendar.</p>}</div></Field><div className="form-row"><Field label="Data"><input type="date" min={shopToday(timezone)} required value={day} onChange={e => setDay(e.target.value)}/></Field><Field label="Assinatura do cliente (opcional)"><select value={subscriptionId} onChange={e => setSubscriptionId(e.target.value)}><option value="">Sem assinatura</option>{subscriptions.filter(row => row.client_id === clientId && row.status === 'active').map(row => <option key={row.id} value={row.id}>{asText(row.plan_id)}</option>)}</select></Field></div><Field label="Horário disponível"><div className="slot-grid">{loadingSlots ? <Loading text="Buscando horários..."/> : available.length ? available.map(item => <button type="button" key={item.starts_at} className={`slot ${slot === item.starts_at ? 'selected' : ''}`} onClick={() => setSlot(item.starts_at)}>{shopClock(item.starts_at, timezone)}</button>) : <span className="muted">{barberId && serviceIds.length ? 'Nenhum horário livre nesta data.' : 'Escolha profissional, serviço e data.'}</span>}</div></Field><div className="booking-total"><span>Total dos procedimentos</span><strong>{money(selectedTotal)}</strong></div><Notice text={error}/><div className="form-actions"><button className="button ghost" type="button" onClick={onClose}>Cancelar</button><PrimaryButton type="submit" disabled={busy || !clientId || !barberId || !serviceIds.length || !slot}>{busy ? 'Agendando...' : 'Confirmar agendamento'}</PrimaryButton></div></form></Modal>
}

export function ServicesPage({ identity, role, notify }: PageProps) {
  const shopId = identity.shop?.id ?? null
  const services = useRows('services', shopId)
  const [costMap, setCostMap] = useState<Record<string,number>>({})
  const [costError, setCostError] = useState<string | null>(null)
  useEffect(() => {
    if (!shopId || role === 'barber') return
    let cancelled = false
    void requireSupabase().rpc('service_costs', { p_barbershop_id: shopId }).then(({ data, error }) => {
      if (cancelled) return
      if (error) setCostError(error.message)
      else setCostMap(Object.fromEntries(((data ?? []) as { service_id: string; cost_cents: number }[]).map(item => [item.service_id,item.cost_cents])))
    })
    return () => { cancelled = true }
  }, [shopId, role])
  const rules = useRows('availability_rules', shopId)
  const exceptions = useRows('availability_exceptions', shopId)
  const members = useRows('memberships', shopId)
  const [editor, setEditor] = useState<Row | 'new' | null>(null)
  const [ruleModal, setRuleModal] = useState(false)
  const [ruleEditorId, setRuleEditorId] = useState<string | null>(null)
  const [exceptionModal, setExceptionModal] = useState(false)
  const [exceptionEditorId, setExceptionEditorId] = useState<string | null>(null)
  const [exception, setException] = useState({ barber_membership_id: '', day: today(), unavailable: true, start_time: '09:00', end_time: '18:00' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', duration_minutes: '30', price: '', cost: '', active: true })
  const [rule, setRule] = useState({ barber_membership_id: '', weekday: '1', start_time: '09:00', end_time: '18:00' })
  const barbers = members.rows.filter(row => row.role === 'barber' && row.active && (role !== 'barber' || row.id === identity.membership?.id))
  function openRule(row?: Row) { setRuleEditorId(row?.id ?? null); setRule(row ? { barber_membership_id: String(row.barber_membership_id), weekday: String(row.weekday), start_time: String(row.start_time).slice(0,5), end_time: String(row.end_time).slice(0,5) } : { barber_membership_id: role === 'barber' ? identity.membership?.id || '' : '', weekday: '1', start_time: '09:00', end_time: '18:00' }); setRuleModal(true) }
  function openException(row?: Row) { setExceptionEditorId(row?.id ?? null); setException(row ? { barber_membership_id: String(row.barber_membership_id), day: String(row.day), unavailable: Boolean(row.unavailable), start_time: String(row.start_time || '09:00').slice(0,5), end_time: String(row.end_time || '18:00').slice(0,5) } : { barber_membership_id: role === 'barber' ? identity.membership?.id || '' : '', day: today(), unavailable: true, start_time: '09:00', end_time: '18:00' }); setExceptionModal(true) }
  function openEditor(row?: Row) { if (role === 'barber') return; setEditor(row || 'new'); setError(null); setForm(row ? { name: String(row.name || ''), description: String(row.description || ''), duration_minutes: String(row.duration_minutes || 30), price: String(Number(row.price_cents || 0)/100), cost: String(Number(costMap[row.id] || 0)/100), active: Boolean(row.active) } : { name: '', description: '', duration_minutes: '30', price: '', cost: '', active: true }) }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!editor || !shopId) return
    setBusy(true); setError(null)
    try { const values = { name: form.name.trim(), description: form.description.trim() || null, duration_minutes: Number(form.duration_minutes), price_cents: cents(form.price), cost_cents: cents(form.cost || '0'), active: form.active }; if (editor === 'new') await createRow('services', { ...values, barbershop_id: shopId }); else await updateRow('services', editor.id, values); notify('Serviço salvo.'); setEditor(null); await services.refresh(); const costs = await requireSupabase().rpc('service_costs', { p_barbershop_id: shopId }); if (!costs.error) setCostMap(Object.fromEntries(((costs.data ?? []) as { service_id: string; cost_cents: number }[]).map(item => [item.service_id,item.cost_cents]))) }
    catch (err) { setError(err instanceof Error ? err.message : 'Falha ao salvar serviço.') }
    finally { setBusy(false) }
  }
  async function saveRule(event: FormEvent) {
    event.preventDefault(); if (!shopId) return
    setBusy(true); setError(null)
    try { const values = { barber_membership_id: role === 'barber' ? identity.membership?.id : rule.barber_membership_id, weekday: Number(rule.weekday), start_time: rule.start_time, end_time: rule.end_time, active: true }; if (ruleEditorId) await updateRow('availability_rules', ruleEditorId, values); else await createRow('availability_rules', { barbershop_id: shopId, ...values }); notify('Disponibilidade salva.'); setRuleModal(false); await rules.refresh() }
    catch (err) { setError(err instanceof Error ? err.message : 'Falha ao salvar disponibilidade.') }
    finally { setBusy(false) }
  }
  async function saveException(event: FormEvent) {
    event.preventDefault(); if (!shopId) return
    setBusy(true); setError(null)
    try { const values = { barber_membership_id: role === 'barber' ? identity.membership?.id : exception.barber_membership_id, day: exception.day, unavailable: exception.unavailable, start_time: exception.unavailable ? null : exception.start_time, end_time: exception.unavailable ? null : exception.end_time }; if (exceptionEditorId) await updateRow('availability_exceptions', exceptionEditorId, values); else await createRow('availability_exceptions', { barbershop_id: shopId, ...values }); notify('Exceção de horário salva.'); setExceptionModal(false); await exceptions.refresh() }
    catch (err) { setError(err instanceof Error ? err.message : 'Falha ao salvar folga ou horário especial.') }
    finally { setBusy(false) }
  }
  return <div className="page-stack"><PageHeader eyebrow="CATÁLOGO E EQUIPE" title="Serviços e horários" description="Defina preços, duração e janelas de atendimento por profissional." action={role === 'barber' ? undefined : <AddButton onClick={() => openEditor()}>Novo serviço</AddButton>}/><Notice text={services.error || rules.error || exceptions.error || costError}/><Panel title="Serviços cadastrados" subtitle="Disponíveis no agendamento e na mini bio">{services.loading ? <Loading/> : <DataTable rows={services.rows} empty="Nenhum serviço cadastrado" onRowClick={role === 'barber' ? undefined : openEditor} columns={[{ key: 'name', label: 'Serviço', render: row => <div className="person-cell"><div className="service-icon"><Scissors size={17}/></div><div><strong>{asText(row.name)}</strong><small>{asText(row.description)}</small></div></div> }, { key: 'duration_minutes', label: 'Duração', render: row => `${String(row.duration_minutes)} min` }, { key: 'price_cents', label: 'Preço', render: row => money(row.price_cents) }, { key: 'cost_cents', label: 'Custo', render: row => role === 'barber' ? '—' : costMap[row.id] == null ? '—' : money(costMap[row.id]) }, { key: 'active', label: 'Status', render: row => <Status value={row.active ? 'active' : 'paused'}/> }]} />}</Panel><Panel title="Disponibilidade da equipe" subtitle="Regras semanais utilizadas para calcular horários livres" action={<AddButton onClick={() => openRule()}>Adicionar horário</AddButton>}><DataTable rows={rules.rows} empty="Nenhum horário configurado" onRowClick={openRule} columns={[{ key: 'barber_membership_id', label: 'Profissional', render: row => asText(barbers.find(b => b.id === row.barber_membership_id)?.display_name) }, { key: 'weekday', label: 'Dia', render: row => weekdays[Number(row.weekday)] || '—' }, { key: 'start_time', label: 'Início' }, { key: 'end_time', label: 'Fim' }, { key: 'active', label: 'Status', render: row => <Status value={row.active ? 'active' : 'paused'}/> }]} /><p className="panel-footnote"><LockKeyhole size={14}/> Para intervalos, cadastre duas janelas no mesmo dia. Folgas e horários especiais ficam nas exceções.</p></Panel><Panel title="Folgas e horários especiais" subtitle="Exceções por dia, como folgas ou jornada diferente" action={<AddButton onClick={() => openException()}>Nova exceção</AddButton>}><DataTable rows={exceptions.rows} empty="Nenhuma exceção cadastrada" onRowClick={openException} columns={[{ key: 'day', label: 'Dia', render: row => String(row.day) }, { key: 'barber_membership_id', label: 'Profissional', render: row => asText(barbers.find(barber => barber.id === row.barber_membership_id)?.display_name) }, { key: 'unavailable', label: 'Tipo', render: row => row.unavailable ? 'Folga' : 'Horário especial' }, { key: 'start_time', label: 'Horário', render: row => row.unavailable ? 'Dia inteiro' : `${asText(row.start_time)} – ${asText(row.end_time)}` }]} /></Panel>{editor && <Modal title={editor === 'new' ? 'Novo serviço' : 'Editar serviço'} onClose={() => setEditor(null)}><form className="form-grid" onSubmit={save}><Field label="Nome do serviço"><input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}/></Field><Field label="Descrição"><textarea rows={2} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}/></Field><div className="form-row"><Field label="Duração (minutos)"><input type="number" min="10" step="10" required value={form.duration_minutes} onChange={e => setForm({ ...form, duration_minutes: e.target.value })}/></Field><Field label="Preço (R$)"><input type="number" min="0" step="0.01" required value={form.price} onChange={e => setForm({ ...form, price: e.target.value })}/></Field></div><Field label="Custo estimado (R$)"><input type="number" min="0" step="0.01" value={form.cost} onChange={e => setForm({ ...form, cost: e.target.value })}/></Field><label className="check-field"><input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })}/> Disponível para agendamento</label><Notice text={error}/><div className="form-actions"><button type="button" className="button ghost" onClick={() => setEditor(null)}>Cancelar</button><PrimaryButton type="submit" disabled={busy}>{busy ? 'Salvando...' : 'Salvar serviço'}</PrimaryButton></div></form></Modal>}{ruleModal && <Modal title={ruleEditorId ? 'Editar horário semanal' : 'Adicionar horário semanal'} onClose={() => setRuleModal(false)}><form className="form-grid" onSubmit={saveRule}><Field label="Profissional"><select required value={rule.barber_membership_id} onChange={e => setRule({ ...rule, barber_membership_id: e.target.value })}><option value="">Selecione</option>{barbers.map(row => <option key={row.id} value={row.id}>{asText(row.display_name)}</option>)}</select></Field><Field label="Dia da semana"><select value={rule.weekday} onChange={e => setRule({ ...rule, weekday: e.target.value })}>{weekdays.map((name,index) => <option key={index} value={index}>{name}</option>)}</select></Field><div className="form-row"><Field label="Início"><input type="time" required value={rule.start_time} onChange={e => setRule({ ...rule, start_time: e.target.value })}/></Field><Field label="Fim"><input type="time" required value={rule.end_time} onChange={e => setRule({ ...rule, end_time: e.target.value })}/></Field></div><Notice text={error}/><div className="form-actions"><button type="button" className="button ghost" onClick={() => setRuleModal(false)}>Cancelar</button><PrimaryButton type="submit" disabled={busy}><Clock3 size={16}/> Salvar horário</PrimaryButton></div></form></Modal>}{exceptionModal && <Modal title={exceptionEditorId ? 'Editar exceção' : 'Nova exceção'} onClose={() => setExceptionModal(false)}><form className="form-grid" onSubmit={saveException}><Field label="Profissional"><select required value={exception.barber_membership_id} onChange={e => setException({ ...exception, barber_membership_id: e.target.value })}><option value="">Selecione</option>{barbers.map(row => <option key={row.id} value={row.id}>{asText(row.display_name)}</option>)}</select></Field><Field label="Dia"><input type="date" required value={exception.day} onChange={e => setException({ ...exception, day: e.target.value })}/></Field><label className="check-field"><input type="checkbox" checked={exception.unavailable} onChange={e => setException({ ...exception, unavailable: e.target.checked })}/> Folga ou bloqueio do dia inteiro</label>{!exception.unavailable && <div className="form-row"><Field label="Início especial"><input type="time" required value={exception.start_time} onChange={e => setException({ ...exception, start_time: e.target.value })}/></Field><Field label="Fim especial"><input type="time" required value={exception.end_time} onChange={e => setException({ ...exception, end_time: e.target.value })}/></Field></div>}<Notice text={error}/><div className="form-actions"><button type="button" className="button ghost" onClick={() => setExceptionModal(false)}>Cancelar</button><PrimaryButton type="submit" disabled={busy}>Salvar exceção</PrimaryButton></div></form></Modal>}</div>
}
