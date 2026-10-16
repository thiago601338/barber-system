import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { ArrowLeft, ArrowRight, Check, Clock, CreditCard, Globe, LoaderCircle, Lock, Mail, Plus, Scissors, ShieldCheck, Sparkles, Store, Trash2, UserRound, Users, Wallet } from 'lucide-react'
import { authedApi, authedGet, requireSupabase, supabase } from '../lib/supabase'
import '../styles-onboarding.css'

const SUPPORT_WHATSAPP = 'https://wa.me/5582996443151?text=' + encodeURIComponent('Oi! Estou fazendo minha inscrição no Barber System e preciso de ajuda.')
const weekdays = [{ n: 1, l: 'Seg' }, { n: 2, l: 'Ter' }, { n: 3, l: 'Qua' }, { n: 4, l: 'Qui' }, { n: 5, l: 'Sex' }, { n: 6, l: 'Sáb' }, { n: 0, l: 'Dom' }]

interface Pricing { base_cents: number; barber_cents: number; monthly_cap_cents: number; billing_enabled: boolean }
interface Quote { seat_count: number; base_monthly_cents: number; unit_price_cents: number; monthly_cap_cents: number; subtotal_cents: number; discount_cents: number; amount_cents: number }
interface ShopRow { id: string; name: string; slug: string; whatsapp: string | null; phone: string | null; address: string | null; instagram_url: string | null; bio_title: string | null; bio_description: string | null; onboarding_completed_at: string | null }
interface ServiceRow { id: string; name: string; duration_minutes: number; price_cents: number }
interface BarberRow { id: string; display_name: string | null; user_id: string | null }
interface RuleRow { id: string; barber_membership_id: string; weekday: number; start_time: string; end_time: string }
interface Status {
  stage: 'shop' | 'payment' | 'setup' | 'done'
  account: { email: string | null; name: string | null }
  pricing: Pricing
  shop: ShopRow | null
  quote?: Quote
  payment?: { configured: boolean; free: boolean; paid: boolean; status: string | null }
  services?: ServiceRow[]
  barbers?: BarberRow[]
  availability?: RuleRow[]
  receiving?: { configured: boolean; connected: boolean }
}

const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const toCents = (value: string) => Math.round(Number(String(value).replace(/\./g, '').replace(',', '.')) * 100)
const message = (error: unknown) => {
  const text = error instanceof Error ? error.message : 'Não foi possível continuar.'
  if (/already registered|already been registered/i.test(text)) return 'Esse e-mail já tem conta. Entre com sua senha para continuar.'
  if (/invalid login credentials/i.test(text)) return 'E-mail ou senha incorretos.'
  if (/email not confirmed/i.test(text)) return 'Confirme seu e-mail pelo link que enviamos antes de entrar.'
  if (/password should be at least/i.test(text)) return 'A senha precisa ter pelo menos 8 caracteres.'
  return text
}
const slugify = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
const monthly = (p: Pricing, seats: number) => { const sub = p.base_cents + seats * p.barber_cents; return p.monthly_cap_cents > 0 ? Math.min(sub, p.monthly_cap_cents) : sub }

const mainSteps = ['Sua conta', 'Sua barbearia', 'Plano e pagamento', 'Configuração', 'Pronto para usar']

export function OnboardingPage() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [status, setStatus] = useState<Status | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!supabase) { setSession(null); return }
    void supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [])
  const load = useCallback(async () => {
    try { setError(null); setStatus(await authedGet<Status>('/api/onboarding/status')) }
    catch (problem) { setError(message(problem)) }
  }, [])
  useEffect(() => { if (session) void load(); else setStatus(null) }, [session?.user.id, load])
  const current = !session ? 0 : !status || status.stage === 'shop' ? 1 : status.stage === 'payment' ? 2 : status.stage === 'setup' ? 3 : 4
  let body: ReactNode
  if (session === undefined) body = <Busy text="Preparando sua inscrição..."/>
  else if (!session) body = <AccountStep/>
  else if (error) body = <div className="onb-card"><h1>Não conseguimos carregar sua inscrição</h1><p className="onb-error">{error}</p><button className="onb-btn primary" onClick={() => void load()}>Tentar de novo</button></div>
  else if (!status) body = <Busy text="Carregando sua inscrição..."/>
  else if (status.stage === 'shop') body = <ShopStep status={status} onDone={load}/>
  else if (status.stage === 'payment') body = <PaymentStep status={status} reload={load}/>
  else if (status.stage === 'setup') body = <SetupFlow status={status} reload={load}/>
  else body = <DoneStep status={status}/>
  return <div className="onb">
    <header className="onb-top">
      <a href="/inicio" className="onb-logo" aria-label="Barber System, voltar ao site"><img src="/brand/barber-system-logo.png" alt="Barber System" width="2172" height="724"/></a>
      <div className="onb-top-right">{session && <><span className="onb-account"><UserRound size={15}/> {session.user.email}</span><button className="onb-link" onClick={() => void requireSupabase().auth.signOut()}>Sair</button></>}</div>
    </header>
    <div className="onb-layout">
      <aside className="onb-steps" aria-label="Etapas da inscrição">
        <p className="onb-eyebrow">INSCRIÇÃO NO BARBER SYSTEM</p>
        <ol>{mainSteps.map((label, index) => <li key={label} className={index < current ? 'done' : index === current ? 'current' : ''} aria-current={index === current ? 'step' : undefined}><span>{index < current ? <Check size={14}/> : index + 1}</span>{label}</li>)}</ol>
        <div className="onb-help"><strong>Precisa de ajuda?</strong><p>Chama a gente que a gente te acompanha em cada passo.</p><a href={SUPPORT_WHATSAPP} target="_blank" rel="noopener noreferrer">Falar no WhatsApp <ArrowRight size={14}/></a></div>
      </aside>
      <main className="onb-main">{body}</main>
    </div>
  </div>
}

