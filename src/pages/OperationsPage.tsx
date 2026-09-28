import { useEffect, useState, type FormEvent } from 'react'
import { Bot, Landmark, Package, ReceiptText, Target, TrendingUp } from 'lucide-react'
import type { PageProps } from '../App'
import { authedApi, requireSupabase } from '../lib/supabase'
import { createRow, updateRow, useRows } from '../lib/useRows'
import { asText, cents, date, dateTime, money, today, type Row } from '../types'
import { AddButton, DataTable, Empty, Field, Loading, Modal, Notice, PageHeader, Panel, PrimaryButton, Stat, Status } from '../ui'

export function ProductsPage({ identity, notify }: PageProps) {
  const shopId = identity.shop?.id ?? null
  const products = useRows('products', shopId)
  const [filter, setFilter] = useState('all')
  const [editor, setEditor] = useState<Row | 'new' | null>(null)
  const [form, setForm] = useState({ name: '', sku: '', category: 'retail', price: '', cost: '', stock_quantity: '0', active: true })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rows = filter === 'all' ? products.rows : products.rows.filter(p => p.category === filter)
  function edit(row?: Row) { setEditor(row || 'new'); setError(null); setForm(row ? { name: String(row.name || ''), sku: String(row.sku || ''), category: String(row.category || 'retail'), price: String(Number(row.price_cents || 0)/100), cost: String(Number(row.cost_cents || 0)/100), stock_quantity: String(row.stock_quantity ?? 0), active: Boolean(row.active) } : { name: '', sku: '', category: 'retail', price: '', cost: '', stock_quantity: '0', active: true }) }
  async function save(event: FormEvent) { event.preventDefault(); if (!shopId || !editor) return; setBusy(true); setError(null); try { const values = { name: form.name.trim(), sku: form.sku.trim() || null, category: form.category, price_cents: cents(form.price), cost_cents: cents(form.cost || '0'), stock_quantity: Number(form.stock_quantity), active: form.active }; if (editor === 'new') await createRow('products', { ...values, barbershop_id: shopId }); else await updateRow('products', editor.id, values); notify('Produto salvo.'); setEditor(null); await products.refresh() } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao salvar produto.') } finally { setBusy(false) } }
  return <div className="page-stack"><PageHeader eyebrow="ESTOQUE E VENDAS" title="Produtos" description="Gerencie itens da barbearia, do bar e da cozinha." action={<AddButton onClick={() => edit()}>Novo produto</AddButton>}/><div className="segmented"><button className={filter === 'all' ? 'selected' : ''} onClick={() => setFilter('all')}>Todos</button><button className={filter === 'retail' ? 'selected' : ''} onClick={() => setFilter('retail')}>Barbearia</button><button className={filter === 'bar' ? 'selected' : ''} onClick={() => setFilter('bar')}>Bar</button><button className={filter === 'kitchen' ? 'selected' : ''} onClick={() => setFilter('kitchen')}>Cozinha</button></div><Notice text={products.error}/><Panel title="Catálogo" subtitle={`${rows.length} item(ns) no filtro`}>{products.loading ? <Loading/> : <DataTable rows={rows} empty="Nenhum produto cadastrado" onRowClick={edit} columns={[{ key: 'name', label: 'Produto', render: row => <div className="person-cell"><div className="service-icon"><Package size={17}/></div><div><strong>{asText(row.name)}</strong><small>{asText(row.sku)}</small></div></div> }, { key: 'category', label: 'Categoria', render: row => ({ retail: 'Barbearia', bar: 'Bar', kitchen: 'Cozinha' }[String(row.category)] || asText(row.category)) }, { key: 'price_cents', label: 'Preço', render: row => money(row.price_cents) }, { key: 'stock_quantity', label: 'Estoque' }, { key: 'active', label: 'Status', render: row => <Status value={row.active ? 'active' : 'paused'}/> }]} />}</Panel>{editor && <Modal title={editor === 'new' ? 'Novo produto' : 'Editar produto'} onClose={() => setEditor(null)}><form className="form-grid" onSubmit={save}><div className="form-row"><Field label="Nome"><input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}/></Field><Field label="SKU"><input value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })}/></Field></div><Field label="Categoria"><select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}><option value="retail">Barbearia</option><option value="bar">Bar</option><option value="kitchen">Cozinha</option></select></Field><div className="form-row"><Field label="Preço de venda (R$)"><input type="number" min="0" step="0.01" required value={form.price} onChange={e => setForm({ ...form, price: e.target.value })}/></Field><Field label="Custo (R$)"><input type="number" min="0" step="0.01" value={form.cost} onChange={e => setForm({ ...form, cost: e.target.value })}/></Field></div><Field label="Quantidade em estoque"><input type="number" min="0" required value={form.stock_quantity} onChange={e => setForm({ ...form, stock_quantity: e.target.value })}/></Field><label className="check-field"><input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })}/> Produto ativo</label><Notice text={error}/><div className="form-actions"><button type="button" className="button ghost" onClick={() => setEditor(null)}>Cancelar</button><PrimaryButton type="submit" disabled={busy}>{busy ? 'Salvando...' : 'Salvar produto'}</PrimaryButton></div></form></Modal>}</div>
}

