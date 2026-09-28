import type { User } from '@supabase/supabase-js'

export type Row = Record<string, unknown> & { id: string }
export type Role = 'master' | 'admin' | 'barber' | 'client'
export type ModuleKey =
  | 'dashboard' | 'reports' | 'appointments' | 'clients' | 'services' | 'subscriptions'
  | 'products' | 'bar' | 'finance' | 'goals' | 'partners' | 'marketing'
  | 'ai' | 'bio' | 'branding' | 'settings'
  | 'tutorial'

export interface Shop {
  id: string
  name: string
  slug: string
  timezone?: string | null
  phone?: string | null
  whatsapp?: string | null
  instagram_url?: string | null
  bio_title?: string | null
  bio_description?: string | null
  logo_url?: string | null
  brand_theme?: unknown
  pix_key?: string | null
  active?: boolean
}

export interface Membership {
  id: string
  barbershop_id: string
  user_id: string
  role: 'admin' | 'barber'
  active: boolean
  display_name: string
  avatar_path?: string | null
}

export interface Identity {
  user: User
  isMaster: boolean
  memberships: Membership[]
  shops: Shop[]
  membership: Membership | null
  shop: Shop | null
  clientId: string | null
  permissions: Record<string, boolean>
}

export const moduleLabels: Record<ModuleKey, string> = {
  dashboard: 'Visão geral', reports: 'Relatórios', appointments: 'Agenda', clients: 'Clientes',
  services: 'Serviços', subscriptions: 'Assinaturas', products: 'Produtos',
  bar: 'Bar e cozinha', finance: 'Financeiro', goals: 'Metas',
  partners: 'Parceiros', marketing: 'Marketing', ai: 'Ajuda de IA',
  bio: 'Mini bio', branding: 'Identidade visual', settings: 'Configurações', tutorial: 'Passo a passo',
}

export function money(cents: unknown): string {
  const value = Number(cents ?? 0)
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value / 100)
}

export function date(value: unknown): string {
  if (!value) return '—'
  const raw = String(value)
  // A bare SQL date has no timezone. Parsing it as UTC shifts it to yesterday in Brazil.
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00` : raw)
  return Number.isNaN(parsed.getTime()) ? '—' : new Intl.DateTimeFormat('pt-BR').format(parsed)
}

export function dateTime(value: unknown): string {
  if (!value) return '—'
  const parsed = new Date(String(value))
  return Number.isNaN(parsed.getTime()) ? '—' : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(parsed)
}

export function asText(value: unknown): string { return value == null || value === '' ? '—' : String(value) }
export function cents(value: string): number { return Math.round(Number(value.replace(',', '.')) * 100) }
export function today(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
export function startOfWeek(): string {
  const now = new Date()
  const day = (now.getDay() + 6) % 7
  now.setDate(now.getDate() - day)
  now.setHours(0, 0, 0, 0)
  return now.toISOString()
}
