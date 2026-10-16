import { useState, type FormEvent } from 'react'
import { AlertTriangle, ArrowDownUp, PackagePlus, Plus, Truck, X } from 'lucide-react'
import type { PageProps } from '../App'
import { createRow, updateRow, useRows } from '../lib/useRows'
import { operation, safeAmount, stockReasons } from '../lib/operations'
import { shopDateTime } from '../lib/shopTime'
import { asText, money, type Row } from '../types'
import { DataTable, Field, Modal, Notice, Panel, PrimaryButton, Stat } from '../ui'
import '../styles-operations-ledger.css'

type PurchaseItem = { product_id: string; quantity: string; cost: string }
export function InventoryLedger({ identity, notify, onChange }: PageProps & { onChange: () => Promise<void> }) {
  const shopId = identity.shop?.id ?? null
  const tz = identity.shop?.timezone || 'America/Sao_Paulo'
  const products = useRows('products', shopId)
  const suppliers = useRows('inventory_suppliers', shopId)
  const purchases = useRows('inventory_purchases', shopId)
  const purchaseItems = useRows('inventory_purchase_items', shopId)
  const movements = useRows('inventory_movements', shopId)
  const [view, setView] = useState('alerts')
  const [modal, setModal] = useState<'supplier' | 'purchase' | 'adjust' | null>(null)
  const [supplierEditor, setSupplierEditor] = useState<Row | null>(null)
  const [supplier, setSupplier] = useState({ name: '', document: '', contact: '', email: '', notes: '', active: true })
  const [purchase, setPurchase] = useState({ supplier: '', invoice: '', paid: false })
  const [basket, setBasket] = useState<PurchaseItem[]>([])
  const [item, setItem] = useState<PurchaseItem>({ product_id: '', quantity: '1', cost: '' })
  const [adjust, setAdjust] = useState({ product: '', quantity: '', reason: 'internal_use', notes: '' })
  const [requestKey, setRequestKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<Row | null>(null)
  const alerts = products.rows.filter(p => p.active && Number(p.stock_quantity) <= Number(p.minimum_stock || 0))
  const inventoryValue = products.rows.reduce((sum, p) => sum + Number(p.stock_quantity) * Number(p.cost_cents), 0)
  const productName = (id: unknown) => asText(products.rows.find(p => p.id === id)?.name)
  async function refresh() { await Promise.all([products.refresh(), purchases.refresh(), purchaseItems.refresh(), movements.refresh(), suppliers.refresh(), onChange()]) }
  function open(kind: 'supplier' | 'purchase' | 'adjust', row?: Row) {
    setError(null); setModal(kind); setRequestKey(crypto.randomUUID())
    if (kind === 'supplier') { setSupplierEditor(row || null); setSupplier({ name: String(row?.name || ''), document: String(row?.document || ''), contact: String(row?.contact || ''), email: String(row?.email || ''), notes: String(row?.notes || ''), active: row ? Boolean(row.active) : true }) }
    if (kind === 'purchase') { setBasket([]); setPurchase({ supplier: '', invoice: '', paid: false }); setItem({ product_id: '', quantity: '1', cost: '' }) }
    if (kind === 'adjust') setAdjust({ product: row?.id || '', quantity: '', reason: 'internal_use', notes: '' })
  }
  function addItem() {
    try {
      safeAmount(item.cost, true)
      const quantity = Number(item.quantity)
      if (!item.product_id || !Number.isInteger(quantity) || quantity < 1 || quantity > 100000) throw new Error('Selecione produto e quantidade inteira.')
      if (basket.some(i => i.product_id === item.product_id)) throw new Error('O produto já está na compra. Remova-o para alterar a quantidade.')
      setBasket([...basket, item]); setItem({ product_id: '', quantity: '1', cost: '' }); setError(null)
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Item inválido.') }
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!shopId) return
    setBusy(true); setError(null)
    try {
      if (modal === 'supplier') {
        const values = { ...supplier, name: supplier.name.trim(), document: supplier.document.trim() || null, contact: supplier.contact.trim() || null, email: supplier.email.trim() || null, notes: supplier.notes.trim() || null }
        if (supplierEditor) await updateRow('inventory_suppliers', supplierEditor.id, values)
        else await createRow('inventory_suppliers', { ...values, barbershop_id: shopId })
      } else if (modal === 'purchase') {
        if (!basket.length) throw new Error('Adicione os produtos recebidos à compra.')
        await operation('inventory_receive', { p_shop: shopId, p_supplier: purchase.supplier || null, p_invoice: purchase.invoice.trim() || null, p_paid: purchase.paid, p_request: requestKey, p_items: basket.map(i => ({ product_id: i.product_id, quantity: Number(i.quantity), unit_cost_cents: safeAmount(i.cost, true) })) })
      } else {
        const quantity = Number(adjust.quantity)
        if (!Number.isInteger(quantity) || !quantity || Math.abs(quantity) > 100000) throw new Error('Informe uma quantidade inteira diferente de zero.')
        await operation('inventory_adjust', { p_shop: shopId, p_product: adjust.product, p_quantity: adjust.reason === 'adjustment' ? quantity : -Math.abs(quantity), p_reason: adjust.reason, p_notes: adjust.notes.trim(), p_request: requestKey })
      }
      setModal(null); notify('Operação de estoque registrada.'); await refresh()
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Não foi possível registrar a operação.') }
    finally { setBusy(false) }
  }
  async function payPurchase() {
    if (!shopId || !detail) return
    setBusy(true); setError(null)
    try { await operation('inventory_pay', { p_shop:shopId,p_purchase:detail.id }); setDetail(null); notify('Compra marcada como paga e despesa registrada.'); await refresh() }
    catch (problem) { setError(problem instanceof Error ? problem.message : 'Não foi possível registrar o pagamento.') }
    finally { setBusy(false) }
  }
  return <div className="operations-ledger page-stack">
    <div className="stats-grid"><Stat label="Valor do estoque ao custo" value={money(inventoryValue)} foot="Quantidade atual × custo médio cadastrado" icon={<ArrowDownUp size={19}/>}/><Stat label="Itens no limite de reposição" value={alerts.length} foot="Ativos com saldo menor ou igual ao mínimo" icon={<AlertTriangle size={19}/>}/><Stat label="Fornecedores ativos" value={suppliers.rows.filter(s => s.active).length} icon={<Truck size={19}/>}/></div>
    <div className="ops-toolbar"><div className="segmented">{[['alerts','Reposição'],['purchases','Compras'],['movements','Movimentações'],['suppliers','Fornecedores']].map(([key,label]) => <button key={key} className={view === key ? 'selected' : ''} onClick={() => setView(key)}>{label}</button>)}</div><div className="ops-actions"><button className="button outline" onClick={() => open('adjust')}><ArrowDownUp size={16}/>Movimentar</button><PrimaryButton onClick={() => open('purchase')}><PackagePlus size={16}/>Receber compra</PrimaryButton></div></div>
    <Notice text={products.error || suppliers.error || purchases.error || movements.error || purchaseItems.error}/>
    {view === 'alerts' && <Panel title="Lista de reposição" subtitle="O mínimo é configurado no cadastro do produto. Consumo interno e perdas exigem justificativa."><DataTable rows={alerts} empty="Nenhum produto precisa de reposição" columns={[{ key: 'name', label: 'Produto' }, { key: 'stock_quantity', label: 'Saldo' }, { key: 'minimum_stock', label: 'Mínimo' }, { key: 'cost_cents', label: 'Custo médio', render: r => money(r.cost_cents) }, { key: 'actions', label: 'Ações', render: r => <button className="button outline" onClick={() => open('adjust', r)}>Movimentar</button> }]}/></Panel>}
    {view === 'suppliers' && <Panel title="Fornecedores" action={<PrimaryButton onClick={() => open('supplier')}><Plus size={16}/>Cadastrar fornecedor</PrimaryButton>}><DataTable rows={suppliers.rows} empty="Nenhum fornecedor cadastrado" onRowClick={r => open('supplier', r)} columns={[{ key: 'name', label: 'Fornecedor' },{ key: 'document', label: 'CPF/CNPJ' },{ key: 'contact', label: 'Contato' },{ key: 'email', label: 'E-mail' },{ key: 'active', label: 'Status', render: r => r.active ? 'Ativo' : 'Inativo' }]}/></Panel>}
    {view === 'purchases' && <Panel title="Compras recebidas" subtitle="Ao receber, o saldo e o custo médio ponderado mudam juntos. Compras pagas são lançadas como aquisição de estoque, sem repetir o custo da venda."><DataTable rows={purchases.rows} empty="Nenhuma compra registrada" onRowClick={setDetail} columns={[{ key: 'created_at', label: 'Recebimento', render: r => shopDateTime(r.created_at, tz) },{ key: 'supplier_id', label: 'Fornecedor', render: r => asText(suppliers.rows.find(s => s.id === r.supplier_id)?.name || 'Não informado') },{ key: 'invoice_reference', label: 'Documento' },{ key: 'total_cents', label: 'Total', render: r => money(r.total_cents) },{ key: 'paid', label: 'Pagamento', render: r => r.paid ? 'Pago e lançado' : 'Pendente' }]}/></Panel>}
    {view === 'movements' && <Panel title="Trilha do estoque" subtitle="Saldos anteriores à implantação não são reconstruídos. A partir dela, compras, reservas, cancelamentos e ajustes ficam registrados."><DataTable rows={movements.rows} empty="Nenhum movimento registrado" columns={[{ key: 'created_at', label: 'Quando', render: r => shopDateTime(r.created_at, tz) },{ key: 'product_id', label: 'Produto', render: r => productName(r.product_id) },{ key: 'reason', label: 'Movimento', render: r => stockReasons[String(r.reason)] || asText(r.reason) },{ key: 'quantity_delta', label: 'Quantidade', render: r => Number(r.quantity_delta) > 0 ? `+${r.quantity_delta}` : String(r.quantity_delta) },{ key: 'balance_after', label: 'Saldo após' },{ key: 'unit_cost_cents', label: 'Custo após', render: r => money(r.unit_cost_cents) },{ key: 'notes', label: 'Justificativa' }]}/></Panel>}
    {modal && <Modal wide={modal === 'purchase'} title={modal === 'supplier' ? supplierEditor ? 'Editar fornecedor' : 'Novo fornecedor' : modal === 'purchase' ? 'Receber compra' : 'Movimentar estoque'} onClose={() => { if (!busy) setModal(null) }}><form className="form-grid" onSubmit={save}>
      {modal === 'supplier' && <><Field label="Nome"><input required minLength={2} maxLength={160} value={supplier.name} onChange={e => setSupplier({ ...supplier, name: e.target.value })}/></Field><div className="form-row"><Field label="CPF / CNPJ"><input maxLength={30} value={supplier.document} onChange={e => setSupplier({ ...supplier, document: e.target.value })}/></Field><Field label="Telefone / responsável"><input maxLength={160} value={supplier.contact} onChange={e => setSupplier({ ...supplier, contact: e.target.value })}/></Field></div><Field label="E-mail"><input type="email" value={supplier.email} onChange={e => setSupplier({ ...supplier, email: e.target.value })}/></Field><Field label="Observações"><textarea maxLength={2000} value={supplier.notes} onChange={e => setSupplier({ ...supplier, notes: e.target.value })}/></Field><label className="check-field"><input type="checkbox" checked={supplier.active} onChange={e => setSupplier({ ...supplier, active: e.target.checked })}/>Fornecedor ativo</label></>}
      {modal === 'purchase' && <><div className="form-row"><Field label="Fornecedor"><select value={purchase.supplier} onChange={e => setPurchase({ ...purchase, supplier: e.target.value })}><option value="">Não informado</option>{suppliers.rows.filter(s => s.active).map(s => <option key={s.id} value={s.id}>{asText(s.name)}</option>)}</select></Field><Field label="Número da nota / documento"><input maxLength={160} value={purchase.invoice} onChange={e => setPurchase({ ...purchase, invoice: e.target.value })}/></Field></div><div className="ops-entry-line"><Field label="Produto"><select value={item.product_id} onChange={e => { const p = products.rows.find(p => p.id === e.target.value); setItem({ ...item, product_id: e.target.value, cost: String(Number(p?.cost_cents || 0)/100) }) }}><option value="">Selecione</option>{products.rows.map(p => <option key={p.id} value={p.id}>{asText(p.name)}</option>)}</select></Field><Field label="Quantidade"><input type="number" min="1" max="100000" step="1" value={item.quantity} onChange={e => setItem({ ...item, quantity: e.target.value })}/></Field><Field label="Custo unitário (R$)"><input type="number" min="0" step="0.01" value={item.cost} onChange={e => setItem({ ...item, cost: e.target.value })}/></Field><button type="button" className="button outline" onClick={addItem}>Adicionar</button></div><div className="ops-basket">{basket.map(i => <div key={i.product_id}><span>{i.quantity}× {productName(i.product_id)}</span><strong>{money(Number(i.quantity)*Math.round(Number(i.cost)*100))}</strong><button type="button" className="icon-button" aria-label={`Remover ${productName(i.product_id)}`} onClick={() => setBasket(basket.filter(b => b.product_id !== i.product_id))}><X size={16}/></button></div>)}</div><label className="check-field"><input type="checkbox" checked={purchase.paid} onChange={e => setPurchase({ ...purchase, paid: e.target.checked })}/>A compra já foi paga: registrar também a saída no financeiro</label></>}
      {modal === 'adjust' && <><Field label="Produto"><select required value={adjust.product} onChange={e => setAdjust({ ...adjust, product: e.target.value })}><option value="">Selecione</option>{products.rows.map(p => <option key={p.id} value={p.id}>{asText(p.name)} · saldo {String(p.stock_quantity)}</option>)}</select></Field><Field label="Tipo de movimento"><select value={adjust.reason} onChange={e => setAdjust({ ...adjust, reason: e.target.value })}><option value="internal_use">Consumo interno</option><option value="loss">Perda</option><option value="adjustment">Ajuste de inventário</option></select></Field><Field label={adjust.reason === 'adjustment' ? 'Diferença de quantidade (+ entrada / − saída)' : 'Quantidade a retirar'}><input required type="number" step="1" min={adjust.reason === 'adjustment' ? '-100000' : '1'} max="100000" value={adjust.quantity} onChange={e => setAdjust({ ...adjust, quantity: e.target.value })}/></Field><Field label="Justificativa"><textarea required minLength={3} maxLength={2000} value={adjust.notes} onChange={e => setAdjust({ ...adjust, notes: e.target.value })}/></Field></>}
      <Notice text={error}/><div className="form-actions"><button type="button" className="button ghost" disabled={busy} onClick={() => setModal(null)}>Cancelar</button><PrimaryButton type="submit" disabled={busy}>{busy ? 'Registrando…' : 'Confirmar registro'}</PrimaryButton></div></form></Modal>}
    {detail && <Modal title="Detalhes da compra" subtitle={asText(detail.invoice_reference || detail.id)} onClose={() => { if (!busy) setDetail(null) }}><DataTable rows={purchaseItems.rows.filter(i => i.purchase_id === detail.id)} empty="Nenhum item" columns={[{ key: 'product_id', label: 'Produto', render: r => productName(r.product_id) },{ key: 'quantity', label: 'Quantidade' },{ key: 'unit_cost_cents', label: 'Custo unitário', render: r => money(r.unit_cost_cents) },{ key: 'total_cents', label: 'Total', render: r => money(r.total_cents) }]}/><p>Total: <strong>{money(detail.total_cents)}</strong></p><Notice text={error}/>{!detail.paid && <><Notice kind="info" text="Confirme somente se a compra já foi paga. Este botão registra a despesa; não faz transferência para o fornecedor."/><div className="form-actions"><PrimaryButton disabled={busy} onClick={() => void payPurchase()}>{busy ? 'Registrando…' : 'Confirmar compra já paga'}</PrimaryButton></div></>}</Modal>}
  </div>
}
