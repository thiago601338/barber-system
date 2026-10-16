import { useEffect, useState, type FormEvent } from 'react'
import { Copy, CreditCard } from 'lucide-react'
import type { PageProps } from '../App'
import { authedApi, authedGet } from '../lib/supabase'
import { asText, money, type Row } from '../types'
import { Field, Loading, Modal, Notice, PrimaryButton, Stat, Status } from '../ui'
import { MasterDashboard, type MasterOverview } from './MasterDashboard'
import { AiUsageSettings } from '../AiUsageSettings'
import { TutorialAudioAdmin } from '../TutorialAudioAdmin'
import { MasterBlogPanel } from '../MasterBlogPanel'
import { MasterLeadsPanel } from '../MasterLeadsPanel'

type Overview = MasterOverview
export type MasterView = 'overview' | 'blog' | 'leads'
interface SaasQuote { barbershop_id: string; billing_enabled: boolean; shop_active: boolean; seat_count: number; base_monthly_cents: number; unit_price_cents: number; monthly_cap_cents: number; subtotal_cents: number; discount_cents: number; amount_cents: number }
interface PricingDefaults { base: number; unit: number; cap: number }
interface InviteResponse { delivery: 'email' | 'manual_link' | 'existing_account'; email_sent: boolean; invite_url?: string }
const empty: Overview = { shops: [], settings: null, memberships: [], invoices: [] }
function priceCents(value: string, label: string) {
  const cents = Math.round(Number(value) * 100)
  if (!value.trim() || !Number.isSafeInteger(cents) || cents < 0 || cents > 10_000_000) throw new Error(`${label}: informe um valor entre R$ 0,00 e R$ 100.000,00.`)
  return cents
}

