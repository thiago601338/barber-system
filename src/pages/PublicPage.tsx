import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import { ArrowLeft, ArrowUpRight, CalendarDays, Camera, Clock3, CreditCard, Gift, Scissors, ShoppingBag, TicketPercent, UserRound } from 'lucide-react'
import { authedApi, isConfigured, requireSupabase } from '../lib/supabase'
import { productImageUrl } from '../lib/productImages'
import { shopClock, shopDateTime, shopToday } from '../lib/shopTime'
import { TeamAvatar } from '../TeamAvatar'
import { asText, money, type Row, type Shop } from '../types'
import { Empty, Field, Loading, Notice, PrimaryButton } from '../ui'
import { brandStyle, readBrandTheme, safeBrandImage, safeInstagramUrl, ShopBrand } from '../shopBrand'
import '../styles-products.css'

function safeLink(url: unknown) { try { const parsed = new URL(String(url)); return ['http:','https:'].includes(parsed.protocol) ? parsed.href : undefined } catch { return undefined } }
type PartnerPublicOffer = { id: string; partner_name: string; partner_logo_url?: string | null; title: string; code: string; description?: string | null; terms?: string | null; discount_bps?: number | null; discount_cents?: number | null; service_id?: string | null; starts_on?: string; ends_on?: string }
type PartnerQuote = { offer_id: string; partner_name: string; title: string; code: string; subtotal_cents: number; discount_cents: number; total_cents: number; terms?: string | null }
function partnerBenefit(offer: PartnerPublicOffer): string { return offer.discount_bps != null ? `${(Number(offer.discount_bps) / 100).toLocaleString('pt-BR')}% de desconto` : `${money(offer.discount_cents)} de desconto` }