function Busy({ text }: { text: string }) { return <div className="onb-card onb-busy"><LoaderCircle className="onb-spin" size={22}/> {text}</div> }
function StepHead({ eyebrow, title, text, icon }: { eyebrow: string; title: string; text?: string; icon?: ReactNode }) {
  return <div className="onb-head">{icon && <span className="onb-head-icon">{icon}</span>}<p className="onb-eyebrow">{eyebrow}</p><h1>{title}</h1>{text && <p className="onb-lead">{text}</p>}</div>
}

function AccountStep() {
  const [mode, setMode] = useState<'signup' | 'login' | 'check'>('signup')
  const [entry, setEntry] = useState<'shop' | 'barber'>('shop')
  const [form, setForm] = useState({ name: '', email: '', password: '', accept: false })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(null)
    if (mode === 'signup' && !form.accept) { setError('Para continuar, aceite os Termos de Uso e a Política de Privacidade.'); return }
    if (form.password.length < 8) { setError('A senha precisa ter pelo menos 8 caracteres.'); return }
    setBusy(true)
    try {
      const client = requireSupabase()
      if (mode === 'login') {
        const { error: loginError } = await client.auth.signInWithPassword({ email: form.email.trim(), password: form.password })
        if (loginError) throw loginError
      } else {
        const { data, error: signError } = await client.auth.signUp({ email: form.email.trim(), password: form.password, options: { emailRedirectTo: `${window.location.origin}/comecar`, data: { full_name: form.name.trim() } } })
        if (signError) throw signError
        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) { setMode('login'); setError('Esse e-mail já tem conta. Entre com sua senha para continuar.'); return }
        if (!data.session) setMode('check')
      }
    } catch (problem) { setError(message(problem)) }
    finally { setBusy(false) }
  }
  if (mode === 'check') return <div className="onb-card"><StepHead eyebrow="ETAPA 1 · SUA CONTA" icon={<Mail size={22}/>} title="Confira seu e-mail" text={`Mandamos um link de confirmação para ${form.email}. Abra o e-mail e toque no link: você volta direto para esta página para continuar a inscrição.`}/><p className="onb-note">Não chegou? Veja a caixa de spam ou promoções. Se preferir, <button className="onb-link" onClick={() => setMode('login')}>entre com sua senha</button> depois de confirmar.</p></div>
  return <form className="onb-card" onSubmit={submit} noValidate>
    <StepHead eyebrow="ETAPA 1 · SUA CONTA" icon={<UserRound size={22}/>} title={mode === 'signup' ? 'Como você quer começar?' : 'Entre para continuar'} text={mode === 'signup' ? 'Escolha o caminho certo. Se você é dono ou barbeiro independente, já pode criar sua própria barbearia e seguir para o plano.' : 'Use o e-mail e a senha que você cadastrou.'}/>
    {mode === 'signup' && <div className="onb-choice onb-entry-choice" role="radiogroup" aria-label="Tipo de inscrição">
      <button type="button" role="radio" aria-checked={entry === 'shop'} className={entry === 'shop' ? 'on' : ''} onClick={() => setEntry('shop')}><Store size={20}/><strong>Criar minha barbearia</strong><span>Tenha sua página, agenda, equipe e cobrança no seu painel.</span></button>
      <button type="button" role="radio" aria-checked={entry === 'barber'} className={entry === 'barber' ? 'on' : ''} onClick={() => setEntry('barber')}><UserRound size={20}/><strong>Entrar como barbeiro</strong><span>Você já recebeu um convite de uma barbearia.</span></button>
    </div>}
    {mode === 'signup' && entry === 'barber' && <div className="onb-alert"><strong>O acesso de barbeiro é por convite.</strong><p>Peça ao administrador da barbearia para enviar seu convite por e-mail. Se você trabalha por conta própria, escolha “Criar minha barbearia” para ter seu próprio painel.</p><a className="onb-btn ghost" href="/entrar?modo=barbeiro">Já tenho convite e quero entrar <ArrowRight size={16}/></a></div>}
    <div className="onb-grid">
      {mode === 'signup' && <label className="onb-field wide">Seu nome<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} autoComplete="name" required maxLength={100}/></label>}
      <label className="onb-field wide">E-mail<input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} autoComplete="email" required/></label>
      <label className="onb-field wide">Senha<input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} minLength={8} required/><small>Pelo menos 8 caracteres.</small></label>
    </div>
    {mode === 'signup' && <label className="onb-check"><input type="checkbox" checked={form.accept} onChange={e => setForm({ ...form, accept: e.target.checked })}/><span>Li e aceito os <a href="/termos-de-uso" target="_blank">Termos de Uso</a> e a <a href="/politica-de-privacidade" target="_blank">Política de Privacidade</a>.</span></label>}
    {error && <p className="onb-error" role="alert">{error}</p>}
    <div className="onb-actions"><button className="onb-btn primary" type="submit" disabled={busy || mode === 'signup' && entry === 'barber'}>{busy ? <LoaderCircle className="onb-spin" size={17}/> : null}{mode === 'signup' ? 'Criar minha conta e minha barbearia' : 'Entrar e continuar'} <ArrowRight size={17}/></button></div>
    <p className="onb-switch">{mode === 'signup' ? <>Já tem conta? <button type="button" className="onb-link" onClick={() => { setMode('login'); setError(null) }}>Entrar</button></> : <>Ainda não tem conta? <button type="button" className="onb-link" onClick={() => { setMode('signup'); setError(null) }}>Criar conta</button> · <a className="onb-link" href="/entrar">Esqueci minha senha</a></>}</p>
  </form>
}

