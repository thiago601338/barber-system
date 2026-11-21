import { HttpError } from './core.ts'

export const actionTypes = [
  'create_shop', 'create_service', 'create_product', 'create_shop_goal',
  'create_personal_goal', 'create_marketing_task',
  'book_appointment', 'create_schedule_block', 'update_service', 'update_product', 'create_client', 'update_client',
  'manage_appointment', 'quick_service', 'register_sale', 'receive_payment', 'cash_register', 'create_expense',
  'stock_entry', 'stock_adjust',
] as const
export type ActionType = typeof actionTypes[number]
export type HelpAction = { type: ActionType; label: string; values: Record<string, string | number | boolean | string[] | null | Record<string, string | number>[]> }

const labels: Record<ActionType, string> = {
  create_shop: 'Criar barbearia',
  create_service: 'Cadastrar serviço',
  create_product: 'Cadastrar produto',
  create_shop_goal: 'Cadastrar meta da barbearia',
  create_personal_goal: 'Cadastrar meta pessoal',
  create_marketing_task: 'Criar tarefa de marketing',
  book_appointment: 'Agendar atendimento',
  create_schedule_block: 'Bloquear horário',
  update_service: 'Atualizar cadastro do serviço',
  update_product: 'Atualizar cadastro do produto',
  create_client: 'Cadastrar cliente',
  update_client: 'Atualizar cadastro do cliente',
  manage_appointment: 'Atualizar agendamento',
  quick_service: 'Registrar atendimento',
  register_sale: 'Registrar venda de produtos',
  receive_payment: 'Receber no caixa',
  cash_register: 'Movimentar caixa',
  create_expense: 'Lançar despesa',
  stock_entry: 'Entrada de estoque',
  stock_adjust: 'Ajuste de estoque',
}

const appointmentOperations = ['confirm', 'arrive', 'undo_arrive', 'start', 'complete', 'no_show', 'cancel', 'reschedule'] as const
const appointmentOperationLabels: Record<typeof appointmentOperations[number], string> = {
  confirm: 'Confirmar presença', arrive: 'Marcar chegada do cliente', undo_arrive: 'Desfazer chegada', start: 'Iniciar atendimento',
  complete: 'Concluir atendimento', no_show: 'Marcar falta', cancel: 'Cancelar agendamento', reschedule: 'Remarcar',
}
const cashOperations = ['open', 'close', 'withdrawal', 'supply'] as const
const paymentMethods = ['cash', 'card', 'pix', 'other'] as const

/** Brazilian phone in the same format used by the quick service screen: (82) 99999-9999. */
export function formatPhone(value: string): string {
  let digits = value.replace(/\D/g, '')
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) digits = digits.slice(2)
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`
  return value.trim()
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(422, 'Não consegui preparar esta ação. Descreva os dados necessários com mais detalhes.')
  return value as Record<string, unknown>
}
function requiredString(value: unknown, label: string, min: number, max: number): string {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) throw new HttpError(422, `Informe ${label} com ${min} a ${max} caracteres.`)
  return value.trim()
}
function optionalString(value: unknown, max: number): string {
  if (value == null || value === '') return ''
  if (typeof value !== 'string' || value.trim().length > max) throw new HttpError(422, 'Um dos textos da ação é longo demais.')
  return value.trim()
}
function whole(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new HttpError(422, `Informe ${label} válido.`)
  return value
}
function decimal(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || Math.abs(Math.round(value * 100) - value * 100) > 0.000001) throw new HttpError(422, `Informe ${label} válido.`)
  return value
}
function dateOnly(value: unknown, label: string, optional = false): string | null {
  if (optional && (value == null || value === '')) return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError(422, `Informe ${label} no formato AAAA-MM-DD.`)
  const parsed = new Date(`${value}T12:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new HttpError(422, `${label} inválida.`)
  return value
}
function recordId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new HttpError(422, `Selecione ${label} na lista autorizada.`)
  return value.toLowerCase()
}
function instant(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || Number.isNaN(Date.parse(value))) throw new HttpError(422, `Informe ${label} com data, hora e fuso.`)
  return new Date(value).toISOString()
}

