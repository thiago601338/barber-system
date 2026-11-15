import { useEffect, useMemo, useState } from 'react'
import { CalendarCheck, CircleAlert, Maximize2, MessageCircle } from 'lucide-react'
import { shopClock } from '../lib/shopTime'
import { requireSupabase } from '../lib/supabase'
import { whatsappUrl } from '../lib/whatsapp'
import { brandStyle, readBrandTheme, safeBrandImage } from '../shopBrand'
import { Loading } from '../ui'
import '../styles-extras.css'

const tokenPattern = /^\/(?:c|tv)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i
function pathToken(): string | null { return tokenPattern.exec(window.location.pathname)?.[1]?.toLowerCase() ?? null }

/** Páginas abertas por código pessoal não devem aparecer em buscadores. */
function useNoIndex() {
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'; meta.content = 'noindex,nofollow'
    document.head.appendChild(meta)
    return () => { meta.remove() }
  }, [])
}

function longDay(value: unknown, timezone: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(String(value)))
}

interface Confirmation {
  shop_name: string; shop_slug: string; logo_url: string | null; brand_theme: unknown; whatsapp: string | null; address: string | null
  timezone: string; starts_at: string; status: string; confirmed_at: string | null; can_confirm: boolean
  client: string | null; barber: string | null; services: string | null
}

/** Página aberta pelo link do lembrete: o cliente confere o horário e confirma a presença, sem login. */
export function ConfirmAppointmentPage() {
  useNoIndex()
  const token = pathToken()
  const [data, setData] = useState<Confirmation | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  async function load(confirm: boolean) {
    if (!token) { setData(null); return }
    setBusy(true); setFailed(false)
    try {
      const result = await requireSupabase().rpc('appointment_confirmation', { p_token: token, p_confirm: confirm })
      if (result.error) throw result.error
      setData((result.data as Confirmation | null) ?? null)
    } catch { setFailed(true); setData(previous => previous ?? null) }
    finally { setBusy(false) }
  }
  useEffect(() => { void load(false) }, [token])
  useEffect(() => { document.title = data?.shop_name ? `Confirmar horário · ${data.shop_name}` : 'Confirmar horário' }, [data?.shop_name])
  if (data === undefined) return <div className="fullscreen-loading"><Loading text="Abrindo seu horário..."/></div>
  const theme = readBrandTheme(data?.brand_theme)
  const logo = safeBrandImage(theme?.logoUrl || data?.logo_url)
  const timezone = data?.timezone || 'America/Sao_Paulo'
  const changeLink = data ? whatsappUrl(data.whatsapp, `Olá! Preciso remarcar meu horário de ${longDay(data.starts_at, timezone)} às ${shopClock(data.starts_at, timezone)}.`) : null
  const closed = data && ['cancelled', 'no_show', 'completed'].includes(data.status)
  return <div className={`confirm-page ${theme ? 'shop-themed' : ''}`} data-shop-theme={theme ? '' : undefined} style={brandStyle(theme)}>
    <main className="confirm-card">
      {!data ? <>
        <CircleAlert size={30} className="confirm-icon muted-icon"/>
        <h1>Link não encontrado</h1>
        <p>{failed ? 'Não foi possível abrir este horário agora. Tente de novo em instantes.' : 'Este link de confirmação não existe mais. Fale com a barbearia para conferir seu horário.'}</p>
      </> : <>
        <div className="confirm-brand">{logo ? <img src={logo} alt=""/> : <span aria-hidden="true">{data.shop_name.slice(0, 1)}</span>}<strong>{data.shop_name}</strong></div>
        <p className="confirm-eyebrow">{data.client ? `Olá, ${data.client}` : 'Seu horário'}</p>
        <h1>{longDay(data.starts_at, timezone)}<br/><span>às {shopClock(data.starts_at, timezone)}</span></h1>
        <dl className="confirm-details">
          {data.barber && <div><dt>Profissional</dt><dd>{data.barber}</dd></div>}
          {data.services && <div><dt>Serviço</dt><dd>{data.services}</dd></div>}
          {data.address && <div><dt>Endereço</dt><dd>{data.address}</dd></div>}
        </dl>
        {data.status === 'cancelled' ? <p className="confirm-state bad">Este horário foi cancelado.</p>
          : closed ? <p className="confirm-state">Este atendimento já foi encerrado.</p>
          : data.confirmed_at ? <p className="confirm-state good"><CalendarCheck size={19}/> Presença confirmada. Até lá!</p>
          : data.can_confirm ? <button className="button primary confirm-button" disabled={busy} onClick={() => void load(true)}>{busy ? 'Confirmando...' : 'Confirmar presença'}</button>
          : <p className="confirm-state">O horário já passou.</p>}
        {failed && <p className="confirm-state bad">Não foi possível registrar agora. Tente de novo.</p>}
        {!closed && changeLink && <a className="confirm-secondary" href={changeLink} target="_blank" rel="noreferrer"><MessageCircle size={15}/> Preciso remarcar</a>}
      </>}
    </main>
  </div>
}

