import { useEffect, useState, type FormEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import { ArrowLeft, ArrowUpRight, CalendarDays, Camera, Clock3, CreditCard, Scissors, ShoppingBag } from 'lucide-react'
import { authedApi, isConfigured, requireSupabase } from '../lib/supabase'
import { asText, money, today, type Row, type Shop } from '../types'
import { Empty, Field, Loading, Notice, PrimaryButton } from '../ui'

function safeLink(url: unknown) { try { const parsed = new URL(String(url)); return ['http:','https:'].includes(parsed.protocol) ? parsed.href : undefined } catch { return undefined } }

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
  const [user, setUser] = useState<User | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!isConfigured) { setError('A página pública ainda não está conectada ao Supabase.'); setBusy(false); return }
    let cancelled = false
    async function load() {
      const client = requireSupabase()
      const { data: authData } = await client.auth.getUser()
      if (!cancelled) setUser(authData.user)
      const { data: shopData, error: shopError } = await client.from('barbershops').select('id,name,slug,phone,whatsapp,instagram_url,active').eq('slug', slug).eq('active', true).maybeSingle()
      if (cancelled) return
      if (shopError || !shopData) { setError(shopError?.message || 'Barbearia não encontrada.'); setBusy(false); return }
      setShop(shopData as Shop)
      const [servicesResult, plansResult, linksResult, barbersResult, productsResult] = await Promise.all([
        client.from('services').select('id,barbershop_id,name,description,duration_minutes,price_cents,active').eq('barbershop_id', shopData.id).eq('active', true).order('name'),
        client.from('subscription_plans').select('*').eq('barbershop_id', shopData.id).eq('active', true).order('price_cents'),
        client.from('bio_links').select('*').eq('barbershop_id', shopData.id).eq('active', true).order('position'),
        client.rpc('public_barbers', { p_barbershop_id: shopData.id }),
        client.rpc('public_products', { p_barbershop_id: shopData.id }),
      ])
      if (cancelled) return
      setServices((servicesResult.data ?? []) as Row[])
      setPlans((plansResult.data ?? []) as Row[])
      setLinks((linksResult.data ?? []) as Row[])
      setBarbers((barbersResult.data ?? []) as Row[])
      setProducts((productsResult.data ?? []) as Row[])
      setError([servicesResult.error, plansResult.error, linksResult.error, barbersResult.error, productsResult.error].find(Boolean)?.message || null)
      setBusy(false)
    }
    void load()
    return () => { cancelled = true }
  }, [slug])
  if (busy) return <div className="public-loading"><Loading text="Carregando barbearia..."/></div>
  if (!shop) return <div className="public-loading"><div><h2>Barbearia indisponível</h2><Notice text={error}/><a className="button outline" href="/">Voltar</a></div></div>
  return <div className="public-layout"><header className="public-header"><a href={`/b/${slug}`} className="client-brand"><span className="shop-monogram">{shop.name.slice(0,1)}</span>{shop.name}</a><div>{shop.instagram_url && safeLink(shop.instagram_url) && <a href={safeLink(shop.instagram_url)} target="_blank" rel="noreferrer" aria-label="Instagram"><Camera size={19}/></a>}<a className="button outline" href="/">Minha conta</a></div></header>{bookingPage ? <PublicBooking shop={shop} user={user} services={services} plans={plans} barbers={barbers} error={error}/> : <div className="public-bio"><div className="public-hero"><div className="public-emblem">{shop.name.slice(0,1)}</div><div className="eyebrow">BEM-VINDO À BARBEARIA</div><h1>{shop.name}</h1><p>Escolha seu próximo horário, conheça nossos serviços e fique por dentro dos planos.</p></div><div className="public-links"><a href={`/b/${slug}/agendar`} className="public-link primary">Agendar procedimento <ArrowUpRight size={19}/></a>{products.length > 0 && <a href="#produtos" className="public-link">Comprar produtos <ArrowUpRight size={19}/></a>}{plans.length > 0 && <a href="#planos" className="public-link">Ver planos e fazer assinatura <ArrowUpRight size={19}/></a>}{links.map(link => { const url = safeLink(link.url); return url ? <a key={link.id} href={url} target="_blank" rel="noreferrer" className="public-link">{asText(link.label)} <ArrowUpRight size={19}/></a> : null })}{shop.whatsapp && <a href={`https://wa.me/${shop.whatsapp.replace(/\D/g,'')}`} target="_blank" rel="noreferrer" className="public-link">Entrar em contato <ArrowUpRight size={19}/></a>}</div>{services.length > 0 && <section className="public-section"><div className="public-section-title"><span>SERVIÇOS</span><h2>Cuide do seu estilo</h2></div><div className="public-service-grid">{services.slice(0, 6).map(service => <div key={service.id} className="public-service"><div className="service-icon"><Scissors size={19}/></div><h3>{asText(service.name)}</h3><p>{asText(service.description)}</p><div><span><Clock3 size={15}/>{asText(service.duration_minutes)} min</span><strong>{money(service.price_cents)}</strong></div></div>)}</div></section>}{products.length > 0 && <PublicProducts shop={shop} products={products}/>} {plans.length > 0 && <PublicPlans shop={shop} plans={plans} user={user}/>}</div>}<footer className="public-footer">{shop.name} · Powered by Barber System</footer></div>
}

