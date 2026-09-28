import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ArrowRight, CalendarDays, Copy, Download, Gift, Handshake, Plus, Search, TicketPercent, TrendingUp, Users } from 'lucide-react'
import type { PageProps } from '../App'
import { requireSupabase } from '../lib/supabase'
import { createRow, updateRow, useRows } from '../lib/useRows'
import { shiftCalendarDay, shopDateTime, shopMonthStart, shopToday } from '../lib/shopTime'
import { safeBrandImage } from '../shopBrand'
import { asText, date, money, type Row } from '../types'
import { Empty, Field, Loading, Modal, Notice, PageHeader, Panel } from '../ui'

type ClubTab = 'overview' | 'partners' | 'offers' | 'results'
type PartnerForm = { name: string; kind: string; description: string; contact: string; instagram_url: string; website_url: string; logo_url: string; notes: string; active: boolean }
type OfferForm = { partner_id: string; title: string; code: string; description: string; terms: string; service_id: string; discount_kind: 'percent' | 'fixed'; discount_value: string; max_discount: string; min_spend: string; starts_on: string; ends_on: string; usage_limit: string; per_client_limit: string; active: boolean }
type ClubTotals = { reservations: number; completed_visits: number; subtotal_cents: number; discount_cents: number; total_cents: number }
type ClubStats = ClubTotals & {
  active_partners: number; active_offers: number;
  by_partner?: (ClubTotals & { partner_id: string; partner_name?: string })[];
  by_offer?: (ClubTotals & { offer_id: string; partner_id: string; partner_name: string; title: string; code: string; lifetime_uses?: number })[];
}

const blankPartner: PartnerForm = { name: '', kind: '', description: '', contact: '', instagram_url: '', website_url: '', logo_url: '', notes: '', active: true }
const blankOffer: OfferForm = { partner_id: '', title: '', code: '', description: '', terms: '', service_id: '', discount_kind: 'percent', discount_value: '', max_discount: '', min_spend: '', starts_on: '', ends_on: '', usage_limit: '', per_client_limit: '1', active: true }

function numberFromInput(value: string): number {
  return Number(value.replace(',', '.'))
}

function optionalCents(value: string): number | null {
  return value.trim() ? Math.round(numberFromInput(value) * 100) : null
}

function offerBenefit(row: Row): string {
  if (row.discount_bps != null) return `${(Number(row.discount_bps) / 100).toLocaleString('pt-BR')}% de desconto`
  return `${money(row.discount_cents)} de desconto`
}

function offerState(row: Row, current: string, partner?: Row, availableIds?: Set<string> | null): { label: string; tone: string } {
  if (!row.active || partner?.active === false) return { label: 'Pausada', tone: 'paused' }
  if (String(row.starts_on) > current) return { label: 'Programada', tone: 'scheduled' }
  if (row.ends_on && String(row.ends_on) < current) return { label: 'Encerrada', tone: 'ended' }
  if (row.usage_limit != null && !availableIds) return { label: 'Verificando limite', tone: 'scheduled' }
  if (row.usage_limit != null && !availableIds?.has(String(row.id))) return { label: 'Esgotada', tone: 'ended' }
  return { label: 'Ativa', tone: 'active' }
}

function partnerInitials(name: string): string { return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'P' }
function secureUrl(value: string, instagramOnly = false): boolean {
  if (!value.trim()) return true
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' && (!instagramOnly || url.hostname === 'instagram.com' || url.hostname.endsWith('.instagram.com'))
  } catch { return false }
}
const zeroResults: ClubTotals = { reservations: 0, completed_visits: 0, subtotal_cents: 0, discount_cents: 0, total_cents: 0 }

function csvCell(value: unknown): string {
  const safe = String(value ?? '').replace(/^[\s]*([=+@-])/, "'$&")
  return `"${safe.replace(/"/g, '""')}"`
}