/** Model output is never an instruction: it becomes one fixed, validated database action. */
export function validateHelpAction(candidate: unknown, allowed: readonly ActionType[]): { action: HelpAction; summary: string } {
  const output = record(candidate)
  if (output.type === 'unsupported') {
    throw new HttpError(422, optionalString(output.reason, 300) || 'Posso cadastrar barbearias, serviços, produtos, metas e tarefas de marketing. Descreva uma dessas ações.')
  }
  if (typeof output.type !== 'string' || !actionTypes.includes(output.type as ActionType)) {
    throw new HttpError(422, 'Esta tarefa ainda não pode ser executada pela Ajuda de IA.')
  }
  const type = output.type as ActionType
  if (!allowed.includes(type)) throw new HttpError(403, 'Seu perfil não permite esta ação.')
  const input = record(output.values)
  let values: HelpAction['values']
  let summary: string
  if (type === 'book_appointment') {
    const client_id = recordId(input.client_id, 'o cliente')
    const barber_membership_id = recordId(input.barber_membership_id, 'o profissional')
    if (!Array.isArray(input.service_ids) || input.service_ids.length<1 || input.service_ids.length>30) throw new HttpError(422, 'Selecione os serviços do atendimento.')
    const service_ids = input.service_ids.map(value => recordId(value, 'um serviço'))
    if (new Set(service_ids).size !== service_ids.length) throw new HttpError(422, 'Não repita o mesmo serviço.')
    const starts_at = instant(input.starts_at, 'o horário do atendimento')
    const subscription_id = input.subscription_id == null || input.subscription_id === '' ? null : recordId(input.subscription_id, 'a assinatura')
    values = { client_id, barber_membership_id, service_ids, starts_at, subscription_id }
    summary = 'Agendar o cliente e os serviços selecionados no horário disponível. A vaga será conferida novamente ao confirmar.'
  } else if (type === 'create_schedule_block') {
    const barber_membership_id = recordId(input.barber_membership_id, 'o profissional')
    const starts_at = instant(input.starts_at, 'o início do bloqueio'); const ends_at = instant(input.ends_at, 'o fim do bloqueio')
    const reason = requiredString(input.reason, 'o motivo do bloqueio', 2, 500)
    const duration = Date.parse(ends_at)-Date.parse(starts_at)
    if (duration<=0 || duration>7*86_400_000) throw new HttpError(422, 'O bloqueio deve terminar depois do início e ter até 7 dias.')
    values = { barber_membership_id, starts_at, ends_at, reason }; summary = `Bloquear o horário selecionado: ${reason}. Nenhum atendimento existente será cancelado.`
  } else if (type === 'update_service' || type === 'update_product') {
    if (['stock_quantity','tax_pct','fee_pct','commission_pct','requires_subscription','image_url','image_path'].some(key => key in input)) throw new HttpError(422, 'Estoque, imagens, taxas e regras de assinatura não mudam por esta ação. Para estoque, use entrada ou ajuste de estoque.')
    const id = recordId(input.id, type === 'update_service' ? 'o serviço' : 'o produto')
    const expected_updated_at = instant(input.expected_updated_at, 'a versão do cadastro')
    values = { id, expected_updated_at }
    if ('name' in input) values.name = requiredString(input.name, 'o nome', 2, 160)
    if ('description' in input) values.description = optionalString(input.description, 1000)
    if ('active' in input) { if (typeof input.active !== 'boolean') throw new HttpError(422, 'Informe se o cadastro ficará ativo.'); values.active = input.active }
    if (type === 'update_service' && 'duration_minutes' in input) values.duration_minutes = whole(input.duration_minutes, 'a duração', 5, 480)
    if ('price_cents' in input) values.price_cents = whole(input.price_cents, 'o preço em centavos', 0, 100_000_000)
    if ('cost_cents' in input) values.cost_cents = whole(input.cost_cents, 'o custo em centavos', 0, 100_000_000)
    if (type === 'update_product') {
      if ('sku' in input) values.sku = optionalString(input.sku, 80)
      if ('category' in input) { if (!['retail','bar','kitchen','supply'].includes(String(input.category))) throw new HttpError(422, 'Categoria inválida.'); values.category = String(input.category) }
    }
    if(Object.keys(values).length===2) throw new HttpError(422, 'Informe pelo menos um campo para atualizar.')
    summary = `Atualizar somente os campos apresentados no ${type === 'update_service' ? 'serviço' : 'produto'} selecionado.${'price_cents' in values ? ` Novo preço: ${reais(values.price_cents as number)}.` : ''}`
  } else if (type === 'create_client' || type === 'update_client') {
    values = type === 'update_client' ? { id:recordId(input.id,'o cliente'),expected_updated_at:instant(input.expected_updated_at,'a versão do cadastro') } : {}
    if(type==='create_client' || 'full_name' in input) values.full_name=requiredString(input.full_name,'o nome do cliente',2,160)
    if('phone' in input) { const phone=optionalString(input.phone,30); if(phone && !/^[+\d ()-]{8,30}$/.test(phone)) throw new HttpError(422,'Telefone inválido.'); values.phone=phone?formatPhone(phone):phone }
    if('email' in input) { const email=optionalString(input.email,254); if(email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(422,'E-mail inválido.'); values.email=email }
    if('notes' in input) values.notes=optionalString(input.notes,2000)
    if(type==='update_client' && Object.keys(values).length===2) throw new HttpError(422,'Informe pelo menos um campo para atualizar.')
    summary = `${type==='create_client'?'Cadastrar':'Atualizar'} o cliente apresentado. O acesso ao cadastro seguirá as permissões e o vínculo do profissional.`
  } else if (type === 'manage_appointment') {
    const appointment_id = recordId(input.appointment_id, 'o agendamento')
    const operation = String(input.operation ?? '')
    if (!(appointmentOperations as readonly string[]).includes(operation)) throw new HttpError(422, 'Diga o que fazer com o agendamento: confirmar, marcar chegada, iniciar, concluir, marcar falta, cancelar ou remarcar.')
    values = { appointment_id, operation }
    if (operation === 'reschedule') values.starts_at = instant(input.starts_at, 'o novo horário')
    if (operation === 'cancel' && input.reason != null) values.reason = optionalString(input.reason, 300)
    summary = `${appointmentOperationLabels[operation as typeof appointmentOperations[number]]} do agendamento selecionado.`
  } else if (type === 'quick_service') {
    const barber_membership_id = recordId(input.barber_membership_id, 'o profissional')
    if (!Array.isArray(input.service_ids) || input.service_ids.length < 1 || input.service_ids.length > 10) throw new HttpError(422, 'Informe os serviços feitos.')
    const service_ids = input.service_ids.map(value => recordId(value, 'um serviço'))
    if (new Set(service_ids).size !== service_ids.length) throw new HttpError(422, 'Não repita o mesmo serviço.')
    const phoneText = typeof input.phone === 'string' || typeof input.phone === 'number' ? String(input.phone) : ''
    const digits = phoneText.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '')
    if (digits.length < 10 || digits.length > 11) throw new HttpError(422, 'Informe o número do cliente com DDD (o atendimento rápido identifica o cliente pelo número).')
    values = { client_name: optionalString(input.client_name, 160), phone: formatPhone(digits), barber_membership_id, service_ids }
    if (input.starts_at != null && input.starts_at !== '') values.starts_at = instant(input.starts_at, 'o horário do atendimento')
    if (input.total_cents != null && input.total_cents !== '') values.total_cents = whole(input.total_cents, 'o valor cobrado em centavos', 0, 100_000_000)
    if (input.method != null && input.method !== '') {
      if (!(paymentMethods as readonly string[]).includes(String(input.method))) throw new HttpError(422, 'Forma de recebimento inválida (dinheiro, cartão, pix ou outro).')
      values.method = String(input.method)
    }
    if (input.notes != null) values.notes = optionalString(input.notes, 300)
    summary = `Registrar o atendimento como feito${values.method ? ' e já recebido no caixa' : ''}. Entra no histórico do cliente, na comissão e nos relatórios.`
  } else if (type === 'register_sale') {
    if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 50) throw new HttpError(422, 'Informe os produtos vendidos.')
    const items = input.items.map(item => { const row = record(item); return { product_id: recordId(row.product_id, 'o produto'), quantity: whole(row.quantity ?? 1, 'a quantidade', 1, 1000) } })
    if (new Set(items.map(item => item.product_id)).size !== items.length) throw new HttpError(422, 'Não repita o mesmo produto; some as quantidades.')
    values = { items: items }
    if (input.client_id != null && input.client_id !== '') values.client_id = recordId(input.client_id, 'o cliente')
    if (input.barber_membership_id != null && input.barber_membership_id !== '') values.barber_membership_id = recordId(input.barber_membership_id, 'o profissional')
    summary = 'Abrir a comanda com os produtos listados e baixar do estoque. O pagamento é recebido no caixa.'
  } else if (type === 'receive_payment') {
    const hasAppointment = input.appointment_id != null && input.appointment_id !== ''
    const hasSale = input.sale_id != null && input.sale_id !== ''
    if (hasAppointment === hasSale) throw new HttpError(422, 'Escolha um atendimento concluído ou uma comanda para receber.')
    if (!Array.isArray(input.methods) || input.methods.length < 1 || input.methods.length > 8) throw new HttpError(422, 'Informe a forma de pagamento.')
    const methods: Record<string, string | number>[] = input.methods.map(item => {
      const row = record(item); const method = String(row.method ?? '')
      if (!(paymentMethods as readonly string[]).includes(method)) throw new HttpError(422, 'Forma de pagamento inválida (dinheiro, cartão, pix ou outro).')
      const entry: Record<string, string | number> = { method }
      if (row.amount_cents != null && row.amount_cents !== '') entry.amount_cents = whole(row.amount_cents, 'o valor recebido em centavos', 1, 2_147_483_647)
      return entry
    })
    if (methods.length > 1 && methods.some(item => !('amount_cents' in item))) throw new HttpError(422, 'Informe o valor de cada forma de pagamento.')
    values = { ...(hasAppointment ? { appointment_id: recordId(input.appointment_id, 'o atendimento') } : { sale_id: recordId(input.sale_id, 'a comanda') }), methods: methods }
    summary = 'Registrar o recebimento no caixa aberto.'
  } else if (type === 'cash_register') {
    const operation = String(input.operation ?? '')
    if (!(cashOperations as readonly string[]).includes(operation)) throw new HttpError(422, 'Diga se é para abrir, fechar, fazer sangria ou colocar troco no caixa.')
    const amount_cents = whole(input.amount_cents, operation === 'close' ? 'o dinheiro contado na gaveta (em centavos)' : 'o valor em centavos', 0, 2_147_483_647)
    values = { operation, amount_cents }
    if (input.notes != null) values.notes = optionalString(input.notes, 300)
    if ((operation === 'withdrawal' || operation === 'supply') && String(values.notes || '').length < 3) throw new HttpError(422, `Informe o motivo da ${operation === 'withdrawal' ? 'sangria' : 'entrada de troco'}.`)
    summary = operation === 'open' ? `Abrir o caixa com ${reais(amount_cents)} na gaveta.` : operation === 'close' ? `Fechar o caixa com ${reais(amount_cents)} contados na gaveta.`
      : operation === 'withdrawal' ? `Retirar ${reais(amount_cents)} do caixa (sangria).` : `Colocar ${reais(amount_cents)} de troco no caixa.`
  } else if (type === 'create_expense') {
    const description = requiredString(input.description, 'a descrição da despesa', 2, 300)
    const category = requiredString(input.category ?? 'Geral', 'a categoria', 2, 80)
    const amount_cents = whole(input.amount_cents, 'o valor da despesa em centavos', 1, 100_000_000)
    values = { description, category, amount_cents }
    const occurred = dateOnly(input.occurred_on, 'a data da despesa', true); if (occurred) values.occurred_on = occurred
    if (input.cost_kind != null && input.cost_kind !== '') {
      if (!['operating','structure','tax','fees','inventory'].includes(String(input.cost_kind))) throw new HttpError(422, 'Tipo de custo inválido.')
      values.cost_kind = String(input.cost_kind)
    }
    if (input.barber_membership_id != null && input.barber_membership_id !== '') values.barber_membership_id = recordId(input.barber_membership_id, 'o profissional')
    summary = `Lançar a despesa ${description}, de ${reais(amount_cents)}.`
  } else if (type === 'stock_entry') {
    if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 100) throw new HttpError(422, 'Informe os produtos que chegaram.')
    const items = input.items.map(item => {
      const row = record(item)
      const entry: Record<string, string | number> = { product_id: recordId(row.product_id, 'o produto'), quantity: whole(row.quantity, 'a quantidade', 1, 100_000) }
      if (row.unit_cost_cents != null && row.unit_cost_cents !== '') entry.unit_cost_cents = whole(row.unit_cost_cents, 'o custo unitário em centavos', 0, 100_000_000)
      return entry
    })
    if (new Set(items.map(item => item.product_id)).size !== items.length) throw new HttpError(422, 'Não repita o mesmo produto na entrada.')
    values = { items: items, paid: input.paid === true }
    if (input.invoice != null) values.invoice = optionalString(input.invoice, 120)
    summary = 'Dar entrada dos produtos no estoque. Sem custo informado, usa o custo atual do produto.'
  } else if (type === 'stock_adjust') {
    const product_id = recordId(input.product_id, 'o produto')
    const reason = String(input.reason ?? '')
    if (!['internal_use','loss','adjustment'].includes(reason)) throw new HttpError(422, 'Diga se é consumo interno, perda ou ajuste de inventário.')
    const quantity = whole(input.quantity, 'a quantidade', -100_000, 100_000)
    if (quantity === 0) throw new HttpError(422, 'Informe a quantidade.')
    const notes = requiredString(input.notes, 'a justificativa do ajuste', 3, 300)
    values = { product_id, reason, quantity, notes }
    summary = 'Ajustar o estoque do produto selecionado.'
  } else if (type === 'create_shop') {
    const name = requiredString(input.name, 'o nome da barbearia', 2, 160)
    const slug = requiredString(input.slug, 'o endereço público', 2, 80).toLowerCase()
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new HttpError(422, 'O endereço público deve usar letras minúsculas, números e hífens.')
    values = { name, slug }
    summary = `Criar a barbearia ${name} com endereço /b/${slug}.`
  } else if (type === 'create_service') {
    const name = requiredString(input.name, 'o nome do serviço', 2, 160)
    const description = optionalString(input.description, 1000)
    const duration_minutes = whole(input.duration_minutes, 'a duração em minutos', 5, 480)
    const price_cents = whole(input.price_cents, 'o preço em centavos', 0, 100_000_000)
    const cost_cents = whole(input.cost_cents ?? 0, 'o custo em centavos', 0, 100_000_000)
    values = { name, description, duration_minutes, price_cents, cost_cents }
    summary = `Cadastrar o serviço ${name}, ${duration_minutes} min, por R$ ${(price_cents / 100).toFixed(2).replace('.', ',')}.`
  } else if (type === 'create_product') {
    const name = requiredString(input.name, 'o nome do produto', 2, 160)
    const description = optionalString(input.description, 1000)
    const sku = optionalString(input.sku, 80)
    const category = input.category ?? 'retail'
    if (!['retail', 'bar', 'kitchen', 'supply'].includes(String(category))) throw new HttpError(422, 'Categoria de produto inválida.')
    const price_cents = whole(input.price_cents, 'o preço em centavos', 0, 100_000_000)
    const cost_cents = whole(input.cost_cents ?? 0, 'o custo em centavos', 0, 100_000_000)
    const stock_quantity = whole(input.stock_quantity ?? 0, 'a quantidade em estoque', 0, 1_000_000)
    values = { name, description, sku, category: String(category), price_cents, cost_cents, stock_quantity }
    summary = `Cadastrar ${name} no catálogo, por R$ ${(price_cents / 100).toFixed(2).replace('.', ',')}, com estoque ${stock_quantity}. A foto poderá ser adicionada depois.`
  } else if (type === 'create_shop_goal' || type === 'create_personal_goal') {
    const title = requiredString(input.title, 'o título da meta', 2, 160)
    const metric = input.metric
    if (metric !== 'revenue' && metric !== 'appointments') throw new HttpError(422, 'Use receita ou atendimentos como indicador da meta.')
    const target_value = metric === 'appointments'
      ? whole(input.target_value, 'o número de atendimentos', 1, 1_000_000)
      : decimal(input.target_value, 'o valor alvo em reais', 0.01, 1_000_000_000)
    const period_start = dateOnly(input.period_start, 'a data inicial')!
    const period_end = dateOnly(input.period_end, 'a data final')!
    const days = (Date.parse(`${period_end}T12:00:00Z`) - Date.parse(`${period_start}T12:00:00Z`)) / 86_400_000
    if (days < 0 || days > 366) throw new HttpError(422, 'O período da meta deve ter até 367 dias e terminar após o início.')
    values = { title, metric, target_value, period_start, period_end }
    summary = `Cadastrar a meta ${title} para ${type === 'create_personal_goal' ? 'o profissional' : 'a barbearia'}, de ${period_start} a ${period_end}.`
  } else {
    const title = requiredString(input.title, 'a tarefa de marketing', 2, 200)
    const channel = input.channel
    if (channel !== 'organic' && channel !== 'paid') throw new HttpError(422, 'Escolha tráfego orgânico ou pago para a tarefa.')
    const due_on = dateOnly(input.due_on, 'o prazo', true)
    values = { title, channel, due_on }
    summary = `Criar a tarefa ${title} em marketing ${channel === 'paid' ? 'pago' : 'orgânico'}${due_on ? `, com prazo em ${due_on}` : ''}.`
  }
  return { action: { type, label: labels[type], values }, summary }
}

export function actionLabel(type: ActionType): string { return labels[type] }

function reais(cents: number): string { return `R$ ${(cents / 100).toFixed(2).replace('.', ',')}` }
