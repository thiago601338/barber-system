import { useMemo, useState, type FormEvent } from 'react'
import { Activity, AlertCircle, ArrowRight, Building2, CalendarClock, CheckCircle2, CreditCard, Crown, Plus, RefreshCw, Scissors, Search, Settings2, Wallet } from 'lucide-react'
import { asText, date, money, type Row } from '../types'
import { DataTable, Empty, PageHeader, Panel, Stat, Status } from '../ui'

export interface PlatformSummary {
  active_shops: number
  active_barbers: number
  monthly_expected_cents: number
  monthly_potential_cents?: number
  invoiced_cents: number
  paid_cents: number
  outstanding_cents: number
  failed_cents: number
  refunded_cents: number
  other_cents: number
  paid_invoice_count: number
  open_invoice_count: number
  failed_invoice_count: number
  refunded_invoice_count: number
  other_invoice_count: number
  active_subscription_count: number
  pending_subscription_count: number
  paused_subscription_count: number
  cancelled_subscription_count: number
  unconfigured_shop_count: number
}

export interface MasterOverview {
  shops: Row[]
  settings: Record<string, unknown> | null
  memberships: Row[]
  invoices: Row[]
  subscriptions?: Row[]
  summary?: PlatformSummary | null
  monthly?: { month: string; invoiced_cents: number; paid_cents: number; pending_cents: number; failed_cents: number; refunded_cents: number; other_cents: number; invoice_count: number }[]
  payment_configuration?: {
    shop_oauth_configured: boolean
    shop_webhook_secret_present: boolean
    shop_checkout_url_configured: boolean
    platform_credentials_present: boolean
    platform_webhook_secret_present: boolean
    platform_checkout_url_configured: boolean
  }
}

type View = 'overview' | 'billing' | 'shops' | 'settings'
type InvoiceFilter = 'all' | 'paid' | 'open' | 'failed'

interface Props {
  overview: MasterOverview
  seatPrice: string
  setSeatPrice: (value: string) => void
  billing: boolean
  setBilling: (value: boolean) => void
  busy: boolean
  onSavePrice: (event: FormEvent) => void
  onCreateShop: () => void
  onInviteAdmin: () => void
  onManageBilling: (shop: Row) => void
  onRefresh: () => void
}

function amount(value: unknown): number { const number = Number(value); return Number.isFinite(number) ? number : 0 }
function statusText(value: unknown): string { return String(value || '').toLowerCase() }
function isOpenStatus(value: unknown): boolean { return ['pending', 'in_process', 'in_mediation', 'authorized'].includes(statusText(value)) }
function isFailedStatus(value: unknown): boolean { return ['failed', 'rejected', 'cancelled'].includes(statusText(value)) }
function isRefundedStatus(value: unknown): boolean { return ['refunded', 'charged_back'].includes(statusText(value)) }
function isActiveSubscription(value: unknown): boolean { return ['authorized', 'active'].includes(statusText(value)) }

