import { useCallback, useEffect, useState } from 'react'
import { requireSupabase } from './supabase'
import type { Row } from '../types'

export function useRows(table: string, barbershopId: string | null, enabled = true, orderBy: string | null = 'created_at') {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!barbershopId || !enabled) { setRows([]); return }
    setLoading(true)
    setError(null)
    const columns = table === 'services'
      ? 'id,barbershop_id,name,description,duration_minutes,price_cents,active,created_at,updated_at'
      : '*'
    let query = requireSupabase().from(table).select(columns).eq('barbershop_id', barbershopId)
    if (orderBy) query = query.order(orderBy, { ascending: false })
    const { data, error: queryError } = await query.limit(500)
    if (queryError) { setError(queryError.message); setRows([]) }
    else setRows((data ?? []) as unknown as Row[])
    setLoading(false)
  }, [table, barbershopId, enabled, orderBy])

  useEffect(() => { void refresh() }, [refresh])
  return { rows, loading, error, refresh }
}

export async function createRow(table: string, values: Record<string, unknown>) {
  const columns = table === 'services' ? 'id,barbershop_id,name,description,duration_minutes,price_cents,active,created_at,updated_at' : '*'
  const { data, error } = await requireSupabase().from(table).insert(values).select(columns).single()
  if (error) throw new Error(error.message)
  return data as unknown as Row
}

export async function updateRow(table: string, id: string, values: Record<string, unknown>) {
  const columns = table === 'services' ? 'id,barbershop_id,name,description,duration_minutes,price_cents,active,created_at,updated_at' : '*'
  const { data, error } = await requireSupabase().from(table).update(values).eq('id', id).select(columns).single()
  if (error) throw new Error(error.message)
  return data as unknown as Row
}

export async function removeRow(table: string, id: string) {
  const { error } = await requireSupabase().from(table).delete().eq('id', id)
  if (error) throw new Error(error.message)
}
