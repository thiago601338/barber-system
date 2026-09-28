import { useEffect, useState, type FormEvent } from 'react'
import { Copy, CreditCard } from 'lucide-react'
import type { PageProps } from '../App'
import { authedApi, authedGet } from '../lib/supabase'
import { asText, money, type Row } from '../types'
import { Field, Loading, Modal, Notice, PrimaryButton, Stat, Status } from '../ui'
import { MasterDashboard, type MasterOverview } from './MasterDashboard'

type Overview = MasterOverview
interface SaasQuote { barbershop_id: string; billing_enabled: boolean; shop_active: boolean; seat_count: number; base_monthly_cents: number; unit_price_cents: number; amount_cents: number }
const empty: Overview = { shops: [], settings: null, memberships: [], invoices: [] }

export function MasterPage({ notify, onRefresh }: PageProps & { onRefresh: () => Promise<void> }) {
  const [overview, setOverview] = useState<Overview>(empty)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<'shop' | 'invite' | null>(null)
  const [shopForm, setShopForm] = useState({ name: '', slug: '' })
  const [inviteForm, setInviteForm] = useState({ barbershop_id: '', email: '', display_name: '' })
  const [seatPrice, setSeatPrice] = useState('')
  const [billing, setBilling] = useState(false)
  const [billingShop, setBillingShop] = useState<Row | null>(null)
  const [busy, setBusy] = useState(false)
  const platformPaymentReady = Boolean(overview.payment_configuration?.platform_credentials_present && overview.payment_configuration?.platform_webhook_secret_present && overview.payment_configuration?.platform_checkout_url_configured)
  async function refresh(showLoading = false) { if (showLoading) setLoading(true); setError(null); try { const data = await authedGet<Overview>('/api/admin/overview'); setOverview(data); setSeatPrice(String(Number(data.settings?.seat_price_cents || 0)/100)); setBilling(Boolean(data.settings?.billing_enabled)) } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao carregar painel master.') } finally { setLoading(false) } }
  useEffect(() => { void refresh(true) }, [])
  async function createShop(event: FormEvent) { event.preventDefault(); setBusy(true); setError(null); try { await authedApi('/api/admin/create-shop', { name: shopForm.name.trim(), slug: shopForm.slug.trim().toLowerCase() }); notify('Barbearia criada.'); setModal(null); await refresh(); await onRefresh() } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao criar barbearia.') } finally { setBusy(false) } }
  async function inviteAdmin(event: FormEvent) { event.preventDefault(); setBusy(true); setError(null); try { await authedApi('/api/admin/invite', { barbershop_id: inviteForm.barbershop_id, email: inviteForm.email.trim(), role: 'admin', display_name: inviteForm.display_name.trim() || null }); notify('Convite de administrador processado.'); setModal(null); await refresh() } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao convidar administrador.') } finally { setBusy(false) } }
  async function savePrice(event: FormEvent) { event.preventDefault(); setBusy(true); setError(null); try { await authedApi('/api/admin/set-seat-price', { seat_price_cents: Math.round(Number(seatPrice)*100), billing_enabled: billing }); notify('Preço do sistema atualizado.'); await refresh() } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao salvar preço.') } finally { setBusy(false) } }
  return <div className="page-stack">
    <Notice text={error}/>
    {loading ? <Loading/> : <MasterDashboard overview={overview} seatPrice={seatPrice} setSeatPrice={setSeatPrice} billing={billing} setBilling={setBilling} busy={busy} onSavePrice={savePrice} onCreateShop={() => setModal('shop')} onInviteAdmin={() => setModal('invite')} onManageBilling={setBillingShop} onRefresh={() => void refresh()}/>}
    {modal === 'shop' && <Modal title="Nova barbearia" subtitle="Um ambiente separado será criado para esta empresa." onClose={() => setModal(null)}><form className="form-grid" onSubmit={createShop}><Field label="Nome da barbearia"><input required value={shopForm.name} onChange={e => setShopForm({ ...shopForm, name: e.target.value })}/></Field><Field label="Endereço curto"><input required pattern="[a-z0-9-]+" value={shopForm.slug} onChange={e => setShopForm({ ...shopForm, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,'') })} placeholder="minha-barbearia"/></Field><Notice text={error}/><div className="form-actions"><button type="button" className="button ghost" onClick={() => setModal(null)}>Cancelar</button><PrimaryButton type="submit" disabled={busy}>{busy ? 'Criando...' : 'Criar barbearia'}</PrimaryButton></div></form></Modal>}{modal === 'invite' && <Modal title="Convidar administrador" onClose={() => setModal(null)}><form className="form-grid" onSubmit={inviteAdmin}><Field label="Barbearia"><select required value={inviteForm.barbershop_id} onChange={e => setInviteForm({ ...inviteForm, barbershop_id: e.target.value })}><option value="">Selecione</option>{overview.shops.map(shop => <option key={shop.id} value={shop.id}>{asText(shop.name)}</option>)}</select></Field><Field label="E-mail"><input type="email" required value={inviteForm.email} onChange={e => setInviteForm({ ...inviteForm, email: e.target.value })}/></Field><Field label="Nome exibido"><input value={inviteForm.display_name} onChange={e => setInviteForm({ ...inviteForm, display_name: e.target.value })}/></Field><Notice text={error}/><div className="form-actions"><button type="button" className="button ghost" onClick={() => setModal(null)}>Cancelar</button><PrimaryButton type="submit" disabled={busy}>{busy ? 'Convidando...' : 'Enviar convite'}</PrimaryButton></div></form></Modal>}{billingShop && <SaasBillingModal shop={billingShop} paymentReady={platformPaymentReady} onClose={() => setBillingShop(null)} onUpdated={refresh}/>}
  </div>
}

function SaasBillingModal({ shop, paymentReady, onClose, onUpdated }: { shop: Row; paymentReady: boolean; onClose: () => void; onUpdated: () => Promise<void> }) {
  const [quote, setQuote] = useState<SaasQuote | null>(null)
  const [subscription, setSubscription] = useState<Row | null>(null)
  const [payerEmail, setPayerEmail] = useState('')
  const [basePrice, setBasePrice] = useState(String(Number(shop.base_monthly_cents || 0) / 100))
  const [inheritPrice, setInheritPrice] = useState(shop.per_barber_monthly_cents == null)
  const [unitPrice, setUnitPrice] = useState(String(Number(shop.per_barber_monthly_cents || 0) / 100))
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
    event.preventDefault(); setBusy(true); setError(null); setSaved(false)
    try {
      await authedApi('/api/admin/set-shop-pricing', {
        barbershop_id: shop.id,
        base_monthly_cents: Math.round(Number(basePrice) * 100),
        per_barber_monthly_cents: inheritPrice ? null : Math.round(Number(unitPrice) * 100),
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

  return <Modal title={`Cobrança central · ${asText(shop.name)}`} subtitle="Mensalidade SaaS recebida na conta da plataforma" onClose={onClose} wide><div className="form-grid"><Notice text={error}/><Notice text={saved ? 'Preços desta barbearia salvos.' : null} kind="success"/><form className="form-grid master-pricing-form" onSubmit={savePricing}><h3>Preços desta barbearia</h3><div className="form-row"><Field label="Mensalidade base (R$)"><input type="number" min="0" step="0.01" required value={basePrice} onChange={event => setBasePrice(event.target.value)}/></Field><Field label="Por barbeiro ativo (R$)"><input type="number" min="0" step="0.01" required={!inheritPrice} disabled={inheritPrice} value={inheritPrice ? String((quote?.unit_price_cents || 0) / 100) : unitPrice} onChange={event => setUnitPrice(event.target.value)}/></Field></div><label className="check-field"><input type="checkbox" checked={inheritPrice} onChange={event => { if (!event.target.checked) setUnitPrice(String((quote?.unit_price_cents || 0) / 100)); setInheritPrice(event.target.checked) }}/> Usar o valor padrão da plataforma por barbeiro</label><p className="panel-footnote">Total mensal = mensalidade base + barbeiros ativos × valor por barbeiro.</p><button className="button primary" type="submit" disabled={busy}>{busy ? 'Salvando...' : 'Salvar preços da barbearia'}</button></form>{loading && !quote ? <Loading text="Consultando valor e assinatura..."/> : <><div className="master-quote-grid"><Stat label="Mensalidade base" value={quote ? money(quote.base_monthly_cents) : '—'}/><Stat label="Barbeiros ativos" value={quote?.seat_count ?? '—'}/><Stat label="Por barbeiro" value={quote ? money(quote.unit_price_cents) : '—'}/><Stat label="Total mensal" value={quote ? money(quote.amount_cents) : '—'}/></div>{quote && <p className="master-quote-formula">{money(quote.base_monthly_cents)} + {quote.seat_count} × {money(quote.unit_price_cents)} = <strong>{money(quote.amount_cents)} por mês</strong></p>}<div className="detail-list"><div><span>Cobrança habilitada</span><strong>{quote?.billing_enabled ? 'Sim' : 'Não'}</strong></div><div><span>Mercado Pago central</span><strong>{paymentReady ? 'Configurado' : 'Pendente'}</strong></div><div><span>Assinatura central</span><strong>{subscription ? <Status value={subscription.status}/> : 'Não criada'}</strong></div>{subscription && <div><span>Valor vigente</span><strong>{money(subscription.amount_cents)}</strong></div>}</div>{!paymentReady && <Notice text="Configure o Mercado Pago central para gerar o link de aprovação."/>}{!subscription || subscription.status === 'cancelled' ? <form className="form-grid" onSubmit={start}><Field label="E-mail do responsável que vai autorizar o pagamento"><input type="email" required value={payerEmail} onChange={event => setPayerEmail(event.target.value)} placeholder="financeiro@barbearia.com"/></Field><PrimaryButton type="submit" disabled={busy || !paymentReady || !quote?.billing_enabled || !quote?.shop_active || !quote?.amount_cents}>{busy ? 'Iniciando...' : 'Gerar link de aprovação'}</PrimaryButton></form> : <div className="button-row"><button className="button outline" disabled={busy} onClick={() => void change('saas-sync')}>Conciliar cobrança agora</button><button className="button danger-text" disabled={busy} onClick={() => void change('saas-cancel')}>Cancelar assinatura central</button></div>}{checkoutUrl && <div className="master-checkout-actions"><button className="button outline" type="button" onClick={() => void copyCheckout()}><Copy size={16}/>{linkCopied ? 'Link copiado' : 'Copiar link para o responsável'}</button><a className="button primary" href={checkoutUrl} target="_blank" rel="noreferrer">Visualizar checkout <CreditCard size={16}/></a></div>}<p className="panel-footnote">Fluxo: defina os preços, gere o link e envie ao responsável da barbearia. Ele autoriza a assinatura no Mercado Pago; as cobranças recorrentes são destinadas à conta central da plataforma. O painel confirma os pagamentos após o webhook ou a conciliação.</p></>}</div></Modal>
}