export function BarPage({ identity, notify }: PageProps) {
  const shopId = identity.shop?.id ?? null
  const sales = useRows('sales', shopId)
  const items = useRows('sale_items', shopId)
  const products = useRows('products', shopId)
  const clients = useRows('clients', shopId)
  const [filter, setFilter] = useState<'open' | 'delivered' | 'all'>('open')
  const [editor, setEditor] = useState(false)
  const [clientId, setClientId] = useState('')
  const [productId, setProductId] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const menu = products.rows.filter(p => ['bar','kitchen'].includes(String(p.category)) && p.active)
  const shown = sales.rows.filter(s => filter === 'all' || s.status === filter)
  async function deliver(id: string) { try { await updateRow('sales', id, { status: 'delivered' }); notify('Pedido marcado como entregue.'); await sales.refresh() } catch (err) { notify(err instanceof Error ? err.message : 'Falha ao atualizar pedido.', 'error') } }
  async function createOrder(event: FormEvent) {
    event.preventDefault(); if (!shopId) return
    setBusy(true); setError(null)
    try { const { error } = await requireSupabase().rpc('create_sale', { p_barbershop_id: shopId, p_client_id: clientId || null, p_items: [{ product_id: productId, quantity: Number(quantity) }] }); if (error) throw error; notify('Comanda criada.'); setEditor(false); await Promise.all([sales.refresh(), items.refresh(), products.refresh()]) }
    catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível criar a comanda.') }
    finally { setBusy(false) }
  }
  return <div className="page-stack"><PageHeader eyebrow="BAR E COZINHA" title="Pedidos e comandas" description="Acompanhe o que foi pedido e o que ainda precisa ser entregue." action={<AddButton onClick={() => setEditor(true)}>Nova comanda</AddButton>}/><div className="segmented"><button className={filter === 'open' ? 'selected' : ''} onClick={() => setFilter('open')}>Em aberto</button><button className={filter === 'delivered' ? 'selected' : ''} onClick={() => setFilter('delivered')}>Entregues</button><button className={filter === 'all' ? 'selected' : ''} onClick={() => setFilter('all')}>Todos</button></div><Notice text={sales.error || items.error || products.error}/>{sales.loading ? <Loading/> : shown.length ? <div className="order-grid">{shown.map(sale => <Panel key={sale.id} className="order-card" title={asText(clients.rows.find(c => c.id === sale.client_id)?.full_name || 'Comanda avulsa')} subtitle={dateTime(sale.created_at)} action={<Status value={sale.status}/>}><div className="order-items">{items.rows.filter(item => item.sale_id === sale.id).map(item => <div key={item.id}><span>{String(item.quantity)}× {asText(item.description || products.rows.find(p => p.id === item.product_id)?.name)}</span><strong>{money(item.total_cents)}</strong></div>)}</div><div className="order-footer"><strong>{money(sale.total_cents)}</strong>{sale.status === 'open' && <button className="button outline" onClick={() => void deliver(sale.id)}>Entregar</button>}</div></Panel>)}</div> : <Panel><Empty title="Nenhum pedido neste filtro" text="As comandas do bar e da cozinha aparecerão aqui."/></Panel>}{editor && <Modal title="Nova comanda" subtitle="Registre o item pedido pelo cliente." onClose={() => setEditor(false)}><form className="form-grid" onSubmit={createOrder}><Field label="Cliente"><select value={clientId} onChange={e => setClientId(e.target.value)}><option value="">Comanda avulsa</option>{clients.rows.map(c => <option key={c.id} value={c.id}>{asText(c.full_name)}</option>)}</select></Field><Field label="Produto"><select required value={productId} onChange={e => setProductId(e.target.value)}><option value="">Selecione</option>{menu.map(p => <option key={p.id} value={p.id}>{asText(p.name)} — {money(p.price_cents)}</option>)}</select></Field><Field label="Quantidade"><input type="number" min="1" required value={quantity} onChange={e => setQuantity(e.target.value)}/></Field><Notice text={error}/><div className="form-actions"><button type="button" className="button ghost" onClick={() => setEditor(false)}>Cancelar</button><PrimaryButton type="submit" disabled={busy || !productId}>{busy ? 'Criando...' : 'Criar comanda'}</PrimaryButton></div></form></Modal>}</div>
}

