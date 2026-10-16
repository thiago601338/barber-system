import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Bot, ImagePlus, Landmark, Package, ReceiptText, Sparkles, Target, TrendingUp } from 'lucide-react'
import type { PageProps } from '../App'
import { authedApi, requireSupabase } from '../lib/supabase'
import { createRow, updateRow, useRows } from '../lib/useRows'
import { productImageUrl, removeProductImage, uploadProductImage, validateProductImageChoice, validProductImagePath } from '../lib/productImages'
import { shopDateTime, shopMonthStart, shopToday } from '../lib/shopTime'
import { calculateProfitability, type ProfitabilityData } from '../lib/profitability'
import { operation } from '../lib/operations'
import { InventoryLedger } from './InventoryLedger'
import { currentMonth, monthDays, MonthPicker } from '../MonthRangeFilter'
import { CashRegisterPage } from './CashRegisterPage'
import { CommissionsPage } from './CommissionsPage'
import { SaleComposer } from './SaleComposer'
import { asText, cents, date, money, type Row } from '../types'
import { AddButton, DataTable, Empty, Field, Loading, Modal, Notice, PageHeader, Panel, PrimaryButton, Stat, Status } from '../ui'
import '../styles-products.css'

function ProductThumb({ path, shopId, name, compact = false }: { path: unknown; shopId: string; name: string; compact?: boolean }) {
  const src = productImageUrl(path, shopId)
  return <span className={compact ? 'bar-product-thumb' : 'product-thumb'}>
    {src ? <img src={src} alt={`Foto de ${name}`} loading="lazy"/> : <Package size={18} aria-hidden="true"/>}
  </span>
}

