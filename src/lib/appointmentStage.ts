import type { Row } from '../types'
import { publicSystemOrigin } from './publicUrl'
import { shiftCalendarDay, shopClock, shopDateKey, shopToday } from './shopTime'

/** Situação do cliente em relação ao horário, do agendamento até o fim do atendimento. */
export type ClientStage = 'waiting' | 'reminded' | 'confirmed' | 'arrived' | 'in_progress' | 'completed' | 'no_show' | 'cancelled'

export const stageLabels: Record<ClientStage, string> = {
  waiting: 'Aguardando',
  reminded: 'Lembrete enviado',
  confirmed: 'Confirmado',
  arrived: 'Chegou',
  in_progress: 'Em atendimento',
  completed: 'Concluído',
  no_show: 'Faltou',
  cancelled: 'Cancelado',
}

/** Ordem em que as situações aparecem na legenda da agenda. */
export const stageLegend: ClientStage[] = ['waiting', 'reminded', 'confirmed', 'arrived', 'in_progress', 'completed', 'no_show']

export function clientStage(appointment: Row): ClientStage {
  const status = String(appointment.status)
  if (status === 'cancelled' || status === 'no_show' || status === 'completed' || status === 'in_progress') return status
  if (appointment.arrived_at) return 'arrived'
  // Horários importados chegam como "confirmados" pela recepção; só conta a confirmação do próprio cliente.
  if (appointment.client_confirmed_at || (status === 'confirmed' && !appointment.import_source)) return 'confirmed'
  if (appointment.reminder_sent_at) return 'reminded'
  return 'waiting'
}

export function newToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    const random = Math.floor(Math.random() * 16)
    return (char === 'x' ? random : (random & 0x3) | 0x8).toString(16)
  })
}

export function confirmationUrl(token: string): string { return `${publicSystemOrigin}/c/${token}` }

function firstName(name: string): string {
  const first = name.trim().split(/\s+/)[0] || ''
  return first ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() : ''
}

export function reminderMessage(input: { clientName: string; shopName: string; startsAt: unknown; timezone: string; barberName?: string; token: string }): string {
  const day = shopDateKey(new Date(String(input.startsAt)), input.timezone)
  const today = shopToday(input.timezone)
  const [, month, date] = day.split('-')
  const when = day === today ? 'hoje' : day === shiftCalendarDay(today, 1) ? 'amanhã' : `dia ${date}/${month}`
  const greeting = firstName(input.clientName)
  const barber = input.barberName ? ` com ${firstName(input.barberName)}` : ''
  return `Olá${greeting ? `, ${greeting}` : ''}! Aqui é da ${input.shopName}. Passando para lembrar do seu horário ${when} às ${shopClock(input.startsAt, input.timezone)}${barber}.\n\nConfirme sua presença: ${confirmationUrl(input.token)}\n\nSe precisar remarcar, é só responder esta mensagem.`
}
