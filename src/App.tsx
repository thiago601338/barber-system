import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { BarChart3, BookOpenCheck, CalendarDays, ChevronDown, CircleHelp, ClipboardList, CreditCard, Crown, LayoutDashboard, Link2, LogOut, Menu, Package, Palette, Scissors, Settings2, ShoppingBasket, Sparkles, Target, TrendingUp, Users, Wallet, X } from 'lucide-react'
import { authedApi, authedGet, isConfigured, requireSupabase, supabase } from './lib/supabase'
import { moduleLabels, type Identity, type Membership, type ModuleKey, type Role, type Shop } from './types'
import { Loading, Notice } from './ui'
import { DashboardPage } from './pages/DashboardPage'
import { ReportsPage } from './pages/ReportsPage'
import { ClientsPage } from './pages/ClientsPage'
import { AppointmentsPage, ServicesPage } from './pages/SchedulingPage'
import { ProductsPage, BarPage, FinancePage, GoalsPage } from './pages/OperationsPage'
import { SubscriptionsPage } from './pages/SubscriptionsPage'
import { MarketingPage, BioPage } from './pages/GrowthPage'
import { PartnerClubPage } from './pages/PartnerClubPage'
import { SettingsPage } from './pages/SettingsPage'
import { MasterPage } from './pages/MasterPage'
import { ClientPage } from './pages/ClientPage'
import { PublicPage } from './pages/PublicPage'
import { TutorialPage } from './pages/TutorialPage'
import { BrandLogo } from './brand'
import { BrandIdentityPage } from './pages/BrandIdentityPage'
import { AiHelpPage } from './pages/AiHelpPage'
import { brandStyle, readBrandTheme, ShopBrand } from './shopBrand'
import { TeamAvatar } from './TeamAvatar'
import { GuidedTour } from './GuidedTour'
import { getTourChapters, saveFinishedTours, tourStorageKey, type TourStep } from './tour'

export interface PageProps { identity: Identity; role: Role; notify: (message: string, kind?: 'success' | 'error') => void }

const navItems: { key: ModuleKey; icon: typeof LayoutDashboard; group: string }[] = [
  { key: 'dashboard', icon: LayoutDashboard, group: 'GESTÃO' },
  { key: 'reports', icon: BarChart3, group: 'GESTÃO' },
  { key: 'appointments', icon: CalendarDays, group: 'GESTÃO' },
  { key: 'clients', icon: Users, group: 'GESTÃO' },
  { key: 'services', icon: Scissors, group: 'GESTÃO' },
  { key: 'subscriptions', icon: CreditCard, group: 'OPERAÇÃO' },
  { key: 'products', icon: Package, group: 'OPERAÇÃO' },
  { key: 'bar', icon: ShoppingBasket, group: 'OPERAÇÃO' },
  { key: 'finance', icon: Wallet, group: 'RESULTADOS' },
  { key: 'goals', icon: Target, group: 'RESULTADOS' },
  { key: 'partners', icon: Link2, group: 'CRESCIMENTO' },
  { key: 'marketing', icon: TrendingUp, group: 'CRESCIMENTO' },
  { key: 'ai', icon: Sparkles, group: 'CRESCIMENTO' },
  { key: 'bio', icon: ClipboardList, group: 'CRESCIMENTO' },
  { key: 'branding', icon: Palette, group: 'SISTEMA' },
  { key: 'settings', icon: Settings2, group: 'SISTEMA' },
  { key: 'tutorial', icon: BookOpenCheck, group: 'SISTEMA' },
]