export function ProductsPage({ identity, role, notify }: PageProps) {
  const shopId = identity.shop?.id ?? null
  const canEdit = role === 'admin' || role === 'master'
  const products = useRows('products', shopId)
  const [filter, setFilter] = useState('all')
  const [editor, setEditor] = useState<Row | 'new' | null>(null)
  const [form, setForm] = useState({
    name: '', sku: '', description: '', category: 'retail', price: '',
    cost: '', stock_quantity: '0', minimum_stock: '0', active: true,
  })
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [removePhoto, setRemovePhoto] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rows = filter === 'all' ? products.rows : products.rows.filter(product => product.category === filter)
  const oldPath = editor && editor !== 'new' && shopId && validProductImagePath(editor.image_path, shopId) ? editor.image_path : null
  const displayedPhoto = previewUrl || (!removePhoto && shopId ? productImageUrl(oldPath, shopId) : null)
  const photoPending = (row: Row) => row.image_ai_status === 'pending' && !row.image_path && Date.now() - Date.parse(String(row.image_ai_at || 0)) < 10 * 60_000
  const anyPhotoPending = products.rows.some(photoPending)
  const refreshProducts = products.refresh

  // Enquanto a IA prepara fotos, atualiza o catálogo de tempos em tempos.
  useEffect(() => {
    if (!anyPhotoPending) return
    const timer = window.setInterval(() => { void refreshProducts() }, 8000)
    return () => window.clearInterval(timer)
  }, [anyPhotoPending, refreshProducts])

  async function requestAiPhoto(productId: string, quiet = false) {
    try {
      const result = await authedApi<{ status: string }>('/api/product-photo', { product_id: productId })
      if (result.status === 'pending') {
        if (!quiet) notify('A IA está buscando uma foto para o produto. Ela aparece no catálogo em instantes.')
        await products.refresh()
      }
      return result.status === 'pending'
    } catch (problem) {
      if (!quiet) notify(problem instanceof Error ? problem.message : 'Não foi possível gerar a foto agora.', 'error')
      return false
    }
  }

  useEffect(() => {
    if (!photoFile) { setPreviewUrl(null); return }
    const url = URL.createObjectURL(photoFile)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [photoFile])

  function edit(row?: Row) {
    if (!canEdit) return
    setEditor(row || 'new')
    setPhotoFile(null)
    setRemovePhoto(false)
    setError(null)
    setForm(row ? {
      name: String(row.name || ''),
      sku: String(row.sku || ''),
      description: String(row.description || ''),
      category: String(row.category || 'retail'),
      price: String(Number(row.price_cents || 0) / 100),
      cost: String(Number(row.cost_cents || 0) / 100),
      stock_quantity: String(row.stock_quantity ?? 0),
      minimum_stock: String(row.minimum_stock ?? 0),
      active: Boolean(row.active),
    } : {
      name: '', sku: '', description: '', category: 'retail', price: '',
      cost: '', stock_quantity: '0', minimum_stock: '0', active: true,
    })
  }

  function selectPhoto(file: File | undefined) {
    if (!file) return
    try {
      validateProductImageChoice(file)
      setPhotoFile(file)
      setRemovePhoto(false)
      setError(null)
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Imagem inválida.')
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!shopId || !editor || !canEdit) return
    setBusy(true)
    setError(null)
    let uploadedPath: string | null = null
    let saved = false
    try {
      if (photoFile) uploadedPath = await uploadProductImage(shopId, photoFile)
      const imagePath = uploadedPath || (removePhoto ? null : oldPath)
      const values = {
        name: form.name.trim(),
        sku: form.sku.trim() || null,
        description: form.description.trim() || null,
        category: form.category,
        price_cents: cents(form.price),
        cost_cents: cents(form.cost || '0'),
        stock_quantity: Number(form.stock_quantity),
        minimum_stock: Number(form.minimum_stock),
        active: form.active,
        image_path: imagePath,
      }
      let savedId: string | null = editor === 'new' ? null : String(editor.id)
      if (editor === 'new') savedId = String((await createRow('products', { ...values, barbershop_id: shopId })).id || '') || null
      else await operation('product_save', { p_shop: shopId, p_product: editor.id, p_values: values })
      saved = true
      const aiPhoto = editor === 'new' && !imagePath && savedId ? await requestAiPhoto(savedId, true) : false
      setEditor(null)
      setPhotoFile(null)
      let oldImageRemovalFailed = false
      if (oldPath && oldPath !== imagePath) {
        try { await removeProductImage(oldPath, shopId) }
        catch { oldImageRemovalFailed = true }
      }
      await products.refresh()
      notify(oldImageRemovalFailed ? 'Produto salvo, mas a foto antiga não pôde ser removida do armazenamento.' : aiPhoto ? 'Produto salvo. A IA está buscando uma foto para ele.' : 'Produto salvo.', oldImageRemovalFailed ? 'error' : undefined)
    } catch (problem) {
      if (saved) {
        notify('Produto salvo, mas não foi possível atualizar o catálogo. Reabra a página para conferir.', 'error')
      } else {
        if (uploadedPath) await removeProductImage(uploadedPath, shopId).catch(() => undefined)
        setError(problem instanceof Error ? problem.message : 'Falha ao salvar produto.')
      }
    } finally {
      setBusy(false)
    }
  }

  return <div className="page-stack products-page">
    <PageHeader eyebrow="ESTOQUE E VENDAS" title="Produtos" description="Cadastre fotos, preços e estoque dos itens da barbearia, do bar e da cozinha." action={canEdit && <AddButton onClick={() => edit()} data-tour-action="product-create">Novo produto</AddButton>}/>
    <div className="segmented">
      <button type="button" className={filter === 'all' ? 'selected' : ''} onClick={() => setFilter('all')}>Todos</button>
      <button type="button" className={filter === 'retail' ? 'selected' : ''} onClick={() => setFilter('retail')}>Barbearia</button>
      <button type="button" className={filter === 'bar' ? 'selected' : ''} onClick={() => setFilter('bar')}>Bar</button>
      <button type="button" className={filter === 'kitchen' ? 'selected' : ''} onClick={() => setFilter('kitchen')}>Cozinha</button>
      <button type="button" className={filter === 'supply' ? 'selected' : ''} onClick={() => setFilter('supply')}>Insumos</button>
    </div>
    <Notice text={products.error}/>
    <Panel title="Catálogo" subtitle={`${rows.length} item(ns) no filtro`}>
      {products.loading ? <Loading/> : <DataTable rows={rows} empty="Nenhum produto cadastrado" onRowClick={canEdit ? edit : undefined} columns={[
        { key: 'name', label: 'Produto', render: row => <div className="person-cell"><ProductThumb path={row.image_path} shopId={shopId || ''} name={asText(row.name)}/><div><strong>{asText(row.name)}</strong><small>{photoPending(row) ? <span className="product-ai-pending"><Sparkles size={12}/> Gerando foto com IA…</span> : asText(row.sku)}</small></div></div> },
        { key: 'category', label: 'Categoria', render: row => ({ retail: 'Barbearia', bar: 'Bar', kitchen: 'Cozinha', supply: 'Insumos' }[String(row.category)] || asText(row.category)) },
        { key: 'price_cents', label: 'Preço', render: row => money(row.price_cents) },
        { key: 'stock_quantity', label: 'Estoque' },
        { key: 'active', label: 'Status', render: row => <Status value={row.active ? 'active' : 'paused'}/> },
      ]}/>}
    </Panel>
    {editor && <Modal title={editor === 'new' ? 'Novo produto' : 'Editar produto'} onClose={() => { if (!busy) setEditor(null) }}>
      <form className="form-grid" onSubmit={save} data-tour-form="product-create">
        <div className="product-photo-field">
          <div className="product-photo-preview">{displayedPhoto ? <img src={displayedPhoto} alt={`Prévia de ${form.name || 'produto'}`}/> : <Package size={28} aria-hidden="true"/>}</div>
          <div className="product-photo-controls">
            <strong>Foto do produto</strong>
            <small>JPEG, PNG ou WebP · até 2 MB. A foto aparece no catálogo e, para produtos da barbearia, na página pública.</small>
            <div>
              <label className="button outline product-photo-upload"><ImagePlus size={16}/> Escolher imagem
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => { selectPhoto(event.target.files?.[0]); event.currentTarget.value = '' }}/>
              </label>
              {(displayedPhoto || oldPath) && <button type="button" className="button ghost" onClick={() => { setPhotoFile(null); setRemovePhoto(true) }}>Remover foto</button>}
              {editor !== 'new' && !displayedPhoto && !oldPath && !photoFile && (photoPending(editor)
                ? <span className="product-ai-pending"><Sparkles size={13}/> A IA está gerando a foto…</span>
                : <button type="button" className="button outline" disabled={busy} onClick={() => { const id = String(editor.id); setEditor(null); void requestAiPhoto(id) }}><Sparkles size={16}/> Gerar foto com IA</button>)}
            </div>
            {editor === 'new' && !photoFile && <small className="product-ai-hint"><Sparkles size={12}/> Sem foto? Ao salvar, a IA busca o produto e cria uma imagem que o represente.</small>}
          </div>
        </div>
        <div className="form-row"><Field label="Nome"><input required value={form.name} onChange={event => setForm({ ...form, name: event.target.value })}/></Field><Field label="SKU"><input value={form.sku} onChange={event => setForm({ ...form, sku: event.target.value })}/></Field></div>
        <Field label="Descrição"><textarea rows={2} maxLength={1000} value={form.description} onChange={event => setForm({ ...form, description: event.target.value })}/></Field>
        <Field label="Categoria"><select value={form.category} onChange={event => setForm({ ...form, category: event.target.value })}><option value="retail">Barbearia</option><option value="bar">Bar</option><option value="kitchen">Cozinha</option><option value="supply">Insumos / consumo interno</option></select></Field>
        <div className="form-row"><Field label="Preço de venda (R$)"><input type="number" min="0" step="0.01" required value={form.price} onChange={event => setForm({ ...form, price: event.target.value })}/></Field><Field label="Custo (R$)"><input type="number" min="0" step="0.01" value={form.cost} onChange={event => setForm({ ...form, cost: event.target.value })}/></Field></div>
        <div className="form-row"><Field label={editor === 'new' ? 'Estoque inicial' : 'Estoque atual'} hint={editor === 'new' ? 'O cadastro registra o saldo inicial na trilha do estoque.' : 'Receba compras ou use Movimentar para alterar o saldo com justificativa.'}><input type="number" min="0" step="1" required disabled={editor !== 'new'} value={form.stock_quantity} onChange={event => setForm({ ...form, stock_quantity: event.target.value })}/></Field><Field label="Estoque mínimo para reposição"><input type="number" min="0" step="1" required value={form.minimum_stock} onChange={event => setForm({ ...form, minimum_stock: event.target.value })}/></Field></div>
        <label className="check-field"><input type="checkbox" checked={form.active} onChange={event => setForm({ ...form, active: event.target.checked })}/> Produto ativo</label>
        <Notice text={error}/>
        <div className="form-actions"><button type="button" className="button ghost" onClick={() => setEditor(null)} disabled={busy}>Cancelar</button><PrimaryButton type="submit" disabled={busy}>{busy ? 'Salvando...' : 'Salvar produto'}</PrimaryButton></div>
      </form>
    </Modal>}
    {canEdit && <InventoryLedger identity={identity} role={role} notify={notify} onChange={products.refresh}/>}
  </div>
}

