import { useCallback, useEffect, useRef, useState } from 'react'
import { requireSupabase } from './supabase'
import type { Row } from '../types'

export function useRows(table: string, barbershopId: string | null, enabled = true, orderBy: string | null = 'created_at', filters: Record<string, string | string[]> = {}) {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const revision = useRef(0)
  const filterKey = JSON.stringify(filters)

  const refresh = useCallback(async () => {
    const requestRevision = ++revision.current
    if (!barbershopId || !enabled) { setRows([]); setLoading(false); setError(null); return }
    setLoading(true)
    setError(null)
    const columns = table === 'services'
      ? 'id,barbershop_id,name,description,duration_minutes,price_cents,requires_subscription,active,created_at,updated_at'
      : '*'
    try {
      const all: Row[] = []
      const keys = table === 'appointment_services' ? ['appointment_id','service_id']
        : table === 'subscription_plan_services' ? ['plan_id','service_id']
        : table === 'item_financial_profiles' ? ['item_kind','item_id']
        : table === 'module_permissions' ? ['user_id','module']
        : table === 'client_barbers' ? ['client_id','barber_membership_id'] : ['id']
      for (let page = 0; page < 100; page++) {
        let query = requireSupabase().from(table).select(columns).eq('barbershop_id', barbershopId)
        for (const [key, value] of Object.entries(JSON.parse(filterKey) as Record<string,string|string[]>)) query = Array.isArray(value) ? query.in(key,value) : query.eq(key, value)
        if (orderBy) query = query.order(orderBy, { ascending: false })
        for (const key of keys) if (key !== orderBy) query = query.order(key)
        const result = await query.range(page * 1000, page * 1000 + 999)
        if (requestRevision !== revision.current) return
        if (result.error) throw result.error
        all.push(...(result.data || []) as unknown as Row[])
        if ((result.data || []).length < 1000) break
        if (page === 99) throw new Error('A lista ultrapassa 100 mil registros. Use um relatório com período menor.')
      }
      if (requestRevision === revision.current) setRows(all)
    } catch (problem) {
      if (requestRevision === revision.current) { setError(problem instanceof Error ? problem.message : String((problem as { message?: string }).message || 'Falha ao carregar registros.')); setRows([]) }
    } finally { if (requestRevision === revision.current) setLoading(false) }
  }, [table, barbershopId, enabled, orderBy, filterKey])

  useEffect(() => { setRows([]); void refresh(); return () => { revision.current++ } }, [refresh])
  return { rows, loading, error, refresh }
}

export async function createRow(table: string, values: Record<string, unknown>) {
  const columns = table === 'services' ? 'id,barbershop_id,name,description,duration_minutes,price_cents,requires_subscription,active,created_at,updated_at' : '*'
  const { data, error } = await requireSupabase().from(table).insert(values).select(columns).single()
  if (error) throw new Error(error.message)
  return data as unknown as Row
}

export async function updateRow(table: string, id: string, values: Record<string, unknown>) {
  const columns = table === 'services' ? 'id,barbershop_id,name,description,duration_minutes,price_cents,requires_subscription,active,created_at,updated_at' : '*'
  const { data, error } = await requireSupabase().from(table).update(values).eq('id', id).select(columns).single()
  if (error) throw new Error(error.message)
  return data as unknown as Row
}

export async function removeRow(table: string, id: string) {
  const { error } = await requireSupabase().from(table).delete().eq('id', id)
  if (error) throw new Error(error.message)
}
