import { useEffect, useRef, useState, type FormEvent } from 'react'
import { CalendarDays, Check, Clock3, MessageCircle, UserCheck, X } from 'lucide-react'
import { requireSupabase } from '../lib/supabase'
import { shopClock, shopDateKey, shopDateTime, shopToday } from '../lib/shopTime'
import { useRows } from '../lib/useRows'
import { whatsappUrl } from '../lib/whatsapp'
import { newToken, reminderMessage } from '../lib/appointmentStage'
import { money, type Row } from '../types'
import { Field, Loading, Modal, Notice, PrimaryButton } from '../ui'
import { BookingRules, problemMessage } from './BookingEnhancements'
import '../styles-scheduling-advanced.css'

export interface AppointmentContact { phone: unknown; clientName: string; shopName: string; barberName?: string }

export function AppointmentActions({ shopId, appointment, timezone, staff = false, contact, onChanged }: { shopId: string; appointment: Row; timezone: string; staff?: boolean; contact?: AppointmentContact; onChanged: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'cancel' | 'reschedule' | null>(null)
  const [day, setDay] = useState(() => shopDateKey(new Date(String(appointment.starts_at)),timezone))
  const [slots, setSlots] = useState<{ starts_at: string; ends_at: string }[]>([]), [slot, setSlot] = useState(''), [loading, setLoading] = useState(false)
  const [reason, setReason] = useState('')
  const deposits = useRows('appointment_deposits',shopId,true,'created_at',{ appointment_id: appointment.id })
  const closed = ['completed','cancelled','no_show'].includes(String(appointment.status))
  useEffect(() => {
    setSlots([]); setSlot(''); setLoading(false)
    if (mode!=='reschedule' || !day) return
    let cancelled = false; setLoading(true); setError(null)
    void (async () => {
      try { const r = await requireSupabase().rpc('reschedule_slots',{ p_barbershop_id: shopId, p_appointment_id: appointment.id, p_day: day }); if(r.error) throw r.error; if(!cancelled) setSlots((r.data || []) as { starts_at: string; ends_at: string }[]) }
      catch(p) { if(!cancelled) setError(problemMessage(p,'Não foi possível consultar horários para remarcação.')) }
      finally { if(!cancelled) setLoading(false) }
    })()
    return () => { cancelled=true }
  },[shopId,appointment.id,mode,day])
  async function act(action: string) {
    if (busy) return; setBusy(true); setError(null)
    try {
      const r = await requireSupabase().rpc('manage_appointment',{ p_barbershop_id: shopId, p_appointment_id: appointment.id, p_action: action, p_starts_at: action==='reschedule' ? slot : null, p_reason: action==='cancel' ? reason.trim() || null : null })
      if(r.error) throw r.error
      setMode(null); await onChanged(); await deposits.refresh()
    } catch(p) { setError(problemMessage(p,'Não foi possível atualizar o agendamento.')) }
    finally { setBusy(false) }
  }
  // Recepção: chegada do cliente e lembrete com link de confirmação.
  const reminderToken = useRef(String(appointment.confirm_token || '') || newToken())
  async function checkin(action: 'arrive' | 'undo_arrive' | 'remind') {
    if (busy) return; setBusy(true); setError(null)
    try {
      const r = await requireSupabase().rpc('appointment_checkin',{ p_barbershop_id: shopId, p_appointment_id: appointment.id, p_action: action, p_token: action==='remind' ? reminderToken.current : null })
      if(r.error) throw r.error
      await onChanged()
    } catch(p) { setError(problemMessage(p,'Não foi possível atualizar o agendamento.')) }
    finally { setBusy(false) }
  }
  function submit(e: FormEvent) { e.preventDefault(); if(mode) void act(mode) }
  const started = new Date(String(appointment.starts_at)).getTime()<=Date.now()
  const deposit = deposits.rows.find(d=>d.appointment_id===appointment.id)
  const waitingArrival = staff && !appointment.arrived_at && ['pending','confirmed'].includes(String(appointment.status)) && shopDateKey(new Date(String(appointment.starts_at)),timezone) <= shopToday(timezone)
  const reminderUrl = staff && contact && !started && !appointment.client_confirmed_at && !appointment.arrived_at ? whatsappUrl(contact.phone, reminderMessage({ clientName: contact.clientName, shopName: contact.shopName, barberName: contact.barberName, startsAt: appointment.starts_at, timezone, token: reminderToken.current })) : null
  return <div className="appointment-actions"><Notice text={error || deposits.error}/>{deposit && <div className="appointment-deposit"><strong>Sinal: {money(deposit.amount_cents)}</strong><span>{deposit.status==='requires_provider' ? 'Cobrança aguardando ativação do provedor — nenhum pagamento confirmado' : deposit.status==='paid' ? 'Pago e confirmado pelo provedor' : deposit.status==='cancelled' ? 'Cobrança cancelada' : deposit.status==='waived' ? 'Dispensado' : 'Aguardando pagamento'}</span></div>}{!closed && <><div className="appointment-action-buttons">{waitingArrival && <button className="button primary" type="button" disabled={busy} onClick={()=>void checkin('arrive')}><UserCheck size={16}/>Cliente chegou</button>}{(staff ? appointment.status==='pending' : !appointment.client_confirmed_at && appointment.status!=='in_progress') && <button className="button outline" type="button" disabled={busy} onClick={()=>void act('confirm')}><Check size={16}/>{staff ? 'Confirmar' : 'Confirmar presença'}</button>}{reminderUrl && <a className="button outline" href={reminderUrl} target="_blank" rel="noreferrer" onClick={()=>void checkin('remind')}><MessageCircle size={16}/>{appointment.reminder_sent_at ? 'Lembrar de novo' : 'Lembrar no WhatsApp'}</a>}{appointment.status!=='in_progress' && <button className="button outline" type="button" disabled={busy} onClick={()=>{ setMode('reschedule'); setError(null) }}><CalendarDays size={16}/>Reagendar</button>}<button className="button ghost danger-text" type="button" disabled={busy} onClick={()=>{setMode('cancel');setError(null)}}><X size={16}/>Cancelar</button>{staff && started && <>{appointment.status!=='in_progress' && <button className="button outline" type="button" disabled={busy} onClick={()=>void act('start')}><Clock3 size={16}/>Iniciar</button>}<button className="button primary" type="button" disabled={busy} onClick={()=>void act('complete')}>Concluir</button>{appointment.status!=='in_progress' && <button className="button ghost" type="button" disabled={busy} onClick={()=>void act('no_show')}>Marcar falta</button>}</>}</div>{staff && Boolean(appointment.arrived_at) && <p className="muted">Cliente chegou às {shopClock(appointment.arrived_at,timezone)}.{appointment.status!=='in_progress' && <> <button type="button" className="text-link" disabled={busy} onClick={()=>void checkin('undo_arrive')}>Desfazer</button></>}</p>}{appointment.client_confirmed_at ? <p className="muted">Presença confirmada pelo cliente em {shopDateTime(appointment.client_confirmed_at,timezone)}.</p> : staff && Boolean(appointment.reminder_sent_at) && <p className="muted">Lembrete enviado em {shopDateTime(appointment.reminder_sent_at,timezone)}. Aguardando a confirmação do cliente.</p>}</>}{mode && <Modal title={mode==='reschedule' ? 'Reagendar atendimento' : 'Cancelar atendimento'} onClose={()=>setMode(null)}><form className="form-grid" onSubmit={submit}>{mode==='reschedule' ? <><p>O mesmo profissional, os procedimentos e os valores serão mantidos. O saldo da assinatura será conferido no novo horário.</p><Field label="Nova data"><input type="date" min={shopToday(timezone)} required value={day} onChange={e=>setDay(e.target.value)}/></Field><Field label="Novo horário"><div className="slot-grid">{loading ? <Loading/> : slots.length ? slots.map(s=><button className={`slot ${slot===s.starts_at?'selected':''}`} type="button" key={s.starts_at} onClick={()=>setSlot(s.starts_at)}>{shopClock(s.starts_at,timezone)}</button>) : <p className="muted">Não há horários disponíveis nessa data.</p>}</div></Field></> : <><p>Confirme o cancelamento do horário de {shopDateTime(appointment.starts_at,timezone)}. A reserva de uso da assinatura será liberada.</p><Field label="Motivo (opcional)"><textarea rows={2} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></Field></>}<BookingRules shopId={shopId} subscription={Boolean(appointment.subscription_id)}/><Notice text={error}/><div className="form-actions"><button className="button ghost" type="button" onClick={()=>setMode(null)}>Voltar</button><PrimaryButton type="submit" disabled={busy || mode==='reschedule' && (!slot || loading)}>{busy ? 'Atualizando...' : mode==='reschedule' ? 'Confirmar remarcação' : 'Confirmar cancelamento'}</PrimaryButton></div></form></Modal>}</div>
}
