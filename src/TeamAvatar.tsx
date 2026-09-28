import { requireSupabase } from './lib/supabase'

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const teamPathPattern = new RegExp(`^(${uuid})/team/(${uuid})/${uuid}\\.(?:jpg|png|webp)$`)

export function teamAvatarUrl(path: unknown, shopId?: string, memberId?: string): string | null {
  if (typeof path !== 'string' || path.length > 180) return null
  const match = teamPathPattern.exec(path)
  if (!match || (shopId && match[1] !== shopId) || (memberId && match[2] !== memberId)) return null
  return requireSupabase().storage.from('shop-assets').getPublicUrl(path).data.publicUrl
}

export function TeamAvatar({ path, name, shopId, memberId, className = '' }: {
  path?: unknown
  name: string
  shopId?: string
  memberId?: string
  className?: string
}) {
  const url = teamAvatarUrl(path, shopId, memberId)
  return <span className={`member-avatar team-avatar ${className}`} aria-hidden="true">
    {url ? <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer"/> : name.trim().slice(0, 1) || 'B'}
  </span>
}