export function MasterPage({ notify, onRefresh, view, onViewChange }: PageProps & { onRefresh: () => Promise<void>; view: MasterView; onViewChange: (view: MasterView) => void }) {
  const [overview, setOverview] = useState<Overview>(empty)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<'shop' | 'invite' | null>(null)
  const [shopForm, setShopForm] = useState({ name: '', slug: '' })
  const [inviteForm, setInviteForm] = useState({ barbershop_id: '', email: '', display_name: '' })
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [basePrice, setBasePrice] = useState('')
  const [seatPrice, setSeatPrice] = useState('')
  const [monthlyCap, setMonthlyCap] = useState('')
  const [billing, setBilling] = useState(false)
  const [billingShop, setBillingShop] = useState<Row | null>(null)
  const [busy, setBusy] = useState(false)
  const platformPaymentReady = Boolean(overview.payment_configuration?.platform_credentials_present && overview.payment_configuration?.platform_webhook_secret_present && overview.payment_configuration?.platform_checkout_url_configured)
  async function refresh(showLoading = false) { if (showLoading) setLoading(true); setError(null); try { const data = await authedGet<Overview>('/api/admin/overview'); setOverview(data); setBasePrice(String(Number(data.settings?.base_monthly_cents ?? 0)/100)); setSeatPrice(String(Number(data.settings?.seat_price_cents ?? 0)/100)); setMonthlyCap(String(Number(data.settings?.monthly_cap_cents ?? 0)/100)); setBilling(Boolean(data.settings?.billing_enabled)) } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao carregar painel master.') } finally { setLoading(false) } }
  useEffect(() => { void refresh(true) }, [])
  async function createShop(event: FormEvent) { event.preventDefault(); setBusy(true); setError(null); try { await authedApi('/api/admin/create-shop', { name: shopForm.name.trim(), slug: shopForm.slug.trim().toLowerCase() }); notify('Barbearia criada.'); setModal(null); await refresh(); await onRefresh() } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao criar barbearia.') } finally { setBusy(false) } }
  async function inviteAdmin(event: FormEvent) {
    event.preventDefault(); if (busy || inviteUrl) return
    setBusy(true); setError(null)
    try {
      const result = await authedApi<InviteResponse>('/api/admin/invite', { barbershop_id: inviteForm.barbershop_id, email: inviteForm.email.trim(), role: 'admin', display_name: inviteForm.display_name.trim() || null })
      if (result.delivery === 'manual_link' && result.invite_url?.startsWith('https://')) {
        setInviteUrl(result.invite_url)
        notify('Acesso criado. Copie o link do convite; o e-mail não foi enviado.')
      } else if (result.delivery === 'email' && result.email_sent) {
        notify('Convite de administrador enviado por e-mail.'); setModal(null)
      } else if (result.delivery === 'existing_account') {
        notify('Acesso cadastrado. O administrador já tem conta e pode entrar com sua senha.'); setModal(null)
      } else throw new Error('O resultado do convite não foi confirmado. Confira os acessos antes de repetir.')
      await refresh()
    } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao convidar administrador.') }
    finally { setBusy(false) }
  }
  async function copyInviteUrl() {
    if (!inviteUrl) return
    try { await navigator.clipboard.writeText(inviteUrl); notify('Link do convite copiado.') }
    catch { setError('Não foi possível copiar automaticamente. Selecione o link do convite e copie manualmente.') }
  }
  async function savePrice(event: FormEvent) { event.preventDefault(); if (busy) return; setBusy(true); setError(null); try { await authedApi('/api/admin/set-seat-price', { base_monthly_cents: priceCents(basePrice, 'Mensalidade base'), seat_price_cents: priceCents(seatPrice, 'Valor por barbeiro'), monthly_cap_cents: priceCents(monthlyCap, 'Teto mensal'), billing_enabled: billing }); notify('Preços padrão do sistema atualizados.'); await refresh() } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao salvar preços.') } finally { setBusy(false) } }
  return <div className="page-stack">
    <nav className="button-row" aria-label="Áreas do administrador master"><button className={`button ${view==='overview'?'primary':'outline'}`} aria-current={view==='overview'?'page':undefined} onClick={()=>onViewChange('overview')}>Plataforma e cobranças</button><button className={`button ${view==='blog'?'primary':'outline'}`} aria-current={view==='blog'?'page':undefined} onClick={()=>onViewChange('blog')}>Blog e publicações</button><button className={`button ${view==='leads'?'primary':'outline'}`} aria-current={view==='leads'?'page':undefined} onClick={()=>onViewChange('leads')}>Solicitações de acesso</button></nav>
    <Notice text={error}/>
    {loading ? <Loading/> : view==='blog'?<MasterBlogPanel notify={notify}/>:view==='leads'?<MasterLeadsPanel notify={notify} onPrepareShop={lead=>{setShopForm({name:lead.business_name,slug:lead.business_name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')});onViewChange('overview');setModal('shop')}}/>:<MasterDashboard overview={overview} basePrice={basePrice} setBasePrice={setBasePrice} seatPrice={seatPrice} setSeatPrice={setSeatPrice} monthlyCap={monthlyCap} setMonthlyCap={setMonthlyCap} billing={billing} setBilling={setBilling} busy={busy} onSavePrice={savePrice} onCreateShop={() => setModal('shop')} onInviteAdmin={() => { setInviteUrl(null); setError(null); setInviteForm({ barbershop_id: '', email: '', display_name: '' }); setModal('invite') }} onManageBilling={setBillingShop} onRefresh={() => void refresh()}/>}
    {!loading&&view==='overview'&&<AiUsageSettings notify={notify}/>}
    {!loading&&view==='overview'&&<TutorialAudioAdmin/>}
    {modal === 'shop' && <Modal title="Nova barbearia" subtitle="Um ambiente separado será criado para esta empresa." onClose={() => setModal(null)}><form className="form-grid" onSubmit={createShop} data-tour-form="master-create-shop"><Field label="Nome da barbearia"><input required value={shopForm.name} onChange={e => setShopForm({ ...shopForm, name: e.target.value })}/></Field><Field label="Endereço curto"><input required pattern="[a-z0-9-]+" value={shopForm.slug} onChange={e => setShopForm({ ...shopForm, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,'') })} placeholder="minha-barbearia"/></Field><Notice text={error}/><div className="form-actions"><button type="button" className="button ghost" onClick={() => setModal(null)}>Cancelar</button><PrimaryButton type="submit" disabled={busy}>{busy ? 'Criando...' : 'Criar barbearia'}</PrimaryButton></div></form></Modal>}{modal === 'invite' && <Modal title="Convidar administrador" onClose={() => setModal(null)}><form className="form-grid" onSubmit={inviteAdmin} data-tour-form="master-invite-admin"><Field label="Barbearia"><select required disabled={busy || !!inviteUrl} value={inviteForm.barbershop_id} onChange={e => setInviteForm({ ...inviteForm, barbershop_id: e.target.value })}><option value="">Selecione</option>{overview.shops.map(shop => <option key={shop.id} value={shop.id}>{asText(shop.name)}</option>)}</select></Field><Field label="E-mail"><input type="email" required disabled={busy || !!inviteUrl} value={inviteForm.email} onChange={e => setInviteForm({ ...inviteForm, email: e.target.value })}/></Field><Field label="Nome exibido"><input disabled={busy || !!inviteUrl} value={inviteForm.display_name} onChange={e => setInviteForm({ ...inviteForm, display_name: e.target.value })}/></Field><Notice text={error}/>{inviteUrl && <div className="notice success"><div><strong>Acesso criado. Compartilhe o convite manualmente.</strong><p>O e-mail não foi enviado. Este link permite ao administrador definir a senha.</p><input readOnly aria-label="Link do convite do administrador" value={inviteUrl}/><button className="button outline" type="button" onClick={() => void copyInviteUrl()}><Copy size={16}/> Copiar link</button></div></div>}<div className="form-actions"><button type="button" className="button ghost" onClick={() => setModal(null)}>{inviteUrl ? 'Fechar' : 'Cancelar'}</button><PrimaryButton type="submit" disabled={busy || !!inviteUrl}>{busy ? 'Convidando...' : 'Enviar convite'}</PrimaryButton></div></form></Modal>}{billingShop && <SaasBillingModal shop={billingShop} pricingDefaults={{base:Number(overview.settings?.base_monthly_cents ?? 0),unit:Number(overview.settings?.seat_price_cents ?? 0),cap:Number(overview.settings?.monthly_cap_cents ?? 0)}} paymentReady={platformPaymentReady} onClose={() => setBillingShop(null)} onUpdated={refresh}/>}
  </div>
}

function SaasBillingModal({ shop, pricingDefaults, paymentReady, onClose, onUpdated }: { shop: Row; pricingDefaults: PricingDefaults; paymentReady: boolean; onClose: () => void; onUpdated: () => Promise<void> }) {
  const [quote, setQuote] = useState<SaasQuote | null>(null)
  const [subscription, setSubscription] = useState<Row | null>(null)
  const [payerEmail, setPayerEmail] = useState('')
  const [inheritBase, setInheritBase] = useState(shop.base_monthly_cents == null)
  const [basePrice, setBasePrice] = useState(String(Number(shop.base_monthly_cents ?? pricingDefaults.base) / 100))
  const [inheritPrice, setInheritPrice] = useState(shop.per_barber_monthly_cents == null)
  const [unitPrice, setUnitPrice] = useState(String(Number(shop.per_barber_monthly_cents ?? pricingDefaults.unit) / 100))
  const [inheritCap, setInheritCap] = useState(shop.monthly_cap_cents == null)
  const [capPrice, setCapPrice] = useState(String(Number(shop.monthly_cap_cents ?? pricingDefaults.cap) / 100))
  const [saved, setSaved] = useState(false)
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null)
  const [linkCopied, setLinkCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function refreshStatus() {
    setLoading(true); setError(null)
    try {
      const query = `?barbershop_id=${encodeURIComponent(shop.id)}`
      const currentQuote = await authedGet<SaasQuote>(`/api/mercadopago/saas-quote${query}`)
      setQuote(currentQuote)
      const status = await authedGet<{ quote: SaasQuote; subscription: Row | null; checkout_url?: string | null }>(`/api/mercadopago/saas-status${query}`)
      setSubscription(status.subscription)
      setCheckoutUrl(status.subscription?.status === 'pending' ? status.checkout_url || null : null)
      if (status.subscription?.payer_email) setPayerEmail(String(status.subscription.payer_email))
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Não foi possível consultar a cobrança central.') }
    finally { setLoading(false) }
  }

  useEffect(() => { void refreshStatus() }, [shop.id])

  async function savePricing(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError(null); setSaved(false)
    try {
      await authedApi('/api/admin/set-shop-pricing', {
        barbershop_id: shop.id,
        base_monthly_cents: inheritBase ? null : priceCents(basePrice, 'Mensalidade base'),
        per_barber_monthly_cents: inheritPrice ? null : priceCents(unitPrice, 'Valor por barbeiro'),
        monthly_cap_cents: inheritCap ? null : priceCents(capPrice, 'Teto mensal'),
      })
      setSaved(true)
      await refreshStatus(); await onUpdated()
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Não foi possível salvar os preços desta barbearia.') }
    finally { setBusy(false) }
  }

  async function start(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null)
    try {
      const result = await authedApi<{ checkout_url: string | null }>('/api/mercadopago/saas-start', { barbershop_id: shop.id, payer_email: payerEmail.trim() })
      setCheckoutUrl(result.checkout_url); setLinkCopied(false)
      await refreshStatus(); await onUpdated()
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Não foi possível iniciar a cobrança.') }
    finally { setBusy(false) }
  }

  async function change(action: 'saas-sync' | 'saas-cancel') {
    setBusy(true); setError(null)
    try { await authedApi(`/api/mercadopago/${action}`, { barbershop_id: shop.id }); await refreshStatus(); await onUpdated() }
    catch (problem) { setError(problem instanceof Error ? problem.message : 'Não foi possível atualizar a cobrança.') }
    finally { setBusy(false) }
  }

  async function copyCheckout() {
    if (!checkoutUrl) return
    try { await navigator.clipboard.writeText(checkoutUrl); setLinkCopied(true) }
    catch { setError('Não foi possível copiar automaticamente. Abra o checkout e copie o endereço da página.') }
  }

  return <Modal title={`Cobrança central · ${asText(shop.name)}`} subtitle="Mensalidade SaaS recebida na conta da plataforma" onClose={onClose} wide>
    <div className="form-grid">
      <Notice text={error}/><Notice text={saved ? 'Preços desta barbearia salvos.' : null} kind="success"/>
      <form className="form-grid master-pricing-form" onSubmit={savePricing}>
        <h3>Preços desta barbearia</h3>
        <p className="panel-footnote">Escolha separadamente quais valores seguem o padrão da plataforma. Desmarque um padrão para definir o valor desta empresa.</p>
        <div className="field"><span>Mensalidade base (R$)</span>
          <input aria-label="Mensalidade base desta barbearia (R$)" type="number" min="0" max="100000" step="0.01" required={!inheritBase} disabled={busy || inheritBase} value={inheritBase ? String(pricingDefaults.base / 100) : basePrice} onChange={event => {setBasePrice(event.target.value);setSaved(false)}}/>
          <label className="check-field"><input type="checkbox" disabled={busy} checked={inheritBase} onChange={event => {setInheritBase(event.target.checked);setSaved(false)}}/> Usar a base padrão: {money(pricingDefaults.base)}</label>
        </div>
        <div className="field"><span>Por barbeiro ativo (R$)</span>
          <input aria-label="Por barbeiro ativo desta barbearia (R$)" type="number" min="0" max="100000" step="0.01" required={!inheritPrice} disabled={busy || inheritPrice} value={inheritPrice ? String(pricingDefaults.unit / 100) : unitPrice} onChange={event => {setUnitPrice(event.target.value);setSaved(false)}}/>
          <label className="check-field"><input type="checkbox" disabled={busy} checked={inheritPrice} onChange={event => {setInheritPrice(event.target.checked);setSaved(false)}}/> Usar o valor padrão por barbeiro: {money(pricingDefaults.unit)}</label>
        </div>
        <div className="field"><span>Teto mensal desta barbearia (R$)</span>
          <input aria-label="Teto mensal desta barbearia (R$)" type="number" min="0" max="100000" step="0.01" required={!inheritCap} disabled={busy || inheritCap} value={inheritCap ? String(pricingDefaults.cap / 100) : capPrice} onChange={event => {setCapPrice(event.target.value);setSaved(false)}}/>
          <label className="check-field"><input type="checkbox" disabled={busy} checked={inheritCap} onChange={event => {setInheritCap(event.target.checked);setSaved(false)}}/> Usar o teto padrão: {pricingDefaults.cap > 0 ? money(pricingDefaults.cap) : 'sem limite'}</label>
          <small>Desmarque o padrão e informe 0 para remover o teto apenas desta barbearia.</small>
        </div>
        <p className="panel-footnote">Bruto = base + barbeiros cadastrados ativos × valor por barbeiro. Administradores não contam como barbeiros. O teto, quando maior que zero, limita o total. Os valores abaixo refletem os preços salvos; salve para atualizar a composição.</p>
        <button className="button primary" type="submit" disabled={busy}>{busy ? 'Salvando...' : 'Salvar preços da barbearia'}</button>
      </form>
      {loading && !quote ? <Loading text="Consultando valor e assinatura..."/> : <>
        <div className="master-quote-grid">
          <Stat label="Mensalidade base" value={quote ? money(quote.base_monthly_cents) : '—'} foot="Preço salvo para esta empresa"/>
          <Stat label="Barbeiros ativos" value={quote?.seat_count ?? '—'} foot="Cadastros ativos com perfil de barbeiro"/>
          <Stat label="Por barbeiro" value={quote ? money(quote.unit_price_cents) : '—'} foot="Valor por profissional / mês"/>
          <Stat label="Total mensal" value={quote ? money(quote.amount_cents) : '—'} foot="Depois de aplicar o teto, se houver"/>
        </div>
        {quote && <>
          <div className="detail-list">
            <div><span>Valor bruto</span><strong>{money(quote.subtotal_cents)}</strong></div>
            <div><span>Teto mensal aplicado</span><strong>{quote.monthly_cap_cents > 0 ? money(quote.monthly_cap_cents) : 'Sem limite'}</strong></div>
            <div><span>Abatimento pelo teto</span><strong>{money(quote.discount_cents)}</strong></div>
            <div><span>Total da composição</span><strong>{money(quote.amount_cents)} por mês</strong></div>
          </div>
          <p className="master-quote-formula">{money(quote.base_monthly_cents)} + {quote.seat_count} × {money(quote.unit_price_cents)} = {money(quote.subtotal_cents)} bruto. {quote.monthly_cap_cents > 0 ? `Com teto de ${money(quote.monthly_cap_cents)}, o abatimento é ${money(quote.discount_cents)}.` : 'Sem teto mensal.'} Total: <strong>{money(quote.amount_cents)} por mês.</strong></p>
        </>}
        <div className="detail-list">
          <div><span>Cobrança habilitada</span><strong>{quote?.billing_enabled ? 'Sim' : 'Não'}</strong></div>
          <div><span>Mercado Pago central</span><strong>{paymentReady ? 'Configurado' : 'Pendente'}</strong></div>
          <div><span>Assinatura central</span><strong>{subscription ? <Status value={subscription.status}/> : 'Não criada'}</strong></div>
          {subscription && <div><span>Valor vigente da assinatura</span><strong>{money(subscription.amount_cents)}</strong></div>}
        </div>
        {!paymentReady && <Notice text="Configure o Mercado Pago central para gerar o link de aprovação."/>}
        {!subscription || subscription.status === 'cancelled' ? <form className="form-grid" onSubmit={start}>
          <Field label="E-mail do responsável que vai autorizar o pagamento"><input type="email" required value={payerEmail} onChange={event => setPayerEmail(event.target.value)} placeholder="financeiro@barbearia.com"/></Field>
          <PrimaryButton type="submit" disabled={busy || !paymentReady || !quote?.billing_enabled || !quote?.shop_active || !quote?.amount_cents}>{busy ? 'Iniciando...' : 'Gerar link de aprovação'}</PrimaryButton>
        </form> : <div className="button-row"><button className="button outline" disabled={busy} onClick={() => void change('saas-sync')}>Conciliar cobrança agora</button><button className="button danger-text" disabled={busy} onClick={() => void change('saas-cancel')}>Cancelar assinatura central</button></div>}
        {checkoutUrl && <div className="master-checkout-actions"><button className="button outline" type="button" onClick={() => void copyCheckout()}><Copy size={16}/>{linkCopied ? 'Link copiado' : 'Copiar link para o responsável'}</button><a className="button primary" href={checkoutUrl} target="_blank" rel="noreferrer">Visualizar checkout <CreditCard size={16}/></a></div>}
        <p className="panel-footnote">Fluxo: defina os preços, gere o link e envie ao responsável da barbearia. Ele autoriza a assinatura no Mercado Pago; as cobranças recorrentes são destinadas à conta central da plataforma. Faturas emitidas mantêm o valor original. O painel confirma pagamentos após o webhook ou a conciliação.</p>
      </>}
    </div>
  </Modal>
}