function configuredPublicPath() { return /^\/b\/[^/]+(?:\/agendar)?\/?$/.test(window.location.pathname) }
function requestedShopSlug(): string | null {
  const params = new URLSearchParams(window.location.search)
  const explicit = params.get('shop')
  if (explicit && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(explicit)) return explicit
  const fromReturn = params.get('return')?.match(/^\/b\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/agendar)?(?:#.*)?$/)
  return fromReturn?.[1] || null
}

export default function App() {
  if (configuredPublicPath()) return <PublicPage />
  if (!isConfigured) return <SetupPage />
  return <AuthenticatedApp />
}

function SetupPage() {
  return <div className="auth-layout"><div className="auth-brand"><BrandLogo tone="dark"/><h1>Gestão para uma barbearia que cresce.</h1><p>Agenda, operação e números em um só lugar.</p><div className="auth-deco"><div className="deco-circle"/><span>UM NOVO PADRÃO DE GESTÃO</span></div></div><div className="auth-form-wrap"><div className="auth-form"><span className="eyebrow">CONFIGURAÇÃO INICIAL</span><h2>Conectar o projeto</h2><p>Informe a URL e a chave pública do Supabase nas variáveis <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> do ambiente de implantação. Chaves secretas ficam apenas no servidor.</p><Notice kind="info" text="O painel ficará disponível após a conexão e a criação das tabelas no Supabase."/></div></div></div>
}

function AuthPage() {
  const contextSlug = requestedShopSlug()
  const [contextShop, setContextShop] = useState<Shop | null>(null)
  const [contextLoading, setContextLoading] = useState(Boolean(contextSlug))
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!contextSlug) { setContextShop(null); setContextLoading(false); return }
    let active = true
    setContextLoading(true)
    void Promise.resolve(requireSupabase().from('barbershops')
      .select('id,name,slug,instagram_url,logo_url,bio_description,brand_theme,active')
      .eq('slug', contextSlug).eq('active', true).maybeSingle())
      .then(({ data }) => { if (active) setContextShop(data as Shop | null) })
      .catch(() => { if (active) setContextShop(null) })
      .finally(() => { if (active) setContextLoading(false) })
    return () => { active = false }
  }, [contextSlug])
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage(null); setError(null)
    try {
      const client = requireSupabase()
      if (mode === 'login') {
        const result = await client.auth.signInWithPassword({ email, password })
        if (result.error) throw result.error
        const returnTo = new URLSearchParams(window.location.search).get('return')
        if (returnTo?.startsWith('/b/')) window.location.assign(returnTo)
      } else if (mode === 'register') {
        const result = await client.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/${window.location.search}`, data: { full_name: name } } })
        if (result.error) throw result.error
        setMessage('Conta criada. Confira seu e-mail para confirmar o acesso, se solicitado.')
      } else {
        const result = await client.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/${window.location.search}` })
        if (result.error) throw result.error
        setMessage('Se o e-mail estiver cadastrado, você receberá as instruções de recuperação.')
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível continuar.') }
    finally { setBusy(false) }
  }
  if (contextLoading) return <div className="fullscreen-loading"><Loading text="Preparando acesso da barbearia..."/></div>
  const contextTheme = readBrandTheme(contextShop?.brand_theme)
  return <div className={`auth-layout ${contextTheme ? 'shop-themed shop-auth-context' : ''}`} data-shop-theme={contextTheme ? '' : undefined} style={brandStyle(contextTheme)}><div className="auth-brand">{contextShop ? <ShopBrand shop={contextShop} dark/> : <BrandLogo tone="dark"/>}<h1>{contextShop ? contextShop.name : 'Seu negócio, em boas mãos.'}</h1><p>{contextTheme?.tagline || contextShop?.bio_description || 'Toda a operação da barbearia em uma experiência simples e conectada.'}</p><div className="auth-deco"><div className="deco-circle"/><span>GESTÃO QUE ACOMPANHA VOCÊ</span></div></div><div className="auth-form-wrap"><form className="auth-form" onSubmit={submit}><div className="eyebrow">ACESSO SEGURO</div><h2>{mode === 'login' ? 'Bem-vindo de volta' : mode === 'register' ? 'Crie sua conta' : 'Recuperar senha'}</h2><p>{mode === 'login' ? 'Entre para acompanhar sua barbearia ou seus agendamentos.' : mode === 'register' ? 'Crie seu acesso. O painel master é ativado com o e-mail autorizado; administradores e barbeiros entram por convite.' : 'Enviaremos um link para seu e-mail cadastrado.'}</p>{mode === 'register' && <label className="field"><span>Nome completo</span><input required value={name} onChange={e => setName(e.target.value)} placeholder="Seu nome"/></label>}<label className="field"><span>E-mail</span><input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="voce@exemplo.com"/></label>{mode !== 'reset' && <label className="field"><span>Senha</span><input type="password" minLength={6} required value={password} onChange={e => setPassword(e.target.value)} placeholder="Sua senha"/></label>}<Notice text={error}/><Notice text={message} kind="success"/><button className="button primary auth-submit" type="submit" disabled={busy}>{busy ? 'Aguarde...' : mode === 'login' ? 'Entrar no sistema' : mode === 'register' ? 'Criar conta' : 'Enviar link'}</button><div className="auth-links">{mode !== 'login' ? <button type="button" onClick={() => setMode('login')}>Voltar para entrar</button> : <><button type="button" onClick={() => setMode('register')}>Criar conta</button><button type="button" onClick={() => setMode('reset')}>Esqueci minha senha</button></>}</div><small>{contextShop ? `Seu acesso fica ligado à ${contextShop.name}. Agendamentos e benefícios aparecem na sua conta.` : 'Administradores e barbeiros recebem convite da barbearia; o master ativa o acesso com o e-mail autorizado.'}</small></form></div></div>
}