export function BarPage(props: PageProps) {
  const { identity, notify } = props
  const shopId = identity.shop?.id ?? null
  const timezone = identity.shop?.timezone || 'America/Sao_Paulo'
  const sales = useRows('sales', shopId)
  const items = useRows('sale_items', shopId)
  const products = useRows('products', shopId)
  const clients = useRows('clients', shopId)
  const [filter, setFilter] = useState<'open' | 'delivered' | 'all'>('open')
  const [editor, setEditor] = useState(false)
  const [cancelSale, setCancelSale] = useState<Row | null>(null)
  const [busy, setBusy] = useState(false)
  const shown = sales.rows.filter(s => (filter === 'all' || s.status === filter) && items.rows.some(i => i.sale_id === s.id && ['bar','kitchen'].includes(String(products.rows.find(p => p.id === i.product_id)?.category))))
  async function refresh() { await Promise.all([sales.refresh(),items.refresh(),products.refresh()]) }
  async function changeStatus(id: string, status: string) {
    setBusy(true)
    try { await updateRow('sales',id,{ status }); setCancelSale(null); notify(status === 'delivered' ? 'Pedido marcado como entregue.' : 'Comanda cancelada e estoque devolvido.'); await refresh() }
    catch (problem) { notify(problem instanceof Error ? problem.message : 'Falha ao atualizar a comanda.','error') }
    finally { setBusy(false) }
  }
  return <div className="page-stack">
    <PageHeader eyebrow="BAR E COZINHA" title="Pedidos e comandas" description="Monte comandas com vários itens, acompanhe as entregas e receba no Financeiro › Caixa." action={<AddButton onClick={() => setEditor(true)} data-tour-action="bar-order-create">Nova comanda</AddButton>}/>
    <div className="segmented"><button className={filter === 'open' ? 'selected' : ''} onClick={() => setFilter('open')}>Em aberto</button><button className={filter === 'delivered' ? 'selected' : ''} onClick={() => setFilter('delivered')}>Entregues</button><button className={filter === 'all' ? 'selected' : ''} onClick={() => setFilter('all')}>Todos</button></div>
    <Notice text={sales.error || items.error || products.error || clients.error}/>
    {sales.loading || items.loading || products.loading ? <Loading/> : shown.length ? <div className="order-grid">{shown.map(sale => <Panel key={sale.id} className="order-card" title={asText(clients.rows.find(c => c.id === sale.client_id)?.full_name || 'Comanda avulsa')} subtitle={shopDateTime(sale.created_at,timezone)} action={<Status value={sale.status}/>}>
      <div className="order-items">{items.rows.filter(item => item.sale_id === sale.id).map(item => { const product = products.rows.find(p => p.id === item.product_id); return <div className="bar-order-item" key={item.id}><ProductThumb path={product?.image_path} shopId={shopId || ''} name={asText(item.description || product?.name)} compact/><span className="bar-order-name">{String(item.quantity)}× {asText(item.description || product?.name)}</span><strong>{money(item.total_cents)}</strong></div> })}</div>
      <div className="order-footer"><strong>{money(sale.total_cents)}</strong><div className="ops-actions">{sale.status === 'open' && <button className="button outline" disabled={busy} onClick={() => void changeStatus(sale.id,'delivered')}>Entregar</button>}{['open','delivered'].includes(String(sale.status)) && <button className="button ghost" disabled={busy} onClick={() => setCancelSale(sale)}>Cancelar comanda</button>}</div></div>
    </Panel>)}</div> : <Panel><Empty title="Nenhum pedido neste filtro" text="As comandas do bar e da cozinha aparecerão aqui."/></Panel>}
    {editor && <SaleComposer {...props} categories={['bar','kitchen']} onClose={() => setEditor(false)} onCreated={refresh} tourForm="bar-order-create"/>}
    {cancelSale && <Modal title="Cancelar comanda?" subtitle="O cancelamento devolve todos os itens reservados ao estoque. Comandas com recebimentos exigem devolução no Caixa primeiro." onClose={() => { if (!busy) setCancelSale(null) }}><div className="form-actions"><button className="button ghost" disabled={busy} onClick={() => setCancelSale(null)}>Manter comanda</button><PrimaryButton disabled={busy} onClick={() => void changeStatus(cancelSale.id,'cancelled')}>{busy ? 'Cancelando…' : 'Confirmar cancelamento'}</PrimaryButton></div></Modal>}
  </div>
}

