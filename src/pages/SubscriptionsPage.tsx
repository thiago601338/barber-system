import { useEffect, useState, type FormEvent } from 'react'
import { LegacyCashbarber } from '../LegacyCashbarber'
import { SubscriptionHealthPanel } from '../SubscriptionHealthPanel'
import { SubscriptionCalendar } from './SubscriptionCalendar'
import { InviteLinkModal } from './SubscriptionInvite'
import { CreditCard, Landmark, Link2, Plus, TrendingUp } from 'lucide-react'
import type { PageProps } from '../App'
import { authedApi, authedGet, requireSupabase } from '../lib/supabase'
import { createRow, updateRow, useRows } from '../lib/useRows'
import { asText, cents, date, money, type Row } from '../types'
import { AddButton, DataTable, Field, Modal, Notice, PageHeader, Panel, PrimaryButton, Stat, Status } from '../ui'

interface ContractSnapshot {
  plan_name: string; description: string | null; captured_at: string
  price_cents: number; frequency_months: number; visits_per_cycle: number
  services: { id: string; name: string; duration_minutes: number }[]
}
function snapshot(row: Row): ContractSnapshot | null {
  return row.contract_snapshot && typeof row.contract_snapshot === 'object'
    ? row.contract_snapshot as ContractSnapshot : null
}
function ContractTerms({ row }: { row: Row }) {
  const terms = snapshot(row)
  if (!terms || row.contract_review_required) return <Notice kind="info" text="As condições originais deste contrato ainda precisam ser comprovadas. O plano atual não substitui o preço nem os benefícios contratados no passado."/>
  return <section className="subscription-contract-terms"><h3>Condições contratadas</h3><p><strong>{money(terms.price_cents)}</strong> a cada {terms.frequency_months} mês(es), com {terms.visits_per_cycle} visitas por ciclo.</p>{terms.description && <p>{terms.description}</p>}<ul>{terms.services.map(service => <li key={service.id}>{service.name} · {service.duration_minutes} min</li>)}</ul><small>Registradas em {date(terms.captured_at)}. Alterações do catálogo não mudam este contrato.</small></section>
}