function RecoveryPage({ mode, onComplete, onSignOut }: { mode: 'invite' | 'recovery'; onComplete: () => void; onSignOut: () => void }) {
  const contextSlug = requestedShopSlug()
  const [contextShop, setContextShop] = useState<Shop | null>(null)
  const [contextLoading, setContextLoading] = useState(true)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    setContextLoading(true)
    async function loadContext() {
      try {
        const client = requireSupabase()
        let result
        if (contextSlug) {
          result = await client.from('barbershops')
            .select('id,name,slug,logo_url,bio_description,brand_theme,active')
            .eq('slug', contextSlug).eq('active', true).maybeSingle()
        } else {
          // Invitation links use the site's already configured redirect URL.
          // Once accepted, the signed-in member still receives the correct shop identity.
          const { data: auth } = await client.auth.getUser()
          if (!auth.user) return
          const { data: memberships, error: memberError } = await client.from('memberships')
            .select('barbershop_id').eq('user_id', auth.user.id).eq('active', true).limit(2)
          if (memberError || memberships?.length !== 1) return
          result = await client.from('barbershops')
            .select('id,name,slug,logo_url,bio_description,brand_theme,active')
            .eq('id', memberships[0].barbershop_id).eq('active', true).maybeSingle()
        }
        if (active) setContextShop(result?.data as Shop | null || null)
      } catch { if (active) setContextShop(null) }
      finally { if (active) setContextLoading(false) }
    }
    void loadContext()
    return () => { active = false }
  }, [contextSlug])
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(null)
    if (password !== confirmation) { setError('As senhas não conferem.'); return }
    setBusy(true)
    try {
      const { error: updateError } = await requireSupabase().auth.updateUser({ password })
      if (updateError) throw updateError
      window.history.replaceState({}, '', contextSlug ? `/?shop=${encodeURIComponent(contextSlug)}` : '/')
      onComplete()
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Não foi possível atualizar sua senha.') }
    finally { setBusy(false) }
  }
  if (contextLoading) return <div className="fullscreen-loading"><Loading text="Preparando acesso da barbearia..."/></div>
  const contextTheme = readBrandTheme(contextShop?.brand_theme)
  return <div className={`auth-layout ${contextTheme ? 'shop-themed shop-auth-context' : ''}`} data-shop-theme={contextTheme ? '' : undefined} style={brandStyle(contextTheme)}><div className="auth-brand">{contextShop ? <ShopBrand shop={contextShop} dark/> : <BrandLogo tone="dark"/>}<h1>{mode === 'invite' ? 'Bem-vindo à sua nova equipe.' : 'Seu acesso, de volta às suas mãos.'}</h1><p>{mode === 'invite' ? 'Seu convite foi aceito. Defina sua senha para entrar na barbearia.' : `Defina uma nova senha para continuar usando ${contextShop?.name || 'o Barber System'} com segurança.`}</p><div className="auth-deco"><span>ACESSO SEGURO · {contextShop?.name.toUpperCase() || 'BARBER SYSTEM'}</span></div></div><div className="auth-form-wrap"><form className="auth-form" onSubmit={submit}><div className="eyebrow">{mode === 'invite' ? 'PRIMEIRO ACESSO' : 'RECUPERAR ACESSO'}</div><h2>{mode === 'invite' ? 'Crie sua senha' : 'Crie sua nova senha'}</h2><p>Use pelo menos oito caracteres e confirme a senha abaixo.</p><label className="field"><span>Nova senha</span><input type="password" minLength={8} autoComplete="new-password" required value={password} onChange={event => setPassword(event.target.value)}/></label><label className="field"><span>Confirmar nova senha</span><input type="password" minLength={8} autoComplete="new-password" required value={confirmation} onChange={event => setConfirmation(event.target.value)}/></label><Notice text={error}/><button className="button primary auth-submit" type="submit" disabled={busy}>{busy ? 'Salvando...' : 'Salvar senha e continuar'}</button><div className="auth-links"><button type="button" onClick={onSignOut}>Sair da conta</button></div></form></div></div>
}

