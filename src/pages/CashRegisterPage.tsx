import { useState, type FormEvent } from 'react'
import { ArrowDownUp, Banknote, Check, Plus, Printer, Receipt, X } from 'lucide-react'
import type { PageProps } from '../App'
import { useRows } from '../lib/useRows'
import { cashMethods, operation, safeAmount } from '../lib/operations'
import { shopDateTime } from '../lib/shopTime'
import { asText, money, type Row } from '../types'
import { DataTable, Field, Modal, Notice, Panel, PrimaryButton, Stat } from '../ui'
import { SaleComposer } from './SaleComposer'
import '../styles-operations-ledger.css'

export function CashRegisterPage(props: PageProps) {
  const { identity, notify } = props
  const shop = identity.shop!
  const tz = shop.timezone || 'America/Sao_Paulo'
  const sessions = useRows('cash_sessions', shop.id)
  const movements = useRows('cash_movements', shop.id)
  const sales = useRows('sales', shop.id)
  const saleItems = useRows('sale_items', shop.id)
  const appointments = useRows('appointments', shop.id)
  const payments = useRows('payments', shop.id)
  const clients = useRows('clients', shop.id)
  const [modal, setModal] = useState<'open' | 'adjust' | 'close' | 'receive' | 'refund' | null>(null)
  const [saleModal, setSaleModal] = useState(false)
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [kind, setKind] = useState('withdrawal')
  const [source, setSource] = useState('')
  const [parts, setParts] = useState([{ method: 'pix', amount: '' }])
  const [refundPayment, setRefundPayment] = useState<Row | null>(null)
  const [restock, setRestock] = useState(false)
  const [requestKey, setRequestKey] = useState('')
  const [receipt, setReceipt] = useState<Row | null>(null)
  const [sessionDetail, setSessionDetail] = useState<Row | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const current = sessions.rows.find(s => !s.closed_at)
  const currentMoves = movements.rows.filter(m => m.session_id === current?.id)
  const expected = Number(current?.opening_cents || 0) + currentMoves.filter(m => m.method === 'cash').reduce((sum,m) => sum + (['receipt','supply'].includes(String(m.kind)) ? Number(m.amount_cents) : -Number(m.amount_cents)),0)
  const totals = Object.keys(cashMethods).map(method => ({ method, amount: currentMoves.filter(m => m.method === method && ['receipt','refund'].includes(String(m.kind))).reduce((sum,m) => sum + (m.kind === 'receipt' ? 1 : -1) * Number(m.amount_cents),0) }))
  const paid = (type: string, id: string) => payments.rows.filter(p => p[`${type}_id`] === id && ['paid','approved'].includes(String(p.status))).reduce((sum,p) => sum + Number(p.amount_cents),0)
  const pending: (Row & { sourceType: string; remaining: number })[] = [...sales.rows.filter(s => ['open','delivered'].includes(String(s.status))).map(s => ({ ...s, sourceType: 'sale', remaining: Number(s.total_cents)-paid('sale',s.id) })), ...appointments.rows.filter(a => a.status === 'completed' && !a.subscription_id).map(a => ({ ...a, sourceType: 'appointment', remaining: Number(a.total_price_cents)-paid('appointment',a.id) }))].filter(s => s.remaining > 0)
  const selected = pending.find(s => `${s.sourceType}:${s.id}` === source)
  const customer = (id: unknown) => asText(clients.rows.find(c => c.id === id)?.full_name || 'Cliente avulso')
  async function refresh() { await Promise.all([sessions.refresh(), movements.refresh(), sales.refresh(), saleItems.refresh(), payments.refresh(), appointments.refresh()]) }
  function open(type: typeof modal, row?: Row) {
    setError(null); setModal(type); setAmount(''); setNotes(''); setRequestKey(crypto.randomUUID()); setRestock(false); setRefundPayment(row || null)
    if (type === 'receive') { const match = row || pending[0]; const key = match ? `${match.sourceType}:${match.id}` : ''; setSource(key); setParts([{ method: 'pix', amount: match ? String(Number(match.remaining)/100) : '' }]) }
  }
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null)
    try {
      if (modal === 'open') await operation('cash_open', { p_shop: shop.id, p_opening: safeAmount(amount, true), p_notes: notes.trim() || null })
      if (modal === 'adjust') await operation('cash_adjust', { p_shop: shop.id, p_kind: kind, p_amount: safeAmount(amount), p_notes: notes.trim(), p_request: requestKey })
      if (modal === 'close') await operation('cash_close', { p_shop: shop.id, p_session: current?.id, p_counted: safeAmount(amount, true), p_notes: notes.trim() || null })
      if (modal === 'receive') {
        if (!selected) throw new Error('Selecione uma comanda ou atendimento com saldo em aberto.')
        await operation('cash_receive', { p_shop: shop.id, p_sale: selected.sourceType === 'sale' ? selected.id : null, p_appointment: selected.sourceType === 'appointment' ? selected.id : null, p_methods: parts.map(p => ({ method: p.method, amount_cents: safeAmount(p.amount) })), p_request: requestKey })
      }
      if (modal === 'refund') await operation('cash_refund', { p_shop: shop.id, p_payment: refundPayment?.id, p_reason: notes.trim(), p_restock: restock, p_request: requestKey })
      setModal(null); notify(modal === 'close' ? 'Caixa fechado e conferência registrada.' : 'Lançamento de caixa registrado.'); await refresh()
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Não foi possível registrar o lançamento.') }
    finally { setBusy(false) }
  }
  const splitTotal = parts.reduce((sum,p) => sum + Math.round(Number(p.amount || 0)*100),0)
  const receiptPayment = receipt && payments.rows.find(p => p.id === receipt.payment_id)
  const receiptSale = receiptPayment && sales.rows.find(s => s.id === receiptPayment.sale_id)
  const receiptGroup = receipt ? movements.rows.filter(m => m.kind === receipt.kind && (receipt.kind === 'receipt' ? m.notes === receipt.notes : m.id === receipt.id)) : []
  return <div className="operations-ledger page-stack">
    <Panel title={current ? 'Caixa aberto' : 'Caixa fechado'} subtitle={current ? `Aberto em ${shopDateTime(current.opened_at,tz)}` : 'Abra o caixa para registrar recebimentos, suprimentos e devoluções.'} action={<div className="ops-actions">{current ? <><button className="button outline" onClick={() => open('adjust')}><ArrowDownUp size={16}/>Sangria / suprimento</button><button className="button outline" onClick={() => open('close')}><Check size={16}/>Fechar caixa</button><PrimaryButton onClick={() => open('receive')} disabled={!pending.length}><Banknote size={16}/>Receber pagamento</PrimaryButton></> : <PrimaryButton onClick={() => open('open')}><Banknote size={16}/>Abrir caixa</PrimaryButton>}</div>}>
      <Notice kind="info" text="Dinheiro, Pix e cartão aqui registram valores já recebidos. O caixa não cobra o cartão nem transfere Pix; confira o recebimento antes de confirmar."/>
      <div className="ops-money-grid"><Stat label="Dinheiro esperado na gaveta" value={money(expected)} foot="Abertura + entradas − saídas em dinheiro"/>{totals.map(t => <Stat key={t.method} label={`Recebido líquido · ${cashMethods[t.method]}`} value={money(t.amount)} foot="Recebimentos menos devoluções neste caixa"/>)}</div>
    </Panel>
    <Notice text={sessions.error || movements.error || sales.error || payments.error || appointments.error || saleItems.error || clients.error}/>
    <Panel title="Comandas e atendimentos a receber" subtitle="Atendimentos avulsos concluídos e comandas ainda em aberto. Assinaturas são cobradas no módulo de assinaturas." action={<button className="button outline" onClick={() => setSaleModal(true)}><Plus size={16}/>Nova comanda</button>}><DataTable rows={pending} empty="Nenhum saldo em aberto" columns={[{ key: 'client_id', label: 'Cliente', render: r => customer(r.client_id) },{ key: 'sourceType', label: 'Origem', render: r => r.sourceType === 'sale' ? `Comanda ${r.id.slice(0,8)}` : 'Atendimento avulso' },{ key: 'created_at', label: 'Data', render: r => shopDateTime(r.starts_at || r.created_at,tz) },{ key: 'remaining', label: 'Saldo a receber', render: r => money(r.remaining) },{ key: 'action', label: 'Ação', render: r => <button className="button outline" disabled={!current} onClick={() => open('receive',r)}>Receber</button> }]}/></Panel>
    <Panel title="Movimentações do caixa atual" subtitle="Recebimentos ficam vinculados ao pagamento; devoluções mantêm a trilha original."><DataTable rows={currentMoves} empty="Nenhum lançamento neste caixa" columns={[{ key: 'created_at', label: 'Horário', render: r => shopDateTime(r.created_at,tz) },{ key: 'kind', label: 'Tipo', render: r => ({ receipt:'Recebimento',refund:'Devolução',supply:'Suprimento',withdrawal:'Sangria' }[String(r.kind)] || asText(r.kind)) },{ key: 'method', label: 'Forma', render: r => cashMethods[String(r.method)] },{ key: 'amount_cents', label: 'Valor', render: r => money(r.amount_cents) },{ key: 'notes', label: 'Observação', render: r => String(r.notes || '').startsWith('checkout:') ? customer(payments.rows.find(p => p.id === r.payment_id)?.client_id) : asText(r.notes) },{ key: 'action', label: 'Ações', render: r => { const p = payments.rows.find(p => p.id === r.payment_id); return <div className="ops-actions">{Boolean(r.payment_id) && <button className="button outline" onClick={() => setReceipt(r)}><Receipt size={15}/>Comprovante</button>}{r.kind === 'receipt' && p?.status === 'paid' && <button className="button ghost" onClick={() => open('refund',p)}>Devolver</button>}</div> } }]}/></Panel>
    <Panel title="Histórico de aberturas e fechamentos"><DataTable rows={sessions.rows} empty="Nenhum caixa registrado" onRowClick={setSessionDetail} columns={[{ key: 'opened_at', label: 'Abertura', render: r => shopDateTime(r.opened_at,tz) },{ key: 'closed_at', label: 'Fechamento', render: r => r.closed_at ? shopDateTime(r.closed_at,tz) : 'Aberto' },{ key: 'opening_cents', label: 'Fundo inicial', render: r => money(r.opening_cents) },{ key: 'counted_cents', label: 'Dinheiro contado', render: r => r.counted_cents == null ? '—' : money(r.counted_cents) },{ key: 'difference_cents', label: 'Diferença', render: r => r.difference_cents == null ? '—' : money(r.difference_cents) }]}/></Panel>
    {saleModal && <SaleComposer {...props} onClose={() => setSaleModal(false)} onCreated={refresh}/>}
    {modal && <Modal wide={modal === 'receive'} title={{ open:'Abrir caixa', adjust:'Sangria ou suprimento', close:'Conferir e fechar caixa', receive:'Registrar recebimento', refund:'Registrar devolução' }[modal]} onClose={() => { if (!busy) setModal(null) }}><form className="form-grid operations-ledger" onSubmit={save}>
      {modal === 'adjust' && <Field label="Tipo"><select value={kind} onChange={e => setKind(e.target.value)}><option value="withdrawal">Sangria · retirar dinheiro</option><option value="supply">Suprimento · colocar dinheiro</option></select></Field>}
      {['open','adjust','close'].includes(modal) && <Field label={modal === 'open' ? 'Fundo inicial em dinheiro (R$)' : modal === 'close' ? 'Dinheiro contado na gaveta (R$)' : 'Valor em dinheiro (R$)'}><input required type="number" min={modal === 'adjust' ? '0.01' : '0'} step="0.01" value={amount} onChange={e => setAmount(e.target.value)}/></Field>}
      {modal === 'close' && <div className="ops-total"><span>Esperado {money(expected)} · diferença da contagem</span><strong>{amount ? money(Math.round(Number(amount)*100)-expected) : '—'}</strong></div>}
      {modal === 'receive' && <><Field label="Comanda / atendimento"><select required value={source} onChange={e => { const p = pending.find(s => `${s.sourceType}:${s.id}` === e.target.value); setSource(e.target.value); setParts([{ method: 'pix', amount: p ? String(p.remaining/100) : '' }]) }}><option value="">Selecione</option>{pending.map(p => <option key={`${p.sourceType}:${p.id}`} value={`${p.sourceType}:${p.id}`}>{customer(p.client_id)} · {p.sourceType === 'sale' ? 'Comanda' : 'Atendimento'} · {money(p.remaining)}</option>)}</select></Field><Notice kind="info" text="Você pode dividir entre formas ou registrar um recebimento parcial. A comanda só será quitada quando o saldo inteiro for recebido."/>{parts.map((p,index) => <div className="ops-entry-line" key={index}><Field label={`Forma ${index+1}`}><select value={p.method} onChange={e => setParts(parts.map((row,i) => i === index ? { ...row, method: e.target.value } : row))}>{Object.entries(cashMethods).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></Field><Field label="Valor recebido (R$)"><input required type="number" min="0.01" step="0.01" value={p.amount} onChange={e => setParts(parts.map((row,i) => i === index ? { ...row, amount: e.target.value } : row))}/></Field><button type="button" className="icon-button" disabled={parts.length === 1} aria-label={`Remover forma ${index+1}`} onClick={() => setParts(parts.filter((_,i) => i !== index))}><X size={16}/></button></div>)}<button type="button" className="button outline" disabled={parts.length >= 8} onClick={() => setParts([...parts,{ method:'cash',amount:'' }])}><Plus size={16}/>Adicionar forma de pagamento</button><div className="ops-total"><span>Registrar {money(splitTotal)} · saldo após</span><strong>{selected ? money(selected.remaining-splitTotal) : '—'}</strong></div></>}
      {modal === 'refund' && <><Notice kind="info" text={`Devolução integral deste recebimento: ${money(refundPayment?.amount_cents)} em ${cashMethods[String(refundPayment?.method)]}. Confirme somente após devolver o valor ao cliente. Valores online são estornados no provedor.`}/>{Boolean(refundPayment?.sale_id) && <label className="check-field"><input type="checkbox" checked={restock} onChange={e => setRestock(e.target.checked)}/>Os produtos foram devolvidos: repor o estoque ao devolver o último pagamento da comanda</label>}</>}
      {modal !== 'receive' && <Field label={['adjust','refund'].includes(modal) ? 'Justificativa obrigatória' : 'Observações'}><textarea required={['adjust','refund'].includes(modal)} minLength={['adjust','refund'].includes(modal) ? 3 : undefined} maxLength={2000} value={notes} onChange={e => setNotes(e.target.value)}/></Field>}
      <Notice text={error}/><div className="form-actions"><button type="button" className="button ghost" disabled={busy} onClick={() => setModal(null)}>Cancelar</button><PrimaryButton type="submit" disabled={busy || (modal === 'receive' && (!selected || splitTotal <= 0 || splitTotal > selected.remaining))}>{busy ? 'Registrando…' : 'Confirmar registro'}</PrimaryButton></div>
    </form></Modal>}
    {receipt && <Modal title="Comprovante" subtitle="Comprovante interno · não é documento fiscal" onClose={() => setReceipt(null)}><section className="ops-print-receipt"><h2>{shop.name}</h2><p>{receipt.kind === 'refund' ? 'Comprovante de devolução' : 'Comprovante de recebimento'}</p><p>{shopDateTime(receipt.created_at,tz)}<br/>{customer(receiptPayment?.client_id)}</p><p>Referência: {receiptPayment?.sale_id ? `Comanda ${String(receiptPayment.sale_id).slice(0,8)}` : `Atendimento ${String(receiptPayment?.appointment_id || '').slice(0,8)}`}</p>{receiptSale && <ul>{saleItems.rows.filter(i => i.sale_id === receiptSale.id).map(i => <li key={i.id}>{String(i.quantity)}× {asText(i.description)} — {money(i.total_cents)}</li>)}</ul>}{receiptGroup.map(r => <p key={r.id}>{cashMethods[String(r.method)]}: <strong>{money(r.amount_cents)}</strong></p>)}<hr/><p>Total deste {receipt.kind === 'refund' ? 'estorno' : 'recebimento'}: <strong>{money(receiptGroup.reduce((sum,r) => sum + Number(r.amount_cents),0))}</strong></p><small>Comprovante interno, sem validade fiscal. Registro {receipt.id}.</small></section><div className="form-actions ops-no-print">{current && receiptPayment?.status === 'paid' && receipt.kind === 'receipt' && <button className="button outline" onClick={() => { setReceipt(null); open('refund',receiptPayment) }}>Devolver este recebimento</button>}<PrimaryButton onClick={() => window.print()}><Printer size={16}/>Imprimir / salvar PDF</PrimaryButton></div></Modal>}
    {sessionDetail && <Modal wide title="Conferência do caixa" subtitle={shopDateTime(sessionDetail.opened_at,tz)} onClose={() => setSessionDetail(null)}><div className="ops-money-grid"><Stat label="Fundo inicial" value={money(sessionDetail.opening_cents)}/><Stat label="Dinheiro esperado" value={sessionDetail.expected_cents == null ? 'Em aberto' : money(sessionDetail.expected_cents)}/><Stat label="Dinheiro contado" value={sessionDetail.counted_cents == null ? 'Em aberto' : money(sessionDetail.counted_cents)}/><Stat label="Diferença" value={sessionDetail.difference_cents == null ? 'Em aberto' : money(sessionDetail.difference_cents)}/></div><p>{asText(sessionDetail.notes)}</p><DataTable rows={movements.rows.filter(m => m.session_id === sessionDetail.id)} empty="Sem movimentos" columns={[{ key:'created_at',label:'Quando',render:r=>shopDateTime(r.created_at,tz) },{ key:'kind',label:'Tipo' },{ key:'method',label:'Forma',render:r=>cashMethods[String(r.method)] },{ key:'amount_cents',label:'Valor',render:r=>money(r.amount_cents) },{ key:'action',label:'Comprovante',render:r=>Boolean(r.payment_id) && <button className="button outline" onClick={()=>{ setSessionDetail(null); setReceipt(r) }}>Abrir</button> }]}/></Modal>}
  </div>
}
