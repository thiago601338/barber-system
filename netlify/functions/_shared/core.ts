import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export function setting(name: string): string {
  const value = Netlify.env.get(name)
  if (!value) throw new HttpError(503, `Integração não configurada: ${name}`)
  return value
}

export function optionalSetting(name: string): string | undefined {
  return Netlify.env.get(name) || undefined
}

export function db(): SupabaseClient {
  const secret = optionalSetting('SUPABASE_SECRET_KEY') || optionalSetting('SUPABASE_SERVICE_ROLE_KEY')
  if (!secret) throw new HttpError(503, 'Integração não configurada: SUPABASE_SECRET_KEY')
  return createClient(setting('SUPABASE_URL'), secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

export function failure(error: unknown): Response {
  if (error instanceof HttpError) return json({ error: error.message }, error.status)
  console.error(error)
  return json({ error: 'Não foi possível concluir a operação.' }, 500)
}

export async function body<T = Record<string, unknown>>(request: Request): Promise<T> {
  try { return await request.json() as T } catch { throw new HttpError(400, 'JSON inválido.') }
}

export async function userFromRequest(request: Request, client = db()): Promise<User> {
  const token = /^Bearer (.+)$/i.exec(request.headers.get('authorization') || '')?.[1]
  if (!token) throw new HttpError(401, 'Faça login para continuar.')
  const { data, error } = await client.auth.getUser(token)
  if (error || !data.user) throw new HttpError(401, 'Sessão inválida.')
  return data.user
}

export async function requirePlatformAdmin(client: SupabaseClient, userId: string): Promise<void> {
  const { data, error } = await client.from('platform_admins').select('user_id').eq('user_id', userId).maybeSingle()
  if (error || !data) throw new HttpError(403, 'Acesso restrito ao administrador master.')
}

export async function requireShopAdmin(client: SupabaseClient, userId: string, shopId: string): Promise<void> {
  const { data, error } = await client.from('memberships').select('id').eq('barbershop_id', shopId).eq('user_id', userId).eq('role', 'admin').eq('active', true).maybeSingle()
  if (error || !data) throw new HttpError(403, 'Acesso restrito ao administrador da barbearia.')
}

export function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new HttpError(400, 'Identificador inválido.')
  }
  return value
}

export function text(value: unknown, label: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new HttpError(400, `${label} inválido.`)
  return value.trim()
}

export function email(value: unknown): string {
  const result = text(value, 'E-mail', 254).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw new HttpError(400, 'E-mail inválido.')
  return result
}