function AuthenticatedApp() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [passwordFlow, setPasswordFlow] = useState<'invite' | 'recovery' | null>(() => {
    if (window.location.hash.includes('type=recovery') || window.location.search.includes('type=recovery')) return 'recovery'
    if (window.location.hash.includes('type=invite') || window.location.search.includes('type=invite') || window.location.pathname === '/entrar') return 'invite'
    return null
  })
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [identityError, setIdentityError] = useState<string | null>(null)
  const [selectedShopId, setSelectedShopId] = useState<string | null>(() => localStorage.getItem('barber-selected-shop'))
  const [page, setPage] = useState<ModuleKey | 'master'>(() => new URLSearchParams(window.location.search).get('page') === 'settings' ? 'settings' : 'dashboard')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [tourRun, setTourRun] = useState<{ steps: TourStep[]; chapterIds: string[]; index: number } | null>(null)
  const [masterEligible, setMasterEligible] = useState(false)
  const [toast, setToast] = useState<{ message: string; kind: 'success' | 'error' } | null>(null)
  const notify = useCallback((message: string, kind: 'success' | 'error' = 'success') => { setToast({ message, kind }); window.setTimeout(() => setToast(null), 5000) }, [])

  useEffect(() => {
    if (!supabase) return
    void supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((event, next) => { setSession(next); if (event === 'PASSWORD_RECOVERY') setPasswordFlow('recovery'); if (event === 'SIGNED_IN' && window.location.hash.includes('type=invite')) setPasswordFlow('invite'); if (event === 'SIGNED_OUT') setPasswordFlow(null) })
    return () => data.subscription.unsubscribe()
  }, [])

  const loadIdentity = useCallback(async () => {
    if (!session?.user) { setIdentity(null); return }
    setIdentityError(null)
    try {
      const client = requireSupabase()
      const [masterResult, membersResult, clientsResult] = await Promise.all([
        client.rpc('is_platform_admin'),
        client.from('memberships').select('*').eq('user_id', session.user.id).eq('active', true),
        client.from('clients').select('id,barbershop_id').eq('user_id', session.user.id),
      ])
      if (masterResult.error) throw masterResult.error
      if (membersResult.error) throw membersResult.error
      if (clientsResult.error) throw clientsResult.error
      const isMaster = masterResult.data === true
      const memberships = (membersResult.data ?? []) as Membership[]
      const clientRows = (clientsResult.data ?? []) as { id: string; barbershop_id: string }[]
      const contextSlug = requestedShopSlug()
      let shopQuery = client.from('barbershops').select('id,name,slug,timezone,phone,whatsapp,instagram_url,address,bio_title,bio_description,logo_url,brand_theme,active,created_at,updated_at').eq('active', true)
      if (!isMaster) {
        const ids = [...new Set([...memberships.map(m => m.barbershop_id), ...clientRows.map(c => c.barbershop_id)])]
        if (ids.length === 0 && !contextSlug) { setIdentity({ user: session.user, isMaster: false, memberships, shops: [], membership: null, shop: null, clientId: null, permissions: {} }); return }
        shopQuery = ids.length ? shopQuery.in('id', ids) : shopQuery.eq('slug', contextSlug!)
      }
      const shopsResult = await shopQuery.order('name')
      if (shopsResult.error) throw shopsResult.error
      const shops = (shopsResult.data ?? []) as Shop[]
      if (contextSlug && !shops.some(s => s.slug === contextSlug)) {
        const contextResult = await client.from('barbershops')
          .select('id,name,slug,timezone,phone,whatsapp,instagram_url,address,bio_title,bio_description,logo_url,brand_theme,active,created_at,updated_at')
          .eq('slug', contextSlug).eq('active', true).maybeSingle()
        if (contextResult.error) throw contextResult.error
        if (contextResult.data) shops.push(contextResult.data as Shop)
      }
      const shop = shops.find(s => s.slug === contextSlug) ?? shops.find(s => s.id === selectedShopId) ?? (isMaster ? null : shops[0] ?? null)
      const membership = memberships.find(m => m.barbershop_id === shop?.id) ?? null
      const clientRow = clientRows.find(c => c.barbershop_id === shop?.id)
      const permissionResult = shop && membership?.role === 'barber'
        ? await client.from('module_permissions').select('module,allowed').eq('barbershop_id', shop.id).eq('user_id', session.user.id)
        : null
      if (permissionResult?.error) throw permissionResult.error
      const permissions: Record<string, boolean> = {}
      for (const item of permissionResult?.data ?? []) permissions[String(item.module)] = Boolean(item.allowed)
      setIdentity({ user: session.user, isMaster, memberships, shops, membership, shop, clientId: clientRow?.id ?? null, permissions })
    } catch (err) { setIdentityError(err instanceof Error ? err.message : 'Falha ao carregar acesso.'); setIdentity(null) }
  }, [session?.user, selectedShopId])

  useEffect(() => { void loadIdentity() }, [loadIdentity])
  useEffect(() => { if (identity?.isMaster && !identity.shop) setPage('master') }, [identity?.isMaster, identity?.shop])
  useEffect(() => {
    if (!identity || identity.shop || identity.isMaster) { setMasterEligible(false); return }
    let active = true
    void authedGet<{ eligible: boolean }>('/api/admin/bootstrap-eligibility')
      .then(result => { if (active) setMasterEligible(result.eligible === true) })
      .catch(() => { if (active) setMasterEligible(false) })
    return () => { active = false }
  }, [identity])

  function changeShop(value: string) {
    const id = value || null
    const url = new URL(window.location.href)
    url.searchParams.delete('shop')
    url.searchParams.delete('return')
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
    setSelectedShopId(id)
    if (id) localStorage.setItem('barber-selected-shop', id)
    else localStorage.removeItem('barber-selected-shop')
    setPage(id ? 'dashboard' : 'master')
  }
  function canSee(key: ModuleKey): boolean {
    if (!identity) return false
    if (identity.isMaster || identity.membership?.role === 'admin') return true
    if (identity.membership?.role === 'barber') return key !== 'branding' && (key === 'dashboard' || key === 'tutorial' || identity.permissions[key] === true)
    return false
  }

  async function activateMaster() {
    try { await authedApi('/api/admin/bootstrap', {}); notify('Acesso master ativado.'); await loadIdentity() }
    catch (err) { notify(err instanceof Error ? err.message : 'Não foi possível ativar o acesso master.', 'error') }
  }

  if (session === undefined) return <div className="fullscreen-loading"><Loading text="Preparando seu acesso..."/></div>
  if (!session) return <AuthPage />
  if (passwordFlow) return <RecoveryPage mode={passwordFlow} onComplete={() => setPasswordFlow(null)} onSignOut={() => { const slug = requestedShopSlug(); window.history.replaceState({}, '', slug ? `/?shop=${encodeURIComponent(slug)}` : '/'); setPasswordFlow(null); void requireSupabase().auth.signOut() }}/>
  if (identityError) return <div className="state-screen"><div className="state-card"><CircleHelp size={32}/><h2>Não foi possível carregar seu acesso</h2><Notice text={identityError}/><p>Confira se o banco de dados foi configurado e se seu usuário foi vinculado a uma barbearia.</p><button className="button primary" onClick={() => void loadIdentity()}>Tentar novamente</button><button className="button ghost" onClick={() => void requireSupabase().auth.signOut()}>Sair</button></div></div>
  if (!identity) return <div className="fullscreen-loading"><Loading text="Carregando sua barbearia..."/></div>
  const role: Role = identity.isMaster ? 'master' : identity.membership?.role || 'client'
  if (!identity.shop && !identity.isMaster) return <div className="state-screen"><div className="state-card"><CircleHelp size={32}/><h2>Acesso ainda não vinculado</h2><p>Seu cadastro foi encontrado, mas ainda não há uma barbearia associada. Para entrar como profissional, peça ao administrador para liberar seu e-mail. Para agendar como cliente, acesse o link público da barbearia.</p>{masterEligible && <button className="button primary" onClick={() => void activateMaster()}>Ativar acesso master</button>}<button className="button ghost" onClick={() => void requireSupabase().auth.signOut()}>Sair da conta</button></div>{toast && <div className={`toast ${toast.kind}`}>{toast.message}</div>}</div>
  if (role === 'client' && identity.shop) return <><ClientPage key={identity.shop.id} identity={identity} role={role} notify={notify} onSignOut={() => void requireSupabase().auth.signOut()} />{toast && <div className={`toast ${toast.kind}`}>{toast.message}</div>}</>

  const allowedModules = navItems.filter(item => canSee(item.key)).map(item => item.key)
  function startTour(chapterIds: string[]) {
    const chapters = getTourChapters(role, allowedModules, Boolean(identity!.shop)).filter(chapter => chapterIds.includes(chapter.id))
    const steps = chapters.flatMap(chapter => chapter.steps)
    if (!steps.length) return
    setTourRun({ steps, chapterIds: chapters.map(chapter => chapter.id), index: 0 })
    setMobileOpen(window.innerWidth <= 980 && steps[0].kind === 'nav')
  }
  function moveTour(direction: -1 | 1) {
    if (!tourRun) return
    const nextIndex = tourRun.index + direction
    if (nextIndex >= tourRun.steps.length) {
      saveFinishedTours(tourStorageKey(identity!.user.id, identity!.shop?.id, role), tourRun.chapterIds)
      setTourRun(null); setPage('tutorial'); setMobileOpen(false)
      return
    }
    if (nextIndex < 0) return
    const nextStep = tourRun.steps[nextIndex]
    if (nextStep.kind === 'content' && nextStep.module !== 'client') setPage(nextStep.module)
    setMobileOpen(window.innerWidth <= 980 && nextStep.kind === 'nav')
    setTourRun({ ...tourRun, index: nextIndex })
  }
  function closeTour() { setTourRun(null); setPage('tutorial'); setMobileOpen(false) }

  const content: Record<ModuleKey | 'master', ReactNode> = {
    master: <MasterPage identity={identity} role={role} notify={notify} onRefresh={loadIdentity} />,
    dashboard: <DashboardPage identity={identity} role={role} notify={notify} onNavigate={setPage} />,
    reports: <ReportsPage identity={identity} role={role} notify={notify} />,
    appointments: <AppointmentsPage identity={identity} role={role} notify={notify} />,
    clients: <ClientsPage identity={identity} role={role} notify={notify} />,
    services: <ServicesPage identity={identity} role={role} notify={notify} />,
    subscriptions: <SubscriptionsPage identity={identity} role={role} notify={notify} />,
    products: <ProductsPage identity={identity} role={role} notify={notify} />,
    bar: <BarPage identity={identity} role={role} notify={notify} />,
    finance: <FinancePage identity={identity} role={role} notify={notify} />,
    goals: <GoalsPage identity={identity} role={role} notify={notify} />,
    partners: <PartnerClubPage key={identity.shop?.id} identity={identity} role={role} notify={notify} />,
    marketing: <MarketingPage identity={identity} role={role} notify={notify} />,
    ai: <AiHelpPage key={identity.shop?.id || 'platform'} identity={identity} role={role} notify={notify} />,
    bio: <BioPage identity={identity} role={role} notify={notify} />,
    branding: <BrandIdentityPage key={identity.shop?.id} identity={identity} role={role} notify={notify} onRefresh={loadIdentity} />,
    settings: <SettingsPage identity={identity} role={role} notify={notify} onRefresh={loadIdentity} onGoBranding={() => setPage('branding')} />,
    tutorial: <TutorialPage identity={identity} role={role} allowedModules={allowedModules} onStart={startTour}/>,
  }
  const visiblePage = page === 'master' ? 'master' : canSee(page) ? page : 'dashboard'
  const allowedNav = navItems.filter(item => canSee(item.key))
  const activeTheme = readBrandTheme(identity.shop?.brand_theme)
  return <div className={`app-layout ${activeTheme ? 'shop-themed' : ''}`} data-shop-theme={activeTheme ? '' : undefined} style={brandStyle(activeTheme)}>
    {mobileOpen && <div className="mobile-scrim" onClick={() => setMobileOpen(false)} />}
    <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
      <div className="sidebar-brand">{identity.shop ? <ShopBrand shop={identity.shop} compact dark/> : <BrandLogo tone="dark" compact/>}<button className="mobile-close icon-button" onClick={() => setMobileOpen(false)} aria-label="Fechar menu"><X size={20}/></button></div>
      <div className="shop-switcher"><div className="shop-avatar">{identity.shop?.name?.slice(0, 1) || 'M'}</div><div><strong>{identity.shop?.name || 'Painel master'}</strong><small>{identity.shop ? role === 'master' ? 'Acesso master' : role === 'admin' ? 'Administrador' : 'Profissional' : 'Todas as barbearias'}</small></div><ChevronDown size={15}/></div>
      <nav className="nav-list">
        {identity.isMaster && <><div className="nav-group">PLATAFORMA</div><button data-tour-nav="master" className={`nav-item ${visiblePage === 'master' ? 'active' : ''}`} onClick={() => { setPage('master'); setMobileOpen(false) }}><Crown size={19}/><span>Painel master</span></button>{!identity.shop && <><button data-tour-nav="ai" className={`nav-item ${visiblePage === 'ai' ? 'active' : ''}`} onClick={() => { setPage('ai'); setMobileOpen(false) }}><Sparkles size={18}/><span>Ajuda de IA</span></button><button data-tour-nav="tutorial" className={`nav-item ${visiblePage === 'tutorial' ? 'active' : ''}`} onClick={() => { setPage('tutorial'); setMobileOpen(false) }}><BookOpenCheck size={18}/><span>Passo a passo</span></button></>}</>}
        {identity.shop && allowedNav.map((item, index) => { const Icon = item.icon; const previous = allowedNav[index - 1]; return <div key={item.key}>{(!previous || previous.group !== item.group) && <div className="nav-group">{item.group}</div>}<button data-tour-nav={item.key} className={`nav-item ${visiblePage === item.key ? 'active' : ''}`} onClick={() => { setPage(item.key); setMobileOpen(false) }}><Icon size={18}/><span>{moduleLabels[item.key]}</span></button></div> })}
      </nav>
      <div className="sidebar-bottom"><div className="help-card"><div className="help-icon"><Sparkles size={18}/></div><strong>Decida com clareza</strong><p>Relatórios e ferramentas para evoluir sua operação.</p></div><button className="sidebar-logout" onClick={() => void requireSupabase().auth.signOut()}><LogOut size={17}/> Sair da conta</button></div>
    </aside>
    <div className="main-area"><header className="topbar"><button className="mobile-menu icon-button" onClick={() => setMobileOpen(true)} aria-label="Abrir menu"><Menu size={22}/></button><div className="topbar-crumb">{identity.shop?.name || 'Barber System'} <span>/</span> <strong>{visiblePage === 'master' ? 'Painel master' : moduleLabels[visiblePage]}</strong></div><div className="topbar-right">{identity.shops.length > 1 || identity.isMaster ? <select className="topbar-select" aria-label="Selecionar barbearia" value={identity.shop?.id || ''} onChange={e => changeShop(e.target.value)}><option value="">Visão master</option>{identity.shops.map(shop => <option value={shop.id} key={shop.id}>{shop.name}</option>)}</select> : null}<div className="profile-pill"><span>{identity.membership?.display_name || identity.user.email?.split('@')[0] || 'Usuário'}</span><TeamAvatar path={identity.membership?.avatar_path} name={identity.membership?.display_name || identity.user.email || 'Usuário'} shopId={identity.membership?.barbershop_id} memberId={identity.membership?.id} className="profile-avatar"/></div></div></header><main className="content">{content[visiblePage]}</main></div>
    {toast && <div className={`toast ${toast.kind}`}>{toast.message}</div>}
    {tourRun && <GuidedTour steps={tourRun.steps} index={tourRun.index} onBack={() => moveTour(-1)} onNext={() => moveTour(1)} onClose={closeTour}/>}
  </div>
}
