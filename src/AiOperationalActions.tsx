import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Check, CheckCircle2, ListChecks, LoaderCircle, ShieldCheck } from 'lucide-react'
import { authedApi, authedGet } from './lib/supabase'
import { aiActionLabels, aiDisplayFields, aiLocalInstant } from './lib/aiActionDisplay'
import { shopClock, shopToday } from './lib/shopTime'
import { asText, type Row } from './types'
import { Field, Modal, Notice } from './ui'
type Options={allowed:string[];clients:Row[];barbers:Row[];services:Row[];products:Row[];timezone:string;daily_limit:number}
type Slot={starts_at:string;ends_at:string;eligibility:{requires_subscription:boolean;eligible:boolean;reason:string|null;subscriptions:{id:string;plan_name:string;remaining_visits:number}[]}}
type Plan={plan_id:string;summary:string;expires_at:string;action:{type:string;label:string;values:Record<string,unknown>}}

export function AiOperationalActions({shopId,notify}:{shopId:string;notify:(text:string,kind?:'success'|'error')=>void}) {
 const [open,setOpen]=useState(false);const [options,setOptions]=useState<Options|null>(null);const [type,setType]=useState('')
 const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);const [plan,setPlan]=useState<Plan|null>(null);const [done,setDone]=useState(false)
 const [recordId,setRecordId]=useState('');const [clientId,setClientId]=useState('');const [barberId,setBarberId]=useState('');const [serviceIds,setServiceIds]=useState<string[]>([])
 const [day,setDay]=useState('');const [slots,setSlots]=useState<Slot[]>([]);const [slot,setSlot]=useState('');const [subscription,setSubscription]=useState('');const [slotLoading,setSlotLoading]=useState(false)
 const [name,setName]=useState('');const [description,setDescription]=useState('');const [phone,setPhone]=useState('');const [email,setEmail]=useState('')
 const [start,setStart]=useState('');const [end,setEnd]=useState('');const [reason,setReason]=useState('');const [channel,setChannel]=useState('organic');const [due,setDue]=useState('')
 const revision=useRef(0);const formRevision=useRef(0);const key=useRef(crypto.randomUUID())
 const selectedSlot=slots.find(value=>value.starts_at===slot)
 const records=type==='update_service'?options?.services:type==='update_product'?options?.products:options?.clients
 const selected=records?.find(row=>row.id===recordId)
 useEffect(()=>{setOpen(false);setOptions(null);setPlan(null);revision.current++},[shopId])
 useEffect(()=>{
  formRevision.current++;setPlan(null);setDone(false);key.current=crypto.randomUUID()
 },[type,recordId,clientId,barberId,serviceIds,day,slot,subscription,name,description,phone,email,start,end,reason,channel,due])
 useEffect(()=>{
  if(!open||type!=='book_appointment'||!clientId||!barberId||!serviceIds.length||!day){setSlots([]);setSlot('');setSubscription('');setSlotLoading(false);return}
  let cancelled=false;setSlotLoading(true);setSlots([]);setSlot('');setSubscription('')
  const query=new URLSearchParams({barbershop_id:shopId,client_id:clientId,barber_id:barberId,service_ids:serviceIds.join(','),day})
  void authedGet<{slots:Slot[]}>(`/api/ai-help/slots?${query}`).then(response=>{if(!cancelled)setSlots(response.slots)},problem=>{if(!cancelled)setError(problem instanceof Error?problem.message:'Não foi possível conferir a agenda.')}).finally(()=>{if(!cancelled)setSlotLoading(false)})
  return()=>{cancelled=true}
 },[open,type,shopId,clientId,barberId,serviceIds,day])
 async function show(){setOpen(true);setBusy(true);setError(null);setPlan(null);setDone(false);key.current=crypto.randomUUID();const current=++revision.current
  try{const response=await authedGet<Options>(`/api/ai-help/options?barbershop_id=${encodeURIComponent(shopId)}`);if(current!==revision.current)return;setOptions(response);setType(response.allowed.find(action=>action in aiActionLabels)||'');setBarberId(response.barbers.length===1?response.barbers[0].id:'');setDay(shopToday(response.timezone))}
  catch(problem){if(current===revision.current)setError(problem instanceof Error?problem.message:'Não foi possível carregar as ações.')}
  finally{if(current===revision.current)setBusy(false)}
 }
 function pickRecord(id:string){setRecordId(id);const row=records?.find(value=>value.id===id);setName(String(row?.full_name||row?.name||''));setDescription(String(row?.description||''));setPhone('');setEmail('')}
 async function prepare(event:FormEvent){event.preventDefault();if(!options||!type)return;setBusy(true);setError(null);const current=revision.current;const fields=formRevision.current
  try{let values:Record<string,unknown>
   if(type==='book_appointment')values={client_id:clientId,barber_membership_id:barberId,service_ids:serviceIds,starts_at:slot,subscription_id:subscription||null}
   else if(type==='create_schedule_block')values={barber_membership_id:barberId,starts_at:aiLocalInstant(start,options.timezone),ends_at:aiLocalInstant(end,options.timezone),reason}
   else if(type==='create_marketing_task')values={title:name,channel,due_on:due||null}
   else if(type==='create_client'||type==='update_client')values={...(type==='update_client'?{id:recordId,expected_updated_at:selected?.updated_at}:{}),full_name:name,...(phone?{phone}:{}),...(email?{email}:{})}
   else values={id:recordId,expected_updated_at:selected?.updated_at,name,description}
   const response=await authedApi<Plan>('/api/ai-help/prepare',{barbershop_id:shopId,prompt:`Preparar ${aiActionLabels[type].toLowerCase()} com os dados selecionados.`,action:{type,values},idempotency_key:key.current})
   if(current===revision.current&&fields===formRevision.current)setPlan(response)
  }catch(problem){if(current===revision.current&&fields===formRevision.current)setError(problem instanceof Error?problem.message:'Não foi possível preparar a proposta.')}
  finally{if(current===revision.current)setBusy(false)}
 }
 async function confirm(){if(!plan)return;setBusy(true);setError(null);try{await authedApi('/api/ai-help/execute',{plan_id:plan.plan_id});setDone(true);notify('Ação confirmada, salva e registrada no histórico.')}catch(problem){setError(problem instanceof Error?problem.message:'Não foi possível confirmar a ação.')}finally{setBusy(false)}}
 const bookingReady=type!=='book_appointment'||Boolean(slot&&selectedSlot?.eligibility.eligible&&(!selectedSlot.eligibility.requires_subscription||subscription))
 return <><button type="button" className="button outline" onClick={()=>void show()}><ListChecks size={16}/> Ações guiadas</button>{open&&<Modal wide title="Prepare uma ação no sistema" subtitle="Selecione cadastros autorizados, revise todos os dados e confirme." onClose={()=>{setOpen(false);revision.current++}}>
  <Notice text={error}/>{busy&&!options&&<p><LoaderCircle className="spin" size={18}/> Carregando opções...</p>}
  {options&&!plan&&<form className="form-grid" onSubmit={prepare}><Field label="O que você quer fazer?"><select value={type} onChange={event=>{setType(event.target.value);setRecordId('');setName('');setDescription('');setError(null)}}>{options.allowed.filter(action=>action in aiActionLabels).map(action=><option key={action} value={action}>{aiActionLabels[action]}</option>)}</select></Field>
   {!type&&<Notice kind="info" text="Seu perfil pode conversar com a IA. As ações guiadas dependem das permissões liberadas pelo administrador."/>}
   {['book_appointment','create_schedule_block'].includes(type)&&<Field label="Profissional"><select required value={barberId} onChange={event=>setBarberId(event.target.value)}><option value="">Selecione</option>{options.barbers.map(row=><option key={row.id} value={row.id}>{asText(row.display_name)}</option>)}</select></Field>}
   {type==='book_appointment'&&<><Field label="Cliente"><select required value={clientId} onChange={event=>{setClientId(event.target.value);setSubscription('')}}><option value="">Selecione seu cliente</option>{options.clients.map(row=><option key={row.id} value={row.id}>{asText(row.full_name)}</option>)}</select></Field><Field label="Serviços"><div className="choice-grid">{options.services.filter(row=>row.active).map(row=><label className="choice-card" key={row.id}><input type="checkbox" checked={serviceIds.includes(row.id)} onChange={event=>setServiceIds(event.target.checked?[...serviceIds,row.id]:serviceIds.filter(id=>id!==row.id))}/><span>{asText(row.name)}{row.requires_subscription?<small>Exclusivo de assinatura</small>:null}</span></label>)}</div></Field><Field label={`Dia · ${options.timezone}`}><input required type="date" value={day} onChange={event=>setDay(event.target.value)}/></Field><Field label="Horário disponível"><select required value={slot} disabled={slotLoading} onChange={event=>{setSlot(event.target.value);setSubscription('')}}><option value="">{slotLoading?'Consultando agenda...':'Selecione uma vaga'}</option>{slots.map(row=><option key={row.starts_at} value={row.starts_at} disabled={!row.eligibility.eligible}>{shopClock(row.starts_at,options.timezone)} – {shopClock(row.ends_at,options.timezone)}{!row.eligibility.eligible?' · revisar assinatura':''}</option>)}</select></Field>{selectedSlot&&<Field label="Forma de atendimento"><select required={selectedSlot.eligibility.requires_subscription} value={subscription} onChange={event=>setSubscription(event.target.value)}><option value="">{selectedSlot.eligibility.requires_subscription?'Selecione a assinatura elegível':'Atendimento avulso'}</option>{selectedSlot.eligibility.subscriptions.map(row=><option key={row.id} value={row.id}>{row.plan_name} · {row.remaining_visits} visitas disponíveis</option>)}</select></Field>}{!slotLoading&&clientId&&barberId&&serviceIds.length>0&&slots.length===0&&<Notice kind="info" text="Nenhuma vaga encontrada neste dia. Escolha outra data."/>}</>}
   {type==='create_schedule_block'&&<><div className="form-row"><Field label={`Início · ${options.timezone}`}><input required type="datetime-local" value={start} onChange={event=>setStart(event.target.value)}/></Field><Field label="Fim"><input required type="datetime-local" value={end} onChange={event=>setEnd(event.target.value)}/></Field></div><Field label="Motivo"><textarea required minLength={2} maxLength={500} value={reason} onChange={event=>setReason(event.target.value)}/></Field><Notice kind="info" text="Só será possível bloquear um intervalo sem atendimentos confirmados. O bloqueio não cancela nenhum cliente."/></>}
   {type.startsWith('update_')&&<Field label="Cadastro a atualizar"><select required value={recordId} onChange={event=>pickRecord(event.target.value)}><option value="">Selecione</option>{records?.map(row=><option key={row.id} value={row.id}>{asText(row.full_name||row.name)}</option>)}</select></Field>}
   {['create_client','update_client','update_service','update_product','create_marketing_task'].includes(type)&&<Field label={type==='create_marketing_task'?'Título da tarefa':'Nome'}><input required minLength={2} maxLength={type==='create_marketing_task'?200:160} value={name} onChange={event=>setName(event.target.value)}/></Field>}
   {['update_service','update_product'].includes(type)&&<><Field label="Descrição"><textarea maxLength={1000} value={description} onChange={event=>setDescription(event.target.value)}/></Field><Notice kind="info" text="Este formulário altera nome e descrição. Preço, custos, imagem, estoque e assinatura são preservados."/></>}
   {['create_client','update_client'].includes(type)&&<div className="form-row"><Field label="Telefone (opcional)"><input value={phone} maxLength={30} onChange={event=>setPhone(event.target.value)} placeholder="Só preencha se quiser informar ou alterar"/></Field><Field label="E-mail (opcional)"><input type="email" maxLength={254} value={email} onChange={event=>setEmail(event.target.value)} placeholder="Nenhuma mensagem será enviada"/></Field></div>}
   {type==='create_marketing_task'&&<div className="form-row"><Field label="Canal"><select value={channel} onChange={event=>setChannel(event.target.value)}><option value="organic">Orgânico</option><option value="paid">Pago</option></select></Field><Field label="Prazo"><input type="date" value={due} onChange={event=>setDue(event.target.value)}/></Field></div>}
   <div className="form-actions"><button type="button" className="button ghost" onClick={()=>setOpen(false)}>Fechar</button><button type="submit" className="button primary" disabled={busy||!type||!bookingReady}>{busy?'Preparando...':'Revisar proposta'}</button></div>
  </form>}
  {plan&&<div className="page-stack"><div className="notice info"><ShieldCheck size={18}/><span>{plan.summary}</span></div><dl className="ai-help-fields">{aiDisplayFields(plan.action.values,options?.timezone).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>{done?<div className="notice success"><CheckCircle2 size={18}/> Salvo com registro de auditoria. Confirmar novamente não duplica a ação.</div>:<div className="form-actions"><button className="button ghost" onClick={()=>{setPlan(null);key.current=crypto.randomUUID()}} disabled={busy}>Editar dados</button><button className="button primary" onClick={()=>void confirm()} disabled={busy}><Check size={17}/>{busy?'Confirmando...':'Confirmar e salvar'}</button></div>}</div>}
 </Modal>}</>
}
