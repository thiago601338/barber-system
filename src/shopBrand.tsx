import type { CSSProperties } from 'react'
import type { Shop } from './types'

export interface BrandTheme {
  palette: {
    background: string
    surface: string
    sidebar: string
    text: string
    muted: string
    accent: string
    accentText: string
    border: string
  }
  headingFont: 'serif' | 'sans' | 'cinzel'
  bodyFont: 'serif' | 'sans'
  tagline: string
  heroImageUrl: string | null
  logoUrl: string | null
}

const fallbackPalette: BrandTheme['palette'] = {
  background: '#f5f2ec', surface: '#fffefa', sidebar: '#162820', text: '#17251e',
  muted: '#7e867b', accent: '#d8bb82', accentText: '#162820', border: '#e5e4d9',
}

const color = (value: unknown, fallback: string) => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
function readableOn(hex: string): string {
  const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
  const luminance = channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722
  const lightContrast = (1 + .05) / (luminance + .05)
  const darkContrast = (luminance + .05) / .05
  return darkContrast > lightContrast ? '#000000' : '#ffffff'
}

/** Browser guard for user supplied imagery. Stored URLs cannot inject CSS or JavaScript. */
export function safeBrandImage(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null
  if (/^\/(brands|assets)\/[a-z0-9/_-]+\.(?:png|jpe?g|webp|avif|svg)$/i.test(value) && !value.includes('..')) return value
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
      || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':') || /["'()<>\\]/.test(value)) return null
    return url.href
  } catch { return null }
}

export function safeInstagramUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 300) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || !['instagram.com', 'www.instagram.com'].includes(url.hostname) || url.username || url.password || url.port) return null
    const pieces = url.pathname.split('/').filter(Boolean)
    if (pieces.length !== 1 || !/^[a-zA-Z0-9._]{1,30}$/.test(pieces[0]) || pieces[0].startsWith('.') || pieces[0].endsWith('.') || pieces[0].includes('..')) return null
    if (['p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'direct'].includes(pieces[0].toLowerCase())) return null
    return `https://www.instagram.com/${pieces[0].toLowerCase()}/`
  } catch { return null }
}

export function readBrandTheme(value: unknown): BrandTheme | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = object(value)
  const palette = object(raw.palette)
  if (!Object.keys(fallbackPalette).every(key => typeof palette[key] === 'string' && /^#[0-9a-fA-F]{6}$/.test(palette[key] as string))) return null
  return {
    palette: {
      background: color(palette.background, fallbackPalette.background),
      surface: color(palette.surface, fallbackPalette.surface),
      sidebar: color(palette.sidebar, fallbackPalette.sidebar),
      text: color(palette.text, fallbackPalette.text),
      muted: color(palette.muted, fallbackPalette.muted),
      accent: color(palette.accent, fallbackPalette.accent),
      accentText: color(palette.accentText, fallbackPalette.accentText),
      border: color(palette.border, fallbackPalette.border),
    },
    headingFont: raw.headingFont === 'sans' || raw.headingFont === 'cinzel' ? raw.headingFont : 'serif',
    bodyFont: raw.bodyFont === 'serif' ? 'serif' : 'sans',
    tagline: typeof raw.tagline === 'string' ? raw.tagline.slice(0, 180) : '',
    heroImageUrl: safeBrandImage(raw.heroImageUrl),
    logoUrl: safeBrandImage(raw.logoUrl),
  }
}

export function brandStyle(theme: BrandTheme | null): CSSProperties | undefined {
  if (!theme) return undefined
  const vars: Record<string, string> = {
    '--shop-background': theme.palette.background,
    '--shop-surface': theme.palette.surface,
    '--shop-sidebar': theme.palette.sidebar,
    '--shop-text': theme.palette.text,
    '--shop-muted': theme.palette.muted,
    '--shop-accent': theme.palette.accent,
    '--shop-accent-text': theme.palette.accentText,
    '--shop-border': theme.palette.border,
    '--shop-sidebar-foreground': readableOn(theme.palette.sidebar),
    '--shop-heading-font': theme.headingFont === 'cinzel' ? "Cinzel,Georgia,serif" : theme.headingFont === 'serif' ? "'Instrument Serif',Georgia,serif" : "'DM Sans',Arial,sans-serif",
    '--shop-body-font': theme.bodyFont === 'serif' ? "'Instrument Serif',Georgia,serif" : "'DM Sans',Arial,sans-serif",
  }
  if (theme.heroImageUrl) vars['--shop-hero-image'] = `url(${JSON.stringify(theme.heroImageUrl)})`
  return vars as CSSProperties
}

export function ShopBrand({ shop, compact = false, dark = false }: { shop: Shop; compact?: boolean; dark?: boolean }) {
  const theme = readBrandTheme(shop.brand_theme)
  const logo = safeBrandImage(theme?.logoUrl || shop.logo_url)
  return <span className={`shop-brand-lockup ${compact ? 'compact' : ''} ${dark ? 'dark' : ''}`}>
    <span className="shop-brand-mark">{logo ? <img src={logo} alt={`Logo ${shop.name}`}/> : <span aria-hidden="true">{shop.name.slice(0, 1)}</span>}</span>
    <span className="shop-brand-words"><strong>{shop.name}</strong>{!compact && <small>{theme?.tagline || 'BARBEARIA'}</small>}</span>
  </span>
}