function ShopStep({ status, onDone }: { status: Status; onDone: () => Promise<void> }) {
  const [form, setForm] = useState({ owner_name: status.account.name || '', name: '', slug: '', whatsapp: '', city: '', profile: 'shop_owner', owner_attends: true })
  const [slugTouched, setSlugTouched] = useState(false)
  const [slugState, setSlugState] = useState<'idle' | 'checking' | 'ok' | 'taken'>('idle')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const slug = slugTouched ? form.slug : slugify(form.name)
  useEffect(() => {
    if (slug.length < 3) { setSlugState('idle'); return }
    setSlugState('checking')
    const timer = window.setTimeout(() => { void authedGet<{ available: boolean }>(`/api/onboarding/slug?slug=${encodeURIComponent(slug)}`).then(r => setSlugState(r.available ? 'ok' : 'taken')).catch(() => setSlugState('idle')) }, 450)
    return () => window.clearTimeout(timer)
  }, [slug])
  const seats = form.owner_attends ? 1 : 0
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(null)
    if (!form.owner_name.trim() || !form.name.trim() || !form.city.trim()) { setError('Preencha seu nome, o nome da barbearia e a cidade.'); return }
    if (form.whatsapp.replace(/\D/g, '').length < 10) { setError('Informe o WhatsApp com DDD.'); return }
    if (slugState === 'taken') { setError('Esse endereço já está em uso. Escolha outro.'); return }
    setBusy(true)
    try { await authedApi('/api/onboarding/create-shop', { owner_name: form.owner_name, name: form.name, slug, whatsapp: form.whatsapp, city: form.city, profile_type: form.profile, owner_attends: form.owner_attends }); await onDone() }
    catch (problem) { setError(message(problem)) }
    finally { setBusy(false) }
  }
  return <form className="onb-card" onSubmit={submit} noValidate>
    <StepHead eyebrow="ETAPA 2 · SUA BARBEARIA" icon={<Store size={22}/>} title="Conta pra gente sobre sua barbearia" text="Com esses dados a gente cria o seu espaço no sistema e a página de agendamento dos seus clientes."/>
    <div className="onb-choice" role="radiogroup" aria-label="Como você trabalha">
      {[['shop_owner', 'Tenho uma barbearia', 'Com ou sem equipe'], ['independent', 'Sou barbeiro independente', 'Atendo por conta própria']].map(([value, title, sub]) => <button type="button" key={value} role="radio" aria-checked={form.profile === value} className={form.profile === value ? 'on' : ''} onClick={() => setForm({ ...form, profile: value, owner_attends: value === 'independent' ? true : form.owner_attends })}><strong>{title}</strong><span>{sub}</span></button>)}
    </div>
    <div className="onb-grid">
      <label className="onb-field">Seu nome<input value={form.owner_name} onChange={e => setForm({ ...form, owner_name: e.target.value })} maxLength={100} required/></label>
      <label className="onb-field">Nome da barbearia<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} maxLength={120} required placeholder="Ex.: Barbearia do Zé"/></label>
      <label className="onb-field wide">Endereço da sua página
        <div className="onb-prefix"><span>sistemadebarbearia.com.br/b/</span><input value={slug} onChange={e => { setSlugTouched(true); setForm({ ...form, slug: slugify(e.target.value) }) }} maxLength={60} required/></div>
        <small className={slugState === 'taken' ? 'bad' : slugState === 'ok' ? 'good' : ''}>{slugState === 'checking' ? 'Conferindo...' : slugState === 'ok' ? 'Endereço disponível.' : slugState === 'taken' ? 'Esse endereço já está em uso.' : 'Só letras, números e hífens.'}</small>
      </label>
      <label className="onb-field">WhatsApp da barbearia<input type="tel" inputMode="tel" value={form.whatsapp} onChange={e => setForm({ ...form, whatsapp: e.target.value })} placeholder="(82) 99999-9999" required/></label>
      <label className="onb-field">Cidade<input value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} placeholder="Ex.: Maceió/AL" maxLength={80} required/></label>
    </div>
    <label className="onb-check"><input type="checkbox" checked={form.owner_attends} onChange={e => setForm({ ...form, owner_attends: e.target.checked })}/><span><strong>Eu também atendo clientes.</strong> Assim você aparece na agenda e na página de agendamento.</span></label>
    {status.pricing.billing_enabled && <div className="onb-price-hint"><Wallet size={17}/><span>Sua mensalidade começa em <strong>{brl(monthly(status.pricing, seats))}/mês</strong>{seats ? ' (barbearia + você atendendo)' : ''}. Cada profissional ativo soma {brl(status.pricing.barber_cents)}.</span></div>}
    {error && <p className="onb-error" role="alert">{error}</p>}
    <div className="onb-actions"><button className="onb-btn primary" type="submit" disabled={busy}>{busy && <LoaderCircle className="onb-spin" size={17}/>}Continuar para a assinatura <ArrowRight size={17}/></button></div>
  </form>
}

