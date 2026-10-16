import { useEffect, useState, type FormEvent } from 'react'
import { Award, CheckCheck, Gift, Plus, UsersRound } from 'lucide-react'
import type { PageProps } from '../App'
import { createRow, updateRow, useRows } from '../lib/useRows'
import { errorMessage } from '../lib/errorMessage'
import { operation, safeAmount } from '../lib/operations'
import { shopDateTime } from '../lib/shopTime'
import { asText, type Row } from '../types'
import { DataTable, Field, Loading, Modal, Notice, Panel, PrimaryButton, Stat } from '../ui'
import '../styles-operations-ledger.css'

export interface LoyaltySummary {
 enabled:boolean;balance_points:number;earned_points:number;referral_code:string|null;referral_count:number;
 tier:{name:string;min_points:number}|null;next_tier:{name:string;min_points:number}|null;
 rewards:(Row & {name:string;description:string|null;points_cost:number;valid_days:number})[];
 ledger:(Row & {points_delta:number;reason:string;created_at:string})[];
 redemptions:(Row & {reward_snapshot:Record<string,unknown>;status:string;expires_at:string;created_at:string})[];
}
const loyaltyReasons:Record<string,string>={appointment:'Atendimento pago e concluído',referral:'Indicação qualificada',refund:'Estorno do recebimento',redeem:'Pontos reservados para benefício',redeem_cancel:'Pontos devolvidos'}
const redemptionStates:Record<string,string>={requested:'Aguardando retirada',fulfilled:'Entregue',cancelled:'Cancelado',expired:'Expirado · pontos devolvidos'}
const initialPolicy={enabled:false,points_per_real:'0',points_per_visit:'0',referrer_points:'0',referee_points:'0',max_per_appointment:'0',daily_cap:'0',refund_policy:'full'}
export function LoyaltyPanel({ identity,role,notify,clientId }: PageProps & {clientId?:string}) {
 const shop=identity.shop!
 const tz=shop.timezone || 'America/Sao_Paulo'
 const admin=role !== 'barber'
 const config=admin && !clientId
 const settings=useRows('loyalty_settings',shop.id,config)
 const rewards=useRows('loyalty_rewards',shop.id,config)
 const tiers=useRows('loyalty_tiers',shop.id,config)
 const allRedemptions=useRows('loyalty_redemptions',shop.id,config)
 const clients=useRows('clients',shop.id,!clientId)
 const products=useRows('products',shop.id,admin)
 const [view,setView]=useState('wallet')
 const [walletClient,setWalletClient]=useState(clientId || '')
 const [summary,setSummary]=useState<LoyaltySummary|null>(null)
 const [loading,setLoading]=useState(false)
 const [revision,setRevision]=useState(0)
 const [policy,setPolicy]=useState(initialPolicy)
 const [modal,setModal]=useState<'reward'|'tier'|'redeem'|'referral'|'fulfill'|'cancel'|null>(null)
 const [editor,setEditor]=useState<Row|null>(null)
 const [reward,setReward]=useState({name:'',description:'',points:'',days:'',max:'',product:'',quantity:'1',active:false})
 const [tier,setTier]=useState({name:'',description:'',min:'',active:false})
 const [rewardId,setRewardId]=useState('')
 const [code,setCode]=useState('')
 const [notes,setNotes]=useState('')
 const [cost,setCost]=useState('')
 const [requestKey,setRequestKey]=useState('')
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState<string|null>(null)
 const client=clientId || walletClient
 const redemptionRows=client ? summary?.redemptions || [] : allRedemptions.rows
 useEffect(()=>{
  const row=settings.rows[0]
  if(row)setPolicy({enabled:Boolean(row.enabled),points_per_real:String(row.points_per_real),points_per_visit:String(row.points_per_visit),referrer_points:String(row.referrer_points),referee_points:String(row.referee_points),max_per_appointment:String(row.max_per_appointment),daily_cap:String(row.daily_cap),refund_policy:String(row.refund_policy)})
 },[settings.rows])
 useEffect(()=>{
  let stopped=false;setSummary(null);setError(null);setLoading(false)
  if(!client)return()=>{stopped=true}
  setLoading(true)
  operation<LoyaltySummary>('loyalty_summary',{p_shop:shop.id,p_client:client}).then(data=>{if(!stopped)setSummary(data)}).catch(problem=>{if(!stopped)setError(errorMessage(problem))}).finally(()=>{if(!stopped)setLoading(false)})
  return()=>{stopped=true}
 },[shop.id,client,revision])
 async function refresh(){await Promise.all([settings.refresh(),rewards.refresh(),tiers.refresh(),allRedemptions.refresh(),products.refresh()]);setRevision(v=>v+1)}
 function open(kind:typeof modal,row?:Row){
  setError(null);setEditor(row || null);setModal(kind);setRequestKey(crypto.randomUUID());setNotes('');setCost('');setCode('')
  if(kind==='reward')setReward({name:String(row?.name || ''),description:String(row?.description || ''),points:String(row?.points_cost || ''),days:String(row?.valid_days || ''),max:String(row?.max_per_client || ''),product:String(row?.product_id || ''),quantity:String(row?.quantity || 1),active:row?Boolean(row.active):false})
  if(kind==='tier')setTier({name:String(row?.name || ''),description:String(row?.description || ''),min:String(row?.min_points ?? ''),active:row?Boolean(row.active):false})
  if(kind==='redeem')setRewardId(row?.id || summary?.rewards[0]?.id || '')
  if(kind==='fulfill'){const snapshot=row?.reward_snapshot as Record<string,unknown>;const product=products.rows.find(p=>p.id===snapshot?.product_id);if(product)setCost(String(Number(product.cost_cents)*Number(snapshot.quantity || 1)/100))}
 }
 async function savePolicy(event:FormEvent){
  event.preventDefault();setBusy(true);setError(null)
  try{const values={enabled:policy.enabled,points_per_real:Number(policy.points_per_real),points_per_visit:Number(policy.points_per_visit),referrer_points:Number(policy.referrer_points),referee_points:Number(policy.referee_points),max_per_appointment:Number(policy.max_per_appointment),daily_cap:Number(policy.daily_cap),refund_policy:policy.refund_policy};if(settings.rows[0])await updateRow('loyalty_settings',settings.rows[0].id,values);else await createRow('loyalty_settings',{...values,barbershop_id:shop.id});notify(policy.enabled?'Política ativada para novos atendimentos elegíveis.':'Política salva e desativada.');await refresh()}
  catch(problem){setError(errorMessage(problem))}finally{setBusy(false)}
 }
 async function save(event:FormEvent){
  event.preventDefault();setBusy(true);setError(null)
  try{
   if(modal==='reward'){const values={name:reward.name.trim(),description:reward.description.trim() || null,points_cost:Number(reward.points),valid_days:Number(reward.days),max_per_client:Number(reward.max),product_id:reward.product || null,quantity:Number(reward.quantity),active:reward.active};if(editor)await updateRow('loyalty_rewards',editor.id,values);else await createRow('loyalty_rewards',{...values,barbershop_id:shop.id})}
   if(modal==='tier'){const values={name:tier.name.trim(),description:tier.description.trim() || null,min_points:Number(tier.min),active:tier.active};if(editor)await updateRow('loyalty_tiers',editor.id,values);else await createRow('loyalty_tiers',{...values,barbershop_id:shop.id})}
   if(modal==='redeem')await operation('redeem_loyalty',{p_shop:shop.id,p_client:client,p_reward:rewardId,p_request:requestKey})
   if(modal==='referral')await operation('register_loyalty_referral',{p_shop:shop.id,p_client:client,p_code:code.trim()})
   if(modal==='cancel')await operation('cancel_loyalty',{p_shop:shop.id,p_redemption:editor?.id,p_reason:notes.trim()})
   if(modal==='fulfill')await operation('fulfill_loyalty',{p_shop:shop.id,p_redemption:editor?.id,p_cost:safeAmount(cost,true),p_notes:notes.trim()})
   setModal(null);notify(modal==='fulfill'?'Entrega e custo do benefício registrados.':'Operação de fidelidade registrada.');await refresh()
  }catch(problem){setError(errorMessage(problem))}finally{setBusy(false)}
 }
 const selectedReward=summary?.rewards.find(r=>r.id===rewardId)
 const fulfillmentProduct=editor?.reward_snapshot ? products.rows.find(p=>p.id===(editor.reward_snapshot as Record<string,unknown>).product_id) : undefined
 return <div className="operations-ledger page-stack">
  {!clientId && <div className="ops-toolbar"><div className="segmented">{[['wallet','Carteira do cliente'],...(config?[['policy','Política de pontos'],['rewards','Benefícios'],['tiers','Níveis'],['redemptions','Todas as retiradas']]:[])].map(([key,label])=><button key={key} className={view===key?'selected':''} onClick={()=>setView(key)}>{label}</button>)}</div>{config && <span className="status">{settings.rows[0]?.enabled?'Programa ativo':'Programa inativo'}</span>}</div>}
  <Notice text={error || settings.error || rewards.error || tiers.error || allRedemptions.error || clients.error || products.error}/>
  {view==='wallet' && <>
   {!clientId && <Panel title="Selecionar cliente"><Field label="Cliente"><select value={walletClient} onChange={e=>setWalletClient(e.target.value)}><option value="">Selecione para consultar a carteira</option>{clients.rows.map(c=><option key={c.id} value={c.id}>{asText(c.full_name)}</option>)}</select></Field></Panel>}
   {loading?<Loading text="Conferindo pontos e benefícios…"/>:summary && <>
    <div className="stats-grid"><Stat label="Saldo de pontos" value={summary.balance_points} foot={summary.balance_points<0?'Estorno de pontos já usados; novos créditos compensam o saldo':'Pontos disponíveis menos reservas de benefícios'} icon={<Gift size={19}/>}/><Stat label="Pontos ganhos líquidos" value={summary.earned_points} foot="Atendimentos + indicações − estornos"/><Stat label="Nível do cliente" value={summary.tier?.name || 'Sem nível configurado'} foot={summary.next_tier?`${Math.max(0,summary.next_tier.min_points-summary.earned_points)} pontos para ${summary.next_tier.name}`:'Sem próximo nível configurado'} icon={<Award size={19}/>}/></div>
    {!summary.enabled && <Notice kind="info" text="O programa está inativo. A administração precisa configurar e ativar a política de pontos e os benefícios. Os saldos e o histórico existentes continuam disponíveis."/>}
    <Panel title="Indicações" subtitle="O código deve ser registrado antes do primeiro atendimento pago do indicado. Os pontos só são creditados depois de concluir e receber o atendimento." action={<button className="button outline" disabled={!summary.enabled} onClick={()=>open('referral')}><UsersRound size={16}/>Registrar quem indicou este cliente</button>}><div className="ops-total"><span>Código deste cliente <strong>{summary.referral_code || 'Programa inativo'}</strong></span><span>{summary.referral_count} indicação(ões) cadastrada(s)</span></div></Panel>
    <Panel title="Benefícios disponíveis" subtitle="Solicitar reserva os pontos. O benefício deve ser retirado e confirmado pela barbearia."><DataTable rows={summary.rewards} empty="Nenhum benefício ativo" columns={[{key:'name',label:'Benefício'},{key:'description',label:'Descrição'},{key:'points_cost',label:'Pontos'},{key:'valid_days',label:'Prazo em dias'},{key:'action',label:'Solicitar',render:r=><button className="button outline" disabled={!summary.enabled || summary.balance_points<Number(r.points_cost)} onClick={()=>open('redeem',r)}>Solicitar benefício</button>}]}/></Panel>
    <Panel title="Extrato de pontos"><DataTable rows={summary.ledger} empty="Nenhum movimento de pontos" columns={[{key:'created_at',label:'Quando',render:r=>shopDateTime(r.created_at,tz)},{key:'reason',label:'Movimento',render:r=>loyaltyReasons[String(r.reason)]},{key:'points_delta',label:'Pontos',render:r=>Number(r.points_delta)>0?`+${r.points_delta}`:String(r.points_delta)}]}/></Panel>
   </>}
  </>}
  {view==='policy' && config && <Panel title="Política de fidelidade" subtitle="Nenhum valor ou prêmio é ativado automaticamente. Na primeira ativação, o início do programa fica registrado e visitas anteriores não geram pontos."><form className="form-grid" onSubmit={savePolicy}><div className="ops-filter-grid">{[['points_per_real','Pontos por R$ 1 recebido (avulso)'],['points_per_visit','Pontos por visita paga e concluída'],['referrer_points','Pontos de quem indicou'],['referee_points','Pontos de quem foi indicado'],['max_per_appointment','Limite total por atendimento/cliente'],['daily_cap','Limite de créditos por dia/cliente']].map(([key,label])=><Field key={key} label={label}><input required type="number" min="0" max={key==='points_per_real'?'10000':'1000000'} step={key==='points_per_real'?'0.001':'1'} value={policy[key as keyof typeof policy] as string} onChange={e=>setPolicy({...policy,[key]:e.target.value})}/></Field>)}</div><Field label="Como estornar os pontos quando um recebimento for devolvido"><select value={policy.refund_policy} onChange={e=>setPolicy({...policy,refund_policy:e.target.value})}><option value="full">Cancelar todos os pontos desse atendimento ao ocorrer estorno</option><option value="proportional">Estornar na proporção do valor devolvido</option></select></Field><Notice kind="info" text="Visitas de assinatura ganham somente pontos por visita, após pagamento do ciclo; não repetem pontos por valor da mensalidade. Se pontos já usados forem estornados, o saldo pode ficar negativo. Alterar a política preserva os registros anteriores."/><label className="check-field"><input type="checkbox" checked={policy.enabled} onChange={e=>setPolicy({...policy,enabled:e.target.checked})}/>Ativar programa com os valores e limites acima</label>{Boolean(settings.rows[0]?.cutover_at) && <p className="muted">Início registrado: {shopDateTime(settings.rows[0].cutover_at,tz)}</p>}<PrimaryButton type="submit" disabled={busy}>{busy?'Salvando…':'Salvar política'}</PrimaryButton></form></Panel>}
  {view==='rewards' && config && <Panel title="Catálogo de benefícios" subtitle="Cadastre benefícios, custo em pontos, prazo de retirada e limite por cliente. Um produto vinculado terá estoque e custo registrados na entrega." action={<PrimaryButton onClick={()=>open('reward')}><Plus size={16}/>Novo benefício</PrimaryButton>}><DataTable rows={rewards.rows} empty="Nenhum benefício cadastrado" onRowClick={r=>open('reward',r)} columns={[{key:'name',label:'Benefício'},{key:'points_cost',label:'Pontos'},{key:'valid_days',label:'Validade em dias'},{key:'max_per_client',label:'Limite por cliente'},{key:'active',label:'Status',render:r=>r.active?'Ativo':'Inativo'}]}/></Panel>}
  {view==='tiers' && config && <Panel title="Níveis do clube" subtitle="O nível usa os pontos ganhos líquidos. Resgatar um benefício não reduz o nível; estornar atendimentos ou indicações reduz." action={<PrimaryButton onClick={()=>open('tier')}><Plus size={16}/>Novo nível</PrimaryButton>}><DataTable rows={tiers.rows} empty="Nenhum nível cadastrado" onRowClick={r=>open('tier',r)} columns={[{key:'name',label:'Nível'},{key:'min_points',label:'A partir de pontos ganhos'},{key:'description',label:'Descrição'},{key:'active',label:'Status',render:r=>r.active?'Ativo':'Inativo'}]}/></Panel>}
  {(view==='redemptions' || view==='wallet' && summary) && <Panel title="Retiradas de benefícios" subtitle="Pedidos pendentes reservam pontos. Cancelamento ou expiração devolve os pontos; a entrega exige confirmação da barbearia."><DataTable rows={redemptionRows} empty="Nenhum benefício solicitado" columns={[...(!client?[{key:'client_id',label:'Cliente',render:(r:Row)=>asText(clients.rows.find(c=>c.id===r.client_id)?.full_name)}]:[]),{key:'reward_snapshot',label:'Benefício',render:r=>asText((r.reward_snapshot as Record<string,unknown>)?.name)},{key:'expires_at',label:'Retirar até',render:r=>shopDateTime(r.expires_at,tz)},{key:'status',label:'Situação',render:r=>redemptionStates[String(r.status)]},{key:'action',label:'Ações',render:r=>r.status==='requested' && <div className="ops-actions">{admin && <button className="button outline" onClick={()=>open('fulfill',r)}>Confirmar entrega</button>}<button className="button ghost" onClick={()=>open('cancel',r)}>Cancelar e devolver pontos</button></div>}]}/></Panel>}
  {modal && <Modal title={{reward:editor?'Editar benefício':'Novo benefício',tier:editor?'Editar nível':'Novo nível',redeem:'Solicitar benefício',referral:'Registrar indicação',fulfill:'Confirmar entrega do benefício',cancel:'Cancelar solicitação'}[modal]} onClose={()=>{if(!busy)setModal(null)}}><form className="form-grid" onSubmit={save}>
   {modal==='reward' && <><Field label="Nome do benefício"><input required minLength={2} maxLength={160} value={reward.name} onChange={e=>setReward({...reward,name:e.target.value})}/></Field><Field label="Descrição e condições"><textarea maxLength={2000} value={reward.description} onChange={e=>setReward({...reward,description:e.target.value})}/></Field><div className="form-row"><Field label="Pontos necessários"><input required type="number" min="1" max="1000000" step="1" value={reward.points} onChange={e=>setReward({...reward,points:e.target.value})}/></Field><Field label="Prazo de retirada (dias)"><input required type="number" min="1" max="365" step="1" value={reward.days} onChange={e=>setReward({...reward,days:e.target.value})}/></Field></div><Field label="Máximo de resgates por cliente"><input required type="number" min="1" max="1000" step="1" value={reward.max} onChange={e=>setReward({...reward,max:e.target.value})}/></Field><Field label="Produto entregue (opcional)"><select value={reward.product} onChange={e=>setReward({...reward,product:e.target.value})}><option value="">Benefício manual sem produto de estoque</option>{products.rows.filter(p=>p.active).map(p=><option key={p.id} value={p.id}>{asText(p.name)} · estoque {String(p.stock_quantity)}</option>)}</select></Field>{reward.product && <Field label="Quantidade do produto por resgate"><input required type="number" min="1" max="1000" step="1" value={reward.quantity} onChange={e=>setReward({...reward,quantity:e.target.value})}/></Field>}<label className="check-field"><input type="checkbox" checked={reward.active} onChange={e=>setReward({...reward,active:e.target.checked})}/>Ativar este benefício</label></>}
   {modal==='tier' && <><Field label="Nome do nível"><input required minLength={2} maxLength={80} value={tier.name} onChange={e=>setTier({...tier,name:e.target.value})}/></Field><Field label="Pontos ganhos necessários"><input required type="number" min="0" step="1" value={tier.min} onChange={e=>setTier({...tier,min:e.target.value})}/></Field><Field label="Descrição"><textarea maxLength={2000} value={tier.description} onChange={e=>setTier({...tier,description:e.target.value})}/></Field><label className="check-field"><input type="checkbox" checked={tier.active} onChange={e=>setTier({...tier,active:e.target.checked})}/>Ativar este nível</label></>}
   {modal==='redeem' && <><Field label="Benefício"><select required value={rewardId} onChange={e=>setRewardId(e.target.value)}>{summary?.rewards.map(r=><option key={r.id} value={r.id}>{r.name} · {r.points_cost} pontos</option>)}</select></Field><Notice kind="info" text={`Serão reservados ${selectedReward?.points_cost || 0} pontos. O prazo de retirada é de ${selectedReward?.valid_days || 0} dias. A entrega será confirmada pela barbearia.`}/></>}
   {modal==='referral' && <Field label="Código de quem indicou o cliente"><input required minLength={12} maxLength={12} value={code} onChange={e=>setCode(e.target.value.toUpperCase())}/></Field>}
   {modal==='fulfill' && <><Notice kind="info" text={fulfillmentProduct?`A entrega retirará ${String((editor?.reward_snapshot as Record<string,unknown>)?.quantity || 1)} unidade(s) de ${asText(fulfillmentProduct.name)}. O custo será conferido novamente no estoque ao confirmar.`:'Informe o custo real do benefício entregue. Registre zero explicitamente quando não houver custo; não repetimos uma despesa já registrada.'}/><Field label="Custo da entrega (R$)"><input required type="number" min="0" step="0.01" readOnly={Boolean(fulfillmentProduct)} value={cost} onChange={e=>setCost(e.target.value)}/></Field></>}
   {(modal==='fulfill' || modal==='cancel') && <Field label={modal==='cancel'?'Motivo do cancelamento':'Registro da entrega'}><textarea required minLength={2} maxLength={2000} value={notes} onChange={e=>setNotes(e.target.value)}/></Field>}
   <Notice text={error}/><div className="form-actions"><button type="button" className="button ghost" disabled={busy} onClick={()=>setModal(null)}>Voltar</button><PrimaryButton type="submit" disabled={busy || modal==='redeem' && (!selectedReward || Number(summary?.balance_points)<selectedReward.points_cost)}><CheckCheck size={16}/>{busy?'Registrando…':'Confirmar'}</PrimaryButton></div>
  </form></Modal>}
 </div>
}