interface BoardAppointment { id: string; starts_at: string; ends_at: string; status: string; arrived_at: string | null; client: string; barber: string; services: string | null }
interface Board { shop: { name: string; logo_url: string | null; brand_theme: unknown; timezone: string }; now: string; appointments: BoardAppointment[] }

/** Painel de TV da barbearia: em atendimento, quem já chegou e os próximos horários. Atualiza sozinho. */
export function TvBoardPage() {
  useNoIndex()
  const token = pathToken()
  const [board, setBoard] = useState<Board | null | undefined>(undefined)
  const [now, setNow] = useState(() => new Date())
  const [offline, setOffline] = useState(false)
  const [fullscreen, setFullscreen] = useState(() => Boolean(document.fullscreenElement))
  useEffect(() => {
    if (!token) { setBoard(null); return }
    let cancelled = false
    async function load() {
      try {
        const result = await requireSupabase().rpc('tv_board', { p_token: token })
        if (result.error) throw result.error
        if (!cancelled) { setBoard((result.data as Board | null) ?? null); setOffline(false) }
      } catch { if (!cancelled) { setOffline(true); setBoard(previous => previous === undefined ? null : previous) } }
    }
    void load()
    const refresh = window.setInterval(() => { void load() }, 20_000)
    const clock = window.setInterval(() => setNow(new Date()), 10_000)
    const onFullscreen = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFullscreen)
    return () => { cancelled = true; window.clearInterval(refresh); window.clearInterval(clock); document.removeEventListener('fullscreenchange', onFullscreen) }
  }, [token])
  useEffect(() => { document.title = board?.shop.name ? `Painel · ${board.shop.name}` : 'Painel da barbearia' }, [board?.shop.name])
  const groups = useMemo(() => {
    const rows = board?.appointments ?? []
    const inService = rows.filter(row => row.status === 'in_progress')
    const arrived = rows.filter(row => row.status !== 'in_progress' && row.arrived_at).sort((a, b) => String(a.arrived_at).localeCompare(String(b.arrived_at)))
    const upcoming = rows.filter(row => row.status !== 'in_progress' && !row.arrived_at && new Date(row.starts_at).getTime() >= now.getTime() - 15 * 60_000).slice(0, 8)
    return { inService, arrived, upcoming }
  }, [board, now])
  if (board === undefined) return <div className="tv-board tv-board-message"><Loading text="Abrindo o painel..."/></div>
  if (!board) return <div className="tv-board tv-board-message"><div><h1>Painel indisponível</h1><p>{offline ? 'Sem conexão no momento. O painel tenta de novo sozinho.' : 'Este link não é mais válido. Abra o painel de novo pela agenda da barbearia.'}</p></div></div>
  const theme = readBrandTheme(board.shop.brand_theme)
  const logo = safeBrandImage(theme?.logoUrl || board.shop.logo_url)
  const timezone = board.shop.timezone || 'America/Sao_Paulo'
  return <div className="tv-board" style={brandStyle(theme)}>
    <header className="tv-board-head">
      <div className="tv-board-brand">{logo ? <img src={logo} alt=""/> : <span aria-hidden="true">{board.shop.name.slice(0, 1)}</span>}<strong>{board.shop.name}</strong></div>
      <div className="tv-board-clock"><strong>{shopClock(now.toISOString(), timezone)}</strong><span>{longDay(now.toISOString(), timezone)}</span></div>
    </header>
    <div className="tv-board-columns">
      <section className="tv-board-column highlight">
        <h2>Em atendimento</h2>
        {groups.inService.length ? <ul>{groups.inService.map(row => <li key={row.id}><strong>{row.client}</strong><span>com {row.barber || 'a equipe'}</span></li>)}</ul> : <p className="tv-board-empty">Nenhum atendimento em andamento.</p>}
      </section>
      <section className="tv-board-column">
        <h2>Na barbearia</h2>
        {groups.arrived.length ? <ul>{groups.arrived.map(row => <li key={row.id}><strong>{row.client}</strong><span>{shopClock(row.starts_at, timezone)} · {row.barber || 'equipe'}</span></li>)}</ul> : <p className="tv-board-empty">Ninguém aguardando.</p>}
      </section>
      <section className="tv-board-column">
        <h2>Próximos horários</h2>
        {groups.upcoming.length ? <ul className="tv-board-upcoming">{groups.upcoming.map(row => <li key={row.id}><time>{shopClock(row.starts_at, timezone)}</time><strong>{row.client}</strong><span>{row.barber || 'equipe'}</span></li>)}</ul> : <p className="tv-board-empty">Sem mais horários hoje.</p>}
      </section>
    </div>
    {offline && <p className="tv-board-offline">Sem conexão. Mostrando a última atualização.</p>}
    {!fullscreen && <button type="button" className="tv-board-fullscreen" onClick={() => { void document.documentElement.requestFullscreen?.().catch(() => undefined) }}><Maximize2 size={15}/> Tela cheia</button>}
  </div>
}
