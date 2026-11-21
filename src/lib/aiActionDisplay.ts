import { money } from '../types'
import { shopDateTime } from './shopTime'
export const aiActionLabels: Record<string,string>={book_appointment:'Agendar atendimento',create_schedule_block:'Bloquear horário',update_service:'Atualizar serviço',update_product:'Atualizar produto',create_client:'Cadastrar cliente',update_client:'Atualizar cliente',create_marketing_task:'Criar tarefa de marketing'}
/** Every action the chat can propose (the guided form above only offers a subset). */
export const aiChatActionLabels: Record<string,string>={...aiActionLabels,create_shop:'Criar barbearia',create_service:'Cadastrar serviço',create_product:'Cadastrar produto',create_shop_goal:'Cadastrar meta da barbearia',create_personal_goal:'Cadastrar meta pessoal',
  manage_appointment:'Atualizar agendamento',quick_service:'Registrar atendimento',register_sale:'Registrar venda de produtos',receive_payment:'Receber no caixa',cash_register:'Movimentar caixa',create_expense:'Lançar despesa',stock_entry:'Entrada de estoque',stock_adjust:'Ajuste de estoque'}
const fieldLabels: Record<string,string>={operation_label:'O que fazer',warning_label:'Atenção',professional_label:'Profissional',client_label:'Cliente',appointment_label:'Agendamento',services_label:'Serviços',items_label:'Itens',source_label:'Referente a',record_label:'Cadastro',
  full_name:'Nome do cliente',name:'Nome',description:'Descrição',reason:'Motivo',starts_at:'Início',ends_at:'Fim',when_label:'Quando',duration_minutes:'Duração',active:'Cadastro ativo',phone:'Telefone',email:'E-mail',notes:'Observações',title:'Tarefa',channel:'Canal',due_on:'Prazo',sku:'Código',category:'Categoria',
  subscription_id:'Cobertura por assinatura',current_price_cents:'Preço atual',price_cents:'Novo preço',current_cost_cents:'Custo atual',cost_cents:'Custo',stock_quantity:'Estoque',stock_label:'Estoque',quantity:'Quantidade',total_cents:'Total',remaining_cents:'Saldo em aberto',amount_cents:'Valor',
  methods_label:'Pagamento',method:'Recebido em',expected_cents:'Dinheiro esperado na gaveta',occurred_on:'Data',cost_kind:'Tipo de custo',paid:'Compra já paga',invoice:'Nota fiscal'}
const codeNames: Record<string,string>={cash:'Dinheiro',card:'Cartão',pix:'Pix',other:'Outro',internal_use:'Consumo interno',loss:'Perda',adjustment:'Ajuste de inventário',
  operating:'Operacional',structure:'Estrutura',tax:'Imposto',fees:'Taxas',inventory:'Estoque'}
const hidden=new Set(['id','expected_updated_at','operation','items','methods','client_name'])
export function aiDisplayFields(values: Record<string,unknown>,timezone='America/Sao_Paulo'): [string,string][] {
  const shown=(key:string)=>key==='subscription_id'||!(hidden.has(key)||key.endsWith('_id')||key.endsWith('_ids')||(key==='reason'&&'operation_label' in values&&'stock_label' in values))
  const entries=Object.entries(values).filter(([key])=>shown(key))
  const first=['operation_label','warning_label']
  return [...entries.filter(([key])=>first.includes(key)),...entries.filter(([key])=>!first.includes(key))].map(([key,value])=>[
    (key==='starts_at'&&values.operation==='reschedule'?'Novo horário':fieldLabels[key])||key.replace(/_/g,' '), value==null||value===''?'Não informado':key==='subscription_id'?'Assinatura validada pelo sistema':
    ['starts_at','ends_at'].includes(key)?shopDateTime(value,timezone):typeof value==='boolean'?(value?'Sim':'Não'):
    key.endsWith('_cents')?money(value):key==='duration_minutes'?`${value} min`:key==='occurred_on'&&typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?value.split('-').reverse().join('/'):
    typeof value==='string'&&['method','reason','cost_kind'].includes(key)&&codeNames[value]?codeNames[value]:Array.isArray(value)?value.join(', '):String(value),
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
