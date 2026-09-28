import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

export const isConfigured = Boolean(url && key)
export const supabase: SupabaseClient | null = isConfigured
  ? createClient(url, key, {
      auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
    })
  : null

export function requireSupabase(): SupabaseClient {
  if (!supabase) throw new Error('Conexão com o Supabase ainda não configurada.')
  return supabase
}

export async function authedApi<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const client = requireSupabase()
  const { data } = await client.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Entre na sua conta para continuar.')
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({})) as { error?: string } & T
  if (!response.ok) throw new Error(payload.error || `Não foi possível concluir (${response.status}).`)
  return payload
}

export async function authedGet<T>(path: string): Promise<T> {
  const client = requireSupabase()
  const { data } = await client.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Entre na sua conta para continuar.')
  const response = await fetch(path, { headers: { Authorization: `Bearer ${token}` } })
  const payload = await response.json().catch(() => ({})) as { error?: string } & T
  if (!response.ok) throw new Error(payload.error || `Não foi possível consultar (${response.status}).`)
  return payload
}
