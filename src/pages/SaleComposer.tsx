import { useState, type FormEvent } from 'react'
import { Plus, X } from 'lucide-react'
import type { PageProps } from '../App'
import { useRows } from '../lib/useRows'
import { operation } from '../lib/operations'
import { asText, money } from '../types'
import { Field, Modal, Notice, PrimaryButton } from '../ui'
import '../styles-operations-ledger.css'

export function SaleComposer({ identity, role, notify, categories, onClose, onCreated, tourForm }: PageProps & { categories?: string[]; onClose: () => void; onCreated: () => Promise<void>; tourForm?: string }) {
  const shopId = identity.shop?.id ?? null
  const products = useRows('products', shopId)
  const clients = useRows('clients', shopId)
  const members = useRows('memberships', shopId)
  const [clientId, setClientId] = useState('')
  const [professional, setProfessional] = useState(role === 'barber' ? identity.membership?.id || '' : '')
  const [productId, setProductId] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [basket, setBasket] = useState<{ product_id: string; quantity: number }[]>([])
  const [requestKey] = useState(() => crypto.randomUUID())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const menu = products.rows.filter(p => p.active && p.category !== 'supply' && (!categories || categories.includes(String(p.category))))
  const getProduct = (id: string) => menu.find(p => p.id === id)
  const total = basket.reduce((sum, i) => sum + i.quantity * Number(getProduct(i.product_id)?.price_cents || 0), 0)
  function add() {
    const product = getProduct(productId)
    const count = Number(quantity)
    const previous = basket.find(i => i.product_id === productId)?.quantity || 0
    if (!product || !Number.isInteger(count) || count < 1 || previous + count > 1000 || previous + count > Number(product.stock_quantity)) { setError('Selecione um produto com estoque e quantidade inteira disponível.'); return }
    setBasket(basket.some(i => i.product_id === productId) ? basket.map(i => i.product_id === productId ? { ...i, quantity: i.quantity + count } : i) : [...basket, { product_id: productId, quantity: count }])
    setProductId(''); setQuantity('1'); setError(null)
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!shopId || !basket.length) return
    setBusy(true); setError(null)
    try {
      await operation('sale_professional', { p_shop: shopId, p_client: clientId || null, p_professional: professional || null, p_items: basket, p_request: requestKey })
      notify('Comanda criada e estoque reservado.'); onClose(); await onCreated()
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Não foi possível criar a comanda.') }
    finally { setBusy(false) }
  }
  return <Modal wide title="Nova comanda" subtitle="Inclua os produtos e confirme a comanda. Os preços e o estoque são conferidos no momento do registro." onClose={() => { if (!busy) onClose() }}><form className="form-grid operations-ledger" onSubmit={save} data-tour-form={tourForm}>
    <Notice text={products.error || clients.error || members.error}/>
    <div className="form-row"><Field label="Cliente"><select value={clientId} onChange={e => setClientId(e.target.value)}><option value="">Comanda avulsa</option>{clients.rows.map(c => <option key={c.id} value={c.id}>{asText(c.full_name)}</option>)}</select></Field><Field label="Profissional responsável pela venda"><select value={professional} onChange={e => setProfessional(e.target.value)} disabled={role === 'barber'}><option value="">Sem atribuição de comissão</option>{members.rows.filter(m => m.role === 'barber' && m.active).map(m => <option key={m.id} value={m.id}>{asText(m.display_name)}</option>)}</select></Field></div>
    <div className="ops-entry-line"><Field label="Produto"><select value={productId} onChange={e => setProductId(e.target.value)}><option value="">Selecione</option>{menu.map(p => <option key={p.id} value={p.id}>{asText(p.name)} — {money(p.price_cents)} · estoque {String(p.stock_quantity)}</option>)}</select></Field><Field label="Quantidade"><input type="number" min="1" max="1000" step="1" value={quantity} onChange={e => setQuantity(e.target.value)}/></Field><button type="button" className="button outline" onClick={add}><Plus size={16}/>Adicionar item</button></div>
    <div className="ops-basket">{basket.map(i => <div key={i.product_id}><span>{i.quantity}× {asText(getProduct(i.product_id)?.name)}</span><strong>{money(i.quantity * Number(getProduct(i.product_id)?.price_cents || 0))}</strong><button type="button" className="icon-button" aria-label={`Remover ${asText(getProduct(i.product_id)?.name)}`} onClick={() => setBasket(basket.filter(b => b.product_id !== i.product_id))}><X size={16}/></button></div>)}</div>
    <div className="ops-total"><span>Total da comanda</span><strong>{money(total)}</strong></div>
    <Notice text={error}/><div className="form-actions"><button type="button" className="button ghost" disabled={busy} onClick={onClose}>Cancelar</button><PrimaryButton type="submit" disabled={busy || !basket.length}>{busy ? 'Criando…' : 'Criar comanda'}</PrimaryButton></div>
  </form></Modal>
}