export function PublicPage() {
  const parts = window.location.pathname.split('/').filter(Boolean)
  const slug = parts[1]
  const bookingPage = parts[2] === 'agendar'
  const [shop, setShop] = useState<Shop | null>(null)
  const [services, setServices] = useState<Row[]>([])
  const [products, setProducts] = useState<Row[]>([])
  const [plans, setPlans] = useState<Row[]>([])
  const [links, setLinks] = useState<Row[]>([])
  const [barbers, setBarbers] = useState<Row[]>([])
  const [partnerOffers, setPartnerOffers] = useState<PartnerPublicOffer[]>([])
  const [partnerOffersError, setPartnerOffersError] = useState<string | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!isConfigured) { setError('A página pública ainda não está conectada ao Supabase.'); setBusy(false); return }
    let cancelled = false
    async function load() {
      try {
      setBusy(true)
      setError(null)
      setPartnerOffersError(null)
      const client = requireSupabase()
      const { data: authData } = await client.auth.getUser()
      if (!cancelled) setUser(authData.user)
      const { data: shopData, error: shopError } = await client.from('barbershops').select('id,name,slug,timezone,phone,whatsapp,instagram_url,bio_title,bio_description,logo_url,brand_theme,active').eq('slug', slug).eq('active', true).maybeSingle()
      if (cancelled) return
      if (shopError || !shopData) { setError(shopError?.message || 'Barbearia não encontrada.'); setBusy(false); return }
      setShop(shopData as Shop)
      const [servicesResult, plansResult, linksResult, barbersResult, productsResult, partnerOffersResult] = await Promise.all([
        client.from('services').select('id,barbershop_id,name,description,duration_minutes,price_cents,active').eq('barbershop_id', shopData.id).eq('active', true).order('name'),
        client.from('subscription_plans').select('*').eq('barbershop_id', shopData.id).eq('active', true).order('price_cents'),
        client.from('bio_links').select('*').eq('barbershop_id', shopData.id).eq('active', true).order('position'),
        client.rpc('public_barber_profiles', { p_barbershop_id: shopData.id }),
        client.rpc('public_products', { p_barbershop_id: shopData.id }),
        client.rpc('list_partner_offers', { p_barbershop_id: shopData.id }),
      ])
      if (cancelled) return
      setServices((servicesResult.data ?? []) as Row[])
      setPlans((plansResult.data ?? []) as Row[])
      setLinks((linksResult.data ?? []) as Row[])
      setBarbers((barbersResult.data ?? []) as Row[])
      setProducts((productsResult.data ?? []) as Row[])
      setPartnerOffers((partnerOffersResult.data ?? []) as PartnerPublicOffer[])
      setPartnerOffersError(partnerOffersResult.error ? 'Não foi possível carregar as ofertas dos parceiros agora.' : null)
      setError([servicesResult.error, plansResult.error, linksResult.error, barbersResult.error, productsResult.error].find(Boolean)?.message || null)
      setBusy(false)
      } catch (problem) {
        if (cancelled) return
        setError(problem instanceof Error ? problem.message : 'Não foi possível carregar a barbearia.')
        setBusy(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [slug])
  if (busy) return <div className="public-loading"><Loading text="Carregando barbearia..."/></div>
  if (!shop) return <div className="public-loading"><div><h2>Barbearia indisponível</h2><Notice text={error}/><a className="button outline" href="/">Voltar</a></div></div>
  const activeTheme = readBrandTheme(shop.brand_theme)
  const instagramUrl = safeInstagramUrl(shop.instagram_url)
  const logo = safeBrandImage(activeTheme?.logoUrl || shop.logo_url)
  return <div className={`public-layout ${activeTheme ? 'shop-themed' : ''}`} data-shop-theme={activeTheme ? '' : undefined} style={brandStyle(activeTheme)}><header className="public-header"><a href={`/b/${slug}`} className="client-brand"><ShopBrand shop={shop} compact/></a><div>{instagramUrl && <a href={instagramUrl} target="_blank" rel="noreferrer" aria-label="Instagram"><Camera size={19}/></a>}<a className="button outline" href={`/?shop=${encodeURIComponent(shop.slug)}`}>Minha conta</a></div></header>{bookingPage ? <PublicBooking key={shop.id} shop={shop} user={user} services={services} plans={plans} barbers={barbers} error={error}/> : <div className="public-bio"><div className="public-hero"><div className="public-emblem">{logo ? <img src={logo} alt={`Logo ${shop.name}`}/> : shop.name.slice(0,1)}</div><div className="eyebrow">BEM-VINDO À BARBEARIA</div><h1>{shop.name}</h1><p>{activeTheme?.tagline || shop.bio_description || 'Escolha seu próximo horário, conheça nossos serviços e fique por dentro dos planos.'}</p></div><div className="public-links"><a href={`/b/${slug}/agendar`} className="public-link primary">Agendar procedimento <ArrowUpRight size={19}/></a>{partnerOffers.length > 0 && <a href="#parceiros" className="public-link">Clube do Parceiro <ArrowUpRight size={19}/></a>}{products.length > 0 && <a href="#produtos" className="public-link">Ver produtos <ArrowUpRight size={19}/></a>}{plans.length > 0 && <a href="#planos" className="public-link">Ver planos e fazer assinatura <ArrowUpRight size={19}/></a>}{links.map(link => { const url = safeLink(link.url); return url ? <a key={link.id} href={url} target="_blank" rel="noreferrer" className="public-link">{asText(link.label)} <ArrowUpRight size={19}/></a> : null })}{shop.whatsapp && <a href={`https://wa.me/${shop.whatsapp.replace(/\D/g,'')}`} target="_blank" rel="noreferrer" className="public-link">Entrar em contato <ArrowUpRight size={19}/></a>}</div><PublicWelcome shop={shop} instagramUrl={instagramUrl}/>{partnerOffersError && <section className="public-section"><Notice text={partnerOffersError}/></section>}{!partnerOffersError && <PublicPartnerOffers shop={shop} offers={partnerOffers}/>} {services.length > 0 && <section className="public-section"><div className="public-section-title"><span>SERVIÇOS</span><h2>Cuide do seu estilo</h2></div><div className="public-service-grid">{services.slice(0, 6).map(service => <div key={service.id} className="public-service"><div className="service-icon"><Scissors size={19}/></div><h3>{asText(service.name)}</h3><p>{asText(service.description)}</p><div><span><Clock3 size={15}/>{asText(service.duration_minutes)} min</span><strong>{money(service.price_cents)}</strong></div></div>)}</div></section>}{products.length > 0 && <PublicProducts shop={shop} products={products}/>} {plans.length > 0 && <PublicPlans shop={shop} plans={plans} user={user}/>}</div>}<footer className="public-footer">{shop.name} · Powered by Barber System</footer></div>
}

function PublicWelcome({ shop, instagramUrl }: { shop: Shop; instagramUrl: string | null }) {
  return <section className="public-discover" aria-label={`Explore ${shop.name}`}>
    <div className="public-discover-heading">
      <span className="public-discover-kicker">SUA EXPERIÊNCIA COMEÇA AQUI</span>
      <h2>Mais do que um horário.<br/><em>Um momento seu.</em></h2>
      <p>Escolha como quer começar sua experiência em {shop.name}.</p>
    </div>
    <div className="public-discover-grid">
      <a href={`/b/${shop.slug}/agendar`} className="public-discover-card">
        <span className="public-discover-card-top"><span>01 / AGENDAMENTO</span><Scissors size={24} strokeWidth={1.45}/></span>
        <span className="public-discover-card-bottom"><strong>Encontre seu horário</strong><small>Veja os procedimentos, valores e profissionais disponíveis.</small></span>
      </a>
      <a href={`/?shop=${encodeURIComponent(shop.slug)}`} className="public-discover-card">
        <span className="public-discover-card-top"><span>02 / SUA CONTA</span><UserRound size={24} strokeWidth={1.45}/></span>
        <span className="public-discover-card-bottom"><strong>Acompanhe sua história</strong><small>Suas visitas, agendamentos e benefícios reunidos.</small></span>
      </a>
      {instagramUrl && <a href={instagramUrl} target="_blank" rel="noreferrer" className="public-discover-card">
        <span className="public-discover-card-top"><span>03 / INSTAGRAM</span><Camera size={24} strokeWidth={1.45}/></span>
        <span className="public-discover-card-bottom"><strong>Conheça a marca</strong><small>Visite o perfil oficial de {shop.name} no Instagram.</small></span>
      </a>}
    </div>
  </section>
}

function PublicPartnerOffers({ shop, offers }: { shop: Shop; offers: PartnerPublicOffer[] }) {
  const [showAll, setShowAll] = useState(false)
  if (!offers.length) return <section className="public-section public-partner-section" id="parceiros"><div className="public-section-title"><span>CLUBE DO PARCEIRO</span><h2>Benefícios em breve</h2></div><div className="public-partner-empty"><Gift size={24}/><p>A barbearia ainda não publicou ofertas de parceiros. Volte em breve para conferir.</p></div></section>
  return <section className="public-section public-partner-section" id="parceiros">
    <div className="public-section-title"><span>CLUBE DO PARCEIRO</span><h2>Benefícios para a sua próxima visita</h2><p>Use o link ou o código de uma oferta ao agendar. O valor final aparece antes de confirmar o horário.</p></div>
    <div className="public-partner-grid">{(showAll ? offers : offers.slice(0, 6)).map(offer => {
      const logo = safeBrandImage(offer.partner_logo_url)
      return <article key={offer.id} className="public-partner-card">
        <div className="public-partner-card-top"><span className="public-partner-icon">{logo ? <img src={logo} alt="" loading="lazy"/> : <Gift size={20}/>}</span><small>{offer.partner_name}</small></div>
        <h3>{offer.title}</h3><p>{offer.description || 'Uma vantagem para clientes desta barbearia.'}</p>
        <div className="public-partner-value"><TicketPercent size={17}/><strong>{partnerBenefit(offer)}</strong></div>
        <div className="public-partner-code"><span>Código</span><strong>{offer.code}</strong></div>
        {offer.terms && <small className="public-partner-terms">{offer.terms}</small>}
        <a className="button outline" href={`/b/${shop.slug}/agendar?ref=${encodeURIComponent(offer.code)}`}>Agendar com benefício <ArrowUpRight size={16}/></a>
      </article>
    })}</div>
    {offers.length > 6 && !showAll && <button type="button" className="button outline public-partner-more" onClick={() => setShowAll(true)}>Ver todas as {offers.length} ofertas</button>}
    <p className="public-hint">A oferta depende das regras, do serviço e do horário escolhidos. O desconto é validado ao confirmar a reserva; assinatura não acumula.</p>
  </section>
}

function BookingCoupon({ code, onCodeChange, onApply, onRemove, quote, error, busy, disabled }: {
  code: string; onCodeChange: (code: string) => void; onApply: () => void; onRemove: () => void;
  quote: PartnerQuote | null; error: string | null; busy: boolean; disabled: boolean;
}) {
  return <section className="public-coupon-section"><div className="public-coupon-heading"><span><TicketPercent size={19}/></span><div><h2>Clube do Parceiro</h2><p>Tem um código? Confira seu benefício antes de confirmar o agendamento.</p></div></div><div className="public-coupon-entry"><Field label="Código de indicação"><input maxLength={24} autoComplete="off" placeholder="Ex.: KINGS-CLUBE" value={code} onChange={event => onCodeChange(event.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))} disabled={disabled || busy}/></Field><button type="button" className="button outline" disabled={disabled || busy || code.trim().length < 4} onClick={onApply}>{busy ? 'Verificando...' : 'Aplicar código'}</button>{code && <button type="button" className="button ghost" onClick={onRemove} disabled={busy}>Remover</button>}</div>{disabled && <p className="public-coupon-note">Assinatura e cupom não podem ser usados juntos. Selecione “Sem assinatura” para aplicar um código.</p>}<Notice text={error}/>{quote && <div className="public-coupon-applied" aria-live="polite"><div><Gift size={19}/><strong>{quote.title}</strong><span>Indicação de {quote.partner_name}</span></div><dl><div><dt>Valor dos serviços</dt><dd>{money(quote.subtotal_cents)}</dd></div><div><dt>Benefício aplicado</dt><dd>− {money(quote.discount_cents)}</dd></div><div><dt>Total previsto</dt><dd>{money(quote.total_cents)}</dd></div></dl>{quote.terms && <small>{quote.terms}</small>}</div>}</section>
}