export function FinancePage(props: PageProps) {
  const [section, setSection] = useState('overview')
  const admin = props.role === 'admin' || props.role === 'master'
  return <div>
    <div className="segmented ops-ledger-tabs"><button className={section === 'overview' ? 'selected' : ''} onClick={() => setSection('overview')}>Visão financeira</button>{admin && <button className={section === 'cash' ? 'selected' : ''} onClick={() => setSection('cash')}>Caixa e comandas</button>}<button className={section === 'commissions' ? 'selected' : ''} onClick={() => setSection('commissions')}>{admin ? 'Comissões da equipe' : 'Minhas comissões'}</button></div>
    {section === 'cash' && admin ? <CashRegisterPage {...props}/> : section === 'commissions' ? <CommissionsPage {...props}/> : <FinanceOverview {...props}/>}
  </div>
}

function FinanceOverview({ identity, role, notify }: PageProps) {
  const shop = identity.shop!
  const timezone = shop.timezone || 'America/Sao_Paulo'
  const admin = role !== 'barber'
  const canSeeRevenue = admin || identity.permissions.reports === true
  const expenses = useRows('expenses', shop.id, admin)
  const services = useRows('services', shop.id, admin)
  const [editor, setEditor] = useState(false)
  const [form, setForm] = useState({ category: 'supplies', cost_kind: 'operating', description: '', amount: '', occurred_on: shopToday(timezone), recurring: false })
  const [settings, setSettings] = useState<{ structure_monthly_cost_cents: number; target_profit_pct: number | null } | null>(null)
  const [structure, setStructure] = useState('')
  const [profit, setProfit] = useState('')
  const [analysis, setAnalysis] = useState<string | null>(null)
  const [monthly, setMonthly] = useState<{ revenueCents: number; spentCents: number | null; profitCents: number | null } | null>(null)
  const [monthlyLoading, setMonthlyLoading] = useState(false)
  const [financeMonth, setFinanceMonth] = useState(() => currentMonth(timezone))
  const [monthlyError, setMonthlyError] = useState<string | null>(null)
  const [financeRevision, setFinanceRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setForm(previous => ({ ...previous, occurred_on: shopToday(timezone) }))
  }, [shop.id, timezone])

  useEffect(() => {
    if (!admin) { setSettings(null); return }
    let cancelled = false
    void requireSupabase().rpc('shop_financial_settings', { p_barbershop_id: shop.id }).then(({ data, error: settingsError }) => {
      if (cancelled) return
      if (settingsError) setError(settingsError.message)
      else if (data) {
        const privateData = data as { structure_monthly_cost_cents: number; target_profit_pct: number | null }
        setSettings(privateData)
        setStructure(String(Number(privateData.structure_monthly_cost_cents || 0) / 100))
        setProfit(privateData.target_profit_pct == null ? '' : String(privateData.target_profit_pct))
      }
    })
    return () => { cancelled = true }
  }, [shop.id, admin])

  const loadMonthly = useCallback(async () => {
    if (!canSeeRevenue) { setMonthly(null); return }
    const client = requireSupabase()
    const { from, to } = monthDays(financeMonth, timezone)
    const metrics = await client.rpc('dashboard_metrics', { p_barbershop_id: shop.id, p_from: from, p_to: to })
    if (metrics.error) throw metrics.error
    let spentCents: number | null = null
    let profitCents: number | null = null
    if (admin) {
      const report = await client.rpc('profitability_data', { p_barbershop_id: shop.id, p_from: from, p_to: to })
      if (report.error) throw report.error
      const data = report.data as ProfitabilityData
      spentCents = data.expenses.reduce((sum, expense) => sum + Number(expense.amount_cents), 0)
      profitCents = calculateProfitability(data).profit
    }
    return { revenueCents: Number((metrics.data as { revenue_cents?: number })?.revenue_cents || 0), spentCents, profitCents }
  }, [shop.id, timezone, canSeeRevenue, admin, financeMonth])

  useEffect(() => {
    let cancelled = false
    setMonthly(null)
    setMonthlyError(null)
    if (!canSeeRevenue) return () => { cancelled = true }
    setMonthlyLoading(true)
    void loadMonthly().then(result => { if (!cancelled) setMonthly(result || null) })
      .catch(problem => { if (!cancelled) setMonthlyError(problem instanceof Error ? problem.message : 'Falha ao apurar o mês.') })
      .finally(() => { if (!cancelled) setMonthlyLoading(false) })
    return () => { cancelled = true }
  }, [loadMonthly, financeRevision, canSeeRevenue])

  const revenue = monthly?.revenueCents ?? null
  const spent = monthly?.spentCents ?? null
  const structureCents = settings?.structure_monthly_cost_cents
  const result = monthly?.profitCents ?? null
  async function saveExpense(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null)
    try {
      await createRow('expenses', { barbershop_id: shop.id, category: form.category, cost_kind: form.cost_kind, description: form.description.trim(), amount_cents: cents(form.amount), occurred_on: form.occurred_on, recurring: form.recurring })
      notify('Despesa registrada.')
      setEditor(false)
      setFinanceRevision(previous => previous + 1)
      await expenses.refresh()
    } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao salvar despesa.') }
    finally { setBusy(false) }
  }
  async function saveStructure(event: FormEvent) {
    event.preventDefault(); if (!settings) return
    setBusy(true); setError(null)
    try {
      const newCost = cents(structure || '0')
      const newTarget = profit ? Number(profit) : null
      const { error } = await requireSupabase().from('barbershops').update({ structure_monthly_cost_cents: newCost, target_profit_pct: newTarget }).eq('id', shop.id)
      if (error) throw error
      setSettings({ structure_monthly_cost_cents: newCost, target_profit_pct: newTarget })
      setFinanceRevision(previous => previous + 1)
      notify('Parâmetros salvos.')
    } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao salvar parâmetros.') }
    finally { setBusy(false) }
  }
  async function requestAnalysis() {
    setBusy(true); setError(null); setAnalysis(null)
    try {
      const output = await authedApi<{ response: string; source: string }>('/api/ai/analyze', { barbershop_id: shop.id, kind: 'financial' })
      setAnalysis(output.response)
      notify(output.source === 'ai' ? 'Análise gerada.' : 'Análise calculada com os dados disponíveis.')
    } catch (err) { setError(err instanceof Error ? err.message : 'Análise indisponível.') }
    finally { setBusy(false) }
  }

  return <div className="page-stack">
    <PageHeader eyebrow="SAÚDE FINANCEIRA" title="Financeiro" description={admin ? 'Receitas confirmadas, gastos, custo da estrutura e meta de lucro.' : 'Acompanhe a receita dos seus atendimentos quando Relatórios estiver liberado.'} action={admin && <AddButton onClick={() => setEditor(true)} data-tour-action="expense-create">Registrar despesa</AddButton>}/>
    <Notice text={expenses.error || monthlyError || error}/>
    {!canSeeRevenue && <Notice kind="info" text="A administração precisa liberar Relatórios para mostrar sua receita de atendimentos."/>}
    <div className="month-quick finance-month"><span>Mês a mês</span><MonthPicker value={financeMonth} onChange={setFinanceMonth} timezone={timezone}/></div>
    {monthlyLoading && <Loading text="Apurando os lançamentos do mês..."/>}
    <div className="stats-grid">
      <Stat label={admin ? 'Receita recebida no mês' : 'Receita dos seus atendimentos'} value={revenue == null ? '—' : money(revenue)} foot={admin ? 'Pagamentos confirmados' : 'Pagamentos de agendamentos próprios'} icon={<TrendingUp size={19}/>}/>
      {admin && <>
        <Stat label="Despesas do mês" value={spent == null ? '—' : money(spent)} foot="Todos os lançamentos até hoje" icon={<ReceiptText size={19}/>}/>
        <Stat label="Custo mensal da estrutura" value={structureCents == null ? '—' : money(structureCents)} foot="Valor configurado" icon={<Landmark size={19}/>}/>
        <Stat label="Resultado estimado" value={result == null ? '—' : money(result)} foot="Mesma apuração da Margem de Lucro" icon={<Target size={19}/>}/>
      </>}
    </div>
    {admin && <>
      <div className="dashboard-grid">
        <Panel title="Despesas" subtitle="Histórico completo com classificação para apuração do lucro"><DataTable rows={expenses.rows} empty="Nenhuma despesa registrada" columns={[{ key: 'occurred_on', label: 'Data', render: row => date(row.occurred_on) }, { key: 'description', label: 'Descrição' }, { key: 'category', label: 'Categoria' }, { key: 'amount_cents', label: 'Valor', render: row => money(row.amount_cents) }]} /></Panel>
        <Panel title="Estrutura e lucro" subtitle="Base para análise de preços e margem"><form className="form-grid" onSubmit={saveStructure}><Field label="Custo mensal da estrutura (R$)"><input type="number" min="0" step="0.01" value={structure} onChange={e => setStructure(e.target.value)}/></Field><Field label="Meta de lucro (%)"><input type="number" min="0" max="100" step="0.01" value={profit} onChange={e => setProfit(e.target.value)}/></Field><PrimaryButton type="submit" disabled={busy || !settings}>Salvar parâmetros</PrimaryButton></form><p className="panel-footnote">O resultado é uma estimativa com base nos lançamentos deste mês. Não substitui contabilidade.</p></Panel>
      </div>
      <Panel title="Análise de custos e preços" subtitle="Sugestões a partir dos serviços, recebimentos e despesas registrados" action={<button className="button primary" onClick={() => void requestAnalysis()} disabled={busy}><Bot size={17}/>{busy ? 'Analisando...' : 'Analisar com IA'}</button>}><div className="analysis-summary"><div><strong>{services.rows.length}</strong><span>serviços cadastrados</span></div><div><strong>{expenses.rows.length}</strong><span>despesas recentes exibidas</span></div><div><strong>{revenue == null ? '—' : money(revenue)}</strong><span>receita confirmada no mês</span></div></div>{analysis ? <div className="analysis-result">{analysis}</div> : <p className="muted">Clique em analisar para receber um diagnóstico do que pode melhorar e sugestões de valores. O cálculo usa somente dados disponíveis no sistema.</p>}</Panel>
      {editor && <Modal title="Registrar despesa" onClose={() => setEditor(false)}><form className="form-grid" onSubmit={saveExpense} data-tour-form="expense-create"><Field label="Descrição"><input required value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}/></Field><div className="form-row"><Field label="Categoria"><select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}><option value="supplies">Insumos</option><option value="staff">Equipe</option><option value="marketing">Marketing</option><option value="other">Outros</option></select></Field><Field label="Valor (R$)"><input type="number" min="0" step="0.01" required value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })}/></Field></div><Field label="Tratamento no lucro"><select value={form.cost_kind} onChange={e => setForm({ ...form, cost_kind: e.target.value })}><option value="operating">Despesa operacional</option><option value="structure">Estrutura (aluguel, energia, salários fixos)</option><option value="tax">Imposto já pago / apurado</option><option value="fees">Taxa de pagamento já lançada</option><option value="commission">Comissão já lançada</option><option value="inventory">Compra de estoque (não repetir custo da venda)</option></select></Field><Field label="Data"><input type="date" required value={form.occurred_on} onChange={e => setForm({ ...form, occurred_on: e.target.value })}/></Field><label className="check-field"><input type="checkbox" checked={form.recurring} onChange={e => setForm({ ...form, recurring: e.target.checked })}/> Despesa recorrente</label><Notice text={error}/><div className="form-actions"><button className="button ghost" type="button" onClick={() => setEditor(false)}>Cancelar</button><PrimaryButton type="submit" disabled={busy}>{busy ? 'Salvando...' : 'Registrar'}</PrimaryButton></div></form></Modal>}
    </>}
  </div>
}

