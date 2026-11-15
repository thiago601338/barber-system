import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, ExternalLink, MessageCircle, RefreshCw } from 'lucide-react'
import { clientStage, newToken, reminderMessage, stageLabels, stageLegend, type ClientStage } from '../lib/appointmentStage'
import { publicSystemOrigin } from '../lib/publicUrl'
import { shopClock } from '../lib/shopTime'
import { requireSupabase } from '../lib/supabase'
import { whatsappUrl } from '../lib/whatsapp'
import { asText, type Row } from '../types'
import { Empty, Loading, Modal, Notice } from '../ui'
import { problemMessage } from './BookingEnhancements'
import '../styles-extras.css'

export function StageChip({ stage }: { stage: ClientStage }) {
  return <span className={`stage-chip stage-${stage}`}>{stageLabels[stage]}</span>
}

/** Legenda discreta das cores usadas nos blocos da agenda. */
export function StageLegend() {
  return <div className="stage-legend" aria-label="Legenda da situação do cliente">
    {stageLegend.map(stage => <span key={stage} className={`stage-legend-item stage-${stage}`}><i aria-hidden="true"/>{stageLabels[stage]}</span>)}
  </div>
}

/** Fila de lembretes do dia: um toque abre o WhatsApp com a mensagem pronta e o link de confirmação. */
export function RemindersModal({ shopId, shopName, timezone, dayLabel, appointments, clients, barbers, onClose, onChanged }: {
  shopId: string; shopName: string; timezone: string; dayLabel: string
  appointments: Row[]; clients: Row[]; barbers: Row[]
  onClose: () => void; onChanged: () => void | Promise<void>
}) {
  const tokens = useRef(new Map<string, string>())
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<string[]>([])
  const pending = useMemo(() => appointments
    .filter(a => ['waiting', 'reminded'].includes(clientStage(a)) && new Date(String(a.starts_at)).getTime() > Date.now())
    .sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at))), [appointments])
  function tokenFor(appointment: Row) {
    const known = String(appointment.confirm_token || '') || tokens.current.get(appointment.id)
    if (known) return known
    const created = newToken()
    tokens.current.set(appointment.id, created)
    return created
  }
  async function markSent(appointment: Row) {
    setError(null); setSent(previous => [...previous, appointment.id])
    try {
      const result = await requireSupabase().rpc('appointment_checkin', { p_barbershop_id: shopId, p_appointment_id: appointment.id, p_action: 'remind', p_token: tokenFor(appointment) })
      if (result.error) throw result.error
      await onChanged()
    } catch (problem) {
      setSent(previous => previous.filter(id => id !== appointment.id))
      setError(problemMessage(problem, 'O lembrete não foi registrado. Tente de novo antes de enviar a mensagem.'))
    }
  }
  return <Modal wide title="Lembretes do dia" subtitle={`${dayLabel} · ${pending.length} horário(s) sem confirmação do cliente`} onClose={onClose}>
    <Notice text={error}/>
    {pending.length === 0 ? <Empty title="Tudo confirmado" text="Nenhum horário futuro deste dia aguarda confirmação."/> : <ul className="reminder-list">
      {pending.map(appointment => {
        const client = clients.find(row => row.id === appointment.client_id)
        const barber = barbers.find(row => row.id === appointment.barber_membership_id)
        const stage = clientStage(appointment)
        const link = whatsappUrl(client?.phone, reminderMessage({ clientName: String(client?.full_name || ''), shopName, barberName: String(barber?.display_name || ''), startsAt: appointment.starts_at, timezone, token: tokenFor(appointment) }))
        const done = stage === 'reminded' || sent.includes(appointment.id)
        return <li key={appointment.id}>
          <time>{shopClock(appointment.starts_at, timezone)}</time>
          <div><strong>{asText(client?.full_name)}</strong><small>{asText(barber?.display_name)}{done ? ' · lembrete enviado' : ''}</small></div>
          {link
            ? <a className={`button ${done ? 'ghost' : 'outline'}`} href={link} target="_blank" rel="noreferrer" onClick={() => void markSent(appointment)}>{done ? <Check size={15}/> : <MessageCircle size={15}/>}{done ? 'Enviar de novo' : 'Lembrar'}</a>
            : <span className="muted">Sem telefone</span>}
        </li>
      })}
    </ul>}
    <p className="panel-footnote">A mensagem leva um link pessoal. Quando o cliente toca em confirmar, o horário aparece como Confirmado na agenda.</p>
  </Modal>
}

/** Link do painel de TV (fila do dia), que abre sem login em qualquer tela da barbearia. */
export function TvBoardModal({ shopId, admin, onClose, notify }: { shopId: string; admin: boolean; onClose: () => void; notify: (message: string, kind?: 'success' | 'error') => void }) {
  const [token, setToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmRotate, setConfirmRotate] = useState(false)
  useEffect(() => {
    let cancelled = false
    void requireSupabase().rpc('tv_board_link', { p_barbershop_id: shopId, p_rotate: false }).then(({ data, error: problem }) => {
      if (cancelled) return
      if (problem) setError(problemMessage(problem, 'Não foi possível abrir o link do painel.'))
      else setToken(String(data))
    })
    return () => { cancelled = true }
  }, [shopId])
  const url = token ? `${publicSystemOrigin}/tv/${token}` : ''
  async function copy() {
    try { await navigator.clipboard.writeText(url); notify('Link do painel copiado.') }
    catch { notify('Não foi possível copiar. Selecione o link e copie manualmente.', 'error') }
  }
  async function rotate() {
    setBusy(true); setError(null)
    try {
      const result = await requireSupabase().rpc('tv_board_link', { p_barbershop_id: shopId, p_rotate: true })
      if (result.error) throw result.error
      setToken(String(result.data)); setConfirmRotate(false); notify('Novo link gerado. O anterior deixou de funcionar.')
    } catch (problem) { setError(problemMessage(problem, 'Não foi possível gerar um novo link.')) }
    finally { setBusy(false) }
  }
  return <Modal title="Painel de TV" subtitle="Mostra quem está em atendimento, quem já chegou e os próximos horários do dia." onClose={onClose}>
    <Notice text={error}/>
    {!token && !error ? <Loading text="Preparando o link..."/> : token && <div className="form-grid">
      <label className="field"><span>Link do painel</span><input readOnly value={url} onFocus={event => event.currentTarget.select()}/><small>Abra este endereço no navegador da TV ou de um tablet. Não precisa de login e atualiza sozinho.</small></label>
      <div className="form-actions tv-link-actions">
        {admin && (confirmRotate
          ? <><span className="muted">O link atual para de funcionar.</span><button type="button" className="button ghost" disabled={busy} onClick={() => setConfirmRotate(false)}>Manter</button><button type="button" className="button outline" disabled={busy} onClick={() => void rotate()}>{busy ? 'Gerando...' : 'Gerar novo'}</button></>
          : <button type="button" className="button ghost" onClick={() => setConfirmRotate(true)}><RefreshCw size={15}/>Trocar link</button>)}
        {!confirmRotate && <><button type="button" className="button outline" onClick={() => void copy()}><Copy size={15}/>Copiar</button><a className="button primary" href={url} target="_blank" rel="noreferrer"><ExternalLink size={15}/>Abrir painel</a></>}
      </div>
    </div>}
  </Modal>
}
