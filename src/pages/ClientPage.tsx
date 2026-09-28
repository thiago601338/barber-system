import { useState } from 'react'
import { BookOpenCheck, CalendarDays, Camera, CreditCard, History, LogOut, Sparkles } from 'lucide-react'
import type { PageProps } from '../App'
import { shopDateKey, shopDateTime } from '../lib/shopTime'
import { useRows } from '../lib/useRows'
import { asText, money } from '../types'
import { DataTable, PageHeader, Panel, Stat, Status } from '../ui'
import { TutorialPage } from './TutorialPage'
import { GuidedTour } from '../GuidedTour'
import { getTourChapters, saveFinishedTours, tourStorageKey, type TourStep } from '../tour'
import { brandStyle, readBrandTheme, safeInstagramUrl, ShopBrand } from '../shopBrand'

export function ClientPage({ identity, onSignOut }: PageProps & { onSignOut: () => void }) {
  const shop = identity.shop!
  const timezone = shop.timezone || 'America/Sao_Paulo'
  const [tutorialOpen, setTutorialOpen] = useState(false)
  const [tourRun, setTourRun] = useState<{ steps: TourStep[]; chapterIds: string[]; index: number } | null>(null)
  const appointments = useRows('appointments', shop.id)
  const subscriptions = useRows('subscriptions', shop.id)
  const plans = useRows('subscription_plans', shop.id)
  const usages = useRows('subscription_usages', shop.id)
  const payments = useRows('payments', shop.id)
  const procedures = useRows('procedure_records', shop.id)
  const myAppointments = appointments.rows.filter(a => a.client_id === identity.clientId)
  const mySubscriptions = subscriptions.rows.filter(s => s.client_id === identity.clientId)
  const myPayments = payments.rows.filter(p => p.client_id === identity.clientId && p.status === 'paid')
  const active = mySubscriptions.find(s => s.status === 'active')
  const plan = plans.rows.find(p => p.id === active?.plan_id)
  const used = usages.rows.filter(u => {
    if (u.subscription_id !== active?.id || !['reserved','used'].includes(String(u.status))) return false
    const appointment = myAppointments.find(a => a.id === u.appointment_id)
    if (!appointment) return false
    const when = String(appointment.starts_at)
    return (!active?.current_period_start || when >= String(active.current_period_start))
      && (!active?.current_period_end || when < String(active.current_period_end))
  }).length
  const remaining = active && plan ? Math.max(0, Number(plan.visits_per_cycle || 0) - used) : null
  const activeTheme = readBrandTheme(shop.brand_theme)
  const instagramUrl = safeInstagramUrl(shop.instagram_url)

  function startTour(chapterIds: string[]) {
    const chapters = getTourChapters('client', ['dashboard', 'appointments', 'subscriptions', 'tutorial'], true).filter(chapter => chapterIds.includes(chapter.id))
    const steps = chapters.flatMap(chapter => chapter.steps)
    if (!steps.length) return
    setTutorialOpen(false)
    setTourRun({ steps, chapterIds: chapters.map(chapter => chapter.id), index: 0 })
  }
  function moveTour(direction: -1 | 1) {
    if (!tourRun) return
    const nextIndex = tourRun.index + direction
    if (nextIndex >= tourRun.steps.length) {
      saveFinishedTours(tourStorageKey(identity.user.id, shop.id, 'client'), tourRun.chapterIds)
      setTourRun(null); setTutorialOpen(true)
    } else if (nextIndex >= 0) setTourRun({ ...tourRun, index: nextIndex })
  }

  return <div className={`client-layout ${activeTheme ? 'shop-themed' : ''}`} data-shop-theme={activeTheme ? '' : undefined} style={brandStyle(activeTheme)}>
    <header className="client-header">
      <a href={`/?shop=${encodeURIComponent(shop.slug)}`} className="client-brand"><ShopBrand shop={shop} compact/></a>
      <div>
        {instagramUrl && <a className="button ghost client-instagram" href={instagramUrl} target="_blank" rel="noreferrer" aria-label={`Instagram de ${shop.name}`}><Camera size={16}/> Instagram</a>}
        <button className="button ghost" onClick={() => setTutorialOpen(value => !value)}><BookOpenCheck size={16}/>{tutorialOpen ? 'Minha conta' : 'Passo a passo'}</button>
        <button className="button ghost" onClick={onSignOut}><LogOut size={16}/> Sair</button>
      </div>
    </header>
    {tutorialOpen ? <main className="client-content"><TutorialPage identity={identity} role="client" allowedModules={['dashboard','appointments','subscriptions','tutorial']} onStart={startTour}/></main> : <main className="client-content">
      <div data-tour-client="summary"><PageHeader eyebrow="ÁREA DO CLIENTE" title={`Olá, ${identity.user.user_metadata?.full_name?.split(' ')[0] || 'bem-vindo'}!`} description={`Acompanhe seus horários e benefícios em ${shop.name}.`} action={<a data-tour-client="book" className="button primary" href={`/b/${shop.slug}/agendar`}><CalendarDays size={17}/> Agendar procedimento</a>}/></div>
      <div className="stats-grid three" data-tour-client="stats">
        <Stat label="Visitas registradas" value={myAppointments.filter(a => a.status === 'completed').length} foot="Agendamentos concluídos" icon={<History size={19}/>}/>
        <Stat label="Valor pago" value={money(myPayments.reduce((sum,p) => sum + Number(p.amount_cents || 0),0))} foot="Pagamentos confirmados" icon={<CreditCard size={19}/>}/>
        <Stat label="Usos restantes" value={remaining === null ? 'Sem plano ativo' : remaining} foot={plan ? asText(plan.name) : 'Conheça os planos da barbearia'} icon={<Sparkles size={19}/>}/>
      </div>
      <div className="dashboard-grid">
        <div data-tour-client="upcoming"><Panel title="Próximos agendamentos" subtitle="Seus horários confirmados"><DataTable rows={myAppointments.filter(a => new Date(String(a.starts_at)).getTime() >= Date.now() && a.status !== 'cancelled').sort((a,b) => String(a.starts_at).localeCompare(String(b.starts_at)))} empty="Nenhum agendamento futuro" columns={[{ key: 'starts_at', label: 'Data e hora', render: row => shopDateTime(row.starts_at, timezone) }, { key: 'total_price_cents', label: 'Valor', render: row => money(row.total_price_cents) }, { key: 'status', label: 'Status', render: row => <Status value={row.status}/> }]} /></Panel></div>
        <div data-tour-client="plan"><Panel title="Minha assinatura" subtitle="Uso do ciclo atual">{active && plan ? <div className="client-plan"><div className="plan-icon"><CreditCard size={24}/></div><h3>{asText(plan.name)}</h3><strong>{remaining} de {asText(plan.visits_per_cycle)} usos disponíveis</strong><p>Próximo ciclo: {active.current_period_end ? shopDateKey(new Date(String(active.current_period_end)), timezone) : 'a confirmar'}</p><Status value={active.status}/></div> : <div className="client-plan empty-plan"><p>Você ainda não tem assinatura ativa. Consulte os planos oferecidos pela barbearia.</p></div>}</Panel></div>
      </div>
      <div data-tour-client="history"><Panel title="Histórico de visitas" subtitle="Agendamentos e procedimentos já realizados"><DataTable rows={myAppointments.sort((a,b) => String(b.starts_at).localeCompare(String(a.starts_at)))} empty="Nenhuma visita registrada" columns={[{ key: 'starts_at', label: 'Data', render: row => shopDateTime(row.starts_at, timezone) }, { key: 'total_price_cents', label: 'Valor', render: row => money(row.total_price_cents) }, { key: 'status', label: 'Status', render: row => <Status value={row.status}/> }]} /></Panel></div>
      {procedures.rows.some(row => row.client_id === identity.clientId) && <Panel title="Procedimentos realizados"><DataTable rows={procedures.rows.filter(row => row.client_id === identity.clientId)} empty="Nenhum procedimento" columns={[{ key: 'performed_at', label: 'Data', render: row => shopDateTime(row.performed_at, timezone) }, { key: 'description', label: 'Procedimento' }]} /></Panel>}
    </main>}
    {tourRun && <GuidedTour steps={tourRun.steps} index={tourRun.index} onBack={() => moveTour(-1)} onNext={() => moveTour(1)} onClose={() => { setTourRun(null); setTutorialOpen(true) }}/>}
  </div>
}
