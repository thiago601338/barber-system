import { useState, type FormEvent } from 'react'
import { CheckCheck, FileCheck, Percent, Plus } from 'lucide-react'
import type { PageProps } from '../App'
import { createRow, updateRow, useRows } from '../lib/useRows'
import { commissionStates, operation, safeAmount } from '../lib/operations'
import { shopDateKey, shopDateTime, shopMonthStart, shopToday } from '../lib/shopTime'
import { MonthQuickPick } from '../MonthRangeFilter'
import { asText, date, money, type Row } from '../types'
import { DataTable, Field, Modal, Notice, Panel, PrimaryButton, Stat } from '../ui'
import '../styles-operations-ledger.css'

export function CommissionsPage({ identity, role, notify }: PageProps) {
  const shop = identity.shop!
  const admin = role !== 'barber'
  const tz = shop.timezone || 'America/Sao_Paulo'
  const entries = useRows('commission_entries', shop.id)
  const closings = useRows('commission_closings', shop.id)
  const rules = useRows('commission_rules', shop.id, admin)
  const members = useRows('memberships', shop.id)
  const services = useRows('services', shop.id, admin)
  const products = useRows('products', shop.id, admin)
  const plans = useRows('subscription_plans', shop.id, admin)
  const [view, setView] = useState('statement')
  const [memberFilter, setMemberFilter] = useState('')
  const [stateFilter, setStateFilter] = useState('all')
  const [from, setFrom] = useState(shopMonthStart(tz))
  const [to, setTo] = useState(shopToday(tz))
  const [modal, setModal] = useState<'rule' | 'close' | 'review' | null>(null)
  const [ruleEditor, setRuleEditor] = useState<Row | null>(null)
  const [rule, setRule] = useState({ member: '', kind: 'service', item: '', mode: 'percent', rate: '', basis: '' })
  const [closingMember, setClosingMember] = useState('')
  const [reviewEntry, setReviewEntry] = useState<Row | null>(null)
  const [reviewMember, setReviewMember] = useState('')
  const [closingDetail, setClosingDetail] = useState<Row | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const allBarbers = members.rows.filter(m => m.role === 'barber')
  // Desativados continuam no histórico, mas saem das listas de escolha.
  const barbers = allBarbers.filter(m => m.active !== false)
  const professional = (id: unknown) => asText(allBarbers.find(m => m.id === id)?.display_name || (id === identity.membership?.id ? 'Você' : 'Sem atribuição'))
  const itemName = (kind: unknown, id: unknown) => id ? asText((kind === 'service' ? services.rows : kind === 'product' ? products.rows : plans.rows).find(i => i.id === id)?.name) : 'Todos desta categoria'
  const shown = entries.rows.filter(e => { const day = shopDateKey(new Date(String(e.earned_at)),tz); return (!memberFilter || e.barber_membership_id === memberFilter) && (stateFilter === 'all' || e.status === stateFilter) && day >= from && day <= to })
  const available = shown.filter(e => e.status === 'accrued').reduce((sum,e) => sum + Number(e.amount_cents || 0),0)
  const awaiting = shown.filter(e => e.status === 'awaiting_payment').reduce((sum,e) => sum + Number(e.amount_cents || 0),0)
  const reviewCount = shown.filter(e => e.status === 'review').length
  const activeRules = rules.rows.filter(r => r.active)
  const compatible = reviewEntry ? activeRules.filter(r => r.item_kind === reviewEntry.item_kind && (!r.barber_membership_id || r.barber_membership_id === reviewMember) && (!r.item_id || r.item_id === reviewEntry.item_id)).sort((a,b) => Number(Boolean(b.barber_membership_id))-Number(Boolean(a.barber_membership_id)) || Number(Boolean(b.item_id))-Number(Boolean(a.item_id)))[0] : null
  async function refresh() { await Promise.all([entries.refresh(), closings.refresh(), rules.refresh()]) }
  function editRule(row?: Row) {
    setError(null); setRuleEditor(row || null); setRule({ member: String(row?.barber_membership_id || ''), kind: String(row?.item_kind || 'service'), item: String(row?.item_id || ''), mode: String(row?.mode || 'percent'), rate: row ? String(Number(row.rate)/(row.mode === 'fixed' ? 100 : 1)) : '', basis: row?.subscription_basis_cents == null ? '' : String(Number(row.subscription_basis_cents)/100) }); setModal('rule')
  }
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null)
    try {
      if (modal === 'rule') {
        const rate = rule.mode === 'fixed' ? safeAmount(rule.rate, true) : Number(rule.rate)
        if (!Number.isFinite(rate) || rate < 0 || (rule.mode === 'percent' && rate > 100) || !rule.rate.trim()) throw new Error('Informe um percentual ou valor válido; zero deve ser informado explicitamente.')
        const values = { barber_membership_id: rule.member || null, item_kind: rule.kind, item_id: rule.item || null, mode: rule.mode, rate, subscription_basis_cents: rule.kind === 'subscription' && rule.mode === 'percent' ? safeAmount(rule.basis, true) : null, active: true }
        if (ruleEditor) await updateRow('commission_rules', ruleEditor.id, values)
        else await createRow('commission_rules', { ...values, barbershop_id: shop.id })
      }
      if (modal === 'close') await operation('commission_close', { p_shop: shop.id, p_member: closingMember, p_from: from, p_to: to })
      if (modal === 'review') await operation('commission_review', { p_shop: shop.id, p_entry: reviewEntry?.id, p_member: reviewMember })
      setModal(null); notify(modal === 'close' ? 'Extrato fechado. Nenhum repasse bancário foi executado.' : 'Configuração de comissão registrada.'); await refresh()
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Não foi possível registrar a comissão.') }
    finally { setBusy(false) }
  }
  async function deactivate(row: Row) {
    setBusy(true)
    try { await updateRow('commission_rules', row.id, { active:false }); notify('Regra desativada. Comissões já registradas mantêm a regra original.'); await rules.refresh() }
    catch (problem) { notify(problem instanceof Error ? problem.message : 'Não foi possível desativar.', 'error') }
    finally { setBusy(false) }
  }
  return <div className="operations-ledger page-stack">
    <div className="ops-toolbar"><div className="segmented">{[['statement','Extrato'],['closings','Fechamentos'],...(admin ? [['rules','Regras de comissão']] : [])].map(([key,label]) => <button key={key} className={view === key ? 'selected' : ''} onClick={() => setView(key)}>{label}</button>)}</div>{admin && <div className="ops-actions"><button className="button outline" onClick={() => editRule()}><Plus size={16}/>Nova regra</button><PrimaryButton onClick={() => { setError(null); setClosingMember(memberFilter || ''); setModal('close') }}><FileCheck size={16}/>Fechar extrato</PrimaryButton></div>}</div>
    <Notice text={entries.error || closings.error || rules.error || members.error || services.error || products.error || plans.error}/>
    <Notice kind="info" text="Comissões usam a regra salva no momento do lançamento. Recebimentos pendentes não são liberados; estornos geram ajustes negativos. Fechar o extrato registra a obrigação, sem transferir dinheiro."/>
    {view === 'statement' && <><Panel title="Filtrar extrato"><div className="ops-filter-grid"><Field label="De"><input type="date" required value={from} max={to} onChange={e => setFrom(e.target.value)}/></Field><Field label="Até"><input type="date" required value={to} min={from} onChange={e => setTo(e.target.value)}/></Field><MonthQuickPick from={from} to={to} timezone={tz} onPick={range => { setFrom(range.from); setTo(range.to) }}/>{admin && <Field label="Profissional"><select value={memberFilter} onChange={e => setMemberFilter(e.target.value)}><option value="">Todos / sem atribuição</option>{barbers.map(m => <option key={m.id} value={m.id}>{asText(m.display_name)}</option>)}</select></Field>}<Field label="Situação"><select value={stateFilter} onChange={e => setStateFilter(e.target.value)}><option value="all">Todas</option>{Object.entries(commissionStates).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></Field></div></Panel><div className="stats-grid"><Stat label="Disponível para fechamento" value={money(available)} icon={<Percent size={19}/>}/><Stat label="Aguardando recebimento" value={money(awaiting)}/><Stat label="Lançamentos para revisar" value={reviewCount} foot="Sem valor presumido até definir regra e profissional"/></div><Panel title={admin ? 'Comissões da equipe' : 'Seu extrato'} subtitle="Produtos: por unidade ou percentual do valor vendido. Serviços: percentual sobre o valor do atendimento rateado pelos serviços. Clube: base por visita definida pela administração."><DataTable rows={shown} empty="Nenhuma comissão neste filtro" columns={[{ key:'earned_at',label:'Quando',render:r=>shopDateTime(r.earned_at,tz) },...(admin ? [{ key:'barber_membership_id',label:'Profissional',render:(r:Row)=>professional(r.barber_membership_id) }] : []),{ key:'description',label:'Origem' },{ key:'quantity',label:'Quantidade' },{ key:'base_cents',label:'Base',render:r=>money(r.base_cents) },{ key:'amount_cents',label:'Comissão',render:r=>r.amount_cents == null ? 'Pendente de regra' : money(r.amount_cents) },{ key:'status',label:'Situação',render:r=>commissionStates[String(r.status)] },...(admin ? [{ key:'action',label:'Revisão',render:(r:Row)=>r.status === 'review' && <button className="button outline" onClick={()=>{ setReviewEntry(r); setReviewMember(String(r.barber_membership_id || '')); setError(null); setModal('review') }}>Revisar</button> }] : [])]}/></Panel></>}
    {view === 'rules' && admin && <Panel title="Regras configuradas" subtitle="A regra específica do profissional tem prioridade; depois, a regra do item. Uma regra nova vale para novos lançamentos, e as pendências precisam de revisão explícita."><DataTable rows={rules.rows} empty="Nenhuma regra cadastrada" columns={[{ key:'barber_membership_id',label:'Profissional',render:r=>r.barber_membership_id ? professional(r.barber_membership_id) : 'Todos' },{ key:'item_kind',label:'Categoria',render:r=>({ service:'Serviços',product:'Produtos',subscription:'Assinaturas' }[String(r.item_kind)]) },{ key:'item_id',label:'Item',render:r=>itemName(r.item_kind,r.item_id) },{ key:'rate',label:'Regra',render:r=>r.mode === 'fixed' ? `${money(r.rate)} por ${r.item_kind === 'subscription' ? 'visita' : 'unidade'}` : `${String(r.rate)}%${r.item_kind === 'subscription' ? ` de ${money(r.subscription_basis_cents)} por visita` : ''}` },{ key:'active',label:'Status',render:r=>r.active ? 'Ativa' : 'Inativa' },{ key:'action',label:'Ações',render:r=><div className="ops-actions"><button className="button outline" disabled={busy} onClick={()=>editRule(r)}>Editar</button>{Boolean(r.active) && <button className="button ghost" disabled={busy} onClick={()=>void deactivate(r)}>Desativar</button>}</div> }]}/></Panel>}
    {view === 'closings' && <Panel title="Fechamentos do extrato" subtitle="Abra um fechamento para conferir seus lançamentos e a regra usada."><DataTable rows={closings.rows} empty="Nenhum extrato fechado" onRowClick={setClosingDetail} columns={[{ key:'created_at',label:'Fechado em',render:r=>shopDateTime(r.created_at,tz) },{ key:'barber_membership_id',label:'Profissional',render:r=>professional(r.barber_membership_id) },{ key:'period_from',label:'Período',render:r=>`${date(r.period_from)} a ${date(r.period_to)}` },{ key:'total_cents',label:'Valor do extrato',render:r=>money(r.total_cents) }]}/></Panel>}
    {modal && <Modal title={modal === 'rule' ? ruleEditor ? 'Editar regra' : 'Nova regra de comissão' : modal === 'close' ? 'Fechar extrato' : 'Revisar comissão'} onClose={()=>{ if (!busy) setModal(null) }}><form className="form-grid operations-ledger" onSubmit={save}>
      {modal === 'rule' && <><Field label="Profissional"><select value={rule.member} onChange={e=>setRule({ ...rule,member:e.target.value })}><option value="">Todos os profissionais</option>{barbers.filter(m=>m.active || m.id === rule.member).map(m=><option key={m.id} value={m.id}>{asText(m.display_name)}</option>)}</select></Field><Field label="Categoria"><select value={rule.kind} onChange={e=>setRule({ ...rule,kind:e.target.value,item:'',basis:'',rate:'' })}><option value="service">Serviço</option><option value="product">Produto</option><option value="subscription">Assinatura · por visita concluída</option></select></Field><Field label="Aplicar a"><select value={rule.item} onChange={e=>setRule({ ...rule,item:e.target.value })}><option value="">Todos desta categoria</option>{(rule.kind === 'service' ? services.rows : rule.kind === 'product' ? products.rows : plans.rows).map(i=><option key={i.id} value={i.id}>{asText(i.name)}</option>)}</select></Field><Field label="Como calcular"><select value={rule.mode} onChange={e=>setRule({ ...rule,mode:e.target.value,rate:'' })}><option value="percent">Percentual</option><option value="fixed">Valor fixo por unidade / visita</option></select></Field><Field label={rule.mode === 'percent' ? 'Percentual (%)' : 'Comissão por unidade / visita (R$)'}><input required type="number" min="0" max={rule.mode === 'percent' ? '100' : undefined} step={rule.mode === 'percent' ? '0.001' : '0.01'} value={rule.rate} onChange={e=>setRule({ ...rule,rate:e.target.value })}/></Field>{rule.kind === 'subscription' && rule.mode === 'percent' && <Field label="Base de comissão por visita da assinatura (R$)" hint="Defina a base contratada com a equipe. Não usamos o preço cheio do serviço nem dividimos o plano automaticamente."><input required type="number" min="0" step="0.01" value={rule.basis} onChange={e=>setRule({ ...rule,basis:e.target.value })}/></Field>}</>}
      {modal === 'close' && <><Field label="Profissional"><select required value={closingMember} onChange={e=>setClosingMember(e.target.value)}><option value="">Selecione</option>{allBarbers.filter(m => m.active !== false || entries.rows.some(e => e.barber_membership_id === m.id && e.status === 'accrued')).map(m=><option key={m.id} value={m.id}>{asText(m.display_name)}</option>)}</select></Field><div className="form-row"><Field label="De"><input required type="date" value={from} max={to} onChange={e=>setFrom(e.target.value)}/></Field><Field label="Até"><input required type="date" min={from} value={to} onChange={e=>setTo(e.target.value)}/></Field></div><Notice kind="info" text="Somente valores disponíveis são incluídos. Lançamentos sem regra desse profissional bloqueiam o fechamento. Este registro não faz transferência ou pagamento bancário."/></>}
      {modal === 'review' && reviewEntry && <><p>{asText(reviewEntry.description)} · base original {money(reviewEntry.base_cents)}</p><Field label="Profissional que deve receber"><select required value={reviewMember} onChange={e=>setReviewMember(e.target.value)}><option value="">Selecione</option>{barbers.map(m=><option key={m.id} value={m.id}>{asText(m.display_name)}</option>)}</select></Field><Notice kind={compatible ? 'info' : 'error'} text={compatible ? `Regra que será salva: ${compatible.mode === 'fixed' ? money(compatible.rate)+' por unidade / visita' : String(compatible.rate)+'%'+(reviewEntry.item_kind === 'subscription' ? ' de '+money(compatible.subscription_basis_cents)+' por visita' : ' sobre a base do lançamento')}. A regra atual será aplicada somente após sua confirmação.` : 'Não há regra compatível. Cadastre a regra antes de revisar este lançamento.'}/></>}
      <Notice text={error}/><div className="form-actions"><button type="button" className="button ghost" disabled={busy} onClick={()=>setModal(null)}>Cancelar</button><PrimaryButton type="submit" disabled={busy || (modal === 'review' && (!compatible || !reviewMember))}><CheckCheck size={16}/>{busy ? 'Registrando…' : modal === 'close' ? 'Confirmar fechamento' : 'Salvar configuração'}</PrimaryButton></div></form></Modal>}
    {closingDetail && <Modal wide title={`Extrato · ${professional(closingDetail.barber_membership_id)}`} subtitle={`${date(closingDetail.period_from)} a ${date(closingDetail.period_to)} · ${money(closingDetail.total_cents)}`} onClose={()=>setClosingDetail(null)}><DataTable rows={entries.rows.filter(e=>e.closing_id === closingDetail.id)} empty="Nenhum lançamento" columns={[{ key:'earned_at',label:'Data',render:r=>shopDateTime(r.earned_at,tz) },{ key:'description',label:'Origem' },{ key:'amount_cents',label:'Comissão',render:r=>money(r.amount_cents) },{ key:'rule_snapshot',label:'Regra registrada',render:r=>{ const s = r.rule_snapshot as Record<string,unknown>; return s?.mode === 'fixed' ? money(s.rate)+' / unidade' : s?.mode === 'percent' ? String(s.rate)+'%' : '—' } }]}/></Modal>}
  </div>
}