function PaymentStep({ status, reload }: { status: Status; reload: () => Promise<void> }) {
  const quote = status.quote!
  const payment = status.payment!
  const returning = new URLSearchParams(window.location.search).get('etapa') === 'pagamento'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [polls, setPolls] = useState(0)
  useEffect(() => {
    if (!returning || payment.paid || polls >= 24) return
    const timer = window.setTimeout(() => { setPolls(n => n + 1); void reload() }, 5000)
    return () => window.clearTimeout(timer)
  }, [returning, payment.paid, polls, reload])
  async function pay() {
    setBusy(true); setError(null)
    try { const result = await authedApi<{ checkout_url: string }>('/api/onboarding/checkout', { barbershop_id: status.shop!.id }); window.location.assign(result.checkout_url) }
    catch (problem) { setError(message(problem)); setBusy(false) }
  }
  const waiting = returning && polls < 24
  return <div className="onb-card">
    <StepHead eyebrow="ETAPA 3 · PLANO E PAGAMENTO" icon={<CreditCard size={22}/>} title={waiting ? 'Confirmando seu pagamento' : 'Seu plano completo'} text={waiting ? 'Assim que o Mercado Pago confirmar, a configuração da barbearia é liberada aqui mesmo. Isso costuma levar poucos segundos.' : `Tudo o que o Barber System oferece, para ${status.shop!.name}. A cobrança é mensal e você pode cancelar quando quiser.`}/>
    {waiting && <div className="onb-waiting"><LoaderCircle className="onb-spin" size={20}/> Aguardando a confirmação do Mercado Pago{payment.status ? ` (situação: ${payment.status})` : ''}...</div>}
    <dl className="onb-bill">
      <div><dt>Valor da barbearia</dt><dd>{brl(quote.base_monthly_cents)}</dd></div>
      <div><dt>Profissionais ativos ({quote.seat_count} × {brl(quote.unit_price_cents)})</dt><dd>{brl(quote.seat_count * quote.unit_price_cents)}</dd></div>
      {quote.discount_cents > 0 && <div><dt>Limite mensal aplicado</dt><dd>− {brl(quote.discount_cents)}</dd></div>}
      <div className="total"><dt>Total por mês</dt><dd>{brl(quote.amount_cents)}</dd></div>
    </dl>
    <ul className="onb-included">{['Agenda online e página de agendamento', 'Clientes, assinaturas e planos', 'Caixa, comissões, produtos e margem', 'Equipe com acesso por permissão', 'Ajuda de IA e tutorial guiado'].map(item => <li key={item}><Check size={15}/>{item}</li>)}</ul>
    <p className="onb-note"><ShieldCheck size={15}/> Pagamento recorrente processado pelo Mercado Pago. Se mudar de ideia em até 7 dias, devolvemos o valor. Veja a <a href="/politica-de-cancelamento-e-reembolso" target="_blank">política de cancelamento e reembolso</a>. Quando você adicionar profissionais, a mensalidade é ajustada automaticamente{quote.monthly_cap_cents > 0 ? `, até o limite de ${brl(quote.monthly_cap_cents)}` : ''}.</p>
    {!payment.configured && <div className="onb-alert"><strong>O pagamento online está sendo liberado.</strong> Chama a gente no WhatsApp que a gente conclui sua assinatura e libera a configuração na hora.<a className="onb-btn ghost" href={SUPPORT_WHATSAPP} target="_blank" rel="noopener noreferrer">Falar no WhatsApp</a></div>}
    {returning && polls >= 24 && !payment.paid && <p className="onb-error">Ainda não recebemos a confirmação. Se você concluiu o pagamento, aguarde alguns minutos e <button className="onb-link" onClick={() => { setPolls(0); void reload() }}>confira de novo</button>.</p>}
    {error && <p className="onb-error" role="alert">{error}</p>}
    <div className="onb-actions">{payment.configured && <button className="onb-btn primary" onClick={() => void pay()} disabled={busy}>{busy && <LoaderCircle className="onb-spin" size={17}/>}{payment.status === 'pending' ? 'Continuar pagamento no Mercado Pago' : 'Pagar com Mercado Pago'} <ArrowRight size={17}/></button>}<button className="onb-btn ghost" onClick={() => void reload()}>Já paguei, conferir</button></div>
  </div>
}

const setupSteps = [
  { key: 'dados', label: 'Dados de contato', icon: Store },
  { key: 'servicos', label: 'Serviços e preços', icon: Scissors },
  { key: 'equipe', label: 'Equipe', icon: Users },
  { key: 'horarios', label: 'Horários de atendimento', icon: Clock },
  { key: 'pagina', label: 'Página da barbearia', icon: Globe },
  { key: 'recebimentos', label: 'Receber dos clientes', icon: Wallet },
  { key: 'revisao', label: 'Revisão final', icon: Sparkles },
] as const
type SetupKey = typeof setupSteps[number]['key']
interface SetupProps { status: Status; reload: () => Promise<void>; next: () => void; back: () => void }