export function FinancePage({ identity, role, notify }: PageProps) {
  const shop = identity.shop!
  const expenses = useRows('expenses', shop.id)
  const payments = useRows('payments', shop.id)
  const services = useRows('services', shop.id)
  const [editor, setEditor] = useState(false)
  const [form, setForm] = useState({ category: 'supplies', description: '', amount: '', occurred_on: today(), recurring: false })
  const [settings, setSettings] = useState<{ structure_monthly_cost_cents: number; target_profit_pct: number | null } | null>(null)
  const [structure, setStructure] = useState('')
  const [profit, setProfit] = useState('')
  const [analysis, setAnalysis] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (role === 'barber') return
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
  }, [shop.id, role])
  const month = today().slice(0,7)
  const monthPayments = payments.rows.filter(p => p.status === 'paid' && String(p.paid_at || p.created_at).slice(0,7) === month)
  const revenue = monthPayments.reduce((sum,p) => sum + Number(p.amount_cents || 0),0)
  const spent = expenses.rows.filter(e => String(e.occurred_on).slice(0,7) === month).reduce((sum,e) => sum + Number(e.amount_cents || 0),0)
  const structureCents = settings?.structure_monthly_cost_cents
  const result = structureCents == null ? null : revenue - spent - structureCents
  async function saveExpense(event: FormEvent) { event.preventDefault(); setBusy(true); setError(null); try { await createRow('expenses', { barbershop_id: shop.id, category: form.category, description: form.description.trim(), amount_cents: cents(form.amount), occurred_on: form.occurred_on, recurring: form.recurring }); notify('Despesa registrada.'); setEditor(false); await expenses.refresh() } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao salvar despesa.') } finally { setBusy(false) } }
  async function saveStructure(event: FormEvent) { event.preventDefault(); if (!settings) return; setBusy(true); setError(null); try { const newCost = cents(structure || '0'); const newTarget = profit ? Number(profit) : null; const { error } = await requireSupabase().from('barbershops').update({ structure_monthly_cost_cents: newCost, target_profit_pct: newTarget }).eq('id', shop.id); if (error) throw error; setSettings({ structure_monthly_cost_cents: newCost, target_profit_pct: newTarget }); notify('Parâmetros salvos.') } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao salvar parâmetros.') } finally { setBusy(false) } }
  async function requestAnalysis() { setBusy(true); setError(null); setAnalysis(null); try { const output = await authedApi<{ response: string; source: string }>('/api/ai/analyze', { barbershop_id: shop.id, kind: 'financial' }); setAnalysis(output.response); notify(output.source === 'ai' ? 'Análise gerada.' : 'Análise calculada com os dados disponíveis.') } catch (err) { setError(err instanceof Error ? err.message : 'Análise indisponível.') } finally { setBusy(false) } }
  return <div className="page-stack"><PageHeader eyebrow="SAÚDE FINANCEIRA" title="Financeiro" description="Receitas confirmadas, gastos, custo da estrutura e meta de lucro." action={<AddButton onClick={() => setEditor(true)}>Registrar despesa</AddButton>}/><div className="stats-grid"><Stat label="Receita recebida no mês" value={money(revenue)} foot="Pagamentos confirmados" icon={<TrendingUp size={19}/>}/><Stat label="Despesas do mês" value={money(spent)} foot="Lançamentos registrados" icon={<ReceiptText size={19}/>}/><Stat label="Custo mensal da estrutura" value={structureCents == null ? '—' : money(structureCents)} foot="Valor configurado" icon={<Landmark size={19}/>}/><Stat label="Resultado estimado" value={result == null ? '—' : money(result)} foot="Receita − despesas − estrutura" icon={<Target size={19}/>} /></div><Notice text={expenses.error || payments.error || error}/><div className="dashboard-grid"><Panel title="Despesas" subtitle="Custos lançados pela barbearia"><DataTable rows={expenses.rows} empty="Nenhuma despesa registrada" columns={[{ key: 'occurred_on', label: 'Data', render: row => date(row.occurred_on) }, { key: 'description', label: 'Descrição' }, { key: 'category', label: 'Categoria' }, { key: 'amount_cents', label: 'Valor', render: row => money(row.amount_cents) }]} /></Panel><Panel title="Estrutura e lucro" subtitle="Base para análise de preços e margem">{role === 'barber' ? <p className="muted">Os custos privados são definidos pela administração.</p> : <><form className="form-grid" onSubmit={saveStructure}><Field label="Custo mensal da estrutura (R$)"><input type="number" min="0" step="0.01" value={structure} onChange={e => setStructure(e.target.value)}/></Field><Field label="Meta de lucro (%)"><input type="number" min="0" max="100" step="0.01" value={profit} onChange={e => setProfit(e.target.value)}/></Field><PrimaryButton type="submit" disabled={busy || !settings}>Salvar parâmetros</PrimaryButton></form><p className="panel-footnote">O resultado é uma estimativa com base nos lançamentos deste mês. Não substitui contabilidade.</p></>}</Panel></div><Panel title="Análise de custos e preços" subtitle="Sugestões a partir dos serviços, recebimentos e despesas registrados" action={<button className="button primary" onClick={() => void requestAnalysis()} disabled={busy}><Bot size={17}/>{busy ? 'Analisando...' : 'Analisar com IA'}</button>}><div className="analysis-summary"><div><strong>{services.rows.length}</strong><span>serviços cadastrados</span></div><div><strong>{expenses.rows.length}</strong><span>despesas lançadas</span></div><div><strong>{money(revenue)}</strong><span>receita confirmada no mês</span></div></div>{analysis ? <div className="analysis-result">{analysis}</div> : <p className="muted">Clique em analisar para receber um diagnóstico do que pode melhorar e sugestões de valores. O cálculo usa somente dados disponíveis no sistema.</p>}</Panel>{editor && <Modal title="Registrar despesa" onClose={() => setEditor(false)}><form className="form-grid" onSubmit={saveExpense}><Field label="Descrição"><input required value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}/></Field><div className="form-row"><Field label="Categoria"><select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}><option value="supplies">Insumos</option><option value="staff">Equipe</option><option value="marketing">Marketing</option><option value="other">Outros</option></select></Field><Field label="Valor (R$)"><input type="number" min="0" step="0.01" required value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })}/></Field></div><Field label="Data"><input type="date" required value={form.occurred_on} onChange={e => setForm({ ...form, occurred_on: e.target.value })}/></Field><label className="check-field"><input type="checkbox" checked={form.recurring} onChange={e => setForm({ ...form, recurring: e.target.checked })}/> Despesa recorrente</label><Notice text={error}/><div className="form-actions"><button className="button ghost" type="button" onClick={() => setEditor(false)}>Cancelar</button><PrimaryButton type="submit" disabled={busy}>{busy ? 'Salvando...' : 'Registrar'}</PrimaryButton></div></form></Modal>}</div>
}