export function MasterDashboard({ overview, seatPrice, setSeatPrice, billing, setBilling, busy, onSavePrice, onCreateShop, onInviteAdmin, onManageBilling, onRefresh }: Props) {
  const [view, setView] = useState<View>('overview')
  const [invoiceFilter, setInvoiceFilter] = useState<InvoiceFilter>('all')
  const [shopFilter, setShopFilter] = useState('all')
  const [shopSearch, setShopSearch] = useState('')
  const shopsById = useMemo(() => new Map(overview.shops.map(shop => [String(shop.id), shop])), [overview.shops])
  const subscriptionsByShop = useMemo(() => new Map((overview.subscriptions || []).map(subscription => [String(subscription.barbershop_id), subscription])), [overview.subscriptions])
  const activeShops = useMemo(() => overview.shops.filter(shop => shop.active), [overview.shops])
  const activeBarbers = useMemo(() => overview.memberships.filter(member => member.role === 'barber' && member.active && shopsById.get(String(member.barbershop_id))?.active), [overview.memberships, shopsById])
  const seatsByShop = useMemo(() => {
    const counts = new Map<string, number>()
    for (const member of activeBarbers) counts.set(String(member.barbershop_id), (counts.get(String(member.barbershop_id)) || 0) + 1)
    return counts
  }, [activeBarbers])
  const summary = overview.summary
  const samplePaid = overview.invoices.filter(invoice => statusText(invoice.status) === 'paid')
  const sampleOpen = overview.invoices.filter(invoice => isOpenStatus(invoice.status))
  const sampleFailed = overview.invoices.filter(invoice => isFailedStatus(invoice.status))
  const sampleRefunded = overview.invoices.filter(invoice => isRefundedStatus(invoice.status))
  const sampleOther = overview.invoices.filter(invoice => !['paid'].includes(statusText(invoice.status)) && !isOpenStatus(invoice.status) && !isFailedStatus(invoice.status) && !isRefundedStatus(invoice.status))
  const received = summary ? amount(summary.paid_cents) : samplePaid.reduce((sum, invoice) => sum + amount(invoice.amount_cents), 0)
  const outstanding = summary ? amount(summary.outstanding_cents) : sampleOpen.reduce((sum, invoice) => sum + amount(invoice.amount_cents), 0)
  const failed = summary ? amount(summary.failed_cents) : sampleFailed.reduce((sum, invoice) => sum + amount(invoice.amount_cents), 0)
  const refunded = summary ? amount(summary.refunded_cents) : sampleRefunded.reduce((sum, invoice) => sum + amount(invoice.amount_cents), 0)
  const other = summary ? amount(summary.other_cents) : sampleOther.reduce((sum, invoice) => sum + amount(invoice.amount_cents), 0)
  const activeSubscriptions = summary?.active_subscription_count ?? [...subscriptionsByShop.values()].filter(item => isActiveSubscription(item.status)).length
  const monthlyExpected = summary ? amount(summary.monthly_expected_cents) : [...subscriptionsByShop.values()].filter(item => isActiveSubscription(item.status)).reduce((sum, item) => sum + amount(item.amount_cents), 0)
  const potential = summary?.monthly_potential_cents ?? activeShops.reduce((sum, shop) => {
    const unit = shop.per_barber_monthly_cents == null ? amount(overview.settings?.seat_price_cents) : amount(shop.per_barber_monthly_cents)
    return sum + amount(shop.base_monthly_cents) + (seatsByShop.get(String(shop.id)) || 0) * unit
  }, 0)
  const openCount = summary?.open_invoice_count ?? sampleOpen.length
  const paidCount = summary?.paid_invoice_count ?? samplePaid.length
  const failedCount = summary?.failed_invoice_count ?? sampleFailed.length
  const refundedCount = summary?.refunded_invoice_count ?? sampleRefunded.length
  const unconfiguredCount = summary?.unconfigured_shop_count ?? Math.max(0, activeShops.length - subscriptionsByShop.size)
  const detailScope = summary ? 'Toda a plataforma' : `Recorte de ${overview.invoices.length} faturas recentes`
  const visibleInvoices = overview.invoices.filter(invoice => {
    if (shopFilter !== 'all' && invoice.barbershop_id !== shopFilter) return false
    if (invoiceFilter === 'paid') return statusText(invoice.status) === 'paid'
    if (invoiceFilter === 'open') return isOpenStatus(invoice.status)
    if (invoiceFilter === 'failed') return isFailedStatus(invoice.status)
    return true
  })
  const visibleShops = overview.shops.filter(shop => `${shop.name || ''} ${shop.slug || ''}`.toLowerCase().includes(shopSearch.toLowerCase()))
  const balanceTotal = received + outstanding + failed + refunded + other
  const receivedPercent = balanceTotal > 0 ? Math.round(received / balanceTotal * 100) : 0
  const balanceWidth = (value: number) => balanceTotal > 0 ? `${value / balanceTotal * 100}%` : '0%'
  const monthly = overview.monthly || []
  const hasMonthlyInvoices = monthly.some(item => amount(item.invoice_count) > 0)
  const monthlyMax = Math.max(1, ...monthly.map(item => amount(item.paid_cents) + amount(item.pending_cents) + amount(item.failed_cents) + amount(item.refunded_cents) + amount(item.other_cents)))

  return <div className="page-stack master-page">
    <PageHeader eyebrow="CENTRAL DA PLATAFORMA" title="Painel master" description="Acompanhe a operação e a cobrança central de todas as barbearias em um só lugar." action={<div className="button-row"><button className="button outline" type="button" onClick={onRefresh}><RefreshCw size={16}/> Atualizar</button><button className="button primary" type="button" onClick={onCreateShop}><Plus size={16}/> Nova barbearia</button></div>}/>

    <section className="master-hero" aria-label="Resumo da plataforma">
      <div className="master-hero-copy"><div className="master-hero-eyebrow"><Crown size={15}/> VISÃO DA PLATAFORMA</div><h2>Seu negócio, em perspectiva.</h2><p>Receita da plataforma, assinaturas SaaS e desempenho das barbearias. Os pagamentos dos clientes pertencem a cada barbearia e não entram nesta receita.</p><div className="master-hero-actions"><button type="button" onClick={() => setView('billing')}>Ver cobranças <ArrowRight size={16}/></button><button type="button" onClick={() => setView('shops')}>Gerenciar barbearias <ArrowRight size={16}/></button></div></div>
      <div className="master-hero-highlight"><span>ASSINATURAS CENTRAIS ATIVAS</span><strong>{activeSubscriptions}</strong><small>{billing ? `${activeBarbers.length} barbeiros em ${activeShops.length} barbearias ativas` : 'Cobrança central desativada'}</small></div>
    </section>

    <div className="master-tabs" role="tablist" aria-label="Seções do painel master">
      {([['overview', 'Visão geral', Activity], ['billing', 'Cobranças', Wallet], ['shops', 'Barbearias', Building2], ['settings', 'Configurações', Settings2]] as const).map(([key, label, Icon]) => <button key={key} type="button" role="tab" aria-selected={view === key} className={view === key ? 'active' : ''} onClick={() => setView(key)}><Icon size={17}/>{label}</button>)}
    </div>

    {view === 'overview' && <div className="page-stack" role="tabpanel">
      <div className="master-kpi-grid">
        <Stat label="Recebido no histórico" value={money(received)} foot={`${paidCount} fatura${paidCount === 1 ? '' : 's'} paga${paidCount === 1 ? '' : 's'} · ${detailScope}`} icon={<CheckCircle2 size={19}/>}/>
        <Stat label="Aguardando pagamento" value={money(outstanding)} foot={`${openCount} cobrança${openCount === 1 ? '' : 's'} pendente${openCount === 1 ? '' : 's'} · ${detailScope}`} icon={<CalendarClock size={19}/>}/>
        <Stat label="Falhas e estornos" value={money(failed + refunded)} foot={`${failedCount} falha${failedCount === 1 ? '' : 's'} · ${refundedCount} estorno${refundedCount === 1 ? '' : 's'}`} icon={<AlertCircle size={19}/>}/>
        <Stat label="Mensalidade ativa" value={money(monthlyExpected)} foot="Valor mensal de assinaturas centrais ativas" icon={<CreditCard size={19}/>}/>
      </div>
      {!summary && <p className="master-data-note"><AlertCircle size={15}/> Os totais desta tela consideram apenas as faturas recentes carregadas. A visão completa depende do resumo financeiro do servidor.</p>}
      <div className="master-overview-grid">
        <Panel title="Situação das cobranças" subtitle={`Valores de faturas registrados · ${detailScope}`}>
          <div className="master-balance"><div><span>Recebido</span><strong>{money(received)}</strong></div><div><span>Pendente</span><strong>{money(outstanding)}</strong></div></div>
          <div className="master-balance-track" role="img" aria-label={`${receivedPercent}% do valor faturado exibido está pago`}><span className="paid" style={{ width: balanceWidth(received) }}/><span className="open" style={{ width: balanceWidth(outstanding) }}/><span className="failed" style={{ width: balanceWidth(failed) }}/><span className="refunded" style={{ width: balanceWidth(refunded) }}/><span className="other" style={{ width: balanceWidth(other) }}/></div>
          <div className="master-balance-legend"><span><i className="paid"/>Pagamento confirmado</span><span><i className="open"/>Aguardando</span><span><i className="failed"/>Falhas: {money(failed)}</span><span><i className="refunded"/>Estornos: {money(refunded)}</span>{other > 0 && <span><i className="other"/>Outros: {money(other)}</span>}</div>
          <button className="master-text-action" type="button" onClick={() => setView('billing')}>Examinar faturas <ArrowRight size={16}/></button>
        </Panel>
        <Panel title="Carteira de barbearias" subtitle="Acesso, profissionais e recorrência central">
          <div className="master-health-list"><div><span><Building2 size={18}/> Barbearias ativas</span><strong>{activeShops.length}</strong></div><div><span><CreditCard size={18}/> Assinaturas ativas</span><strong>{activeSubscriptions}</strong></div><div><span><CalendarClock size={18}/> Sem checkout criado</span><strong>{unconfiguredCount}</strong></div><div><span><Scissors size={18}/> Potencial mensal da base</span><strong>{money(potential)}</strong></div></div>
          <p className="master-panel-note">O potencial soma mensalidade base e barbeiros ativos de todas as lojas ativas. É uma projeção de preços, não um pagamento recebido.</p>
          <button className="master-text-action" type="button" onClick={() => setView('shops')}>Ver barbearias <ArrowRight size={16}/></button>
        </Panel>
      </div>
      {monthly.length > 0 && <Panel title="Evolução das cobranças" subtitle="Últimos 12 meses por competência da fatura, separados por situação">{hasMonthlyInvoices ? <><div className="master-monthly-chart" role="img" aria-label="Evolução mensal das faturas da plataforma">{monthly.map(item => {
        const paidHeight = amount(item.paid_cents) / monthlyMax * 100
        const pendingHeight = amount(item.pending_cents) / monthlyMax * 100
        const failedHeight = amount(item.failed_cents) / monthlyMax * 100
        const refundedHeight = amount(item.refunded_cents) / monthlyMax * 100
        const otherHeight = amount(item.other_cents) / monthlyMax * 100
        const label = new Date(`${item.month}-01T12:00:00`).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })
        return <div className="master-month" key={item.month} title={`${label}: ${money(item.paid_cents)} pagos; ${money(item.pending_cents)} pendentes; ${money(item.failed_cents)} falhas; ${money(item.refunded_cents)} estornos; ${money(item.other_cents)} outros estados`}><div className="master-month-plot"><span className="master-month-other" style={{ height: `${otherHeight}%` }}/><span className="master-month-refunded" style={{ height: `${refundedHeight}%` }}/><span className="master-month-failed" style={{ height: `${failedHeight}%` }}/><span className="master-month-pending" style={{ height: `${pendingHeight}%` }}/><span className="master-month-paid" style={{ height: `${paidHeight}%` }}/></div><small>{label}</small></div>
      })}</div><div className="master-balance-legend"><span><i className="paid"/>Recebido</span><span><i className="open"/>Pendente</span><span><i className="failed"/>Falha</span><span><i className="refunded"/>Estorno</span><span><i className="other"/>Outros estados</span></div></> : <Empty title="Ainda não há faturas registradas" text="A evolução aparecerá quando a primeira cobrança central for processada."/>}</Panel>}
      {!billing && <div className="master-attention"><AlertCircle size={18}/><div><strong>Cobrança central desativada</strong><p>Defina o preço e habilite a cobrança em Configurações para iniciar assinaturas das barbearias.</p></div><button type="button" className="button outline" onClick={() => setView('settings')}>Configurar</button></div>}
      <Panel title="Faturas recentes" subtitle="Últimos lançamentos recebidos do Mercado Pago" action={<button className="master-text-action" type="button" onClick={() => setView('billing')}>Ver todas da lista <ArrowRight size={16}/></button>}>
        <InvoiceTable rows={overview.invoices.slice(0, 5)} shopsById={shopsById} />
      </Panel>
    </div>}

    {view === 'billing' && <div className="page-stack" role="tabpanel">
      <div className="master-section-heading"><div><h2>Cobrança da plataforma</h2><p>Faturas das assinaturas SaaS pagas à conta central. Cobranças de clientes são administradas em cada barbearia.</p></div><span>{detailScope}</span></div>
      <div className="master-kpi-grid"><Stat label="Recebido no histórico" value={money(received)} foot={`${paidCount} pagamentos confirmados`} icon={<CheckCircle2 size={19}/>}/><Stat label="Pendente" value={money(outstanding)} foot={`${openCount} cobranças aguardando`} icon={<CalendarClock size={19}/>}/><Stat label="Falha / estorno" value={money(failed + refunded)} foot={`${failedCount} falhas · ${refundedCount} estornos`} icon={<AlertCircle size={19}/>}/><Stat label="Recorrência mensal ativa" value={money(monthlyExpected)} foot="Assinaturas centrais autorizadas" icon={<CreditCard size={19}/>}/></div>
      <Panel title="Histórico de faturas" subtitle="Os filtros atuam sobre os 100 lançamentos mais recentes exibidos na lista.">
        <div className="master-filter-row"><label><span>Status</span><select value={invoiceFilter} onChange={event => setInvoiceFilter(event.target.value as InvoiceFilter)}><option value="all">Todos</option><option value="paid">Pagos</option><option value="open">Pendentes</option><option value="failed">Falhas e estornos</option></select></label><label><span>Barbearia</span><select value={shopFilter} onChange={event => setShopFilter(event.target.value)}><option value="all">Todas</option>{overview.shops.map(shop => <option key={shop.id} value={shop.id}>{asText(shop.name)}</option>)}</select></label><span className="master-filter-count">{visibleInvoices.length} exibida{visibleInvoices.length === 1 ? '' : 's'}</span></div>
        <InvoiceTable rows={visibleInvoices} shopsById={shopsById}/>
      </Panel>
      <p className="master-data-note"><AlertCircle size={15}/> O sistema ainda não registra data de vencimento. Pendente, falha e estorno são situações distintas; nenhum desses valores é apresentado como atraso.</p>
    </div>}

    {view === 'shops' && <div className="page-stack" role="tabpanel">
      <div className="master-section-heading"><div><h2>Barbearias da plataforma</h2><p>Consulte a equipe ativa, a assinatura central e os acessos de cada empresa.</p></div><button className="button outline" type="button" onClick={onInviteAdmin}><Plus size={16}/> Convidar administrador</button></div>
      <div className="master-shop-toolbar"><Search size={17}/><input type="search" value={shopSearch} onChange={event => setShopSearch(event.target.value)} placeholder="Buscar barbearia ou endereço" aria-label="Buscar barbearia"/><span>{visibleShops.length} de {overview.shops.length}</span></div>
      {visibleShops.length === 0 ? <Empty title="Nenhuma barbearia encontrada" text="Ajuste a busca ou cadastre uma nova barbearia." action={<button type="button" className="button primary" onClick={onCreateShop}>Nova barbearia</button>}/> : <div className="master-shop-grid">{visibleShops.map(shop => {
        const seats = seatsByShop.get(String(shop.id)) || 0
        const subscription = subscriptionsByShop.get(String(shop.id))
        const unit = shop.per_barber_monthly_cents == null ? amount(overview.settings?.seat_price_cents) : amount(shop.per_barber_monthly_cents)
        const base = amount(shop.base_monthly_cents)
        return <article className="master-shop-card" key={shop.id}><div className="master-shop-card-top"><div className="master-shop-monogram">{String(shop.name || 'B').slice(0, 1).toUpperCase()}</div><div><h3>{asText(shop.name)}</h3><span>/b/{asText(shop.slug)}</span></div><Status value={shop.active ? 'active' : 'paused'}/></div><div className="master-shop-metrics"><div><span>Barbeiros ativos</span><strong>{seats}</strong></div><div><span>Potencial mensal</span><strong>{money(shop.active ? base + seats * unit : 0)}</strong></div></div><p className="master-shop-formula">{money(base)} base + {seats} × {money(unit)} por barbeiro{shop.per_barber_monthly_cents == null ? ' (padrão)' : ''}</p><div className="master-shop-subscription"><span>Assinatura central</span>{subscription ? <Status value={subscription.status}/> : <strong>Não criada</strong>}</div><button type="button" className="button outline master-shop-action" onClick={() => onManageBilling(shop)}><CreditCard size={16}/> Gerenciar cobrança <ArrowRight size={15}/></button></article>
      })}</div>}
    </div>}

    {view === 'settings' && <div className="page-stack" role="tabpanel">
      <div className="master-section-heading"><div><h2>Preço e cobrança</h2><p>Defina quanto cada barbearia paga por barbeiro ativo. O valor é cobrado na conta central da plataforma.</p></div></div>
      <div className="master-settings-grid"><Panel title="Preço padrão por barbeiro" subtitle="Valor inicial; cada barbearia pode ter preço próprio"><form className="form-grid" onSubmit={onSavePrice}><label className="field"><span>Valor padrão por barbeiro ativo / mês (R$)</span><input type="number" min="0" step="0.01" required value={seatPrice} onChange={event => setSeatPrice(event.target.value)}/></label><label className="check-field"><input type="checkbox" checked={billing} onChange={event => setBilling(event.target.checked)}/> Cobrança central habilitada</label><button className="button primary" type="submit" disabled={busy}>{busy ? 'Salvando...' : 'Salvar preço padrão'}</button></form><p className="panel-footnote">O valor específico de cada barbearia é configurado em Barbearias → Gerenciar cobrança. Faturas emitidas preservam a composição aplicada na época.</p></Panel><Panel title="Como a receita é separada" subtitle="Transparência entre plataforma e barbearia"><div className="master-revenue-explain"><div><Wallet size={19}/><div><strong>Conta central</strong><p>Recebe a mensalidade SaaS da barbearia, incluindo valor base e barbeiros ativos.</p></div></div><div><Building2 size={19}/><div><strong>Conta da barbearia</strong><p>Recebe as assinaturas e pagamentos dos próprios clientes após conectar sua conta Mercado Pago.</p></div></div></div></Panel></div>
      <Panel title="Configuração de pagamentos" subtitle="Presença das configurações do Mercado Pago no servidor; não confirma uma cobrança de teste nem a entrega de webhook.">
        {overview.payment_configuration ? <div className="master-integration-grid"><div><h3>Conta central da plataforma</h3><IntegrationCheck label="Credenciais da conta central" present={overview.payment_configuration.platform_credentials_present}/><IntegrationCheck label="Segredo do webhook central" present={overview.payment_configuration.platform_webhook_secret_present}/><IntegrationCheck label="URL pública de checkout" present={overview.payment_configuration.platform_checkout_url_configured}/></div><div><h3>Contas das barbearias</h3><IntegrationCheck label="Aplicação OAuth" present={overview.payment_configuration.shop_oauth_configured}/><IntegrationCheck label="Segredo do webhook das lojas" present={overview.payment_configuration.shop_webhook_secret_present}/><IntegrationCheck label="URL pública de retorno" present={overview.payment_configuration.shop_checkout_url_configured}/></div></div> : <p className="master-panel-note">O diagnóstico da integração não está disponível no momento.</p>}
      </Panel>
    </div>}
  </div>
}

function InvoiceTable({ rows, shopsById }: { rows: Row[]; shopsById: Map<string, Row> }) {
  return <DataTable rows={rows} empty="Nenhuma fatura neste recorte" columns={[
    { key: 'barbershop_id', label: 'Barbearia', render: row => asText(shopsById.get(String(row.barbershop_id))?.name) },
    { key: 'period_start', label: 'Competência', render: row => `${date(row.period_start)} a ${date(row.period_end)}` },
    { key: 'seat_count', label: 'Barbeiros' },
    { key: 'amount_cents', label: 'Valor', render: row => money(row.amount_cents) },
    { key: 'status', label: 'Status', render: row => <Status value={row.status}/> },
  ]}/>
}

function IntegrationCheck({ label, present }: { label: string; present: boolean }) {
  return <div className="master-integration-check"><span>{label}</span><strong className={present ? 'present' : 'missing'}>{present ? 'Presente' : 'Pendente'}</strong></div>
}