function SetupFlow({ status, reload }: { status: Status; reload: () => Promise<void> }) {
  const shop = status.shop!
  const storeKey = `barber-onboarding-step:${shop.id}`
  const [index, setIndex] = useState(() => { try { const saved = Number(localStorage.getItem(storeKey)); return Number.isInteger(saved) && saved >= 0 && saved < setupSteps.length ? saved : 0 } catch { return 0 } })
  const top = useRef<HTMLDivElement>(null)
  const mounted = useRef(false)
  useEffect(() => { try { localStorage.setItem(storeKey, String(index)) } catch { /* sem armazenamento local */ } if (mounted.current) top.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); mounted.current = true }, [index, storeKey])
  const done: Record<SetupKey, boolean> = {
    dados: Boolean(shop.whatsapp && shop.address),
    servicos: (status.services?.length || 0) > 0,
    equipe: (status.barbers?.length || 0) > 0,
    horarios: (status.availability?.length || 0) > 0,
    pagina: Boolean(shop.bio_title),
    recebimentos: Boolean(status.receiving?.connected),
    revisao: false,
  }
  const props: SetupProps = { status, reload, next: () => setIndex(i => Math.min(i + 1, setupSteps.length - 1)), back: () => setIndex(i => Math.max(i - 1, 0)) }
  const key = setupSteps[index].key
  return <div ref={top}>
    <div className="onb-paid"><Check size={16}/> {status.payment?.free ? 'Acesso liberado.' : 'Pagamento confirmado.'} Agora é só deixar a barbearia do seu jeito.</div>
    <nav className="onb-substeps" aria-label="Configuração da barbearia">{setupSteps.map((step, i) => { const Icon = step.icon; return <button key={step.key} className={`${i === index ? 'current' : ''} ${done[step.key] ? 'done' : ''}`} onClick={() => setIndex(i)} aria-current={i === index ? 'step' : undefined}><span>{done[step.key] ? <Check size={14}/> : <Icon size={14}/>}</span>{step.label}</button> })}</nav>
    <p className="onb-counter">Passo {index + 1} de {setupSteps.length}</p>
    {key === 'dados' && <DadosStep {...props}/>}
    {key === 'servicos' && <ServicosStep {...props}/>}
    {key === 'equipe' && <EquipeStep {...props}/>}
    {key === 'horarios' && <HorariosStep {...props}/>}
    {key === 'pagina' && <PaginaStep {...props}/>}
    {key === 'recebimentos' && <RecebimentosStep {...props}/>}
    {key === 'revisao' && <RevisaoStep {...props} done={done} go={setIndex}/>}
  </div>
}

function useSaver(reload: () => Promise<void>, next: () => void) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (task: () => Promise<void>, advance = true) => {
    setBusy(true); setError(null)
    try { await task(); await reload(); if (advance) next() }
    catch (problem) { setError(message(problem)) }
    finally { setBusy(false) }
  }
  return { busy, error, setError, run }
}
function Footer({ busy, back, skip, label = 'Salvar e continuar', disabled = false }: { busy: boolean; back?: () => void; skip?: () => void; label?: string; disabled?: boolean }) {
  return <div className="onb-actions">{back && <button type="button" className="onb-btn ghost" onClick={back}><ArrowLeft size={17}/> Voltar</button>}<span className="onb-spacer"/>{skip && <button type="button" className="onb-link" onClick={skip}>Pular por agora</button>}<button className="onb-btn primary" type="submit" disabled={busy || disabled}>{busy && <LoaderCircle className="onb-spin" size={17}/>}{label} <ArrowRight size={17}/></button></div>
}

function DadosStep({ status, reload, next, back }: SetupProps) {
  const shop = status.shop!
  const instagram = (shop.instagram_url || '').replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/$/, '')
  const [form, setForm] = useState({ whatsapp: shop.whatsapp || '', phone: shop.phone || '', address: shop.address || '', instagram })
  const { busy, error, setError, run } = useSaver(reload, next)
  function submit(event: FormEvent) {
    event.preventDefault()
    if (form.whatsapp.replace(/\D/g, '').length < 10) { setError('Informe o WhatsApp com DDD.'); return }
    if (form.address.trim().length < 5) { setError('Informe o endereço da barbearia.'); return }
    const handle = form.instagram.trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/.*$/, '')
    void run(async () => {
      const { error: saveError } = await requireSupabase().from('barbershops').update({ whatsapp: form.whatsapp.replace(/\D/g, ''), phone: form.phone.replace(/\D/g, '') || null, address: form.address.trim(), instagram_url: handle ? `https://instagram.com/${handle}` : null }).eq('id', shop.id)
      if (saveError) throw saveError
    })
  }
  return <form className="onb-card" onSubmit={submit} noValidate>
    <StepHead eyebrow="CONFIGURAÇÃO · DADOS DE CONTATO" title="Onde seus clientes te encontram" text="Esses dados aparecem na página da barbearia e nas mensagens para os clientes."/>
    <div className="onb-grid">
      <label className="onb-field">WhatsApp<input type="tel" value={form.whatsapp} onChange={e => setForm({ ...form, whatsapp: e.target.value })} required/></label>
      <label className="onb-field">Telefone fixo (opcional)<input type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}/></label>
      <label className="onb-field wide">Endereço completo<input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="Rua, número, bairro, cidade/UF" maxLength={200} required/></label>
      <label className="onb-field wide">Instagram (opcional)<div className="onb-prefix"><span>@</span><input value={form.instagram} onChange={e => setForm({ ...form, instagram: e.target.value })} placeholder="suabarbearia"/></div></label>
    </div>
    {error && <p className="onb-error" role="alert">{error}</p>}
    <Footer busy={busy} back={back}/>
  </form>
}