export function GoalsPage({ identity, role, notify }: PageProps) {
  const shopId = identity.shop?.id ?? null
  const goals = useRows('goals', shopId)
  const members = useRows('memberships', shopId)
  const appointments = useRows('appointments', shopId)
  const payments = useRows('payments', shopId)
  const [editor, setEditor] = useState(false)
  const [form, setForm] = useState({ title: '', metric: 'revenue', target_value: '', period_start: today().slice(0,7)+'-01', period_end: today(), barber_membership_id: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const barbers = members.rows.filter(row => row.role === 'barber' && row.active)
  const shown = role === 'barber' ? goals.rows.filter(g => g.barber_membership_id === identity.membership?.id || !g.barber_membership_id) : goals.rows
  function progress(goal: Row) {
    const start = String(goal.period_start), end = String(goal.period_end)
    if (goal.metric === 'appointments') return appointments.rows.filter(a =>
      (!goal.barber_membership_id || a.barber_membership_id === goal.barber_membership_id) &&
      String(a.starts_at).slice(0,10) >= start && String(a.starts_at).slice(0,10) <= end &&
      a.status === 'completed').length
    if (goal.metric === 'revenue') {
      const barberAppointments = new Set(appointments.rows.filter(a => a.barber_membership_id === goal.barber_membership_id).map(a => a.id))
      return payments.rows.filter(p =>
        p.status === 'paid' &&
        (!goal.barber_membership_id || barberAppointments.has(String(p.appointment_id))) &&
        String(p.paid_at || p.created_at).slice(0,10) >= start &&
        String(p.paid_at || p.created_at).slice(0,10) <= end
      ).reduce((sum,p) => sum + Number(p.amount_cents || 0),0)/100
    }
    return 0
  }
  async function save(event: FormEvent) { event.preventDefault(); if (!shopId) return; setBusy(true); setError(null); try { await createRow('goals', { barbershop_id: shopId, barber_membership_id: role === 'barber' ? identity.membership?.id : form.barber_membership_id || null, title: form.title.trim(), metric: form.metric, target_value: Number(form.target_value), period_start: form.period_start, period_end: form.period_end, created_by: identity.user.id }); notify('Meta cadastrada.'); setEditor(false); await goals.refresh() } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao salvar meta.') } finally { setBusy(false) } }
  return <div className="page-stack"><PageHeader eyebrow="EVOLUÇÃO" title="Metas" description="Metas da barbearia, da equipe e objetivos pessoais dos profissionais." action={<AddButton onClick={() => setEditor(true)}>Nova meta</AddButton>}/><Notice text={goals.error}/>{shown.length ? <div className="goal-grid">{shown.map(goal => { const current = progress(goal), target = Number(goal.target_value || 0), percent = target > 0 ? Math.min(100, Math.max(0,current/target*100)) : 0; const isMoney = goal.metric === 'revenue'; return <Panel key={goal.id} className="goal-card" title={asText(goal.title)} subtitle={`${date(goal.period_start)} a ${date(goal.period_end)}`} action={<Status value={goal.barber_membership_id ? 'individual' : 'equipe'}/>}><div className="goal-value"><strong>{isMoney ? money(current*100) : current}</strong><span>de {isMoney ? money(target*100) : target}</span></div><div className="progress"><div style={{ width: `${percent}%` }}/></div><p>{Math.round(percent)}% da meta · {goal.barber_membership_id ? asText(barbers.find(b => b.id === goal.barber_membership_id)?.display_name) : 'Barbearia'}</p></Panel> })}</div> : <Panel><Empty title="Nenhuma meta cadastrada" text="Crie um objetivo para acompanhar a evolução da barbearia ou do profissional."/></Panel>}<p className="data-limit-note">Receita individual considera apenas pagamentos ligados a agendamentos do profissional. Acompanhamento limitado aos 500 registros recentes exibidos.</p>{editor && <Modal title="Nova meta" onClose={() => setEditor(false)}><form className="form-grid" onSubmit={save}><Field label="Título"><input required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}/></Field><Field label="Indicador"><select value={form.metric} onChange={e => setForm({ ...form, metric: e.target.value })}><option value="revenue">Receita (R$)</option><option value="appointments">Agendamentos</option></select></Field><Field label="Valor alvo"><input type="number" min="1" step={form.metric === 'revenue' ? '0.01' : '1'} required value={form.target_value} onChange={e => setForm({ ...form, target_value: e.target.value })}/></Field>{role !== 'barber' && <Field label="Destinatário"><select value={form.barber_membership_id} onChange={e => setForm({ ...form, barber_membership_id: e.target.value })}><option value="">Barbearia inteira</option>{barbers.map(row => <option key={row.id} value={row.id}>{asText(row.display_name)}</option>)}</select></Field>}<div className="form-row"><Field label="Início"><input type="date" required value={form.period_start} onChange={e => setForm({ ...form, period_start: e.target.value })}/></Field><Field label="Fim"><input type="date" min={form.period_start} required value={form.period_end} onChange={e => setForm({ ...form, period_end: e.target.value })}/></Field></div><Notice text={error}/><div className="form-actions"><button type="button" className="button ghost" onClick={() => setEditor(false)}>Cancelar</button><PrimaryButton type="submit" disabled={busy}>{busy ? 'Salvando...' : 'Criar meta'}</PrimaryButton></div></form></Modal>}</div>
}