function PublicProducts({ shop, products }: { shop: Shop; products: Row[] }) {
  const whatsapp = shop.whatsapp?.replace(/\D/g, '')
  return <section className="public-section" id="produtos"><div className="public-section-title"><span>PRODUTOS</span><h2>Seleção da barbearia</h2></div><div className="public-service-grid">{products.map(product => <div className="public-service" key={product.id}><div className="service-icon"><ShoppingBag size={19}/></div><h3>{asText(product.name)}</h3><p>{asText(product.description)}</p><div><span>{product.in_stock ? 'Disponível' : 'Indisponível no momento'}</span><strong>{money(product.price_cents)}</strong></div>{Boolean(product.in_stock) && whatsapp && <a className="button outline" target="_blank" rel="noreferrer" href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(`Olá! Tenho interesse no produto ${asText(product.name)} da ${shop.name}.`)}`}>Consultar no WhatsApp</a>}</div>)}</div><p className="public-hint">Consulte a disponibilidade e combine a compra diretamente com a barbearia.</p></section>
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
  return <section className="public-section" id="planos"><div className="public-section-title"><span>ASSINATURAS</span><h2>Mais vantagens para você</h2></div>{user && <div className="form-row public-plan-identity"><Field label="Seu nome completo"><input value={name} onChange={event => setName(event.target.value)} placeholder="Usado se esta for sua primeira visita"/></Field><Field label="Telefone"><input value={phone} onChange={event => setPhone(event.target.value)}/></Field></div>}<Notice text={error}/><div className="public-service-grid">{plans.map(plan => <div key={plan.id} className="public-service plan"><div className="service-icon"><CreditCard size={19}/></div><h3>{asText(plan.name)}</h3><p>{asText(plan.description)}</p><div><span>{String(plan.visits_per_cycle)} usos por ciclo</span><strong>{money(plan.price_cents)}</strong></div>{user ? <button className="button outline" disabled={busyPlan !== null} onClick={() => void subscribe(plan.id)}>{busyPlan === plan.id ? 'Abrindo pagamento...' : 'Fazer assinatura'}</button> : <a className="button outline" href={`/?return=${encodeURIComponent(`/b/${shop.slug}#planos`)}`}>Entrar para assinar</a>}</div>)}</div><p className="public-hint">A assinatura só fica ativa após confirmação do pagamento pelo Mercado Pago. Os meios disponíveis aparecem no checkout.</p></section>
}

function PublicBooking({ shop, user, services, plans, barbers, error: initialError }: { shop: Shop; user: User | null; services: Row[]; plans: Row[]; barbers: Row[]; error: string | null }) {
  const [selectedServices, setSelectedServices] = useState<string[]>([])
  const [barberId, setBarberId] = useState('')
  const [day, setDay] = useState(today())
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
  useEffect(() => {
    if (!user) return
    let cancelled = false
    async function loadPlans() {
      const client = requireSupabase()
      const own = await client.from('clients').select('id').eq('barbershop_id', shop.id).eq('user_id', user!.id).maybeSingle()
      if (own.error) { if (!cancelled) setError(own.error.message); return }
      if (!own.data) return
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
    if (!selectedServices.length || !barberId || !day) { setSlots([]); setSlot(''); return }
    let cancelled = false
    async function load() { setLoadingSlots(true); setSlot(''); const { data, error } = await requireSupabase().rpc('available_slots', { p_barbershop_id: shop.id, p_barber_membership_id: barberId, p_service_ids: selectedServices, p_day: day }); if (!cancelled) { if (error) { setError(error.message); setSlots([]) } else setSlots((data ?? []) as { starts_at: string; ends_at: string }[]); setLoadingSlots(false) } }
    void load(); return () => { cancelled = true }
  }, [shop.id, barberId, selectedServices.join(','), day])
  async function book(event: FormEvent) {
    event.preventDefault(); if (!user || !slot) return
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
      }
      const result = await client.rpc('book_appointment', { p_barbershop_id: shop.id, p_client_id: clientId, p_barber_membership_id: barberId, p_service_ids: selectedServices, p_starts_at: slot, p_subscription_id: bookingSubscriptionId })
      if (result.error) throw result.error
      setConfirmed(String(result.data))
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível confirmar o agendamento.') }
    finally { setBusy(false) }
  }
  if (confirmed) return <main className="public-booking confirmation"><div className="confirm-icon"><CalendarDays size={34}/></div><h1>Agendamento registrado</h1><p>Seu horário em {shop.name} foi criado para {new Date(slot).toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'short' })}.</p><small>Referência: {confirmed}</small><a className="button primary" href="/">Acompanhar na minha conta</a></main>
  const total = services.filter(s => selectedServices.includes(s.id)).reduce((sum,s) => sum + Number(s.price_cents || 0),0)
  return <main className="public-booking"><a href={`/b/${shop.slug}`} className="back-button"><ArrowLeft size={17}/> Voltar para a página da barbearia</a><div className="public-section-title"><span>AGENDAMENTO ONLINE</span><h1>Escolha seu próximo horário</h1><p>Selecione os procedimentos, o profissional e um horário disponível.</p></div><form onSubmit={book} className="public-booking-form"><section><h2>1. Procedimentos</h2><div className="choice-grid">{services.length ? services.map(service => <label key={service.id} className={`choice-card ${selectedServices.includes(service.id) ? 'selected' : ''}`}><input type="checkbox" checked={selectedServices.includes(service.id)} onChange={e => setSelectedServices(e.target.checked ? [...selectedServices,service.id] : selectedServices.filter(id => id !== service.id))}/><span><strong>{asText(service.name)}</strong><small>{String(service.duration_minutes)} min · {money(service.price_cents)}</small></span></label>) : <Empty title="Sem serviços disponíveis" text="Entre em contato com a barbearia para agendar."/>}</div></section><section><h2>2. Profissional e data</h2><div className="form-row"><Field label="Profissional"><select required value={barberId} onChange={e => setBarberId(e.target.value)}><option value="">Selecione</option>{barbers.map(barber => <option key={barber.id} value={barber.id}>{asText(barber.display_name)}</option>)}</select></Field><Field label="Dia"><input type="date" min={today()} required value={day} onChange={e => setDay(e.target.value)}/></Field></div></section><section><h2>3. Horário disponível</h2><div className="slot-grid">{loadingSlots ? <Loading text="Consultando horários..."/> : slots.length ? slots.map(item => <button type="button" key={item.starts_at} className={`slot ${slot === item.starts_at ? 'selected' : ''}`} onClick={() => setSlot(item.starts_at)}>{new Date(item.starts_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</button>) : <p className="muted">{barberId && selectedServices.length ? 'Não há horários livres nesta data.' : 'Escolha serviço, profissional e data.'}</p>}</div></section>{user ? <section><h2>4. Seus dados</h2><p className="muted">A reserva será vinculada ao e-mail {user.email}.</p><div className="form-row"><Field label="Nome completo"><input required value={fullName} onChange={e => setFullName(e.target.value)}/></Field><Field label="Telefone"><input value={phone} onChange={e => setPhone(e.target.value)}/></Field></div></section> : <section><h2>4. Entre para confirmar</h2><p>É necessário entrar ou criar uma conta de cliente para acompanhar seus agendamentos.</p><a className="button outline" href={`/?return=${encodeURIComponent(`/b/${shop.slug}/agendar`)}`}>Entrar ou criar conta</a></section>}{usableSubscriptions.length > 0 && <section><h2>Usar assinatura</h2><Field label="Plano ativo"><select value={subscriptionId} onChange={event => setSubscriptionId(event.target.value)}><option value="">Sem assinatura</option>{usableSubscriptions.map(sub => <option key={sub.id} value={sub.id}>{asText(plans.find(plan => plan.id === sub.plan_id)?.name)}</option>)}</select></Field><p className="muted">O uso será reservado para este atendimento, conforme a cobertura e o saldo do plano.</p></section>}<div className="booking-total"><span>Total previsto</span><strong>{money(total)}</strong></div><Notice text={error}/>{user && <PrimaryButton type="submit" disabled={busy || !slot || !selectedServices.length}>{busy ? 'Confirmando...' : 'Confirmar agendamento'}</PrimaryButton>}</form></main>
}