const servicePresets: [string, number][] = [['Corte', 40], ['Barba', 30], ['Corte + barba', 60], ['Pezinho', 15], ['Sobrancelha', 15], ['Pigmentação', 45], ['Hidratação', 30], ['Luzes', 90]]
function ServicosStep({ status, reload, next, back }: SetupProps) {
  const existing = status.services || []
  const [rows, setRows] = useState<{ name: string; duration: number; price: string }[]>(() => existing.length ? [] : [{ name: 'Corte', duration: 40, price: '' }, { name: 'Barba', duration: 30, price: '' }, { name: 'Corte + barba', duration: 60, price: '' }])
  const { busy, error, setError, run } = useSaver(reload, next)
  const update = (i: number, patch: Partial<{ name: string; duration: number; price: string }>) => setRows(rows.map((row, j) => j === i ? { ...row, ...patch } : row))
  async function remove(id: string) { await run(async () => { const { error: e } = await requireSupabase().from('services').update({ active: false }).eq('id', id); if (e) throw e }, false) }
  function submit(event: FormEvent) {
    event.preventDefault()
    const filled = rows.filter(row => row.name.trim())
    if (!filled.length && !existing.length) { setError('Cadastre pelo menos um serviço para os clientes poderem agendar.'); return }
    const bad = filled.find(row => !(toCents(row.price) >= 0) || row.price.trim() === '' || Number.isNaN(toCents(row.price)))
    if (bad) { setError(`Informe o preço de "${bad.name}".`); return }
    if (!filled.length) { next(); return }
    void run(async () => {
      const { error: e } = await requireSupabase().from('services').insert(filled.map(row => ({ barbershop_id: status.shop!.id, name: row.name.trim(), duration_minutes: row.duration, price_cents: toCents(row.price), active: true })))
      if (e) throw e
      setRows([])
    })
  }
  return <form className="onb-card" onSubmit={submit} noValidate>
    <StepHead eyebrow="CONFIGURAÇÃO · SERVIÇOS E PREÇOS" title="O que você oferece?" text="Coloque o nome, quanto tempo leva e o preço. O tempo é usado para montar os horários livres na agenda."/>
    {existing.length > 0 && <ul className="onb-list">{existing.map(service => <li key={service.id}><Scissors size={16}/><strong>{service.name}</strong><span>{service.duration_minutes} min · {brl(service.price_cents)}</span><button type="button" className="onb-icon" aria-label={`Remover ${service.name}`} onClick={() => void remove(service.id)}><Trash2 size={15}/></button></li>)}</ul>}
    {rows.length > 0 && <div className="onb-rows">
      <div className="onb-row head" aria-hidden="true"><span>Serviço</span><span>Duração</span><span>Preço (R$)</span><span/></div>
      {rows.map((row, i) => <div className="onb-row" key={i}>
        <input aria-label="Nome do serviço" value={row.name} onChange={e => update(i, { name: e.target.value })} maxLength={160}/>
        <select aria-label="Duração" value={row.duration} onChange={e => update(i, { duration: Number(e.target.value) })}>{[10, 15, 20, 30, 40, 45, 50, 60, 75, 90, 120, 150, 180].map(m => <option key={m} value={m}>{m} min</option>)}</select>
        <input aria-label="Preço" inputMode="decimal" value={row.price} onChange={e => update(i, { price: e.target.value })} placeholder="0,00"/>
        <button type="button" className="onb-icon" aria-label="Remover linha" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 size={15}/></button>
      </div>)}
    </div>}
    <div className="onb-chips"><span>Adicionar:</span>{servicePresets.filter(([name]) => !rows.some(r => r.name === name) && !existing.some(s => s.name === name)).map(([name, duration]) => <button type="button" key={name} onClick={() => setRows([...rows, { name, duration, price: '' }])}><Plus size={13}/>{name}</button>)}<button type="button" onClick={() => setRows([...rows, { name: '', duration: 30, price: '' }])}><Plus size={13}/>Outro serviço</button></div>
    {error && <p className="onb-error" role="alert">{error}</p>}
    <Footer busy={busy} back={back}/>
  </form>
}

function EquipeStep({ status, reload, next, back }: SetupProps) {
  const barbers = status.barbers || []
  const pricing = status.pricing
  const [form, setForm] = useState({ name: '', email: '' })
  const { busy, error, setError, run } = useSaver(reload, next)
  async function add() {
    setError(null)
    if (form.name.trim().length < 2) { setError('Informe o nome do profissional.'); return }
    await run(async () => {
      if (form.email.trim()) await authedApi('/api/admin/invite', { barbershop_id: status.shop!.id, email: form.email.trim(), role: 'barber', display_name: form.name.trim() })
      else await authedApi('/api/admin/member-create', { barbershop_id: status.shop!.id, display_name: form.name.trim() })
      setForm({ name: '', email: '' })
    }, false)
  }
  async function remove(id: string) { await run(async () => { await authedApi('/api/admin/member-update', { barbershop_id: status.shop!.id, membership_id: id, active: false }) }, false) }
  function submit(event: FormEvent) { event.preventDefault(); if (!barbers.length) { setError('Adicione pelo menos um profissional que atende (pode ser você).'); return } next() }
  return <form className="onb-card" onSubmit={submit} noValidate>
    <StepHead eyebrow="CONFIGURAÇÃO · EQUIPE" title="Quem atende na barbearia?" text="Cada profissional ganha sua agenda e aparece para os clientes na hora de agendar. Se você informar o e-mail, a pessoa recebe um convite para entrar com o próprio acesso."/>
    {barbers.length > 0 && <ul className="onb-list">{barbers.map(b => <li key={b.id}><UserRound size={16}/><strong>{b.display_name || 'Profissional'}</strong><span>{b.user_id ? 'Com acesso ao sistema' : 'Sem login · aparece na agenda'}</span><button type="button" className="onb-icon" aria-label={`Remover ${b.display_name}`} onClick={() => void remove(b.id)}><Trash2 size={15}/></button></li>)}</ul>}
    <div className="onb-inline">
      <label className="onb-field">Nome<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} maxLength={120}/></label>
      <label className="onb-field">E-mail (opcional)<input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}/></label>
      <button type="button" className="onb-btn ghost" onClick={() => void add()} disabled={busy}><Plus size={16}/> Adicionar</button>
    </div>
    {pricing.billing_enabled && <div className="onb-price-hint"><Wallet size={17}/><span>Cada profissional ativo soma {brl(pricing.barber_cents)}/mês. Com {barbers.length} profissional(is), sua mensalidade fica em <strong>{brl(monthly(pricing, barbers.length))}</strong>. O ajuste é feito automaticamente na próxima cobrança.</span></div>}
    {error && <p className="onb-error" role="alert">{error}</p>}
    <Footer busy={busy} back={back}/>
  </form>
}