export function PartnerClubPage({ identity, role, notify }: PageProps) {
  const shop = identity.shop!
  const shopId = shop.id
  const currentShopDay = shopToday(shop.timezone || 'America/Sao_Paulo')
  const timezone = shop.timezone || 'America/Sao_Paulo'
  const canManage = role === 'master' || role === 'admin'
  const partners = useRows('partners', shopId)
  const offers = useRows('partner_offers', shopId)
  const services = useRows('services', shopId)
  const [tab, setTab] = useState<ClubTab>('overview')
  const [partnerEditor, setPartnerEditor] = useState<Row | 'new' | null>(null)
  const [partnerForm, setPartnerForm] = useState<PartnerForm>(blankPartner)
  const [offerEditor, setOfferEditor] = useState<Row | 'new' | null>(null)
  const [offerForm, setOfferForm] = useState<OfferForm>(blankOffer)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [partnerQuery, setPartnerQuery] = useState('')
  const [partnerStatus, setPartnerStatus] = useState<'all' | 'active' | 'paused'>('all')
  const [resultPartner, setResultPartner] = useState('all')
  const [resultOffer, setResultOffer] = useState('all')
  const [periodDraft, setPeriodDraft] = useState(() => ({ from: shopMonthStart(timezone), to: currentShopDay }))
  const [period, setPeriod] = useState(() => ({ from: shopMonthStart(timezone), to: currentShopDay }))
  const [stats, setStats] = useState<ClubStats | null>(null)
  const [statsError, setStatsError] = useState<string | null>(null)
  const [statsLoading, setStatsLoading] = useState(canManage)
  const [statsRevision, setStatsRevision] = useState(0)
  const [resultRows, setResultRows] = useState<Row[]>([])
  const [resultError, setResultError] = useState<string | null>(null)
  const [resultLoading, setResultLoading] = useState(canManage)
  const [selectedRedemption, setSelectedRedemption] = useState<Row | null>(null)
  const [redemptionSnapshot, setRedemptionSnapshot] = useState<Record<string, unknown> | null>(null)
  const [snapshotLoading, setSnapshotLoading] = useState(false)
  const [snapshotError, setSnapshotError] = useState<string | null>(null)
  const [availableOfferIds, setAvailableOfferIds] = useState<Set<string> | null>(null)
  const [availabilityError, setAvailabilityError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setAvailableOfferIds(null)
    setAvailabilityError(null)
    void requireSupabase().rpc('list_partner_offers', { p_barbershop_id: shopId }).then(({ data, error: queryError }) => {
      if (!active) return
      if (queryError) { setAvailabilityError('Não foi possível verificar os limites das ofertas.'); return }
      setAvailableOfferIds(new Set((data ?? []).map((row: { id: string }) => String(row.id))))
    })
    return () => { active = false }
  }, [shopId, statsRevision])

  useEffect(() => {
    if (!canManage) return
    let active = true
    async function loadStats() {
      setStatsLoading(true)
      setStatsError(null)
      setStats(null)
      try {
        const { data, error: queryError } = await requireSupabase().rpc('partner_program_stats', { p_barbershop_id: shopId, p_from: period.from, p_to: period.to })
        if (queryError) throw queryError
        if (active) setStats(data as ClubStats)
      } catch (problem) {
        if (active) setStatsError(problem instanceof Error ? problem.message : 'Não foi possível carregar os resultados.')
      } finally { if (active) setStatsLoading(false) }
    }
    void loadStats()
    return () => { active = false }
  }, [canManage, shopId, statsRevision, period.from, period.to])

  useEffect(() => {
    if (!selectedRedemption || !canManage) return
    let active = true
    setSnapshotLoading(true)
    setSnapshotError(null)
    setRedemptionSnapshot(null)
    void requireSupabase().from('partner_redemptions').select('offer_snapshot')
      .eq('barbershop_id', shopId).eq('id', selectedRedemption.id).single()
      .then(({ data, error: queryError }) => {
        if (!active) return
        if (queryError) setSnapshotError('Não foi possível consultar as regras desta reserva.')
        else setRedemptionSnapshot(data?.offer_snapshot && typeof data.offer_snapshot === 'object' ? data.offer_snapshot as Record<string, unknown> : null)
        setSnapshotLoading(false)
      })
    return () => { active = false }
  }, [selectedRedemption, shopId, canManage])

  useEffect(() => {
    if (!canManage) return
    let active = true
    async function loadRedemptions() {
      setResultLoading(true); setResultError(null); setResultRows([])
      try {
        const { data, error: queryError } = await requireSupabase().rpc('partner_program_redemptions', { p_barbershop_id: shopId, p_from: period.from, p_to: period.to })
        if (queryError) throw queryError
        if (active) setResultRows((data ?? []) as Row[])
      } catch (problem) {
        if (active) { setResultError(problem instanceof Error ? problem.message : 'Não foi possível carregar as reservas.'); setResultRows([]) }
      } finally { if (active) setResultLoading(false) }
    }
    void loadRedemptions()
    return () => { active = false }
  }, [canManage, shopId, statsRevision, period.from, period.to])

  const activePartners = useMemo(() => partners.rows.filter(row => row.active), [partners.rows])
  const shownPartners = useMemo(() => partners.rows.filter(row => {
    if (partnerStatus === 'active' && !row.active || partnerStatus === 'paused' && row.active) return false
    const needle = partnerQuery.trim().toLocaleLowerCase('pt-BR')
    return !needle || [row.name, row.kind].some(value => String(value || '').toLocaleLowerCase('pt-BR').includes(needle))
  }), [partners.rows, partnerQuery, partnerStatus])
  const liveOffers = useMemo(() => offers.rows.filter(row => offerState(row, currentShopDay, partners.rows.find(partner => partner.id === row.partner_id), availableOfferIds).tone === 'active'), [offers.rows, partners.rows, currentShopDay, availableOfferIds])
  const shownRedemptions = useMemo(() => resultRows.filter(row => (resultPartner === 'all' || row.partner_id === resultPartner) && (resultOffer === 'all' || row.offer_id === resultOffer)), [resultRows, resultPartner, resultOffer])
  const selectedStats = !stats ? null : resultOffer !== 'all' ? stats.by_offer?.find(item => item.offer_id === resultOffer) || zeroResults : resultPartner !== 'all' ? stats.by_partner?.find(item => item.partner_id === resultPartner) || zeroResults : stats
  const shownOfferStats = (stats?.by_offer || []).filter(item => (resultPartner === 'all' || item.partner_id === resultPartner) && (resultOffer === 'all' || item.offer_id === resultOffer))
  const resultPartners = useMemo(() => {
    const choices = new Map<string, string>()
    partners.rows.forEach(row => choices.set(String(row.id), String(row.name)))
    stats?.by_partner?.forEach(item => choices.set(item.partner_id, item.partner_name || choices.get(item.partner_id) || 'Parceiro'))
    return [...choices].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))
  }, [partners.rows, stats])
  const resultOffers = useMemo(() => {
    const choices = new Map<string, { partnerId: string; code: string }>()
    offers.rows.forEach(row => choices.set(String(row.id), { partnerId: String(row.partner_id), code: String(row.code) }))
    stats?.by_offer?.forEach(item => choices.set(item.offer_id, { partnerId: item.partner_id, code: item.code }))
    return [...choices].sort((a, b) => a[1].code.localeCompare(b[1].code, 'pt-BR'))
  }, [offers.rows, stats])

  function applyPeriod(from: string, to: string) {
    if (!from || !to || from > to) { setStatsError('Informe um período válido.'); return }
    const days = Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1
    if (!Number.isFinite(days) || days > 370) { setStatsError('O período máximo é de 370 dias.'); return }
    setStatsError(null)
    setPeriodDraft({ from, to })
    setPeriod({ from, to })
  }

  function exportRedemptions() {
    if (resultLoading || resultError || !shownRedemptions.length) return
    const headings = ['Data do atendimento', 'Parceiro', 'Cupom', 'Estado', 'Valor original (R$)', 'Desconto (R$)', 'Valor reservado (R$)']
    const values = shownRedemptions.map(row => [
      shopDateTime(row.appointment_starts_at, timezone),
      partners.rows.find(item => item.id === row.partner_id)?.name || '',
      row.code_snapshot,
      row.appointment_status === 'cancelled' ? 'Cancelada' : row.appointment_status === 'completed' ? 'Concluída' : 'Agendada',
      (Number(row.subtotal_cents || 0) / 100).toFixed(2).replace('.', ','),
      (Number(row.discount_cents || 0) / 100).toFixed(2).replace('.', ','),
      (Number(row.total_cents || 0) / 100).toFixed(2).replace('.', ','),
    ])
    const csv = '\uFEFF' + [headings, ...values].map(line => line.map(csvCell).join(';')).join('\r\n')
    const link = document.createElement('a')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    link.href = url
    link.download = `parceiros-${shop.slug}-${period.from}-${period.to}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  function openPartner(row?: Row) {
    setError(null)
    setPartnerEditor(row || 'new')
    setPartnerForm(row ? {
      name: String(row.name || ''), kind: String(row.kind || ''), description: String(row.description || ''),
      contact: String(row.contact || ''), instagram_url: String(row.instagram_url || ''), website_url: String(row.website_url || ''),
      logo_url: String(row.logo_url || ''), notes: String(row.notes || ''), active: row.active !== false,
    } : blankPartner)
  }

  function openOffer(row?: Row) {
    setError(null)
    setOfferEditor(row || 'new')
    setOfferForm(row ? {
      partner_id: String(row.partner_id || ''), title: String(row.title || ''), code: String(row.code || ''),
      description: String(row.description || ''), terms: String(row.terms || ''), service_id: String(row.service_id || ''),
      discount_kind: row.discount_bps != null ? 'percent' : 'fixed',
      discount_value: row.discount_bps != null ? String(Number(row.discount_bps) / 100) : String(Number(row.discount_cents || 0) / 100),
      max_discount: row.max_discount_cents == null ? '' : String(Number(row.max_discount_cents) / 100),
      min_spend: row.min_spend_cents == null ? '' : String(Number(row.min_spend_cents) / 100),
      starts_on: String(row.starts_on || currentShopDay), ends_on: String(row.ends_on || ''),
      usage_limit: row.usage_limit == null ? '' : String(row.usage_limit), per_client_limit: row.per_client_limit == null ? '' : String(row.per_client_limit),
      active: row.active !== false,
    } : { ...blankOffer, partner_id: activePartners[0]?.id || '', starts_on: currentShopDay })
  }

  async function savePartner(event: FormEvent) {
    event.preventDefault()
    if (!partnerEditor || !canManage) return
    if (!secureUrl(partnerForm.instagram_url, true)) { setError('O Instagram deve usar um endereço https://instagram.com válido.'); return }
    if (!secureUrl(partnerForm.website_url) || (partnerForm.logo_url.trim() && !safeBrandImage(partnerForm.logo_url.trim()))) { setError('Site e logo precisam usar endereço HTTPS válido.'); return }
    setError(null); setSaving(true)
    try {
      const values = {
        name: partnerForm.name.trim(), kind: partnerForm.kind.trim() || null, description: partnerForm.description.trim() || null,
        contact: partnerForm.contact.trim() || null, instagram_url: partnerForm.instagram_url.trim() || null,
        website_url: partnerForm.website_url.trim() || null, logo_url: partnerForm.logo_url.trim() || null,
        notes: partnerForm.notes.trim() || null, active: partnerForm.active,
      }
      if (partnerEditor === 'new') await createRow('partners', { ...values, barbershop_id: shopId })
      else await updateRow('partners', partnerEditor.id, values)
      await partners.refresh()
      setStatsRevision(value => value + 1)
      notify(partnerEditor === 'new' ? 'Parceiro cadastrado.' : 'Parceiro atualizado.')
      setPartnerEditor(null)
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Não foi possível salvar o parceiro.') }
    finally { setSaving(false) }
  }

  async function saveOffer(event: FormEvent) {
    event.preventDefault()
    if (!offerEditor || !canManage) return
    const code = offerForm.code.trim().toUpperCase()
    const discount = numberFromInput(offerForm.discount_value)
    const maxDiscount = optionalCents(offerForm.max_discount)
    const minSpend = optionalCents(offerForm.min_spend) ?? 0
    if (!/^[A-Z0-9-]{4,24}$/.test(code)) { setError('Use de 4 a 24 letras, números ou hífens no código.'); return }
    if (offerForm.ends_on && offerForm.ends_on < offerForm.starts_on) { setError('Informe um fim igual ou posterior ao início.'); return }
    if (!Number.isFinite(discount) || discount <= 0 || (offerForm.discount_kind === 'percent' && discount > 100)) { setError('Informe um desconto válido.'); return }
    if (!Number.isFinite(minSpend) || maxDiscount != null && !Number.isFinite(maxDiscount) || maxDiscount != null && maxDiscount <= 0 || minSpend < 0) { setError('Os limites de valor precisam ser válidos e não negativos.'); return }
    if (offerEditor === 'new' && !activePartners.some(row => row.id === offerForm.partner_id)) { setError('Selecione um parceiro ativo.'); return }
    setError(null); setSaving(true)
    try {
      const values = {
        partner_id: offerForm.partner_id, title: offerForm.title.trim(), code, description: offerForm.description.trim() || null,
        terms: offerForm.terms.trim() || null, service_id: offerForm.service_id || null,
        discount_bps: offerForm.discount_kind === 'percent' ? Math.round(discount * 100) : null,
        discount_cents: offerForm.discount_kind === 'fixed' ? Math.round(discount * 100) : null,
        max_discount_cents: offerForm.discount_kind === 'percent' ? maxDiscount : null,
        min_spend_cents: minSpend, starts_on: offerForm.starts_on, ends_on: offerForm.ends_on || null,
        usage_limit: offerForm.usage_limit.trim() ? Number(offerForm.usage_limit) : null,
        per_client_limit: offerForm.per_client_limit.trim() ? Number(offerForm.per_client_limit) : null,
        active: offerForm.active,
      }
      if (offerEditor === 'new') await createRow('partner_offers', { ...values, barbershop_id: shopId })
      else await updateRow('partner_offers', offerEditor.id, values)
      await offers.refresh()
      setStatsRevision(value => value + 1)
      notify(offerEditor === 'new' ? 'Oferta criada.' : 'Oferta atualizada.')
      setOfferEditor(null)
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Não foi possível salvar a oferta.') }
    finally { setSaving(false) }
  }

  async function togglePartner(row: Row) {
    setSaving(true); setError(null)
    try { await updateRow('partners', row.id, { active: !row.active }); await partners.refresh(); setStatsRevision(value => value + 1); notify(row.active ? 'Parceiro pausado.' : 'Parceiro reativado.') }
    catch (problem) { setError(problem instanceof Error ? problem.message : 'Falha ao atualizar parceiro.') }
    finally { setSaving(false) }
  }

  async function toggleOffer(row: Row) {
    setSaving(true); setError(null)
    try { await updateRow('partner_offers', row.id, { active: !row.active }); await offers.refresh(); setStatsRevision(value => value + 1); notify(row.active ? 'Oferta pausada.' : 'Oferta reativada.') }
    catch (problem) { setError(problem instanceof Error ? problem.message : 'Falha ao atualizar oferta.') }
    finally { setSaving(false) }
  }

  async function copyLink(row: Row) {
    const link = `${window.location.origin}/b/${shop.slug}/agendar?ref=${encodeURIComponent(String(row.code))}`
    try { await navigator.clipboard.writeText(link); notify('Link de indicação copiado.') }
    catch { setError(`Não foi possível copiar automaticamente. Link: ${link}`) }
  }

  const panelError = error || partners.error || offers.error || services.error || availabilityError
  const tabLabels: { id: ClubTab; label: string; icon: typeof Handshake }[] = [
    { id: 'overview', label: 'Visão geral', icon: Handshake }, { id: 'partners', label: 'Parceiros', icon: Users },
    { id: 'offers', label: 'Ofertas e cupons', icon: TicketPercent }, ...(canManage ? [{ id: 'results' as const, label: 'Resultados', icon: TrendingUp }] : []),
  ]

  return <div className="page-stack partner-club">
    <PageHeader eyebrow="REDE DE NEGÓCIOS" title="Clube do Parceiro" description="Crie benefícios para clientes, divulgue links de indicação e acompanhe reservas atribuídas a cada parceiro." action={canManage && <button className="button primary" onClick={() => { setTab('partners'); openPartner() }}><Plus size={17}/> Novo parceiro</button>}/>
    <Notice text={panelError || (canManage && tab !== 'results' ? statsError : null)}/>
    <div className="partner-club-tabs" role="tablist" aria-label="Seções do Clube do Parceiro">{tabLabels.map(item => { const Icon = item.icon; return <button type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'active' : ''} key={item.id} onClick={() => setTab(item.id)}><Icon size={16}/>{item.label}</button> })}</div>

    {tab === 'overview' && <div className="partner-club-overview" role="tabpanel" aria-label="Visão geral do Clube do Parceiro"><div className="partner-club-hero"><div><span>PROGRAMA DE PARCERIAS</span><h2>Um benefício real a cada indicação.</h2><p>Cada oferta tem regras, um código próprio e um link para agendar. O desconto só entra no valor da reserva depois que o cliente confirma um horário elegível.</p><button className="button outline" onClick={() => setTab('offers')}>Ver ofertas <ArrowRight size={16}/></button></div><div className="partner-club-hero-mark"><Handshake size={42}/></div></div><div className="partner-club-stats"><div><span>Parceiros ativos</span><strong>{canManage ? stats?.active_partners ?? (statsLoading ? '…' : '—') : activePartners.length}</strong><small>{canManage ? 'Na barbearia' : 'Na lista carregada (até 500)'}</small></div><div><span>Ofertas ativas</span><strong>{canManage ? stats?.active_offers ?? (statsLoading ? '…' : '—') : liveOffers.length}</strong><small>{canManage ? 'Disponíveis hoje' : 'Na lista carregada (até 500)'}</small></div><div><span>Reservas atribuídas</span><strong>{canManage ? stats?.reservations ?? (statsLoading ? '…' : '—') : '—'}</strong><small>{canManage ? `De ${date(period.from)} a ${date(period.to)} · não é pagamento` : 'Disponível para administração'}</small></div><div><span>Benefício concedido</span><strong>{canManage && stats ? money(stats.discount_cents) : statsLoading ? '…' : '—'}</strong><small>Em reservas válidas</small></div></div><div className="partner-club-overview-grid"><Panel title="Como funciona" subtitle="Fluxo completo e verificável"><ol className="partner-club-steps"><li><span>1</span><div><strong>Cadastre o parceiro</strong><p>Defina perfil e contato para manter a relação organizada.</p></div></li><li><span>2</span><div><strong>Publique uma oferta</strong><p>Escolha código, benefício, serviço, vigência e limite de uso.</p></div></li><li><span>3</span><div><strong>Compartilhe o link</strong><p>O cliente aplica o código e vê o valor final antes de reservar.</p></div></li><li><span>4</span><div><strong>Acompanhe a atribuição</strong><p>Uma reserva confirmada registra parceiro, código e desconto concedido.</p></div></li></ol></Panel><Panel title="Ofertas em destaque" subtitle="Prontas para compartilhar">{liveOffers.length ? <div className="partner-club-featured">{liveOffers.slice(0, 3).map(row => <div key={row.id}><span className="partner-club-featured-icon"><Gift size={18}/></span><div><strong>{asText(row.title)}</strong><small>{asText(partners.rows.find(item => item.id === row.partner_id)?.name)} · {offerBenefit(row)}</small></div><button type="button" onClick={() => void copyLink(row)} title="Copiar link de indicação" aria-label={`Copiar link da oferta ${row.title}`}><Copy size={16}/></button></div>)}</div> : <Empty title="Nenhuma oferta ativa" text={canManage ? 'Cadastre um parceiro e crie a primeira oferta.' : 'A administração ainda não publicou ofertas.'}/>}</Panel></div></div>}

    {tab === 'partners' && <section className="partner-club-section" role="tabpanel" aria-label="Parceiros cadastrados"><div className="partner-club-section-head"><div><h2>Parceiros da barbearia</h2><p>Perfil, contato e resultados de {date(period.from)} a {date(period.to)}.</p></div>{canManage && <button type="button" className="button primary" onClick={() => openPartner()}><Plus size={16}/> Cadastrar parceiro</button>}</div><div className="partner-club-search"><label><Search size={17} aria-hidden="true"/><input type="search" value={partnerQuery} onChange={event => setPartnerQuery(event.target.value)} placeholder="Buscar por nome ou tipo" aria-label="Buscar parceiro por nome ou tipo"/></label><select value={partnerStatus} onChange={event => setPartnerStatus(event.target.value as 'all' | 'active' | 'paused')} aria-label="Filtrar estado dos parceiros"><option value="all">Todos os estados</option><option value="active">Ativos</option><option value="paused">Pausados</option></select><small>{shownPartners.length} de {partners.rows.length} parceiros na lista</small></div>{partners.error ? null : partners.loading ? <Loading text="Carregando parceiros..."/> : shownPartners.length ? <div className="partner-club-partners">{shownPartners.map(row => <article key={row.id} className="partner-club-partner"><div className="partner-club-partner-head"><div className="partner-club-avatar">{safeBrandImage(row.logo_url) ? <img src={safeBrandImage(row.logo_url)!} alt=""/> : partnerInitials(String(row.name))}</div><span className={`partner-club-badge ${row.active ? 'active' : 'paused'}`}>{row.active ? 'Ativo' : 'Pausado'}</span></div><h3>{asText(row.name)}</h3><small>{asText(row.kind)}</small><p>{row.description ? String(row.description) : 'Adicione uma descrição da parceria para orientar a equipe.'}</p><div className="partner-club-partner-meta"><span>{offers.rows.filter(offer => offer.partner_id === row.id).length} ofertas</span>{Boolean(row.instagram_url) && <a href={String(row.instagram_url)} target="_blank" rel="noreferrer">Instagram <ArrowRight size={14}/></a>}</div>{canManage && <div className="partner-club-partner-performance" aria-label={`Desempenho de ${row.name} no período`}><div><strong>{stats?.by_partner?.find(item => item.partner_id === row.id)?.reservations ?? (statsLoading ? '…' : '—')}</strong><span>reservas</span></div><div><strong>{stats?.by_partner?.find(item => item.partner_id === row.id)?.completed_visits ?? (statsLoading ? '…' : '—')}</strong><span>visitas</span></div><div><strong>{stats?.by_partner?.find(item => item.partner_id === row.id) ? money(stats.by_partner.find(item => item.partner_id === row.id)!.discount_cents) : statsLoading ? '…' : '—'}</strong><span>benefício</span></div></div>}{canManage && <div className="partner-club-card-actions"><button className="button outline" type="button" onClick={() => { setResultPartner(String(row.id)); setResultOffer('all'); setTab('results') }}>Ver resultados</button><button className="button outline" type="button" onClick={() => openPartner(row)}>Editar perfil</button><button className="button ghost" type="button" disabled={saving} onClick={() => void togglePartner(row)}>{row.active ? 'Pausar' : 'Reativar'}</button></div>}</article>)}</div> : <Panel><Empty title={partners.rows.length ? 'Nenhum parceiro encontrado' : 'Nenhum parceiro cadastrado'} text={partners.rows.length ? 'Tente outro nome ou estado.' : 'Cadastre empresas e criadores para começar a distribuir benefícios.'} action={canManage && !partners.rows.length && <button className="button primary" onClick={() => openPartner()}>Cadastrar parceiro</button>}/></Panel>}</section>}

    {tab === 'offers' && <section className="partner-club-section" role="tabpanel" aria-label="Ofertas e cupons"><div className="partner-club-section-head"><div><h2>Ofertas e cupons</h2><p>Cada código pertence a um parceiro e só vale dentro das regras publicadas.</p></div>{canManage && <button type="button" className="button primary" disabled={!activePartners.length} onClick={() => openOffer()}><Plus size={16}/> Nova oferta</button>}</div>{!activePartners.length && canManage && <Notice kind="info" text="Cadastre e ative um parceiro antes de criar a oferta."/>}{offers.error ? null : offers.loading ? <Loading text="Carregando ofertas..."/> : offers.rows.length ? <div className="partner-club-offers">{offers.rows.map(row => { const partner = partners.rows.find(item => item.id === row.partner_id); const state = offerState(row, currentShopDay, partner, availableOfferIds); const service = services.rows.find(item => item.id === row.service_id); return <article key={row.id} className="partner-club-offer"><div className="partner-club-offer-top"><span className={`partner-club-badge ${state.tone}`}>{state.label}</span><span className="partner-club-offer-partner">{asText(partner?.name)}</span></div><h3>{asText(row.title)}</h3><p>{asText(row.description)}</p><div className="partner-club-benefit"><Gift size={18}/><strong>{offerBenefit(row)}</strong></div><div className="partner-club-offer-code"><span>CÓDIGO</span><strong>{asText(row.code)}</strong><button type="button" onClick={() => void copyLink(row)} aria-label={`Copiar link da oferta ${row.title}`} title="Copiar link"><Copy size={16}/></button></div><div className="partner-club-offer-rules"><span><CalendarDays size={14}/>{date(row.starts_on)} a {row.ends_on ? date(row.ends_on) : "sem prazo final"}</span><span>{service ? `Somente ${asText(service.name)}` : 'Todos os serviços'}</span><span>{Number(row.min_spend_cents || 0) > 0 ? `Mínimo ${money(row.min_spend_cents)}` : 'Sem gasto mínimo'}</span><span>{Boolean(row.usage_limit) ? canManage ? `Usos: ${stats?.by_offer?.find(item => item.offer_id === row.id)?.lifetime_uses ?? '—'} / ${row.usage_limit}` : `Limite total: ${row.usage_limit}` : 'Sem limite total'}</span></div>{Boolean(row.terms) && <p className="partner-club-offer-terms">{String(row.terms)}</p>}{canManage && <div className="partner-club-card-actions"><button className="button outline" onClick={() => openOffer(row)}>Editar regras</button><button className="button ghost" disabled={saving} onClick={() => void toggleOffer(row)}>{row.active ? 'Pausar' : 'Reativar'}</button></div>}</article> })}</div> : <Panel><Empty title="Nenhuma oferta publicada" text="Crie um cupom com regras e prazo para começar a receber indicações." action={canManage && activePartners.length > 0 && <button className="button primary" onClick={() => openOffer()}>Criar oferta</button>}/></Panel>}</section>}

    {tab === 'results' && canManage && <section className="partner-club-section" role="tabpanel" aria-label="Resultados das parcerias">
      <div className="partner-club-section-head"><div><h2>Resultados das indicações</h2><p>Reservas com cupom, visitas concluídas e benefício concedido. Estes valores não representam pagamentos recebidos nem comissões.</p></div></div>
      <div className="partner-club-report-controls">
        <div className="partner-club-quick-ranges"><button type="button" onClick={() => applyPeriod(shopMonthStart(timezone), currentShopDay)}>Este mês</button><button type="button" onClick={() => applyPeriod(shiftCalendarDay(currentShopDay, -29), currentShopDay)}>30 dias</button><button type="button" onClick={() => applyPeriod(shiftCalendarDay(currentShopDay, -89), currentShopDay)}>90 dias</button></div>
        <form className="partner-club-range" onSubmit={event => { event.preventDefault(); applyPeriod(periodDraft.from, periodDraft.to) }}><label>De <input type="date" value={periodDraft.from} onChange={event => setPeriodDraft({ ...periodDraft, from: event.target.value })}/></label><label>Até <input type="date" value={periodDraft.to} onChange={event => setPeriodDraft({ ...periodDraft, to: event.target.value })}/></label><button type="submit" className="button outline">Aplicar período</button></form>
        <div className="partner-club-report-filters">
          <label>Parceiro<select value={resultPartner} onChange={event => { setResultPartner(event.target.value); setResultOffer('all') }}><option value="all">Todos</option>{resultPartners.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
          <label>Cupom<select value={resultOffer} onChange={event => setResultOffer(event.target.value)}><option value="all">Todos</option>{resultOffers.filter(([, item]) => resultPartner === 'all' || item.partnerId === resultPartner).map(([id, item]) => <option key={id} value={id}>{item.code}</option>)}</select></label>
        </div>
      </div>
      <Notice text={statsError}/>
      <div className="partner-club-stats"><div><span>Reservas válidas</span><strong>{selectedStats?.reservations ?? (statsLoading ? '…' : '—')}</strong><small>Com cupom aplicado</small></div><div><span>Visitas concluídas</span><strong>{selectedStats?.completed_visits ?? (statsLoading ? '…' : '—')}</strong><small>Atendimentos realizados</small></div><div><span>Desconto concedido</span><strong>{selectedStats ? money(selectedStats.discount_cents) : statsLoading ? '…' : '—'}</strong><small>Benefício ao cliente</small></div><div><span>Valor das reservas</span><strong>{selectedStats ? money(selectedStats.total_cents) : statsLoading ? '…' : '—'}</strong><small>Não é receita recebida</small></div></div>
      <Panel title="Desempenho por cupom" subtitle={`Reservas entre ${date(period.from)} e ${date(period.to)} · valores de reserva, não pagamentos`}><div className="partner-club-table-scroll"><table><thead><tr><th>Cupom</th><th>Parceiro</th><th>Reservas</th><th>Visitas</th><th>Desconto</th><th>Valor reservado</th></tr></thead><tbody>{shownOfferStats.map(item => <tr key={item.offer_id}><td><strong>{item.code}</strong></td><td>{item.partner_name}</td><td>{item.reservations}</td><td>{item.completed_visits}</td><td>{money(item.discount_cents)}</td><td>{money(item.total_cents)}</td></tr>)}</tbody></table>{!shownOfferStats.length && !statsLoading && <Empty title="Nenhum uso de cupom no período" text="Ajuste as datas ou compartilhe uma oferta ativa."/>}{statsLoading && <Loading text="Calculando resultados..."/>}</div></Panel>
      <Panel title="Reservas atribuídas" subtitle="Até 500 reservas mais recentes no período; filtros e CSV operam sobre essas 500 linhas.">
        <div className="partner-club-export"><span>Datas no fuso da barbearia · Cancelamentos identificados · CSV sem dados do cliente</span><button type="button" className="button outline" disabled={resultLoading || Boolean(resultError) || !shownRedemptions.length} onClick={exportRedemptions}><Download size={16}/> Exportar CSV ({shownRedemptions.length})</button></div>
        <Notice text={resultError}/>
        {resultLoading ? <Loading text="Carregando reservas..."/> : resultError ? null : <div className="partner-club-table-scroll"><table><thead><tr><th>Data do atendimento</th><th>Parceiro</th><th>Cupom</th><th>Estado</th><th>Reserva</th><th>Desconto</th><th>Valor final</th><th>Regras</th></tr></thead><tbody>{shownRedemptions.map(row => <tr key={row.id}><td>{shopDateTime(row.appointment_starts_at, timezone)}</td><td>{asText(partners.rows.find(item => item.id === row.partner_id)?.name || stats?.by_partner?.find(item => item.partner_id === row.partner_id)?.partner_name)}</td><td><strong>{asText(row.code_snapshot)}</strong></td><td>{row.appointment_status === 'cancelled' ? 'Cancelada' : row.appointment_status === 'completed' ? 'Concluída' : 'Agendada'}</td><td>{money(row.subtotal_cents)}</td><td>{money(row.discount_cents)}</td><td>{money(row.total_cents)}</td><td><button type="button" className="partner-club-detail-link" onClick={() => setSelectedRedemption(row)}>Ver regras</button></td></tr>)}</tbody></table>{!shownRedemptions.length && <Empty title="Nenhuma reserva atribuída" text="Quando um cliente aplicar o cupom e confirmar o horário, a reserva aparecerá aqui."/>}</div>}
      </Panel>
    </section>}

    {selectedRedemption && <Modal title={`Regras da reserva · ${asText(selectedRedemption.code_snapshot)}`} subtitle="Condições registradas no momento da confirmação." onClose={() => setSelectedRedemption(null)} wide>
      <Notice text={snapshotError}/>
      {snapshotLoading ? <Loading text="Consultando o histórico..."/> : redemptionSnapshot ? <div className="partner-club-history">
        <div className="detail-list">
          <div><span>Parceiro</span><strong>{asText(redemptionSnapshot.partner_name)}</strong></div>
          <div><span>Oferta</span><strong>{asText(redemptionSnapshot.title)}</strong></div>
          <div><span>Serviço elegível</span><strong>{redemptionSnapshot.service_name ? asText(redemptionSnapshot.service_name) : 'Todos os serviços'}</strong></div>
          <div><span>Desconto previsto</span><strong>{redemptionSnapshot.discount_bps != null ? `${(Number(redemptionSnapshot.discount_bps) / 100).toLocaleString('pt-BR')}%` : money(redemptionSnapshot.discount_cents)}</strong></div>
          <div><span>Gasto mínimo</span><strong>{money(redemptionSnapshot.min_spend_cents)}</strong></div>
          <div><span>Teto do desconto</span><strong>{redemptionSnapshot.max_discount_cents != null ? money(redemptionSnapshot.max_discount_cents) : 'Sem teto'}</strong></div>
          <div><span>Vigência</span><strong>{date(redemptionSnapshot.starts_on)} a {redemptionSnapshot.ends_on ? date(redemptionSnapshot.ends_on) : 'sem prazo final'}</strong></div>
          <div><span>Limite total / por cliente</span><strong>{redemptionSnapshot.usage_limit == null ? 'Sem limite' : String(redemptionSnapshot.usage_limit)} / {redemptionSnapshot.per_client_limit == null ? 'Sem limite' : String(redemptionSnapshot.per_client_limit)}</strong></div>
          <div><span>Valor original</span><strong>{money(redemptionSnapshot.subtotal_cents)}</strong></div>
          <div><span>Desconto aplicado</span><strong>{money(redemptionSnapshot.applied_discount_cents)}</strong></div>
          <div><span>Valor da reserva</span><strong>{money(redemptionSnapshot.total_cents)}</strong></div>
        </div>
        {Boolean(redemptionSnapshot.description) && <p>{asText(redemptionSnapshot.description)}</p>}
        {Boolean(redemptionSnapshot.terms) && <div className="partner-club-history-terms"><strong>Regras exibidas ao cliente</strong><p>{asText(redemptionSnapshot.terms)}</p></div>}
      </div> : !snapshotError ? <p className="muted">Esta reserva é anterior ao registro das condições históricas da oferta.</p> : null}
    </Modal>}

    {partnerEditor && <Modal title={partnerEditor === 'new' ? 'Novo parceiro' : 'Editar parceiro'} subtitle="Após a primeira reserva indicada, o nome fica fixo no histórico. Para mudar a identidade, cadastre outro parceiro." onClose={() => setPartnerEditor(null)} wide><form className="form-grid partner-club-form" onSubmit={savePartner}><div className="form-row"><Field label="Nome da empresa ou parceiro"><input required maxLength={120} value={partnerForm.name} onChange={event => setPartnerForm({ ...partnerForm, name: event.target.value })}/></Field><Field label="Tipo"><input maxLength={80} placeholder="Empresa, criador, profissional..." value={partnerForm.kind} onChange={event => setPartnerForm({ ...partnerForm, kind: event.target.value })}/></Field></div><Field label="Descrição da parceria"><textarea rows={3} maxLength={500} value={partnerForm.description} onChange={event => setPartnerForm({ ...partnerForm, description: event.target.value })}/></Field><div className="form-row"><Field label="Contato interno"><input maxLength={180} value={partnerForm.contact} onChange={event => setPartnerForm({ ...partnerForm, contact: event.target.value })}/></Field><Field label="Instagram"><input type="url" placeholder="https://instagram.com/..." value={partnerForm.instagram_url} onChange={event => setPartnerForm({ ...partnerForm, instagram_url: event.target.value })}/></Field></div><div className="form-row"><Field label="Site"><input type="url" placeholder="https://" value={partnerForm.website_url} onChange={event => setPartnerForm({ ...partnerForm, website_url: event.target.value })}/></Field><Field label="Logo (URL)"><input type="url" placeholder="https://" value={partnerForm.logo_url} onChange={event => setPartnerForm({ ...partnerForm, logo_url: event.target.value })}/></Field></div><Field label="Notas internas"><textarea rows={2} value={partnerForm.notes} onChange={event => setPartnerForm({ ...partnerForm, notes: event.target.value })}/></Field><label className="check-field"><input type="checkbox" checked={partnerForm.active} onChange={event => setPartnerForm({ ...partnerForm, active: event.target.checked })}/> Parceiro ativo</label><Notice text={error}/><div className="form-actions"><button type="button" className="button ghost" onClick={() => setPartnerEditor(null)}>Cancelar</button><button className="button primary" type="submit" disabled={saving}>{saving ? 'Salvando...' : 'Salvar parceiro'}</button></div></form></Modal>}

    {offerEditor && <Modal title={offerEditor === 'new' ? 'Nova oferta' : 'Editar oferta'} subtitle="Parceiro e código ficam fixos após criar; o título também fica fixo após a primeira reserva. Para trocar a identidade, crie outra oferta." onClose={() => setOfferEditor(null)} wide><form className="form-grid partner-club-form" onSubmit={saveOffer}><div className="form-row"><Field label="Parceiro"><select required disabled={offerEditor !== 'new'} value={offerForm.partner_id} onChange={event => setOfferForm({ ...offerForm, partner_id: event.target.value })}><option value="">Selecione</option>{partners.rows.map(row => <option key={row.id} value={row.id}>{String(row.name)}</option>)}</select></Field><Field label="Nome da oferta"><input required maxLength={120} value={offerForm.title} onChange={event => setOfferForm({ ...offerForm, title: event.target.value })}/></Field></div><div className="form-row"><Field label="Código de indicação"><input required disabled={offerEditor !== 'new'} maxLength={24} placeholder="KINGS-CLUBE" value={offerForm.code} onChange={event => setOfferForm({ ...offerForm, code: event.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '') })}/></Field><Field label="Serviço elegível"><select value={offerForm.service_id} onChange={event => setOfferForm({ ...offerForm, service_id: event.target.value })}><option value="">Todos os serviços</option>{services.rows.filter(row => row.active).map(row => <option key={row.id} value={row.id}>{String(row.name)}</option>)}</select></Field></div><Field label="Benefício para o cliente"><textarea rows={2} required value={offerForm.description} onChange={event => setOfferForm({ ...offerForm, description: event.target.value })} placeholder="Ex.: Desconto no primeiro corte agendado com este parceiro."/></Field><div className="form-row"><Field label="Tipo de desconto"><select value={offerForm.discount_kind} onChange={event => setOfferForm({ ...offerForm, discount_kind: event.target.value as 'percent' | 'fixed' })}><option value="percent">Percentual (%)</option><option value="fixed">Valor fixo (R$)</option></select></Field><Field label={offerForm.discount_kind === 'percent' ? 'Desconto (%)' : 'Desconto (R$)'}><input type="number" min="0.01" max={offerForm.discount_kind === 'percent' ? '100' : undefined} step="0.01" required value={offerForm.discount_value} onChange={event => setOfferForm({ ...offerForm, discount_value: event.target.value })}/></Field></div><div className="form-row"><Field label="Gasto mínimo (R$)"><input type="number" min="0" step="0.01" value={offerForm.min_spend} onChange={event => setOfferForm({ ...offerForm, min_spend: event.target.value })}/></Field><Field label="Teto do desconto (R$)"><input type="number" min="0.01" step="0.01" disabled={offerForm.discount_kind === 'fixed'} value={offerForm.max_discount} onChange={event => setOfferForm({ ...offerForm, max_discount: event.target.value })}/></Field></div><div className="form-row"><Field label="Início"><input type="date" required value={offerForm.starts_on} onChange={event => setOfferForm({ ...offerForm, starts_on: event.target.value })}/></Field><Field label="Fim (opcional)"><input type="date" min={offerForm.starts_on} value={offerForm.ends_on} onChange={event => setOfferForm({ ...offerForm, ends_on: event.target.value })}/></Field></div><div className="form-row"><Field label="Limite total de usos"><input type="number" min="1" step="1" placeholder="Sem limite" value={offerForm.usage_limit} onChange={event => setOfferForm({ ...offerForm, usage_limit: event.target.value })}/></Field><Field label="Usos por cliente"><input type="number" min="1" step="1" placeholder="Sem limite" value={offerForm.per_client_limit} onChange={event => setOfferForm({ ...offerForm, per_client_limit: event.target.value })}/></Field></div><Field label="Regras exibidas ao cliente"><textarea rows={3} required value={offerForm.terms} onChange={event => setOfferForm({ ...offerForm, terms: event.target.value })} placeholder="Ex.: Válido somente no período informado. Não acumulativo com assinatura."/></Field><label className="check-field"><input type="checkbox" checked={offerForm.active} onChange={event => setOfferForm({ ...offerForm, active: event.target.checked })}/> Oferta ativa</label><Notice text={error}/><div className="form-actions"><button type="button" className="button ghost" onClick={() => setOfferEditor(null)}>Cancelar</button><button className="button primary" type="submit" disabled={saving}>{saving ? 'Salvando...' : 'Salvar oferta'}</button></div></form></Modal>}
  </div>
}