export function GoalsPage({ identity, role, notify }: PageProps) {
  const shopId = identity.shop?.id ?? null
  const timezone = identity.shop?.timezone || 'America/Sao_Paulo'
  const members = useRows('memberships', shopId)
  const [goalRows, setGoalRows] = useState<Row[]>([])
  const [goalsLoading, setGoalsLoading] = useState(false)
  const [goalsError, setGoalsError] = useState<string | null>(null)
  const [refreshCount, setRefreshCount] = useState(0)
  const [editor, setEditor] = useState(false)
  const [form, setForm] = useState({ title: '', metric: 'revenue', target_value: '', period_start: shopMonthStart(timezone), period_end: shopToday(timezone), barber_membership_id: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const barbers = members.rows.filter(row => row.role === 'barber' && row.active)

  useEffect(() => {
    setForm(previous => ({ ...previous, period_start: shopMonthStart(timezone), period_end: shopToday(timezone) }))
  }, [shopId, timezone])

  useEffect(() => {
    let cancelled = false
    setGoalRows([])
    setGoalsError(null)
    if (!shopId) return
    async function load() {
      setGoalsLoading(true)
      try {
        const response = await requireSupabase().rpc('goal_progress', { p_barbershop_id: shopId })
        if (response.error) throw response.error
        if (!Array.isArray(response.data)) throw new Error('O progresso das metas retornou um formato inesperado.')
        if (!cancelled) setGoalRows(response.data as Row[])
      } catch (problem) {
        if (!cancelled) setGoalsError(problem instanceof Error ? problem.message : 'Não foi possível carregar as metas.')
      } finally {
        if (!cancelled) setGoalsLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [shopId, identity.user.id, refreshCount])

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!shopId) return
    setBusy(true); setError(null)
    try {
      await createRow('goals', {
        barbershop_id: shopId,
        barber_membership_id: role === 'barber' ? identity.membership?.id : form.barber_membership_id || null,
        title: form.title.trim(), metric: form.metric, target_value: Number(form.target_value),
        period_start: form.period_start, period_end: form.period_end, created_by: identity.user.id,
      })
      notify('Meta cadastrada.')
      setEditor(false)
      setRefreshCount(value => value + 1)
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Falha ao salvar meta.')
    } finally { setBusy(false) }
  }

  return <div className="page-stack">
    <PageHeader eyebrow="EVOLUÇÃO" title="Metas" description="Metas da barbearia, da equipe e objetivos pessoais dos profissionais." action={<AddButton onClick={() => setEditor(true)} data-tour-action="goal-create">Nova meta</AddButton>}/>
    <Notice text={goalsError || members.error}/>
    {goalsLoading ? <Loading text="Calculando o progresso das metas..."/> : goalRows.length ? <div className="goal-grid">
      {goalRows.map(goal => {
        const current = goal.current_value == null ? null : Number(goal.current_value)
        const target = Number(goal.target_value || 0)
        const percent = current == null || target <= 0 ? 0 : Math.min(100, Math.max(0, current / target * 100))
        const isMoney = goal.metric === 'revenue'
        const isPercent = goal.metric === 'client_return_pct' || goal.metric === 'profit_pct'
        const display = (value: number) => isMoney ? money(Math.round(value * 100)) : isPercent ? `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%` : value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
        const personal = Boolean(goal.barber_membership_id)
        const owner = personal ? asText(barbers.find(barber => barber.id === goal.barber_membership_id)?.display_name || (goal.barber_membership_id === identity.membership?.id ? 'Você' : null)) : 'Barbearia'
        const detail = current == null
          ? role === 'barber' && !personal ? 'Progresso da barbearia reservado aos administradores' : 'Aguardando dados suficientes'
          : `${Math.round(percent)}% da meta`
        return <Panel key={goal.id} className="goal-card" title={asText(goal.title)} subtitle={`${date(goal.period_start)} a ${date(goal.period_end)}`} action={<Status value={personal ? 'individual' : 'equipe'}/>}>
          <div className="goal-value"><strong>{current == null ? '—' : display(current)}</strong><span>de {display(target)}</span></div>
          <div className="progress"><div style={{ width: `${percent}%` }}/></div>
          <p>{detail} · {owner}</p>
        </Panel>
      })}
    </div> : <Panel><Empty title="Nenhuma meta cadastrada" text="Crie um objetivo para acompanhar a evolução da barbearia ou do profissional."/></Panel>}
    <p className="data-limit-note">Atendimentos usam a data agendada; receita usa pagamentos confirmados. Ambos respeitam o fuso da barbearia e todo o período da meta.</p>
    {editor && <Modal title="Nova meta" onClose={() => setEditor(false)}><form className="form-grid" onSubmit={save} data-tour-form="goal-create">
      <Field label="Título"><input required value={form.title} onChange={event => setForm({ ...form, title: event.target.value })}/></Field>
      <Field label="Indicador"><select value={form.metric} onChange={event => setForm({ ...form, metric: event.target.value })}>
        <option value="revenue">Receita (R$)</option>
        <option value="appointments">Atendimentos concluídos</option>
        <option value="new_clients">Clientes novos</option>
        <option value="client_return_pct">Retorno em 30 dias (%)</option>
        {role !== 'barber' && <option value="profit_pct">Lucro (%)</option>}
      </select></Field>
      <Field label="Valor alvo"><input type="number" min={form.metric === 'revenue' || form.metric.endsWith('_pct') ? '0.01' : '1'} max={form.metric.endsWith('_pct') ? '100' : undefined} step={form.metric === 'revenue' || form.metric.endsWith('_pct') ? '0.01' : '1'} required value={form.target_value} onChange={event => setForm({ ...form, target_value: event.target.value })}/></Field>
      {role !== 'barber' && <Field label="Destinatário"><select value={form.barber_membership_id} onChange={event => setForm({ ...form, barber_membership_id: event.target.value })}><option value="">Barbearia inteira</option>{barbers.map(barber => <option key={barber.id} value={barber.id}>{asText(barber.display_name)}</option>)}</select></Field>}
      <div className="form-row"><Field label="Início"><input type="date" required value={form.period_start} onChange={event => setForm({ ...form, period_start: event.target.value })}/></Field><Field label="Fim"><input type="date" min={form.period_start} required value={form.period_end} onChange={event => setForm({ ...form, period_end: event.target.value })}/></Field></div>
      <Notice text={error}/>
      <div className="form-actions"><button type="button" className="button ghost" onClick={() => setEditor(false)}>Cancelar</button><PrimaryButton type="submit" disabled={busy}>{busy ? 'Salvando...' : 'Criar meta'}</PrimaryButton></div>
    </form></Modal>}
  </div>
}