function HorariosStep({ status, reload, next, back }: SetupProps) {
  const barbers = status.barbers || []
  const rules = status.availability || []
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6])
  const [form, setForm] = useState({ start: '09:00', end: '19:00', lunch: true, lunchStart: '12:00', lunchEnd: '13:00' })
  const [selected, setSelected] = useState<string[]>(() => barbers.map(b => b.id))
  const { busy, error, setError, run } = useSaver(reload, next)
  const summary = useMemo(() => barbers.map(b => ({ name: b.display_name || 'Profissional', days: [...new Set(rules.filter(r => r.barber_membership_id === b.id).map(r => r.weekday))].sort().map(n => weekdays.find(w => w.n === n)?.l).join(', ') })), [barbers, rules])
  function submit(event: FormEvent) {
    event.preventDefault()
    if (!barbers.length) { setError('Cadastre a equipe antes de definir os horários.'); return }
    if (!selected.length && rules.length) { next(); return }
    if (!selected.length) { setError('Escolha pelo menos um profissional.'); return }
    if (!days.length) { setError('Escolha pelo menos um dia de atendimento.'); return }
    if (form.end <= form.start) { setError('O horário de fim precisa ser depois do início.'); return }
    if (form.lunch && (form.lunchStart <= form.start || form.lunchEnd >= form.end || form.lunchEnd <= form.lunchStart)) { setError('O intervalo precisa ficar dentro do horário de atendimento.'); return }
    const windows = form.lunch ? [[form.start, form.lunchStart], [form.lunchEnd, form.end]] : [[form.start, form.end]]
    void run(async () => {
      const client = requireSupabase()
      const { error: deleteError } = await client.from('availability_rules').delete().eq('barbershop_id', status.shop!.id).in('barber_membership_id', selected)
      if (deleteError) throw deleteError
      const values = selected.flatMap(barber => days.flatMap(weekday => windows.map(([start_time, end_time]) => ({ barbershop_id: status.shop!.id, barber_membership_id: barber, weekday, start_time, end_time, active: true }))))
      const { error: insertError } = await client.from('availability_rules').insert(values)
      if (insertError) throw insertError
    })
  }
  return <form className="onb-card" onSubmit={submit} noValidate>
    <StepHead eyebrow="CONFIGURAÇÃO · HORÁRIOS" title="Quando vocês atendem?" text="A agenda só mostra horários livres dentro dessas janelas. Depois você ajusta folgas e horários especiais de cada profissional."/>
    {rules.length > 0 && <ul className="onb-list compact">{summary.map(s => <li key={s.name}><Clock size={16}/><strong>{s.name}</strong><span>{s.days || 'Sem horários'}</span></li>)}</ul>}
    <p className="onb-label">Profissionais</p>
    <div className="onb-pills">{barbers.map(b => <button type="button" key={b.id} className={selected.includes(b.id) ? 'on' : ''} aria-pressed={selected.includes(b.id)} onClick={() => setSelected(selected.includes(b.id) ? selected.filter(id => id !== b.id) : [...selected, b.id])}>{b.display_name || 'Profissional'}</button>)}</div>
    <p className="onb-label">Dias de atendimento</p>
    <div className="onb-pills">{weekdays.map(d => <button type="button" key={d.n} className={days.includes(d.n) ? 'on' : ''} aria-pressed={days.includes(d.n)} onClick={() => setDays(days.includes(d.n) ? days.filter(n => n !== d.n) : [...days, d.n])}>{d.l}</button>)}</div>
    <div className="onb-grid">
      <label className="onb-field">Abre às<input type="time" value={form.start} onChange={e => setForm({ ...form, start: e.target.value })}/></label>
      <label className="onb-field">Fecha às<input type="time" value={form.end} onChange={e => setForm({ ...form, end: e.target.value })}/></label>
    </div>
    <label className="onb-check"><input type="checkbox" checked={form.lunch} onChange={e => setForm({ ...form, lunch: e.target.checked })}/><span>Fazer uma pausa no meio do dia (almoço)</span></label>
    {form.lunch && <div className="onb-grid"><label className="onb-field">Pausa começa<input type="time" value={form.lunchStart} onChange={e => setForm({ ...form, lunchStart: e.target.value })}/></label><label className="onb-field">Pausa termina<input type="time" value={form.lunchEnd} onChange={e => setForm({ ...form, lunchEnd: e.target.value })}/></label></div>}
    {rules.length > 0 && <p className="onb-note">Salvar substitui os horários atuais dos profissionais selecionados.</p>}
    {error && <p className="onb-error" role="alert">{error}</p>}
    <Footer busy={busy} back={back}/>
  </form>
}

function PaginaStep({ status, reload, next, back }: SetupProps) {
  const shop = status.shop!
  const [form, setForm] = useState({ title: shop.bio_title || shop.name, description: shop.bio_description || '' })
  const { busy, error, setError, run } = useSaver(reload, next)
  const link = `${window.location.origin}/b/${shop.slug}`
  function submit(event: FormEvent) {
    event.preventDefault()
    if (form.title.trim().length < 2) { setError('Dê um título para a página.'); return }
    void run(async () => { const { error: e } = await requireSupabase().from('barbershops').update({ bio_title: form.title.trim(), bio_description: form.description.trim() || null }).eq('id', shop.id); if (e) throw e })
  }
  return <form className="onb-card" onSubmit={submit} noValidate>
    <StepHead eyebrow="CONFIGURAÇÃO · PÁGINA DA BARBEARIA" title="Sua página de agendamento" text="É o link que você coloca na bio do Instagram e manda no WhatsApp. Por ele o cliente vê os serviços e marca o horário."/>
    <div className="onb-linkbox"><Globe size={17}/><a href={link} target="_blank" rel="noopener noreferrer">{link.replace(/^https?:\/\//, '')}</a><button type="button" className="onb-link" onClick={() => void navigator.clipboard?.writeText(link)}>Copiar</button></div>
    <div className="onb-grid">
      <label className="onb-field wide">Título da página<input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} maxLength={120}/></label>
      <label className="onb-field wide">Uma frase sobre a barbearia (opcional)<textarea rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} maxLength={300} placeholder="Ex.: Corte, barba e aquele papo bom no coração da Ponta Verde."/></label>
    </div>
    <p className="onb-note">Logo, cores e fotos você personaliza depois na aba Identidade visual do painel.</p>
    {error && <p className="onb-error" role="alert">{error}</p>}
    <Footer busy={busy} back={back}/>
  </form>
}