function PublicProducts({ shop, products }: { shop: Shop; products: Row[] }) {
  const whatsapp = shop.whatsapp?.replace(/\D/g, '')
  return <section className="public-section" id="produtos">
    <div className="public-section-title"><span>PRODUTOS</span><h2>Seleção da barbearia</h2></div>
    <div className="public-service-grid">{products.map(product => {
      const image = productImageUrl(product.image_path, shop.id)
      return <div className="public-service public-product-card" key={product.id}>
        <div className="public-product-image">{image ? <img src={image} alt={`Foto de ${asText(product.name)}`} loading="lazy"/> : <ShoppingBag size={30} aria-hidden="true"/>}</div>
        <h3>{asText(product.name)}</h3>
        <p>{asText(product.description)}</p>
        <div><span>{product.in_stock ? 'Disponível' : 'Indisponível no momento'}</span><strong>{money(product.price_cents)}</strong></div>
        {Boolean(product.in_stock) && whatsapp && <a className="button outline" target="_blank" rel="noreferrer" href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(`Olá! Tenho interesse no produto ${asText(product.name)} da ${shop.name}.`)}`}>Pedir pelo WhatsApp</a>}
      </div>
    })}</div>
    <p className="public-hint">Consulte a disponibilidade e combine a compra diretamente com a barbearia.</p>
  </section>
}
function PublicPlans({ shop, plans, user }: { shop: Shop; plans: Row[]; user: User | null }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [busyPlan, setBusyPlan] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { setName(String(user?.user_metadata?.full_name || '')) }, [user])
  async function subscribe(planId: string) {
    if (!user) return
    setBusyPlan(planId); setError(null)
    try {
      const client = requireSupabase()
      const existing = await client.from('clients').select('id').eq('barbershop_id', shop.id).eq('user_id', user.id).maybeSingle()
      if (existing.error) throw existing.error
      let clientId = existing.data?.id
      if (!clientId) {
        if (!name.trim()) throw new Error('Informe seu nome completo para iniciar a assinatura.')
        const inserted = await client.from('clients').insert({ barbershop_id: shop.id, user_id: user.id, full_name: name.trim(), phone: phone.trim() || null, email: user.email || null }).select('id').single()
        if (inserted.error) throw inserted.error
        clientId = inserted.data.id
      }
      const result = await authedApi<{ checkout_url?: string }>('/api/mercadopago/subscription-start', { barbershop_id: shop.id, client_id: clientId, plan_id: planId })
      if (!result.checkout_url) throw new Error('O pagamento ainda não está disponível para este plano.')
      window.location.assign(result.checkout_url)
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Não foi possível iniciar a assinatura.'); setBusyPlan(null) }
  }
  return <section className="public-section" id="planos"><div className="public-section-title"><span>ASSINATURAS</span><h2>Mais vantagens para você</h2></div>{user && <div className="form-row public-plan-identity"><Field label="Seu nome completo"><input value={name} onChange={event => setName(event.target.value)} placeholder="Usado se esta for sua primeira visita"/></Field><Field label="Telefone"><input value={phone} onChange={event => setPhone(event.target.value)}/></Field></div>}<Notice text={error}/><div className="public-service-grid">{plans.map(plan => <div key={plan.id} className="public-service plan"><div className="service-icon"><CreditCard size={19}/></div><h3>{asText(plan.name)}</h3><p>{asText(plan.description)}</p><div><span>{String(plan.visits_per_cycle)} usos por ciclo</span><strong>{money(plan.price_cents)}</strong></div>{user ? <button className="button outline" disabled={busyPlan !== null} onClick={() => void subscribe(plan.id)}>{busyPlan === plan.id ? 'Abrindo pagamento...' : 'Fazer assinatura'}</button> : <a className="button outline" href={`/?shop=${encodeURIComponent(shop.slug)}&return=${encodeURIComponent(`/b/${shop.slug}#planos`)}`}>Entrar para assinar</a>}</div>)}</div><p className="public-hint">A assinatura só fica ativa após confirmação do pagamento pelo Mercado Pago. Os meios disponíveis aparecem no checkout.</p></section>
}

function PublicBooking({ shop, user, services, plans, barbers, error: initialError }: { shop: Shop; user: User | null; services: Row[]; plans: Row[]; barbers: Row[]; error: string | null }) {
  const timezone = shop.timezone || 'America/Sao_Paulo'
  const [selectedServices, setSelectedServices] = useState<string[]>([])
  const [barberId, setBarberId] = useState('')
  const [day, setDay] = useState(() => shopToday(timezone))
  const [slots, setSlots] = useState<{ starts_at: string; ends_at: string }[]>([])
  const [slot, setSlot] = useState('')
  const [fullName, setFullName] = useState(String(user?.user_metadata?.full_name || ''))
  const [phone, setPhone] = useState('')
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(initialError)
  const [confirmed, setConfirmed] = useState<string | null>(null)
  const [subscriptions, setSubscriptions] = useState<Row[]>([])
  const [coverage, setCoverage] = useState<{ plan_id: string; service_id: string }[]>([])
  const [subscriptionId, setSubscriptionId] = useState('')
  const [couponCode, setCouponCode] = useState(() => (new URLSearchParams(window.location.search).get('ref') || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 24))
  const [quote, setQuote] = useState<PartnerQuote | null>(null)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [quoteBusy, setQuoteBusy] = useState(false)
  const [clientId, setClientId] = useState<string | null>(null)
  const [confirmedBenefit, setConfirmedBenefit] = useState<{ discount_cents: number; partner_name: string } | null>(null)
  const quoteRequestId = useRef(0)
  useEffect(() => {
    if (!user) return
    let cancelled = false
    async function loadPlans() {
      const client = requireSupabase()
      const own = await client.from('clients').select('id').eq('barbershop_id', shop.id).eq('user_id', user!.id).maybeSingle()
      if (own.error) { if (!cancelled) setError(own.error.message); return }
      if (!own.data) return
      if (!cancelled) setClientId(own.data.id)
      const [subResult, coverageResult] = await Promise.all([
        client.from('subscriptions').select('*').eq('barbershop_id', shop.id).eq('client_id', own.data.id).eq('status', 'active'),
        client.from('subscription_plan_services').select('plan_id,service_id').eq('barbershop_id', shop.id),
      ])
      if (cancelled) return
      if (subResult.error || coverageResult.error) setError(subResult.error?.message || coverageResult.error?.message || null)
      else { setSubscriptions((subResult.data ?? []) as Row[]); setCoverage((coverageResult.data ?? []) as { plan_id: string; service_id: string }[]) }
    }
    void loadPlans()
    return () => { cancelled = true }
  }, [shop.id, user])
  const usableSubscriptions = subscriptions.filter(sub => selectedServices.length > 0 && selectedServices.every(serviceId => coverage.some(item => item.plan_id === sub.plan_id && item.service_id === serviceId)))
  const bookingSubscriptionId = usableSubscriptions.some(sub => sub.id === subscriptionId) ? subscriptionId : null
  useEffect(() => {
    ++quoteRequestId.current
    setQuote(null)
    setQuoteError(null)
    setQuoteBusy(false)
  }, [selectedServices.join(','), slot, subscriptionId])
  async function applyCoupon() {
    if (!user) { setQuoteError('Entre na sua conta antes de aplicar o código.'); return }
    if (!selectedServices.length || !slot) { setQuoteError('Escolha serviço e horário antes de aplicar o código.'); return }
    if (bookingSubscriptionId) { setQuoteError('Cupom e assinatura não podem ser usados juntos. Selecione “Sem assinatura” para usar o cupom.'); return }
    const code = couponCode.trim().toUpperCase()
    if (!/^[A-Z0-9-]{4,24}$/.test(code)) { setQuoteError('Informe um código válido de 4 a 24 caracteres.'); return }
    const requestId = ++quoteRequestId.current
    setQuoteBusy(true); setQuoteError(null); setQuote(null)
    try {
      const result = await requireSupabase().rpc('quote_partner_offer', {
        p_barbershop_id: shop.id, p_client_id: clientId, p_service_ids: selectedServices, p_starts_at: slot, p_code: code,
      })
      if (result.error) throw result.error
      if (requestId === quoteRequestId.current) {
        const saved = result.data as PartnerQuote
        setQuote(saved)
        const url = new URL(window.location.href)
        url.searchParams.set('ref', saved.code)
        window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
      }
    } catch (problem) {
      if (requestId === quoteRequestId.current) setQuoteError(problem instanceof Error ? problem.message : 'Não foi possível validar o cupom.')
    } finally { if (requestId === quoteRequestId.current) setQuoteBusy(false) }
  }
  function removeCoupon() {
    ++quoteRequestId.current
    setCouponCode(''); setQuote(null); setQuoteError(null); setQuoteBusy(false)
    const url = new URL(window.location.href)
    url.searchParams.delete('ref')
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
  }
  useEffect(() => {
    if (!selectedServices.length || !barberId || !day) { setSlots([]); setSlot(''); return }
    let cancelled = false
    async function load() { setLoadingSlots(true); setSlot(''); const { data, error } = await requireSupabase().rpc('available_slots', { p_barbershop_id: shop.id, p_barber_membership_id: barberId, p_service_ids: selectedServices, p_day: day }); if (!cancelled) { if (error) { setError(error.message); setSlots([]) } else setSlots((data ?? []) as { starts_at: string; ends_at: string }[]); setLoadingSlots(false) } }
    void load(); return () => { cancelled = true }
  }, [shop.id, barberId, selectedServices.join(','), day])
  async function book(event: FormEvent) {
    event.preventDefault(); if (!user || !slot) return
    if (couponCode.trim() && bookingSubscriptionId) { setError('Cupom e assinatura não podem ser usados juntos. Remova o código ou escolha “Sem assinatura”.'); return }
    if (couponCode.trim() && !quote) { setError('Aplique o código para conferir o desconto antes de confirmar.'); return }
    setBusy(true); setError(null)
    try {
      const client = requireSupabase()
      const existing = await client.from('clients').select('id').eq('barbershop_id', shop.id).eq('user_id', user.id).maybeSingle()
      if (existing.error) throw existing.error
      let clientId = existing.data?.id
      if (!clientId) {
        if (!fullName.trim()) throw new Error('Informe seu nome para agendar.')
        const inserted = await client.from('clients').insert({ barbershop_id: shop.id, user_id: user.id, full_name: fullName.trim(), phone: phone.trim() || null, email: user.email || null }).select('id').single()
        if (inserted.error) throw inserted.error
        clientId = inserted.data.id
        setClientId(clientId)
      }
      if (quote) {
        const result = await client.rpc('book_partner_appointment', { p_barbershop_id: shop.id, p_client_id: clientId, p_barber_membership_id: barberId, p_service_ids: selectedServices, p_starts_at: slot, p_code: quote.code, p_expected_subtotal_cents: quote.subtotal_cents, p_expected_discount_cents: quote.discount_cents, p_expected_total_cents: quote.total_cents })
        if (result.error) throw result.error
        const saved = result.data as { appointment_id: string; discount_cents: number; partner_name: string }
        setConfirmed(String(saved.appointment_id))
        setConfirmedBenefit({ discount_cents: Number(saved.discount_cents), partner_name: String(saved.partner_name) })
      } else {
        const result = await client.rpc('book_appointment', { p_barbershop_id: shop.id, p_client_id: clientId, p_barber_membership_id: barberId, p_service_ids: selectedServices, p_starts_at: slot, p_subscription_id: bookingSubscriptionId })
        if (result.error) throw result.error
        setConfirmed(String(result.data))
      }
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'P2001') {
        ++quoteRequestId.current
        setQuote(null)
        setQuoteError('Preço ou benefício mudou. Aplique o cupom novamente antes de confirmar.')
        setError('O valor mudou. Confira o novo benefício antes de confirmar.')
        return
      }
      setError(err instanceof Error ? err.message : 'Não foi possível confirmar o agendamento.')
    }
    finally { setBusy(false) }
  }
  if (!services.length || !barbers.length) {
    const instagramUrl = safeInstagramUrl(shop.instagram_url)
    const whatsapp = shop.whatsapp?.replace(/\D/g, '')
    return <main className="public-booking public-booking-empty">
      <a href={`/b/${shop.slug}`} className="back-button"><ArrowLeft size={17}/> Voltar para {shop.name}</a>
      <div className="public-booking-empty-card">
        <span className="public-booking-empty-mark"><CalendarDays size={31} strokeWidth={1.3}/></span>
        <span className="public-discover-kicker">AGENDAMENTO ONLINE</span>
        <h1>A agenda online está chegando.</h1>
        <p>Os horários de {shop.name} ainda não estão disponíveis por aqui. Acompanhe os canais da barbearia para combinar sua próxima visita.</p>
        <div className="public-booking-empty-actions">
          {whatsapp && <a className="button primary" href={`https://wa.me/${whatsapp}`} target="_blank" rel="noreferrer">Conversar no WhatsApp <ArrowUpRight size={17}/></a>}
          {instagramUrl && <a className="button outline" href={instagramUrl} target="_blank" rel="noreferrer">Visitar Instagram <ArrowUpRight size={17}/></a>}
        </div>
      </div>
    </main>
  }
  if (confirmed) return <main className="public-booking confirmation"><div className="confirm-icon"><CalendarDays size={34}/></div><h1>Agendamento registrado</h1><p>Seu horário em {shop.name} foi criado para {shopDateTime(slot, timezone)}.</p>{confirmedBenefit && <div className="public-confirm-benefit"><Gift size={18}/><span>Benefício de {confirmedBenefit.partner_name}: {money(confirmedBenefit.discount_cents)} de desconto na reserva.</span></div>}<small>Referência: {confirmed}</small><a className="button primary" href={`/?shop=${encodeURIComponent(shop.slug)}`}>Acompanhar na minha conta</a></main>
  const listedTotal = services.filter(s => selectedServices.includes(s.id)).reduce((sum,s) => sum + Number(s.price_cents || 0),0)
  const payableTotal = quote ? quote.total_cents : bookingSubscriptionId ? 0 : listedTotal
  return <main className="public-booking"><a href={`/b/${shop.slug}`} className="back-button"><ArrowLeft size={17}/> Voltar para a página da barbearia</a><div className="public-section-title"><span>AGENDAMENTO ONLINE</span><h1>Escolha seu próximo horário</h1><p>Selecione os procedimentos, o profissional e um horário disponível.</p></div><form onSubmit={book} className="public-booking-form"><section><h2>1. Procedimentos</h2><div className="choice-grid">{services.length ? services.map(service => <label key={service.id} className={`choice-card ${selectedServices.includes(service.id) ? 'selected' : ''}`}><input type="checkbox" checked={selectedServices.includes(service.id)} onChange={e => setSelectedServices(e.target.checked ? [...selectedServices,service.id] : selectedServices.filter(id => id !== service.id))}/><span><strong>{asText(service.name)}</strong><small>{String(service.duration_minutes)} min · {money(service.price_cents)}</small></span></label>) : <Empty title="Sem serviços disponíveis" text="Entre em contato com a barbearia para agendar."/>}</div></section><section><h2>2. Profissional e data</h2><div className="form-row"><div className="barber-choice-field"><span>Profissional</span><div className="barber-choice-grid" role="radiogroup" aria-label="Escolha o profissional">{barbers.map(barber => <label key={barber.id} className={`barber-choice ${barberId === barber.id ? 'selected' : ''}`}><input type="radio" name="barber" required value={barber.id} checked={barberId === barber.id} onChange={() => setBarberId(barber.id)}/><TeamAvatar path={barber.avatar_path} name={String(barber.display_name || 'B')} shopId={shop.id} memberId={barber.id}/><strong>{asText(barber.display_name)}</strong><span className="barber-choice-check" aria-hidden="true"/></label>)}</div></div><Field label="Dia"><input type="date" min={shopToday(timezone)} required value={day} onChange={e => setDay(e.target.value)}/></Field></div></section><section><h2>3. Horário disponível</h2><div className="slot-grid">{loadingSlots ? <Loading text="Consultando horários..."/> : slots.length ? slots.map(item => <button type="button" key={item.starts_at} className={`slot ${slot === item.starts_at ? 'selected' : ''}`} onClick={() => setSlot(item.starts_at)}>{shopClock(item.starts_at, timezone)}</button>) : <p className="muted">{barberId && selectedServices.length ? 'Não há horários livres nesta data.' : 'Escolha serviço, profissional e data.'}</p>}</div></section>{user ? <section><h2>4. Seus dados</h2><p className="muted">A reserva será vinculada ao e-mail {user.email}.</p><div className="form-row"><Field label="Nome completo"><input required value={fullName} onChange={e => setFullName(e.target.value)}/></Field><Field label="Telefone"><input value={phone} onChange={e => setPhone(e.target.value)}/></Field></div></section> : <section><h2>4. Entre para confirmar</h2><p>É necessário entrar ou criar uma conta de cliente para acompanhar seus agendamentos.</p><a className="button outline" href={`/?shop=${encodeURIComponent(shop.slug)}&return=${encodeURIComponent(`/b/${shop.slug}/agendar${couponCode ? `?ref=${encodeURIComponent(couponCode)}` : ""}`)}`}>Entrar ou criar conta</a></section>}{usableSubscriptions.length > 0 && <section><h2>Usar assinatura</h2><Field label="Plano ativo"><select value={subscriptionId} onChange={event => setSubscriptionId(event.target.value)}><option value="">Sem assinatura</option>{usableSubscriptions.map(sub => <option key={sub.id} value={sub.id}>{asText(plans.find(plan => plan.id === sub.plan_id)?.name)}</option>)}</select></Field><p className="muted">O uso será reservado para este atendimento, conforme a cobertura e o saldo do plano.</p></section>}{user && <BookingCoupon code={couponCode} onCodeChange={value => { ++quoteRequestId.current; setCouponCode(value); setQuote(null); setQuoteError(null) }} onApply={() => void applyCoupon()} onRemove={removeCoupon} quote={quote} error={quoteError} busy={quoteBusy} disabled={Boolean(bookingSubscriptionId)}/>}<div className="booking-total"><span>{bookingSubscriptionId ? "Coberto pela assinatura" : "Total previsto"}</span><strong>{money(payableTotal)}</strong></div><Notice text={error}/>{user && <PrimaryButton type="submit" disabled={busy || quoteBusy || !slot || !selectedServices.length || Boolean(couponCode.trim() && (!quote || bookingSubscriptionId))}>{busy ? 'Confirmando...' : 'Confirmar agendamento'}</PrimaryButton>}</form></main>
}
