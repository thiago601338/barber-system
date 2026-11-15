import { useCallback, useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { requireSupabase } from '../lib/supabase'
import { Loading, Notice } from '../ui'

const dayNames = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
// Segunda primeiro, como a barbearia lê a semana.
const dayOrder = [1, 2, 3, 4, 5, 6, 0]

export interface HoursWindow { id?: string; weekday: number; start: string; end: string }
type Rule = { id: string; weekday: number; start_time: string; end_time: string }

const hhmm = (value: string) => String(value).slice(0, 5)

/** Problema da grade de horários, ou null quando dá para salvar. */
export function hoursProblem(windows: HoursWindow[]): string | null {
  for (const day of dayOrder) {
    const list = windows.filter(w => w.weekday === day).sort((a, b) => a.start.localeCompare(b.start))
    for (const [index, item] of list.entries()) {
      if (!/^\d{2}:\d{2}$/.test(item.start) || !/^\d{2}:\d{2}$/.test(item.end)) return `${dayNames[day]}: preencha início e fim.`
      if (item.end <= item.start) return `${dayNames[day]}: o fim precisa ser depois do início.`
      if (index > 0 && item.start < list[index - 1].end) return `${dayNames[day]}: os horários se sobrepõem.`
    }
  }
  return null
}

/** O que muda no banco para a grade ficar igual à da tela. */
export function hoursChanges({ saved, windows }: { saved: Rule[]; windows: HoursWindow[] }) {
  const kept = new Set(windows.filter(w => w.id).map(w => w.id))
  const remove = saved.filter(rule => !kept.has(rule.id)).map(rule => rule.id)
  const update = windows.filter(w => {
    const before = w.id ? saved.find(rule => rule.id === w.id) : null
    return before && (hhmm(before.start_time) !== w.start || hhmm(before.end_time) !== w.end)
  })
  const insert = windows.filter(w => !w.id)
  return { remove, update, insert }
}

/** Dias e horários de atendimento do barbeiro, editáveis no próprio perfil. */
export function BarberHours({ shopId, membershipId, active, canEdit, notify, onSaved }: { shopId: string; membershipId: string; active: boolean; canEdit: boolean; notify: (message: string, kind?: 'success' | 'error') => void; onSaved: () => void }) {
  const [saved, setSaved] = useState<Rule[] | null>(null)
  const [windows, setWindows] = useState<HoursWindow[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    const { data, error: loadError } = await requireSupabase().from('availability_rules').select('id,weekday,start_time,end_time')
      .eq('barbershop_id', shopId).eq('barber_membership_id', membershipId).eq('active', true).order('start_time')
    if (loadError) { setError(loadError.message); setSaved([]); return }
    const rules = (data ?? []) as Rule[]
    setSaved(rules)
    setWindows(rules.map(rule => ({ id: rule.id, weekday: Number(rule.weekday), start: hhmm(rule.start_time), end: hhmm(rule.end_time) })))
  }, [shopId, membershipId])
  useEffect(() => { void load() }, [load])

  if (saved === null) return <Loading text="Carregando horários..."/>
  const editable = canEdit && active
  const changes = hoursChanges({ saved, windows })
  const dirty = changes.remove.length + changes.update.length + changes.insert.length > 0
  const patch = (target: HoursWindow, values: Partial<HoursWindow>) => setWindows(list => list.map(item => item === target ? { ...item, ...values } : item))
  function addWindow(day: number) {
    const last = windows.filter(w => w.weekday === day).sort((a, b) => a.end.localeCompare(b.end)).at(-1)
    setWindows(list => [...list, last ? { weekday: day, start: last.end < '22:00' ? last.end : '09:00', end: last.end < '22:00' ? '22:00' : '18:00' } : { weekday: day, start: '09:00', end: '18:00' }])
  }
  async function save() {
    const problem = hoursProblem(windows)
    if (problem) { setError(problem); return }
    setBusy(true); setError(null)
    try {
      const client = requireSupabase()
      if (changes.remove.length) {
        const result = await client.from('availability_rules').delete().eq('barbershop_id', shopId).in('id', changes.remove)
        if (result.error) throw result.error
      }
      for (const item of changes.update) {
        const result = await client.from('availability_rules').update({ start_time: item.start, end_time: item.end }).eq('barbershop_id', shopId).eq('id', item.id!)
        if (result.error) throw result.error
      }
      if (changes.insert.length) {
        const result = await client.from('availability_rules').insert(changes.insert.map(item => ({ barbershop_id: shopId, barber_membership_id: membershipId, weekday: item.weekday, start_time: item.start, end_time: item.end, active: true })))
        if (result.error) throw result.error
      }
      notify('Horários salvos.')
      await load(); onSaved()
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Não foi possível salvar os horários.')
      await load()
    } finally { setBusy(false) }
  }

  return <div className="barber-hours">
    <span className="barber-hours-title">Dias e horários de atendimento</span>
    {!active && <small>Barbeiro inativo: ative o cadastro para mudar os horários.</small>}
    <div className="barber-hours-grid">{dayOrder.map(day => {
      const list = windows.filter(w => w.weekday === day).sort((a, b) => a.start.localeCompare(b.start))
      return <div key={day} className={`barber-hours-day ${list.length ? 'on' : ''}`}>
        <strong>{dayNames[day]}</strong>
        <div className="barber-hours-windows">
          {list.length === 0 && <span className="barber-hours-off">Folga</span>}
          {list.map((item, index) => <div key={item.id ?? `new-${day}-${index}`} className="barber-hours-window">
            <input type="time" aria-label={`${dayNames[day]}: início`} value={item.start} disabled={!editable || busy} onChange={event => patch(item, { start: event.target.value })}/>
            <span>às</span>
            <input type="time" aria-label={`${dayNames[day]}: fim`} value={item.end} disabled={!editable || busy} onChange={event => patch(item, { end: event.target.value })}/>
            {editable && <button type="button" className="icon-button" aria-label={`Remover horário de ${dayNames[day]}`} disabled={busy} onClick={() => setWindows(all => all.filter(w => w !== item))}><X size={14}/></button>}
          </div>)}
        </div>
        {editable && <button type="button" className="barber-hours-add" disabled={busy} onClick={() => addWindow(day)}><Plus size={13}/>{list.length ? 'Intervalo' : 'Atender'}</button>}
      </div>
    })}</div>
    <Notice text={error}/>
    {editable && <div className="barber-hours-actions">
      <small>Para almoço ou intervalo, use duas faixas no mesmo dia. Folgas de datas específicas ficam em Serviços.</small>
      <button type="button" className="button ghost" disabled={!dirty || busy} onClick={() => { setError(null); setWindows(saved.map(rule => ({ id: rule.id, weekday: Number(rule.weekday), start: hhmm(rule.start_time), end: hhmm(rule.end_time) }))) }}>Desfazer</button>
      <button type="button" className="button primary" disabled={!dirty || busy} onClick={() => void save()}>{busy ? 'Salvando...' : 'Salvar horários'}</button>
    </div>}
  </div>
}
