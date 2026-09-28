import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Building2, CreditCard, Plus, Scissors } from 'lucide-react'
import type { PageProps } from '../App'
import { authedApi, authedGet } from '../lib/supabase'
import { asText, date, money, type Row } from '../types'
import { AddButton, DataTable, Field, Loading, Modal, Notice, PageHeader, Panel, PrimaryButton, Stat, Status } from '../ui'

interface Overview { shops: Row[]; settings: Record<string, unknown> | null; memberships: Row[]; invoices: Row[] }
interface SaasQuote { barbershop_id: string; billing_enabled: boolean; seat_count: number; unit_price_cents: number; amount_cents: number }
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
  async function refresh() { setLoading(true); setError(null); try { const data = await authedGet<Overview>('/api/admin/overview'); setOverview(data); setSeatPrice(String(Number(data.settings?.seat_price_cents || 0)/100)); setBilling(Boolean(data.settings?.billing_enabled)) } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao carregar painel master.') } finally { setLoading(false) } }
  useEffect(() => { void refresh() }, [])
  const activeBarbers = useMemo(() => overview.memberships.filter(m => m.role === 'barber' && m.active), [overview])
  async function createShop(event: FormEvent) { event.preventDefault(); setBusy(true); setError(null); try { await authedApi('/api/admin/create-shop', { name: shopForm.name.trim(), slug: shopForm.slug.trim().toLowerCase() }); notify('Barbearia criada.'); setModal(null); await refresh(); await onRefresh() } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao criar barbearia.') } finally { setBusy(false) } }
  async function inviteAdmin(event: FormEvent) { event.preventDefault(); setBusy(true); setError(null); try { await authedApi('/api/admin/invite', { barbershop_id: inviteForm.barbershop_id, email: inviteForm.email.trim(), role: 'admin', display_name: inviteForm.display_name.trim() || null }); notify('Convite de administrador processado.'); setModal(null); await refresh() } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao convidar administrador.') } finally { setBusy(false) } }
  async function savePrice(event: FormEvent) { event.preventDefault(); setBusy(true); setError(null); try { await authedApi('/api/admin/set-seat-price', { seat_price_cents: Math.round(Number(seatPrice)*100), billing_enabled: billing }); notify('Preço do sistema atualizado.'); await refresh() } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao salvar preço.') } finally { setBusy(false) } }
  return <div className="page-stack"><PageHeader eyebrow="ADMINISTRAÇÃO MASTER" title="Painel da plataforma" description="Crie acessos para cada barbearia e acompanhe a cobrança do sistema por barbeiro ativo." action={<AddButton onClick={() => setModal('shop')}>Nova barbearia</AddButton>}/><Notice text={error}/>{loading ? <Loading/> : <><div className="stats-grid three"><Stat label="Barbearias" value={overview.shops.length} foot="Cadastradas na plataforma" icon={<Building2 size={19}/>}/><Stat label="Barbeiros ativos" value={activeBarbers.length} foot="Somados em todas as barbearias" icon={<Scissors size={19}/>}/><Stat label="Preço por barbeiro/mês" value={money(overview.settings?.seat_price_cents)} foot="Cobrança central da plataforma" icon={<CreditCard size={19}/>} /></div><div className="dashboard-grid"><Panel title="Barbearias" subtitle="Cada conta tem dados, equipe e pagamentos próprios" action={<button className="button outline" onClick={() => setModal('invite')}><Plus size={16}/> Convidar administrador</button>}><DataTable rows={overview.shops} empty="Nenhuma barbearia criada" columns={[{ key: 'name', label: 'Barbearia' }, { key: 'slug', label: 'Endereço' }, { key: 'id', label: 'Barbeiros ativos', render: row => activeBarbers.filter(m => m.barbershop_id === row.id).length }, { key: 'active', label: 'Status', render: row => <Status value={row.active ? 'active' : 'paused'}/> }, { key: 'id', label: 'Cobrança', render: row => <button className="table-action-button" onClick={() => setBillingShop(row)}><CreditCard size={15}/> Gerenciar</button> }]} /></Panel><Panel title="Preço do sistema" subtitle="Mensalidade SaaS para a conta central"><form className="form-grid" onSubmit={savePrice}><Field label="Valor por barbeiro ativo / mês (R$)"><input type="number" min="0" step="0.01" required value={seatPrice} onChange={e => setSeatPrice(e.target.value)}/></Field><label className="check-field"><input type="checkbox" checked={billing} onChange={e => setBilling(e.target.checked)}/> Cobrança central habilitada</label><PrimaryButton type="submit" disabled={busy}>{busy ? 'Salvando...' : 'Salvar preço'}</PrimaryButton></form><p className="panel-footnote">Cada fatura preserva o preço e a contagem de barbeiros da sua competência. A receita de clientes é paga diretamente à barbearia.</p></Panel></div><Panel title="Faturas das barbearias" subtitle="Cobrança central por profissionais ativos"><DataTable rows={overview.invoices} empty="Nenhuma fatura gerada" columns={[{ key: 'barbershop_id', label: 'Barbearia', render: row => asText(overview.shops.find(s => s.id === row.barbershop_id)?.name) }, { key: 'period_start', label: 'Competência', render: row => date(row.period_start) }, { key: 'seat_count', label: 'Barbeiros' }, { key: 'amount_cents', label: 'Valor', render: row => money(row.amount_cents) }, { key: 'status', label: 'Status', render: row => <Status value={row.status}/> }]} /></Panel></>}{modal === 'shop' && <Modal title="Nova barbearia" subtitle="Um ambiente separado será criado para esta empresa." onClose={() => setModal(null)}><form className="form-grid" onSubmit={createShop}><Field label="Nome da barbearia"><input required value={shopForm.name} onChange={e => setShopForm({ ...shopForm, name: e.target.value })}/></Field><Field label="Endereço curto"><input required pattern="[a-z0-9-]+" value={shopForm.slug} onChange={e => setShopForm({ ...shopForm, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,'') })} placeholder="minha-barbearia"/></Field><Notice text={error}/><div className="form-actions"><button type="button" className="button ghost" onClick={() => setModal(null)}>Cancelar</button><PrimaryButton type="submit" disabled={busy}>{busy ? 'Criando...' : 'Criar barbearia'}</PrimaryButton></div></form></Modal>}{modal === 'invite' && <Modal title="Convidar administrador" onClose={() => setModal(null)}><form className="form-grid" onSubmit={inviteAdmin}><Field label="Barbearia"><select required value={inviteForm.barbershop_id} onChange={e => setInviteForm({ ...inviteForm, barbershop_id: e.target.value })}><option value="">Selecione</option>{overview.shops.map(shop => <option key={shop.id} value={shop.id}>{asText(shop.name)}</option>)}</select></Field><Field label="E-mail"><input type="email" required value={inviteForm.email} onChange={e => setInviteForm({ ...inviteForm, email: e.target.value })}/></Field><Field label="Nome exibido"><input value={inviteForm.display_name} onChange={e => setInviteForm({ ...inviteForm, display_name: e.target.value })}/></Field><Notice text={error}/><div className="form-actions"><button type="button" className="button ghost" onClick={() => setModal(null)}>Cancelar</button><PrimaryButton type="submit" disabled={busy}>{busy ? 'Convidando...' : 'Enviar convite'}</PrimaryButton></div></form></Modal>}{billingShop && <SaasBillingModal shop={billingShop} onClose={() => setBillingShop(null)} onUpdated={refresh}/>}</div>
}

function SaasBillingModal({ shop, onClose, onUpdated }: { shop: Row; onClose: () => void; onUpdated: () => Promise<void> }) {
  const [quote, setQuote] = useState<SaasQuote | null>(null)
  const [subscription, setSubscription] = useState<Row | null>(null)
  const [payerEmail, setPayerEmail] = useState('')
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function refreshStatus() {
    setLoading(true); setError(null)
    try {
      const query = `?barbershop_id=${encodeURIComponent(shop.id)}`
      const currentQuote = await authedGet<SaasQuote>(`/api/mercadopago/saas-quote${query}`)
      setQuote(currentQuote)
      const status = await authedGet<{ quote: SaasQuote; subscription: Row | null }>(`/api/mercadopago/saas-status${query}`)
      setSubscription(status.subscription)
      if (status.subscription?.payer_email) setPayerEmail(String(status.subscription.payer_email))
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Não foi possível consultar a cobrança central.') }
    finally { setLoading(false) }
  }

  useEffect(() => { void refreshStatus() }, [shop.id])

  async function start(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null)
    try {
      const result = await authedApi<{ checkout_url: string | null }>('/api/mercadopago/saas-start', { barbershop_id: shop.id, payer_email: payerEmail.trim() })
      setCheckoutUrl(result.checkout_url)
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

  return <Modal title={`Cobrança central · ${asText(shop.name)}`} subtitle="Mensalidade SaaS recebida na conta da plataforma" onClose={onClose} wide><div className="form-grid"><Notice text={error}/>{loading && !quote ? <Loading text="Consultando valor e assinatura..."/> : <><div className="stats-grid three"><Stat label="Barbeiros ativos" value={quote?.seat_count ?? '—'}/><Stat label="Por barbeiro" value={quote ? money(quote.unit_price_cents) : '—'}/><Stat label="Total mensal" value={quote ? money(quote.amount_cents) : '—'}/></div><div className="detail-list"><div><span>Cobrança habilitada</span><strong>{quote?.billing_enabled ? 'Sim' : 'Não'}</strong></div><div><span>Assinatura central</span><strong>{subscription ? <Status value={subscription.status}/> : 'Não criada'}</strong></div>{subscription && <div><span>Valor vigente</span><strong>{money(subscription.amount_cents)}</strong></div>}</div>{!subscription || subscription.status === 'cancelled' ? <form className="form-grid" onSubmit={start}><Field label="E-mail pagador da barbearia"><input type="email" required value={payerEmail} onChange={event => setPayerEmail(event.target.value)} placeholder="financeiro@barbearia.com"/></Field><PrimaryButton type="submit" disabled={busy || !quote?.billing_enabled || !quote?.seat_count || !quote?.amount_cents}>{busy ? 'Iniciando...' : 'Gerar checkout recorrente'}</PrimaryButton></form> : <div className="button-row"><button className="button outline" disabled={busy} onClick={() => void change('saas-sync')}>Conciliar cobrança agora</button><button className="button danger-text" disabled={busy} onClick={() => void change('saas-cancel')}>Cancelar assinatura central</button></div>}{checkoutUrl && <a className="button primary" href={checkoutUrl} target="_blank" rel="noreferrer">Abrir checkout para aprovação <CreditCard size={16}/></a>}<p className="panel-footnote">Gerar o checkout deixa a assinatura pendente. A cobrança só é considerada ativa após confirmação pelo Mercado Pago. A cobrança é conciliada automaticamente com os barbeiros ativos e o preço master. Sem barbeiros ativos, com a barbearia inativa ou com a cobrança desativada, uma assinatura ativa é pausada e um checkout pendente é cancelado.</p></>}</div></Modal>
}
