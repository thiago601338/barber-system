import { useEffect, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { CalendarClock, ShieldCheck } from 'lucide-react'
import { requireSupabase } from '../lib/supabase'
import { shiftCalendarDay, shopToday } from '../lib/shopTime'
import { money } from '../types'
import { Field, Loading, Modal, Notice, PrimaryButton } from '../ui'
import '../styles-scheduling-advanced.css'

export type EligibleSubscription = { id: string; plan_name: string; remaining_visits: number; period_start: string; period_end: string }
export type BookingEligibility = { requires_subscription: boolean; eligible: boolean; subscriptions: EligibleSubscription[]; reason: string | null }
export function useBookingEligibility(shopId: string, clientId: string | null, serviceIds: string[], startsAt: string) {
  const [value, setValue] = useState<BookingEligibility | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const key = serviceIds.join(',')
  useEffect(() => {
    let cancelled = false
    setValue(null); setError(null); setLoading(false)
    if (!clientId || !key || !startsAt) return
    setLoading(true)
    void (async () => {
      try {
        const result = await requireSupabase().rpc('booking_subscription_eligibility', { p_barbershop_id: shopId, p_client_id: clientId, p_service_ids: key.split(','), p_starts_at: startsAt })
        if (result.error) throw result.error
        if (!cancelled) setValue(result.data as BookingEligibility)
      } catch (problem) { if (!cancelled) setError(problemMessage(problem, 'Não foi possível conferir cobertura e saldo.')) }
      finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [shopId, clientId, key, startsAt])
  return { value, loading, error }
}
export function problemMessage(problem: unknown, fallback: string) { return problem && typeof problem === 'object' && 'message' in problem ? String(problem.message) : fallback }
export function EligibilityChoice({ eligibility, selected, onChange, required }: { eligibility: ReturnType<typeof useBookingEligibility>; selected: string; onChange: (id: string) => void; required: boolean }) {
  const subscriptions = eligibility.value?.subscriptions || []
  return <section className="booking-eligibility"><div className="schedule-section-label"><ShieldCheck size={18}/><strong>Cobertura da assinatura</strong></div>{eligibility.loading ? <Loading text="Conferindo cobertura, ciclo e usos disponíveis..."/> : eligibility.error ? <Notice text={eligibility.error}/> : eligibility.value ? <><Field label={required ? 'Selecione uma assinatura elegível' : 'Usar plano do cliente'}><select value={subscriptions.some(s => s.id === selected) ? selected : ''} onChange={e => onChange(e.target.value)}><option value="">{required ? 'Escolha um plano para este serviço' : 'Pagar atendimento avulso'}</option>{subscriptions.map(s => <option value={s.id} key={s.id}>{s.plan_name} · {s.remaining_visits} uso(s) disponível(is)</option>)}</select></Field>{required && !subscriptions.length && <Notice text={eligibility.value.reason || 'Este serviço exige um plano ativo com cobertura e saldo.'}/>}<p className="muted">São exibidos somente os contratos que cobrem todos os procedimentos e o horário escolhido.</p></> : <p className="muted">Escolha cliente, procedimentos e horário para conferir os benefícios do plano.</p>}</section>
}
export type BookingPolicy = { cancellation_hours: number; reschedule_hours: number; confirmation_required: boolean; deposit_amount_cents: number; deposit_collection_ready: boolean }
export function useBookingPolicy(shopId: string) {
  const [policy, setPolicy] = useState<BookingPolicy | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false; setPolicy(null); setError(null)
    void (async () => {
      try { const r = await requireSupabase().rpc('public_booking_policy', { p_barbershop_id: shopId }); if (r.error) throw r.error; if (!cancelled) setPolicy(r.data as BookingPolicy) }
      catch (p) { if (!cancelled) setError(problemMessage(p, 'Não foi possível consultar as condições de agendamento.')) }
    })()
    return () => { cancelled = true }
  }, [shopId])
  return { policy, error }
}
export function BookingRules({ shopId, subscription = false }: { shopId: string; subscription?: boolean }) {
  const { policy, error } = useBookingPolicy(shopId)
  return <aside className="booking-rules">{error ? <Notice text={error}/> : policy && <><strong>Condições do agendamento</strong><p>Cancelamento pela sua conta até {policy.cancellation_hours}h antes. Reagendamento até {policy.reschedule_hours}h antes. Após o prazo, fale com a barbearia.</p>{policy.confirmation_required && <p>A barbearia solicita que você confirme sua presença na área do cliente.</p>}{!subscription && policy.deposit_amount_cents > 0 && <p className="deposit-pending">Sinal previsto: {money(policy.deposit_amount_cents)}. {policy.deposit_collection_ready ? 'Acompanhe a cobrança na sua conta.' : 'A cobrança de sinal ainda aguarda ativação do provedor. Nada será cobrado ao reservar aqui.'}</p>}</>}</aside>
}
export function WaitlistJoin({ shopId, timezone, clientId, ensureClient, serviceIds, barberId, day, onSaved }: { shopId: string; timezone: string; clientId: string | null; ensureClient?: () => Promise<string>; serviceIds: string[]; barberId: string; day: string; onSaved?: () => void }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ from: day || shopToday(timezone), until: shiftCalendarDay(day || shopToday(timezone), 7), start: '09:00', end: '19:00', notes: '', weekdays: [0,1,2,3,4,5,6] })
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [saved, setSaved] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null)
    try {
      const person = clientId || await ensureClient?.()
      if (!person) throw new Error('Entre na sua conta e informe seu nome para entrar na lista.')
      const r = await requireSupabase().rpc('create_waitlist_entry', { p_barbershop_id: shopId, p_client_id: person, p_service_ids: serviceIds, p_barber_id: barberId || null, p_from_day: form.from, p_until_day: form.until, p_start_time: form.start, p_end_time: form.end, p_weekdays: form.weekdays, p_notes: form.notes.trim() || null })
      if (r.error) throw r.error
      setSaved(true); setOpen(false); onSaved?.()
    } catch (p) { setError(problemMessage(p, 'Não foi possível entrar na lista.')) }
    finally { setBusy(false) }
  }
  return <div className="waitlist-join"><CalendarClock size={19}/><div><strong>{saved ? 'Você está na lista de espera' : 'Prefere aguardar uma vaga?'}</strong><p>{saved ? 'Acompanhe as ofertas na sua conta. A reserva só será feita quando você aceitar um horário ainda disponível.' : 'Informe dias e horários preferidos. A equipe pode oferecer uma vaga, e você decide se aceita.'}</p></div><button type="button" className="button outline" disabled={!serviceIds.length || saved} onClick={() => { setForm(f => ({ ...f, from: day, until: shiftCalendarDay(day,7) })); setError(null); setOpen(true) }}>{saved ? 'Pedido registrado' : 'Entrar na lista'}</button>{open && createPortal(<Modal title="Preferências para uma vaga" onClose={() => setOpen(false)}><form className="form-grid" onSubmit={submit}><div className="form-row"><Field label="A partir de"><input type="date" min={shopToday(timezone)} required value={form.from} onChange={e => setForm({ ...form, from: e.target.value })}/></Field><Field label="Até"><input type="date" min={form.from} max={shiftCalendarDay(form.from,90)} required value={form.until} onChange={e => setForm({ ...form, until: e.target.value })}/></Field></div><div className="form-row"><Field label="Primeiro horário"><input type="time" required value={form.start} onChange={e => setForm({ ...form, start: e.target.value })}/></Field><Field label="Último horário"><input type="time" required value={form.end} onChange={e => setForm({ ...form, end: e.target.value })}/></Field></div><fieldset className="weekday-options"><legend>Dias de preferência</legend>{['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map((label,i) => <label key={label}><input type="checkbox" checked={form.weekdays.includes(i)} onChange={e => setForm({ ...form, weekdays: e.target.checked ? [...form.weekdays,i] : form.weekdays.filter(d => d!==i) })}/>{label}</label>)}</fieldset><Field label="Observações"><textarea maxLength={1000} rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}/></Field><Notice text={error}/><PrimaryButton type="submit" disabled={busy || !form.weekdays.length}>{busy ? 'Registrando...' : 'Registrar preferência'}</PrimaryButton></form></Modal>,document.body)}</div>
}
