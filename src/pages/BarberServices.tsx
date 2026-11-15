import { useCallback, useEffect, useState } from 'react'
import { requireSupabase } from '../lib/supabase'
import { Loading, Notice } from '../ui'

type Service = { id: string; name: string; duration_minutes: number }

/** Procedimentos que o barbeiro faz. Só eles aparecem no agendamento com ele. */
export function BarberServices({ shopId, membershipId, active, canEdit, notify }: { shopId: string; membershipId: string; active: boolean; canEdit: boolean; notify: (message: string, kind?: 'success' | 'error') => void }) {
  const [services, setServices] = useState<Service[] | null>(null)
  const [saved, setSaved] = useState<Set<string>>(new Set())
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    const client = requireSupabase()
    const [list, links] = await Promise.all([
      client.from('services').select('id,name,duration_minutes').eq('barbershop_id', shopId).eq('active', true).order('name'),
      client.from('barber_services').select('service_id').eq('barbershop_id', shopId).eq('barber_membership_id', membershipId).eq('active', true),
    ])
    if (list.error || links.error) { setError((list.error || links.error)!.message); setServices([]); return }
    const current = new Set(((links.data ?? []) as { service_id: string }[]).map(row => row.service_id))
    setServices((list.data ?? []) as Service[]); setSaved(current); setChosen(new Set(current))
  }, [shopId, membershipId])
  useEffect(() => { void load() }, [load])
  if (services === null) return <Loading text="Carregando serviços..."/>
  const editable = canEdit && active
  const added = [...chosen].filter(id => !saved.has(id))
  const removed = [...saved].filter(id => !chosen.has(id))
  const dirty = added.length + removed.length > 0
  const toggle = (id: string) => setChosen(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next })
  async function save() {
    setBusy(true); setError(null)
    try {
      const client = requireSupabase()
      if (added.length) {
        const result = await client.from('barber_services').upsert(added.map(id => ({ barbershop_id: shopId, barber_membership_id: membershipId, service_id: id, active: true })), { onConflict: 'barbershop_id,barber_membership_id,service_id' })
        if (result.error) throw result.error
      }
      if (removed.length) {
        const result = await client.from('barber_services').update({ active: false }).eq('barbershop_id', shopId).eq('barber_membership_id', membershipId).in('service_id', removed)
        if (result.error) throw result.error
      }
      notify('Serviços do barbeiro salvos.')
      await load()
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Não foi possível salvar os serviços.') }
    finally { setBusy(false) }
  }
  return <div className="barber-hours barber-services">
    <span className="barber-hours-title">Serviços que atende <em>{chosen.size} de {services.length}</em></span>
    {saved.size === 0 && <small className="barber-services-warn">Nenhum serviço marcado: este barbeiro não aparece com horários livres no agendamento.</small>}
    <div className="barber-services-grid">{services.map(service => <label key={service.id} className={chosen.has(service.id) ? 'on' : ''}>
      <input type="checkbox" checked={chosen.has(service.id)} disabled={!editable || busy} onChange={() => toggle(service.id)}/>
      <span>{service.name}</span><small>{service.duration_minutes} min</small>
    </label>)}</div>
    <Notice text={error}/>
    {editable && <div className="barber-hours-actions">
      <small><button type="button" className="barber-hours-add" disabled={busy} onClick={() => setChosen(new Set(services.map(s => s.id)))}>Marcar todos</button> · <button type="button" className="barber-hours-add" disabled={busy} onClick={() => setChosen(new Set())}>Desmarcar todos</button></small>
      <button type="button" className="button ghost" disabled={!dirty || busy} onClick={() => setChosen(new Set(saved))}>Desfazer</button>
      <button type="button" className="button primary" disabled={!dirty || busy} onClick={() => void save()}>{busy ? 'Salvando...' : 'Salvar serviços'}</button>
    </div>}
  </div>
}
