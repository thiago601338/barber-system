import { HttpError } from './core'

export const actionTypes = [
  'create_shop', 'create_service', 'create_product', 'create_shop_goal',
  'create_personal_goal', 'create_marketing_task',
] as const
export type ActionType = typeof actionTypes[number]
export type HelpAction = { type: ActionType; label: string; values: Record<string, string | number | null> }

const labels: Record<ActionType, string> = {
  create_shop: 'Criar barbearia',
  create_service: 'Cadastrar serviço',
  create_product: 'Cadastrar produto',
  create_shop_goal: 'Cadastrar meta da barbearia',
  create_personal_goal: 'Cadastrar meta pessoal',
  create_marketing_task: 'Criar tarefa de marketing',
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
  if (type === 'create_shop') {
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