export function SubscriptionsPage({ identity, role, notify }: PageProps) {
  const shopId = identity.shop?.id ?? null
  const admin=role==='admin'||role==='master'
  const [tab, setTab] = useState<'health'|'contracts'|'plans'|'receivables'|'overdue'|'legacy'>(admin?'health':'contracts')
  const [overview,setOverview]=useState<{active:number;legacy_active:number;received_cents:number}|null>(null)
  const [overviewRevision, setOverviewRevision] = useState(0)
  useEffect(()=>{let cancelled=false;setOverview(null);if(shopId&&admin)void requireSupabase().rpc('subscription_overview',{p_barbershop_id:shopId}).then(({data,error})=>{if(!cancelled&&!error)setOverview(data)});return()=>{cancelled=true}},[shopId,admin,overviewRevision])
  const plans = useRows('subscription_plans', shopId)
  const covered = useRows('subscription_plan_services', shopId, true, null)
  const services = useRows('services', shopId)
  const subscriptions = useRows('subscriptions', shopId)
  const [selected, setSelected] = useState<Row | null>(null)
  const [contractFilter, setContractFilter] = useState('all')
  const [cancelMode, setCancelMode] = useState<'schedule' | 'now' | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  // Uso do ciclo: só os atendimentos de plano desde o início do ciclo aberto mais antigo.
  // Carregar a agenda inteira deixava a coluna em "Calculando..." por mais de um minuto.
  const cycleStart = subscriptions.rows
    .filter(row => ['pending','authorized','active','past_due','paused'].includes(String(row.status)) && row.current_period_start)
    .map(row => String(row.current_period_start))
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0] || null
  const usageNeeded = Boolean(cycleStart) && (tab === 'contracts' || !!selected)
  const appointments = useRows('appointments', shopId, usageNeeded, 'starts_at', cycleStart ? { 'starts_at>=': cycleStart, 'subscription_id!null': '' } : {})
  const clients = useRows('clients', shopId)
  const payments = useRows('payments', shopId, !admin)
  const [planModal, setPlanModal] = useState<Row | 'new' | null>(null)
  const [planForm, setPlanForm] = useState({ name: '', description: '', price: '', frequency_months: '1', visits_per_cycle: '4', active: true })
  const [coveredIds, setCoveredIds] = useState<string[]>([])
  const [startModal, setStartModal] = useState(false)
  const [inviteModal, setInviteModal] = useState(false)
  const [clientId, setClientId] = useState('')
  const [planId, setPlanId] = useState('')
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!selected) return
    const latest = subscriptions.rows.find(row => row.id === selected.id)
    if (latest && latest !== selected) setSelected(latest)
  }, [subscriptions.rows, selected])
  const selectedId = selected?.id
  useEffect(() => { setCancelMode(null); setCancelReason('') }, [selectedId])
  const paid = payments.rows.filter(p => p.status === 'paid' && p.subscription_id)
  const overdue = subscriptions.rows.filter(s => s.status === 'past_due')
  const live = (row: Row) => ['pending','authorized','active','past_due','paused'].includes(String(row.status))
  const ending = (row: Row) => Boolean(row.cancel_at_period_end) && live(row)
  const online = (row: Row) => row.provider === 'mercadopago' && Boolean(row.provider_subscription_id)
  const contractGroups: Record<string, (row: Row) => boolean> = {
    all: () => true,
    ok: row => ['active','authorized'].includes(String(row.status)) && !ending(row),
    pending: row => row.status === 'pending',
    ending,
    overdue: row => row.status === 'past_due',
    closed: row => !live(row),
  }
  const shownContracts = subscriptions.rows.filter(contractGroups[contractFilter] || contractGroups.all)
  async function changeCancellation(row: Row, mode: 'schedule' | 'unschedule' | 'now') {
    if (!shopId) return
    setBusy(true); setError(null)
    try {
      const result = await requireSupabase().rpc('manage_subscription_cancellation', { p_barbershop_id: shopId, p_subscription_id: row.id, p_mode: mode, p_reason: cancelReason.trim() || null })
      if (result.error) throw result.error
      const state = result.data as { status: string; cancel_at_period_end: boolean }
      notify(mode === 'unschedule' ? 'Pré-cancelamento desfeito. O contrato segue normalmente.' : state.status === 'cancelled' ? 'Contrato encerrado.' : 'Pré-cancelamento registrado: o contrato encerra ao fim do ciclo pago.')
      setCancelMode(null); setCancelReason('')
      if (state.status === 'cancelled') setSelected(null)
      await subscriptions.refresh(); setOverviewRevision(previous => previous + 1)
    } catch (err) { setError(err instanceof Error ? err.message : String((err as { message?: string })?.message || 'Não foi possível atualizar o contrato.')) }
    finally { setBusy(false) }
  }
  function contractName(row: Row) { return snapshot(row)?.plan_name ?? asText(plans.rows.find(plan => plan.id === row.plan_id)?.name) }
  function editPlan(row?: Row) { if (!admin) return; setPlanModal(row || 'new'); setError(null); setCoveredIds(row ? covered.rows.filter(item => item.plan_id === row.id).map(item => String(item.service_id)) : []); setPlanForm(row ? { name: String(row.name || ''), description: String(row.description || ''), price: String(Number(row.price_cents || 0)/100), frequency_months: String(row.frequency_months || 1), visits_per_cycle: String(row.visits_per_cycle || 4), active: Boolean(row.active) } : { name: '', description: '', price: '', frequency_months: '1', visits_per_cycle: '4', active: true }) }
  async function savePlan(event: FormEvent) {
    event.preventDefault(); if (!shopId || !planModal || !admin) return
    if (!coveredIds.length) { setError('Selecione ao menos um serviço coberto pelo plano.'); return }
    setBusy(true); setError(null)
    try {
      const values = { name: planForm.name.trim(), description: planForm.description.trim() || null, price_cents: cents(planForm.price), frequency_months: Number(planForm.frequency_months), visits_per_cycle: Number(planForm.visits_per_cycle) }
      let plan: Row
      if (planModal === 'new') plan = await createRow('subscription_plans', { ...values, active: false, barbershop_id: shopId })
      else plan = await updateRow('subscription_plans', planModal.id, { ...values, ...(!planForm.active ? { active: false } : {}) })
      // Coverage is saved separately; retain the new plan on failure instead of inserting it again on retry.
      if (planModal === 'new') setPlanModal(plan)
      const previous = covered.rows.filter(item => item.plan_id === plan.id).map(item => String(item.service_id)).sort()
      if (JSON.stringify(previous) !== JSON.stringify([...coveredIds].sort())) {
        const result = await requireSupabase().rpc('save_subscription_plan_services', { p_barbershop_id: shopId, p_plan_id: plan.id, p_service_ids: coveredIds })
        if (result.error) throw result.error
      }
      if (Boolean(plan.active) !== planForm.active) await updateRow('subscription_plans', plan.id, { active: planForm.active })
      notify('Plano e serviços cobertos salvos.'); setPlanModal(null); await Promise.all([plans.refresh(),covered.refresh()])
    } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao salvar plano. O plano novo permanece inativo até concluir.') }
    finally { setBusy(false) }
  }
  async function startSubscription(event: FormEvent) { event.preventDefault(); if (!shopId) return; setBusy(true); setError(null); setCheckoutUrl(null); try { const result = await authedApi<{ subscription_id: string; status: string; checkout_url: string | null }>('/api/mercadopago/subscription-start', { barbershop_id: shopId, client_id: clientId, plan_id: planId }); setCheckoutUrl(result.checkout_url); notify('Assinatura solicitada. Aguarde confirmação do pagamento.'); await subscriptions.refresh(); setOverviewRevision(previous => previous + 1) } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível iniciar a assinatura.') } finally { setBusy(false) } }
  async function verifySubscription(row: Row) { setBusy(true); setError(null); try { const result = await authedGet<{ status: string }>(`/api/mercadopago/subscription-status?subscription_id=${encodeURIComponent(row.id)}`); notify(`Situação no provedor: ${result.status}.`); await subscriptions.refresh(); setOverviewRevision(previous => previous + 1) } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível verificar o contrato.') } finally { setBusy(false) } }
  async function cancelSubscription(row: Row) { if (!window.confirm('Cancelar esta assinatura recorrente no Mercado Pago?')) return; setBusy(true); setError(null); try { const result = await authedApi<{ status: string }>('/api/mercadopago/subscription-cancel', { subscription_id: row.id }); notify(`Assinatura atualizada: ${result.status}.`); setSelected(null); await subscriptions.refresh(); setOverviewRevision(previous => previous + 1) } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível cancelar a assinatura.') } finally { setBusy(false) } }
  function usageText(row: Row) {
    if (appointments.error) return 'Indisponível'
    if (subscriptions.loading || appointments.loading) return 'Calculando...'
    const terms = row.contract_snapshot as { visits_per_cycle?: number } | null
    if (row.contract_review_required || !terms) return 'Revisar condições originais'
    // Contrato sem ciclo aberto, ou com ciclo anterior ao período carregado: não há uso corrente a mostrar.
    if (!cycleStart || !row.current_period_start || new Date(String(row.current_period_start)).getTime() < new Date(cycleStart).getTime()) return '—'
    const start = new Date(String(row.current_period_start)).getTime()
    const end = row.current_period_end ? new Date(String(row.current_period_end)).getTime() : Infinity
    // Cada atendimento de plano que não foi cancelado nem virou falta ocupa uma visita do ciclo.
    const used = appointments.rows.filter(appointment => {
      if (appointment.subscription_id !== row.id || ['cancelled','no_show'].includes(String(appointment.status))) return false
      const when = new Date(String(appointment.starts_at)).getTime()
      return when >= start && when < end
    }).length
    return `${used} / ${asText(terms.visits_per_cycle)}`
  }
  return <div className="page-stack"><PageHeader eyebrow="RECORRÊNCIA" title="Assinaturas" description="Planos, contratos, calendário de recebíveis e inadimplência de clientes." action={admin && <div className="button-row"><button className="button outline" onClick={() => setInviteModal(true)}><Link2 size={16}/> Link de convite</button><button className="button outline" onClick={() => { setStartModal(true); setCheckoutUrl(null); setError(null) }} data-tour-action="subscription-start"><Plus size={16}/> Nova assinatura</button><AddButton onClick={() => editPlan()} data-tour-action="subscription-create-plan">Novo plano</AddButton></div>}/><div className="stats-grid three"><Stat label="Planos para novas assinaturas" value={plans.rows.filter(p => p.active).length} foot="Serviços cobertos definidos" icon={<CreditCard size={19}/>}/><Stat label="Contratos ativos" value={overview?.active ?? subscriptions.rows.filter(s => ['active','authorized'].includes(String(s.status))).length} foot={overview?.legacy_active?`${overview.legacy_active} ativos na origem`:'Confirmados pelo provedor'} icon={<TrendingUp size={19}/>}/><Stat label="Recebido em assinaturas" value={money(overview?.received_cents ?? paid.reduce((sum,p) => sum + Number(p.amount_cents || 0),0))} foot="Pagamentos confirmados" icon={<Landmark size={19}/>} /></div><Notice text={error || plans.error || covered.error || subscriptions.error || appointments.error}/><div className="segmented">{admin && <button className={tab==='health'?'selected':''} onClick={()=>setTab('health')}>Saúde dos planos</button>}{(role==='admin'||role==='master') && <button className={tab==='legacy'?'selected':''} onClick={()=>setTab('legacy')}>Histórico Cashbarber</button>}<button className={tab === 'contracts' ? 'selected' : ''} onClick={() => setTab('contracts')}>Contratos</button><button className={tab === 'plans' ? 'selected' : ''} onClick={() => setTab('plans')}>Planos</button><button className={tab === 'receivables' ? 'selected' : ''} onClick={() => setTab('receivables')}>Calendário e recebíveis</button><button className={tab === 'overdue' ? 'selected' : ''} onClick={() => setTab('overdue')}>Inadimplentes ({overdue.length})</button></div>{tab==='health' && shopId && admin && <SubscriptionHealthPanel shopId={shopId} timezone={identity.shop?.timezone || 'America/Sao_Paulo'} revision={overviewRevision} onInspect={row => setSelected(subscriptions.rows.find(s => s.id === row.id) ?? row)} onVerify={async row => { await verifySubscription(subscriptions.rows.find(s => s.id === row.id) ?? row) }}/>} {tab==='legacy' && shopId && (role==='admin'||role==='master') && <LegacyCashbarber shopId={shopId}/>} {tab === 'plans' && <Panel title="Planos da barbearia" subtitle="Valores, frequência e serviços cobertos"><DataTable rows={plans.rows} empty="Nenhum plano cadastrado" onRowClick={admin ? editPlan : undefined} columns={[{ key: 'name', label: 'Plano' }, { key: 'price_cents', label: 'Valor', render: row => money(row.price_cents) }, { key: 'frequency_months', label: 'Ciclo', render: row => `${row.frequency_months} mês(es)` }, { key: 'visits_per_cycle', label: 'Visitas' }, { key: 'id', label: 'Serviços', render: row => covered.rows.filter(item => item.plan_id === row.id).length }, { key: 'active', label: 'Status', render: row => <Status value={row.active ? 'active' : 'paused'}/> }]} /></Panel>}{tab === 'contracts' && <Panel title="Contratos de clientes" subtitle={`${shownContracts.length} contrato(s) neste filtro`} action={<select className="panel-select" aria-label="Filtrar contratos" value={contractFilter} onChange={e => setContractFilter(e.target.value)}><option value="all">Todos os contratos</option><option value="ok">Em dia</option><option value="pending">Aguardando 1º pagamento</option><option value="ending">Pré-cancelados</option><option value="overdue">Em atraso</option><option value="closed">Encerrados</option></select>}><DataTable rows={shownContracts} empty="Nenhum contrato neste filtro" onRowClick={row => { setSelected(row); setCancelMode(null); setCancelReason(''); setError(null) }} columns={[{ key: 'client_id', label: 'Cliente', render: row => asText(clients.rows.find(c => c.id === row.client_id)?.full_name) }, { key: 'plan_id', label: 'Plano', render: row => contractName(row) }, { key: 'status', label: 'Status', render: row => ending(row) ? <Status value="ending"/> : <Status value={row.status}/> }, { key: 'current_period_end', label: 'Próximo ciclo', render: row => ending(row) ? `Encerra em ${date(row.current_period_end)}` : date(row.current_period_end) }, { key: 'id', label: 'Uso', render: usageText }]} /><p className="panel-footnote">A chave Pix informativa da barbearia não confirma cobrança. O status ativo depende do provedor.</p></Panel>}{tab === 'receivables' && shopId && <SubscriptionCalendar shopId={shopId} shopName={identity.shop?.name || 'barbearia'} timezone={identity.shop?.timezone || 'America/Sao_Paulo'} admin={admin} revision={overviewRevision} onInspect={id => { const row = subscriptions.rows.find(item => item.id === id); if (row) { setSelected(row); setCancelMode(null); setCancelReason(''); setError(null) } }}/>}{tab === 'overdue' && <Panel title="Contratos inadimplentes" subtitle="Assinaturas marcadas como pagamento em atraso"><DataTable rows={overdue} empty="Nenhum contrato em atraso" onRowClick={setSelected} columns={[{ key: 'client_id', label: 'Cliente', render: row => asText(clients.rows.find(c => c.id === row.client_id)?.full_name) }, { key: 'plan_id', label: 'Plano', render: row => contractName(row) }, { key: 'current_period_end', label: 'Ciclo', render: row => date(row.current_period_end) }, { key: 'status', label: 'Status', render: row => <Status value={row.status}/> }]} /></Panel>}{planModal && <Modal title={planModal === 'new' ? 'Novo plano' : 'Editar plano'} onClose={() => setPlanModal(null)} wide><form className="form-grid" onSubmit={savePlan} data-tour-form="subscription-create-plan"><Field label="Nome do plano"><input required value={planForm.name} onChange={e => setPlanForm({ ...planForm, name: e.target.value })}/></Field><Field label="Descrição"><textarea rows={2} value={planForm.description} onChange={e => setPlanForm({ ...planForm, description: e.target.value })}/></Field><div className="form-row"><Field label="Valor por ciclo (R$)"><input type="number" min="0.01" step="0.01" required value={planForm.price} onChange={e => setPlanForm({ ...planForm, price: e.target.value })}/></Field><Field label="A cada (meses)"><input type="number" min="1" max="12" required value={planForm.frequency_months} onChange={e => setPlanForm({ ...planForm, frequency_months: e.target.value })}/></Field></div><Field label="Visitas por ciclo"><input type="number" min="1" max="100" required value={planForm.visits_per_cycle} onChange={e => setPlanForm({ ...planForm, visits_per_cycle: e.target.value })}/></Field><Field label="Serviços cobertos"><div className="choice-grid">{services.rows.filter(row => row.active).map(row => <label className={`choice-card ${coveredIds.includes(row.id) ? 'selected' : ''}`} key={row.id}><input type="checkbox" checked={coveredIds.includes(row.id)} onChange={e => setCoveredIds(e.target.checked ? [...coveredIds,row.id] : coveredIds.filter(id => id !== row.id))}/><span><strong>{asText(row.name)}</strong><small>{money(row.price_cents)}</small></span></label>)}</div></Field><label className="check-field"><input type="checkbox" checked={planForm.active} onChange={e => setPlanForm({ ...planForm, active: e.target.checked })}/> Plano ativo</label><Notice text={error}/><div className="form-actions"><button type="button" className="button ghost" onClick={() => setPlanModal(null)}>Cancelar</button><PrimaryButton type="submit" disabled={busy}>{busy ? 'Salvando...' : 'Salvar plano'}</PrimaryButton></div></form></Modal>}{inviteModal && identity.shop && <InviteLinkModal shop={identity.shop} plans={plans.rows} onClose={() => setInviteModal(false)} notify={notify}/>}{startModal && <Modal title="Nova assinatura" subtitle="O cliente precisa concluir a autorização no checkout do Mercado Pago." onClose={() => setStartModal(false)}><form className="form-grid" onSubmit={startSubscription} data-tour-form="subscription-start"><Field label="Cliente"><select required value={clientId} onChange={e => setClientId(e.target.value)}><option value="">Selecione</option>{clients.rows.map(row => <option key={row.id} value={row.id}>{asText(row.full_name)}{row.email ? ` — ${row.email}` : ''}</option>)}</select></Field><Field label="Plano"><select required value={planId} onChange={e => setPlanId(e.target.value)}><option value="">Selecione</option>{plans.rows.filter(row => row.active).map(row => <option key={row.id} value={row.id}>{asText(row.name)} — {money(row.price_cents)}</option>)}</select></Field><Notice text={error}/>{checkoutUrl && <div className="notice success"><span>Assinatura iniciada. O status permanece pendente até confirmação. <a href={checkoutUrl} target="_blank" rel="noreferrer">Abrir checkout do cliente</a>.</span></div>}<div className="form-actions"><button type="button" className="button ghost" onClick={() => setStartModal(false)}>Fechar</button><PrimaryButton type="submit" disabled={busy || !clientId || !planId || !!checkoutUrl}>{busy ? 'Iniciando...' : 'Gerar checkout'}</PrimaryButton></div></form></Modal>}{selected && <Modal title="Contrato de assinatura" onClose={() => setSelected(null)}><div className="detail-list"><div><span>Cliente</span><strong>{asText(clients.rows.find(c => c.id === selected.client_id)?.full_name)}</strong></div><div><span>Plano</span><strong>{contractName(selected)}</strong></div><div><span>Situação</span>{ending(selected) ? <Status value="ending"/> : <Status value={selected.status}/>}</div><div><span>Usos do ciclo</span><strong>{usageText(selected)}</strong></div><div><span>Próximo ciclo</span><strong>{date(selected.current_period_end)}</strong></div>{ending(selected) && <div><span>Encerramento</span><strong>Programado para {date(selected.current_period_end)}{selected.cancel_reason ? ` · ${String(selected.cancel_reason)}` : ''}</strong></div>}</div><ContractTerms row={selected}/><Notice text={error}/>{admin && online(selected) && <div className="form-actions"><button className="button outline" disabled={busy} onClick={() => void verifySubscription(selected)}>Consultar provedor</button>{selected.status !== 'cancelled' && <button className="button danger-text" disabled={busy} onClick={() => void cancelSubscription(selected)}>Cancelar recorrência</button>}</div>}{admin && !online(selected) && live(selected) && (cancelMode ? <form className="form-grid contract-cancel-form" onSubmit={event => { event.preventDefault(); void changeCancellation(selected, cancelMode) }}><p className="muted">{cancelMode === 'schedule' ? `O cliente continua usando o plano até ${date(selected.current_period_end)}. Depois dessa data o contrato é encerrado sozinho e não entra na inadimplência.` : 'O contrato é encerrado agora e o cliente deixa de ter os benefícios do plano.'}</p><Field label="Motivo (opcional)"><input maxLength={500} value={cancelReason} onChange={event => setCancelReason(event.target.value)} placeholder="Ex.: mudou de cidade"/></Field><div className="form-actions"><button type="button" className="button ghost" disabled={busy} onClick={() => setCancelMode(null)}>Voltar</button><PrimaryButton type="submit" disabled={busy}>{busy ? 'Salvando...' : cancelMode === 'schedule' ? 'Confirmar pré-cancelamento' : 'Encerrar contrato'}</PrimaryButton></div></form> : <div className="form-actions">{ending(selected) ? <button className="button outline" disabled={busy} onClick={() => void changeCancellation(selected, 'unschedule')}>Manter assinatura</button> : <button className="button outline" disabled={busy || !selected.current_period_end || new Date(String(selected.current_period_end)).getTime() <= Date.now()} title="Encerra ao fim do ciclo já pago" onClick={() => { setCancelMode('schedule'); setError(null) }}>Pré-cancelar</button>}<button className="button danger-text" disabled={busy} onClick={() => { setCancelMode('now'); setError(null) }}>Cancelar agora</button></div>)}</Modal>}</div>
}
