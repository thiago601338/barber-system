import { useEffect, useState, type FormEvent } from 'react'
import { CalendarClock, CheckCheck, History, Plus, UsersRound } from 'lucide-react'
import type { PageProps } from '../App'
import { createRow, updateRow, useRows } from '../lib/useRows'
import { errorMessage } from '../lib/errorMessage'
import { operation } from '../lib/operations'
import { shopDateTime, shopToday } from '../lib/shopTime'
import { asText, date, type Row } from '../types'
import { DataTable, Field, Loading, Modal, Notice, Panel, PrimaryButton, Stat } from '../ui'
import '../styles-operations-ledger.css'

const segments: Record<string,string> = { maintenance:'Manutenção do serviço',inactive:'Sem visita recente',birthday:'Aniversário',manual:'Acompanhamento manual' }
const taskStates: Record<string,string> = { planned:'Planejada',contacted:'Contato realizado',responded:'Cliente respondeu',booked:'Agendamento vinculado',closed:'Encerrada' }
export function CrmPanel({ identity,role,notify }: PageProps) {
 const shop=identity.shop!
 const tz=shop.timezone || 'America/Sao_Paulo'
 const admin=role !== 'barber'
 const tasks=useRows('crm_tasks',shop.id)
 const events=useRows('crm_task_events',shop.id)
 const rules=useRows('crm_return_rules',shop.id)
 const services=useRows('services',shop.id)
 const clients=useRows('clients',shop.id)
 const members=useRows('memberships',shop.id)
 const appointments=useRows('appointments',shop.id)
 const [view,setView]=useState('segments')
 const [segment,setSegment]=useState('all')
 const [inactiveDays,setInactiveDays]=useState('90')
 const [birthdayWindow,setBirthdayWindow]=useState('7')
 const [rows,setRows]=useState<Row[]>([])
 const [loading,setLoading]=useState(false)
 const [error,setError]=useState<string|null>(null)
 const [revision,setRevision]=useState(0)
 const [modal,setModal]=useState<'task'|'update'|'rule'|null>(null)
 const [busy,setBusy]=useState(false)
 const [task,setTask]=useState({client:'',assignee:'',segment:'manual',title:'',due:shopToday(tz)})
 const [requestKey,setRequestKey]=useState('')
 const [selected,setSelected]=useState<Row|null>(null)
 const [update,setUpdate]=useState({status:'contacted',notes:'',appointment:''})
 const [ruleEditor,setRuleEditor]=useState<Row|null>(null)
 const [rule,setRule]=useState({service:'',days:'',active:true})
 const [history,setHistory]=useState<Row|null>(null)
 const clientName=(id:unknown)=>asText(clients.rows.find(c=>c.id===id)?.full_name)
 useEffect(()=>{
  let stopped=false
  setLoading(true);setError(null)
  operation<Row[]>('crm_segments',{p_shop:shop.id,p_inactive_days:Number(inactiveDays),p_birthday_window:Number(birthdayWindow)})
   .then(data=>{if(!stopped)setRows(data || [])}).catch(problem=>{if(!stopped){setError(errorMessage(problem));setRows([])}}).finally(()=>{if(!stopped)setLoading(false)})
  return()=>{stopped=true}
 },[shop.id,inactiveDays,birthdayWindow,revision])
 const shown=rows.filter(r=>segment==='all' ? Boolean(r.maintenance_due || r.inactive || r.birthday_upcoming) : segment==='maintenance' ? r.maintenance_due : segment==='inactive' ? r.inactive : r.birthday_upcoming)
 const contacted=tasks.rows.filter(t=>events.rows.some(e=>e.task_id===t.id && e.status==='contacted')).length
 const converted=tasks.rows.filter(t=>t.status==='booked' && appointments.rows.some(a=>a.id===t.appointment_id && !['cancelled','no_show'].includes(String(a.status)))).length
 const contactedConversions=tasks.rows.filter(t=>t.status==='booked' && events.rows.some(e=>e.task_id===t.id && e.status==='contacted') && appointments.rows.some(a=>a.id===t.appointment_id && !['cancelled','no_show'].includes(String(a.status)))).length
 const completed=tasks.rows.filter(t=>t.status==='booked' && appointments.rows.some(a=>a.id===t.appointment_id && a.status==='completed')).length
 function newTask(row?:Row){setError(null);setRequestKey(crypto.randomUUID());setTask({client:row?.id||'',assignee:role==='barber'?identity.membership?.id||'':'',segment:segment==='all'?'manual':segment,title:row?`Retorno · ${asText(row.full_name)}`.slice(0,160):'',due:shopToday(tz)});setModal('task')}
 function editRule(row?:Row){setError(null);setRuleEditor(row || null);setRule({service:String(row?.service_id || ''),days:String(row?.return_days || ''),active:row?Boolean(row.active):true});setModal('rule')}
 async function refresh(){await Promise.all([tasks.refresh(),events.refresh(),rules.refresh()]);setRevision(v=>v+1)}
 async function save(event:FormEvent){
  event.preventDefault();setBusy(true);setError(null)
  try{
   if(modal==='task')await operation('crm_create_task',{p_shop:shop.id,p_client:task.client,p_assignee:task.assignee||null,p_segment:task.segment,p_title:task.title.trim(),p_due:task.due,p_request:requestKey})
   if(modal==='update')await operation('crm_update_task',{p_shop:shop.id,p_task:selected?.id,p_status:update.status,p_notes:update.notes.trim(),p_appointment:update.appointment||null})
   if(modal==='rule'){const values={service_id:rule.service||null,return_days:Number(rule.days),active:rule.active};if(ruleEditor)await updateRow('crm_return_rules',ruleEditor.id,values);else await createRow('crm_return_rules',{...values,barbershop_id:shop.id})}
   setModal(null);notify('Acompanhamento salvo.');await refresh()
  }catch(problem){setError(errorMessage(problem))}finally{setBusy(false)}
 }
 return <div className="operations-ledger page-stack">
  <div className="ops-toolbar"><div className="segmented">{[['segments','Oportunidades de retorno'],['tasks','Tarefas e conversão'],...(admin?[['rules','Intervalos por serviço']]:[])].map(([key,label])=><button key={key} className={view===key?'selected':''} onClick={()=>setView(key)}>{label}</button>)}</div><PrimaryButton onClick={()=>newTask()}><Plus size={16}/>Criar acompanhamento</PrimaryButton></div>
  <Notice kind="info" text="As oportunidades usam visitas concluídas, data de nascimento e intervalos cadastrados. Os contatos são manuais: criar ou atualizar uma tarefa não envia mensagem ao cliente."/>
  <Notice text={error || tasks.error || events.error || rules.error || clients.error || members.error || appointments.error}/>
  {view==='segments' && <><Panel title="Critérios do acompanhamento"><div className="ops-filter-grid"><Field label="Sem visita há (dias)"><input type="number" min="1" max="3650" step="1" value={inactiveDays} onChange={e=>setInactiveDays(e.target.value)}/></Field><Field label="Aniversário nos próximos (dias)"><input type="number" min="0" max="31" step="1" value={birthdayWindow} onChange={e=>setBirthdayWindow(e.target.value)}/></Field><Field label="Grupo"><select value={segment} onChange={e=>setSegment(e.target.value)}><option value="all">Todas as oportunidades</option><option value="maintenance">Manutenção do serviço</option><option value="inactive">Sem visita recente</option><option value="birthday">Aniversários</option></select></Field></div></Panel><div className="stats-grid"><Stat label="Manutenção no prazo de retorno" value={rows.filter(r=>r.maintenance_due).length} foot="Ignora quem já tem agendamento futuro" icon={<CalendarClock size={19}/>}/><Stat label={`Sem visita há ${inactiveDays} dias`} value={rows.filter(r=>r.inactive).length} icon={<UsersRound size={19}/>}/><Stat label="Aniversários no período" value={rows.filter(r=>r.birthday_upcoming).length} foot="Requer data de nascimento no cadastro"/></div><Panel title="Clientes para acompanhar">{loading?<Loading/>:<DataTable rows={shown} empty="Nenhuma oportunidade neste filtro" columns={[{key:'full_name',label:'Cliente'},{key:'phone',label:'Telefone'},{key:'visit_date',label:'Última visita',render:r=>r.visit_date?date(r.visit_date):'Sem visita registrada'},{key:'maintenance_due_on',label:'Retorno sugerido',render:r=>r.maintenance_due_on?date(r.maintenance_due_on):'Configure o intervalo'},{key:'next_birthday',label:'Aniversário',render:r=>r.birth_date?date(r.next_birthday):'Não informado'},{key:'action',label:'Acompanhamento',render:r=><button className="button outline" onClick={()=>newTask(r)}>Criar tarefa</button>}]}/>}</Panel></>}
  {view==='tasks' && <><div className="stats-grid"><Stat label="Contatos registrados" value={contacted} foot="Tarefas com registro manual de contato"/><Stat label="Agendamentos vinculados" value={converted} foot={contacted?`${Math.round(contactedConversions/contacted*100)}% sobre tarefas com contato registrado`:'Sem contatos para calcular conversão'}/><Stat label="Retornos concluídos" value={completed} foot="Agendamentos vinculados já concluídos"/></div><Panel title="Fila de relacionamento"><DataTable rows={tasks.rows} empty="Nenhum acompanhamento criado" columns={[{key:'client_id',label:'Cliente',render:r=>clientName(r.client_id)},{key:'title',label:'Tarefa'},{key:'due_on',label:'Prazo',render:r=>date(r.due_on)},{key:'assignee_membership_id',label:'Responsável',render:r=>asText(members.rows.find(m=>m.id===r.assignee_membership_id)?.display_name || 'Sem responsável')},{key:'status',label:'Situação',render:r=>taskStates[String(r.status)]},{key:'action',label:'Ações',render:r=><div className="ops-actions">{!['booked','closed'].includes(String(r.status)) && <button className="button outline" onClick={()=>{setSelected(r);setUpdate({status:'contacted',notes:'',appointment:''});setError(null);setModal('update')}}>Registrar resultado</button>}<button className="button ghost" onClick={()=>setHistory(r)}><History size={15}/>Histórico</button></div>}]}/></Panel></>}
  {view==='rules' && admin && <Panel title="Prazos de manutenção" subtitle="Configure os intervalos adequados aos seus serviços. Não presumimos que todos precisam retornar no mesmo prazo." action={<PrimaryButton onClick={()=>editRule()}><Plus size={16}/>Novo intervalo</PrimaryButton>}><DataTable rows={rules.rows} empty="Nenhum intervalo cadastrado" onRowClick={editRule} columns={[{key:'service_id',label:'Serviço',render:r=>r.service_id?asText(services.rows.find(s=>s.id===r.service_id)?.name):'Padrão da barbearia'},{key:'return_days',label:'Intervalo em dias'},{key:'active',label:'Status',render:r=>r.active?'Ativo':'Inativo'}]}/></Panel>}
  {modal && <Modal title={modal==='task'?'Novo acompanhamento':modal==='update'?'Registrar resultado do acompanhamento':'Intervalo de manutenção'} onClose={()=>{if(!busy)setModal(null)}}><form className="form-grid" onSubmit={save}>
   {modal==='task' && <><Field label="Cliente"><select required value={task.client} onChange={e=>setTask({...task,client:e.target.value})}><option value="">Selecione</option>{clients.rows.map(c=><option key={c.id} value={c.id}>{asText(c.full_name)}</option>)}</select></Field><Field label="Título"><input required minLength={2} maxLength={160} value={task.title} onChange={e=>setTask({...task,title:e.target.value})}/></Field><div className="form-row"><Field label="Grupo"><select value={task.segment} onChange={e=>setTask({...task,segment:e.target.value})}>{Object.entries(segments).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></Field><Field label="Prazo"><input type="date" required value={task.due} onChange={e=>setTask({...task,due:e.target.value})}/></Field></div><Field label="Responsável"><select value={task.assignee} disabled={!admin} onChange={e=>setTask({...task,assignee:e.target.value})}><option value="">Sem responsável</option>{members.rows.filter(m=>m.active).map(m=><option key={m.id} value={m.id}>{asText(m.display_name)}</option>)}</select></Field></>}
   {modal==='update' && <><p>{clientName(selected?.client_id)} · {asText(selected?.title)}</p><Field label="Resultado"><select value={update.status} onChange={e=>setUpdate({...update,status:e.target.value})}>{Object.entries(taskStates).filter(([key])=>key!=='planned').map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></Field>{update.status==='booked' && <Field label="Agendamento que resultou deste contato"><select required value={update.appointment} onChange={e=>setUpdate({...update,appointment:e.target.value})}><option value="">Selecione o agendamento real</option>{appointments.rows.filter(a=>a.client_id===selected?.client_id && !['cancelled','no_show'].includes(String(a.status))).map(a=><option key={a.id} value={a.id}>{shopDateTime(a.starts_at,tz)} · {asText(members.rows.find(m=>m.id===a.barber_membership_id)?.display_name)}</option>)}</select></Field>}<Field label="O que aconteceu"><textarea required minLength={2} maxLength={2000} value={update.notes} onChange={e=>setUpdate({...update,notes:e.target.value})}/></Field></>}
   {modal==='rule' && <><Field label="Serviço"><select value={rule.service} onChange={e=>setRule({...rule,service:e.target.value})}><option value="">Padrão da barbearia</option>{services.rows.map(s=><option key={s.id} value={s.id}>{asText(s.name)}</option>)}</select></Field><Field label="Retorno após (dias)"><input required type="number" min="1" max="3650" step="1" value={rule.days} onChange={e=>setRule({...rule,days:e.target.value})}/></Field><label className="check-field"><input type="checkbox" checked={rule.active} onChange={e=>setRule({...rule,active:e.target.checked})}/>Intervalo ativo</label></>}
   <Notice text={error}/><div className="form-actions"><button type="button" className="button ghost" disabled={busy} onClick={()=>setModal(null)}>Cancelar</button><PrimaryButton type="submit" disabled={busy}><CheckCheck size={16}/>{busy?'Salvando…':'Salvar acompanhamento'}</PrimaryButton></div>
  </form></Modal>}
  {history && <Modal title="Histórico do acompanhamento" subtitle={clientName(history.client_id)} onClose={()=>setHistory(null)}><DataTable rows={events.rows.filter(e=>e.task_id===history.id)} empty="Sem registros" columns={[{key:'created_at',label:'Quando',render:r=>shopDateTime(r.created_at,tz)},{key:'status',label:'Etapa',render:r=>taskStates[String(r.status)]},{key:'notes',label:'Registro'}]}/></Modal>}
 </div>
}
