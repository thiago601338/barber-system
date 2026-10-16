import { money } from '../types'
import { shopDateTime } from './shopTime'
export const aiActionLabels: Record<string,string>={book_appointment:'Agendar atendimento',create_schedule_block:'Bloquear horário',update_service:'Atualizar serviço',update_product:'Atualizar produto',create_client:'Cadastrar cliente',update_client:'Atualizar cliente',create_marketing_task:'Criar tarefa de marketing'}
const fieldLabels: Record<string,string>={professional_label:'Profissional',client_label:'Cliente',services_label:'Serviços',record_label:'Cadastro',full_name:'Nome do cliente',name:'Nome',description:'Descrição',reason:'Motivo',starts_at:'Início',ends_at:'Fim',duration_minutes:'Duração',active:'Cadastro ativo',phone:'Telefone',email:'E-mail',notes:'Observações',title:'Tarefa',channel:'Canal',due_on:'Prazo',sku:'Código',category:'Categoria',subscription_id:'Cobertura por assinatura',price_cents:'Preço',cost_cents:'Custo',stock_quantity:'Estoque'}
export function aiDisplayFields(values: Record<string,unknown>,timezone='America/Sao_Paulo'): [string,string][] {
  return Object.entries(values).filter(([key])=>!['id','expected_updated_at','client_id','barber_membership_id','service_ids'].includes(key)).map(([key,value])=>[
    fieldLabels[key]||key.replace(/_/g,' '), value==null||value===''?'Não informado':key==='subscription_id'?'Assinatura validada pelo sistema':
    ['starts_at','ends_at'].includes(key)?shopDateTime(value,timezone):typeof value==='boolean'?(value?'Sim':'Não'):
    key.endsWith('_cents')?money(value):key==='duration_minutes'?`${value} min`:Array.isArray(value)?value.join(', '):String(value),
  ])
}
/** Convert a wall clock time in the shop zone, rejecting nonexistent DST times. */
export function aiLocalInstant(value:string,timezone:string):string {
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Informe uma data e hora válidas.')
  const nominal=Date.parse(`${value}:00Z`)
  const format=new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
  function wall(instant:number) { const p=Object.fromEntries(format.formatToParts(new Date(instant)).map(part=>[part.type,part.value]));return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}` }
  let instant=nominal
  for(let i=0;i<4;i++) { const difference=nominal-Date.parse(`${wall(instant)}:00Z`);if(!difference)break;instant+=difference }
  if(Number.isNaN(instant)||wall(instant)!==value) throw new Error('Esse horário não existe no fuso da barbearia. Escolha outro.')
  return new Date(instant).toISOString()
}