function RecebimentosStep({ status, next, back }: SetupProps) {
  const receiving = status.receiving!
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function connect() {
    setBusy(true); setError(null)
    try { const result = await authedApi<{ authorization_url: string }>('/api/mercadopago/oauth-start', { barbershop_id: status.shop!.id }); window.location.assign(result.authorization_url) }
    catch (problem) { setError(message(problem)); setBusy(false) }
  }
  return <form className="onb-card" onSubmit={event => { event.preventDefault(); next() }}>
    <StepHead eyebrow="CONFIGURAÇÃO · RECEBER DOS CLIENTES" title="Receber pagamentos online (opcional)" text="Conectando a sua conta do Mercado Pago, os clientes podem pagar assinaturas e sinais de agendamento online. O dinheiro vai direto para a sua conta, separado da mensalidade do sistema."/>
    {receiving.connected ? <div className="onb-paid"><Check size={16}/> Sua conta do Mercado Pago está conectada.</div>
      : receiving.configured ? <div className="onb-alert"><span>Você vai entrar no Mercado Pago, autorizar a conexão e voltar para o painel.</span><button type="button" className="onb-btn ghost" onClick={() => void connect()} disabled={busy}>{busy && <LoaderCircle className="onb-spin" size={16}/>}<Lock size={15}/> Conectar Mercado Pago</button></div>
      : <div className="onb-alert"><span>O recebimento online pelos clientes ainda está sendo liberado. Por enquanto seus clientes pagam direto na barbearia, e você registra tudo no caixa do sistema.</span></div>}
    {error && <p className="onb-error" role="alert">{error}</p>}
    <Footer busy={busy} back={back} label={receiving.connected ? 'Continuar' : 'Continuar sem conectar'}/>
  </form>
}

function RevisaoStep({ status, back, done, go }: SetupProps & { done: Record<SetupKey, boolean>; go: (i: number) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const essentials: SetupKey[] = ['dados', 'servicos', 'equipe', 'horarios']
  const missing = essentials.filter(key => !done[key])
  async function finish(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null)
    try { await authedApi('/api/onboarding/complete', { barbershop_id: status.shop!.id }); window.location.assign(`/app?shop=${encodeURIComponent(status.shop!.slug)}`) }
    catch (problem) { setError(message(problem)); setBusy(false) }
  }
  return <form className="onb-card" onSubmit={finish}>
    <StepHead eyebrow="CONFIGURAÇÃO · REVISÃO FINAL" title={missing.length ? 'Quase lá!' : 'Tudo pronto para começar'} text={missing.length ? 'Ainda falta um pouco para a agenda funcionar redondinha. Você pode concluir agora e terminar depois pelo painel.' : 'Sua barbearia já pode receber agendamentos. No painel você encontra o tutorial guiado para conhecer cada parte do sistema.'}/>
    <ul className="onb-review">{setupSteps.filter(s => s.key !== 'revisao').map((step, i) => <li key={step.key} className={done[step.key] ? 'ok' : ''}><span>{done[step.key] ? <Check size={14}/> : '!'}</span><strong>{step.label}</strong><em>{step.key === 'servicos' ? `${status.services?.length || 0} serviço(s)` : step.key === 'equipe' ? `${status.barbers?.length || 0} profissional(is)` : step.key === 'horarios' ? (done.horarios ? 'Definidos' : 'Pendente') : step.key === 'recebimentos' ? (done.recebimentos ? 'Conectado' : 'Opcional') : done[step.key] ? 'Concluído' : 'Pendente'}</em><button type="button" className="onb-link" onClick={() => go(i)}>Editar</button></li>)}</ul>
    {error && <p className="onb-error" role="alert">{error}</p>}
    <div className="onb-actions"><button type="button" className="onb-btn ghost" onClick={back}><ArrowLeft size={17}/> Voltar</button><span className="onb-spacer"/><button className="onb-btn primary" type="submit" disabled={busy}>{busy && <LoaderCircle className="onb-spin" size={17}/>}Concluir e abrir meu painel <ArrowRight size={17}/></button></div>
  </form>
}

function DoneStep({ status }: { status: Status }) {
  const shop = status.shop!
  return <div className="onb-card">
    <StepHead eyebrow="PRONTO PARA USAR" icon={<Sparkles size={22}/>} title={`${shop.name} está no ar`} text="Sua configuração foi concluída. Entre no painel para acompanhar a agenda, os clientes e o caixa."/>
    <div className="onb-linkbox"><Globe size={17}/><a href={`/b/${shop.slug}`} target="_blank" rel="noopener noreferrer">{`${window.location.host}/b/${shop.slug}`}</a></div>
    <div className="onb-actions"><a className="onb-btn primary" href={`/app?shop=${encodeURIComponent(shop.slug)}`}>Abrir meu painel <ArrowRight size={17}/></a></div>
  </div>
}
