import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatCompletionTool } from 'openai/resources/chat/completions'
import type { HelpAccess } from './aiHelpAccess'
import type { ActionType } from './aiHelpActions'
import { HttpError } from './core.ts'

/** Lookups the Ajuda de IA can run before proposing an action. All reads are scoped to the shop and to the user's profile. */

type Row = Record<string, unknown>
type Catalog = { barbers: Row[]; services: Row[]; products: Row[] }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY = /^\d{4}-\d{2}-\d{2}$/
const statusNames: Record<string, string> = {
  pending: 'agendado', confirmed: 'confirmado', in_progress: 'em atendimento', completed: 'concluído', cancelled: 'cancelado', no_show: 'falta',
}

export function brMoneyText(text: string): string {
  return text.replace(/R\$ ?(-?\d+)\.(\d{2})\b/g, 'R$ $1,$2')
}

function reais(cents: unknown): string {
  return `R$ ${(Number(cents || 0) / 100).toFixed(2).replace('.', ',')}`
}

/** Wall clock in the shop zone to an instant (same approach as the agenda screens). */
export function zonedInstant(day: string, time: string, timezone: string): Date {
  const nominal = Date.parse(`${day}T${time}:00Z`)
  const format = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const wall = (instant: number) => {
    const p = Object.fromEntries(format.formatToParts(new Date(instant)).map(part => [part.type, part.value]))
    return Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`)
  }
  let instant = nominal
  for (let i = 0; i < 4; i++) { const difference = nominal - wall(instant); if (!difference) break; instant += difference }
  return new Date(instant)
}

function localParts(value: unknown, timezone: string) {
  const date = new Date(String(value))
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' })
    .formatToParts(date).map(part => [part.type, part.value]))
  return { day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, br: `${p.day}/${p.month}` }
}

function isoWithOffset(value: unknown, timezone: string): string {
  const instant = new Date(String(value))
  const { day, time } = localParts(instant, timezone)
  const offsetMinutes = Math.round((Date.parse(`${day}T${time}:00Z`) - instant.getTime()) / 60000)
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMinutes)
  return `${day}T${time}:00${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`
}

function need<T>(result: { data: T; error: unknown }): T {
  if (result.error) throw result.error
  return result.data
}

export async function loadCatalog(client: SupabaseClient, access: HelpAccess): Promise<Catalog> {
  if (!access.shopId) return { barbers: [], services: [], products: [] }
  const shop = access.shopId
  const admin = access.role !== 'barber'
  const [barbers, services, products] = await Promise.all([
    client.from('memberships').select('id,display_name').eq('barbershop_id', shop).eq('active', true).eq('role', 'barber').order('display_name').limit(60),
    client.from('services').select(admin ? 'id,name,price_cents,cost_cents,duration_minutes,active,requires_subscription,category,updated_at' : 'id,name,price_cents,duration_minutes,active,requires_subscription,category')
      .eq('barbershop_id', shop).order('name').limit(250),
    admin || access.modules.includes('products')
      ? client.from('products').select(admin ? 'id,name,price_cents,cost_cents,stock_quantity,category,sku,active,updated_at' : 'id,name,price_cents,stock_quantity,category,active')
        .eq('barbershop_id', shop).order('name').limit(250)
      : Promise.resolve({ data: [], error: null }),
  ])
  return {
    barbers: (need(barbers) as unknown as Row[] || []).map(row => ({ id: row.id, nome: row.display_name, ...(access.role === 'barber' && row.id === access.memberId ? { voce: true } : {}) })),
    services: (need(services) as unknown as Row[] || []),
    products: (need(products) as unknown as Row[] || []),
  }
}

export function helpTools(allowed: readonly ActionType[], role: HelpAccess['role'], hasShop: boolean): ChatCompletionTool[] {
  const list: ChatCompletionTool[] = [
    { type: 'function', function: { name: 'responder', description: 'Resposta final em texto para o usuário: dúvida respondida, orientação, pergunta curta pedindo o que falta, ou explicação de por que não dá para fazer.',
      parameters: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] } } },
  ]
  if (allowed.length) list.push({ type: 'function', function: { name: 'propor_acao', description: 'Final: prepara UMA ação para o usuário confirmar com um clique. O servidor valida; se voltar erro, corrija e tente de novo.',
    parameters: { type: 'object', properties: {
      tipo: { type: 'string', enum: [...allowed] },
      valores: { type: 'object', description: 'Campos da ação, conforme a lista de ações nas instruções.' },
      observacao: { type: 'string', description: 'Opcional: frase curta para o usuário (ex.: o próximo passo depois de confirmar).' },
    }, required: ['tipo', 'valores'] } } })
  if (!hasShop) return list
  list.push(
    { type: 'function', function: { name: 'buscar_clientes', description: 'Procura clientes da barbearia por nome (parte do nome serve) ou telefone. Devolve id, nome, final do telefone, updated_at e última visita.',
      parameters: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] } } },
    { type: 'function', function: { name: 'agenda', description: 'Lista os agendamentos de um dia (com id, horário, cliente, profissional, serviços, status, chegada e valores). Com cliente_id e sem data, lista os agendamentos recentes e futuros do cliente.',
      parameters: { type: 'object', properties: { data: { type: 'string', description: 'AAAA-MM-DD' }, barbeiro_id: { type: 'string' }, cliente_id: { type: 'string' } } } } },
  )
  if (allowed.includes('book_appointment')) list.push({ type: 'function', function: { name: 'horarios_livres', description: 'Horários livres para agendar os serviços em uma data. Sem barbeiro_id, consulta todos os profissionais. Precisa do cliente (para checar assinatura).',
    parameters: { type: 'object', properties: { data: { type: 'string', description: 'AAAA-MM-DD' }, servicos: { type: 'array', items: { type: 'string' }, description: 'IDs dos serviços' },
      cliente_id: { type: 'string' }, barbeiro_id: { type: 'string' }, a_partir_de: { type: 'string', description: 'HH:MM (opcional)' } }, required: ['data', 'servicos', 'cliente_id'] } } })
  if (allowed.includes('manage_appointment')) list.push({ type: 'function', function: { name: 'horarios_para_remarcar', description: 'Horários livres para remarcar um agendamento existente numa data (mesmo profissional e serviços).',
    parameters: { type: 'object', properties: { agendamento_id: { type: 'string' }, data: { type: 'string', description: 'AAAA-MM-DD' }, a_partir_de: { type: 'string', description: 'HH:MM (opcional)' } }, required: ['agendamento_id', 'data'] } } })
  if (role !== 'barber') list.push({ type: 'function', function: { name: 'caixa_e_pendencias', description: 'Situação do caixa (aberto ou fechado, dinheiro esperado na gaveta) e o que falta receber: atendimentos avulsos concluídos e comandas em aberto, com ids e saldo.',
    parameters: { type: 'object', properties: { cliente_id: { type: 'string', description: 'Opcional: só as pendências deste cliente' } } } } })
  return list
}

export async function runHelpTool(client: SupabaseClient, access: HelpAccess, actorId: string, catalog: Catalog, name: string, args: Row): Promise<unknown> {
  const shop = access.shopId
  if (!shop) throw new HttpError(422, 'Consulta disponível só dentro de uma barbearia.')
  const tz = access.timezone
  if (name === 'buscar_clientes') {
    const text = String(args.texto ?? '').slice(0, 120)
    const { data, error } = await client.rpc('ai_help_find_clients', { p_actor_id: actorId, p_barbershop_id: shop, p_query: text })
    if (error) throw new HttpError(422, error.message)
    const rows = (data || []) as Row[]
    return rows.length ? { clientes: rows, observacao: rows.length >= 12 ? 'Mostrando os 12 primeiros; refine o nome se não achar.' : undefined } : { clientes: [], observacao: 'Nenhum cliente encontrado com esse nome ou telefone.' }
  }
  if (name === 'agenda') {
    const day = typeof args.data === 'string' && DAY.test(args.data) ? args.data : null
    const clientId = typeof args.cliente_id === 'string' && UUID.test(args.cliente_id) ? args.cliente_id : null
    const barberId = typeof args.barbeiro_id === 'string' && UUID.test(args.barbeiro_id) ? args.barbeiro_id : null
    if (!day && !clientId) throw new HttpError(422, 'Informe a data (AAAA-MM-DD) ou o cliente_id.')
    let query = client.from('appointments').select('id,client_id,barber_membership_id,subscription_id,starts_at,ends_at,status,arrived_at,total_price_cents,client_confirmed_at')
      .eq('barbershop_id', shop)
    if (access.role === 'barber') query = query.eq('barber_membership_id', access.memberId!)
    if (barberId) query = query.eq('barber_membership_id', barberId)
    if (clientId) query = query.eq('client_id', clientId)
    if (day) {
      const start = zonedInstant(day, '00:00', tz)
      const next = new Date(Date.parse(`${day}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
      query = query.gte('starts_at', start.toISOString()).lt('starts_at', zonedInstant(next, '00:00', tz).toISOString())
    } else query = query.gte('starts_at', new Date(Date.now() - 45 * 86_400_000).toISOString())
    const rows = (need(await query.order('starts_at').limit(120)) || []) as Row[]
    if (!rows.length) return { agendamentos: [], observacao: 'Nenhum agendamento encontrado.' }
    const ids = rows.map(row => String(row.id))
    const clientIds = [...new Set(rows.map(row => String(row.client_id)).filter(Boolean))]
    const [clients, links, payments] = await Promise.all([
      client.from('clients').select('id,full_name').eq('barbershop_id', shop).in('id', clientIds),
      client.from('appointment_services').select('appointment_id,service_id').eq('barbershop_id', shop).in('appointment_id', ids),
      access.role !== 'barber' ? client.from('payments').select('appointment_id,amount_cents,status').eq('barbershop_id', shop).in('appointment_id', ids).in('status', ['paid', 'approved'])
        : Promise.resolve({ data: [], error: null }),
    ])
    const clientName = new Map((need(clients) as Row[] || []).map(row => [String(row.id), String(row.full_name)]))
    const serviceName = new Map(catalog.services.map(row => [String(row.id), String(row.name)]))
    const barberName = new Map(catalog.barbers.map(row => [String(row.id), String(row.nome)]))
    const servicesOf = new Map<string, string[]>()
    for (const link of need(links) as Row[] || []) servicesOf.set(String(link.appointment_id), [...(servicesOf.get(String(link.appointment_id)) || []), serviceName.get(String(link.service_id)) || 'Serviço'])
    const paid = new Map<string, number>()
    for (const payment of need(payments) as Row[] || []) paid.set(String(payment.appointment_id), (paid.get(String(payment.appointment_id)) || 0) + Number(payment.amount_cents || 0))
    return { fuso: tz, agendamentos: rows.map(row => {
      const when = localParts(row.starts_at, tz)
      return {
        id: row.id, data: when.day, inicio: when.time, fim: localParts(row.ends_at, tz).time,
        cliente: clientName.get(String(row.client_id)) || 'Cliente', cliente_id: row.client_id,
        profissional: barberName.get(String(row.barber_membership_id)) || 'Profissional', profissional_id: row.barber_membership_id,
        servicos: (servicesOf.get(String(row.id)) || []).join(', '), status: statusNames[String(row.status)] || row.status,
        chegou: Boolean(row.arrived_at), confirmado_pelo_cliente: Boolean(row.client_confirmed_at), assinatura: Boolean(row.subscription_id),
        valor: reais(row.total_price_cents),
        ...(access.role !== 'barber' && row.status === 'completed' && !row.subscription_id ? { recebido: reais(paid.get(String(row.id)) || 0), falta_receber: reais(Math.max(0, Number(row.total_price_cents || 0) - (paid.get(String(row.id)) || 0))) } : {}),
      }
    }) }
  }
  if (name === 'horarios_livres') {
    const day = String(args.data ?? '')
    if (!DAY.test(day)) throw new HttpError(422, 'Informe a data no formato AAAA-MM-DD.')
    const clientId = String(args.cliente_id ?? '')
    if (!UUID.test(clientId)) throw new HttpError(422, 'Busque o cliente primeiro (buscar_clientes) e use o id dele.')
    const services = Array.isArray(args.servicos) ? args.servicos.map(String).filter(value => UUID.test(value)) : []
    if (!services.length) throw new HttpError(422, 'Informe os IDs dos serviços do catálogo.')
    let barbers = catalog.barbers.map(row => String(row.id))
    if (access.role === 'barber') barbers = [access.memberId!]
    if (typeof args.barbeiro_id === 'string' && UUID.test(args.barbeiro_id)) barbers = barbers.filter(id => id === args.barbeiro_id)
    if (!barbers.length) throw new HttpError(422, 'Profissional fora do seu acesso.')
    const after = typeof args.a_partir_de === 'string' && /^\d{2}:\d{2}$/.test(args.a_partir_de) ? args.a_partir_de : null
    const result = await Promise.all(barbers.slice(0, 15).map(async barber => {
      const { data, error } = await client.rpc('ai_help_available_slots', { p_actor_id: actorId, p_barbershop_id: shop, p_client_id: clientId, p_member_id: barber, p_service_ids: services, p_day: day })
      if (error) return { profissional_id: barber, erro: brMoneyText(error.message) }
      const slots = ((data || []) as Row[]).map(slot => {
        const eligibility = (slot.eligibility || {}) as Row
        return { hora: localParts(slot.starts_at, tz).time, starts_at: isoWithOffset(slot.starts_at, tz),
          ...(eligibility.requires_subscription ? { exige_assinatura: true } : {}),
          ...(eligibility.eligible === false ? { indisponivel_para_o_cliente: eligibility.reason || true } : {}),
          ...(Array.isArray(eligibility.subscriptions) && eligibility.subscriptions.length ? { assinaturas: eligibility.subscriptions } : {}) }
      }).filter(slot => !after || slot.hora >= after)
      return { profissional: catalog.barbers.find(row => row.id === barber)?.nome || 'Profissional', profissional_id: barber, horarios: slots.slice(0, 40) }
    }))
    return { data: day, fuso: tz, por_profissional: result.filter(item => 'erro' in item || (item.horarios?.length ?? 0) > 0),
      observacao: result.every(item => !('horarios' in item) || !item.horarios?.length) ? 'Sem vagas nessa data para esses serviços. Tente outro dia.' : undefined }
  }
  if (name === 'horarios_para_remarcar') {
    const day = String(args.data ?? '')
    if (!DAY.test(day)) throw new HttpError(422, 'Informe a data no formato AAAA-MM-DD.')
    const appointment = String(args.agendamento_id ?? '')
    if (!UUID.test(appointment)) throw new HttpError(422, 'Use o id do agendamento que veio da agenda.')
    const { data, error } = await client.rpc('ai_help_reschedule_slots', { p_actor_id: actorId, p_barbershop_id: shop, p_appointment_id: appointment, p_day: day })
    if (error) throw new HttpError(422, error.message)
    const after = typeof args.a_partir_de === 'string' && /^\d{2}:\d{2}$/.test(args.a_partir_de) ? args.a_partir_de : null
    const slots = ((data || []) as Row[]).map(slot => ({ hora: localParts(slot.starts_at, tz).time, starts_at: isoWithOffset(slot.starts_at, tz) })).filter(slot => !after || slot.hora >= after)
    return { data: day, fuso: tz, horarios: slots.slice(0, 60), observacao: slots.length ? undefined : 'Sem vagas nessa data. Tente outro dia.' }
  }
  if (name === 'caixa_e_pendencias') {
    if (access.role === 'barber') throw new HttpError(403, 'Somente a administração consulta o caixa.')
    const clientId = typeof args.cliente_id === 'string' && UUID.test(args.cliente_id) ? args.cliente_id : null
    const sessions = need(await client.from('cash_sessions').select('id,opening_cents,opened_at').eq('barbershop_id', shop).is('closed_at', null).order('opened_at', { ascending: false }).limit(1)) as Row[] || []
    let cash: Row = { aberto: false }
    if (sessions[0]) {
      const moves = need(await client.from('cash_movements').select('kind,amount_cents').eq('session_id', sessions[0].id).eq('method', 'cash')) as Row[] || []
      const expected = Number(sessions[0].opening_cents || 0) + moves.reduce((sum, move) => sum + (['receipt', 'supply'].includes(String(move.kind)) ? 1 : -1) * Number(move.amount_cents || 0), 0)
      cash = { aberto: true, desde: `${localParts(sessions[0].opened_at, tz).br} ${localParts(sessions[0].opened_at, tz).time}`, abertura: reais(sessions[0].opening_cents), dinheiro_esperado_na_gaveta: reais(expected) }
    }
    let appointmentQuery = client.from('appointments').select('id,client_id,barber_membership_id,starts_at,total_price_cents').eq('barbershop_id', shop).eq('status', 'completed')
      .is('subscription_id', null).gt('total_price_cents', 0).gte('starts_at', new Date(Date.now() - 21 * 86_400_000).toISOString())
    let saleQuery = client.from('sales').select('id,client_id,total_cents,created_at,status').eq('barbershop_id', shop).in('status', ['open', 'delivered'])
      .gte('created_at', new Date(Date.now() - 60 * 86_400_000).toISOString())
    if (clientId) { appointmentQuery = appointmentQuery.eq('client_id', clientId); saleQuery = saleQuery.eq('client_id', clientId) }
    const [appointments, sales] = await Promise.all([appointmentQuery.order('starts_at', { ascending: false }).limit(200), saleQuery.order('created_at', { ascending: false }).limit(100)])
    const appointmentRows = need(appointments) as Row[] || []
    const saleRows = need(sales) as Row[] || []
    const [appointmentPayments, salePayments, clients, links, items] = await Promise.all([
      appointmentRows.length ? client.from('payments').select('appointment_id,amount_cents').eq('barbershop_id', shop).in('status', ['paid', 'approved']).in('appointment_id', appointmentRows.map(row => String(row.id))) : Promise.resolve({ data: [], error: null }),
      saleRows.length ? client.from('payments').select('sale_id,amount_cents').eq('barbershop_id', shop).in('status', ['paid', 'approved']).in('sale_id', saleRows.map(row => String(row.id))) : Promise.resolve({ data: [], error: null }),
      client.from('clients').select('id,full_name').eq('barbershop_id', shop).in('id', [...new Set([...appointmentRows, ...saleRows].map(row => String(row.client_id)).filter(id => UUID.test(id)))]),
      appointmentRows.length ? client.from('appointment_services').select('appointment_id,service_id').eq('barbershop_id', shop).in('appointment_id', appointmentRows.map(row => String(row.id))) : Promise.resolve({ data: [], error: null }),
      saleRows.length ? client.from('sale_items').select('sale_id,description,quantity').eq('barbershop_id', shop).in('sale_id', saleRows.map(row => String(row.id))) : Promise.resolve({ data: [], error: null }),
    ])
    const sum = (rows: Row[], key: string) => rows.reduce((map, row) => map.set(String(row[key]), (map.get(String(row[key])) || 0) + Number(row.amount_cents || 0)), new Map<string, number>())
    const paidAppointments = sum(need(appointmentPayments) as Row[] || [], 'appointment_id')
    const paidSales = sum(need(salePayments) as Row[] || [], 'sale_id')
    const clientName = new Map((need(clients) as Row[] || []).map(row => [String(row.id), String(row.full_name)]))
    const serviceName = new Map(catalog.services.map(row => [String(row.id), String(row.name)]))
    const servicesOf = new Map<string, string[]>()
    for (const link of need(links) as Row[] || []) servicesOf.set(String(link.appointment_id), [...(servicesOf.get(String(link.appointment_id)) || []), serviceName.get(String(link.service_id)) || 'Serviço'])
    const itemsOf = new Map<string, string[]>()
    for (const item of need(items) as Row[] || []) itemsOf.set(String(item.sale_id), [...(itemsOf.get(String(item.sale_id)) || []), `${item.quantity}x ${item.description}`])
    const pendingAppointments = appointmentRows.map(row => ({ row, remaining: Number(row.total_price_cents || 0) - (paidAppointments.get(String(row.id)) || 0) })).filter(item => item.remaining > 0).slice(0, 40)
      .map(({ row, remaining }) => ({ appointment_id: row.id, quando: `${localParts(row.starts_at, tz).br} ${localParts(row.starts_at, tz).time}`, cliente: clientName.get(String(row.client_id)) || 'Cliente',
        profissional: catalog.barbers.find(barber => barber.id === row.barber_membership_id)?.nome || 'Profissional', servicos: (servicesOf.get(String(row.id)) || []).join(', '), falta_receber: reais(remaining), falta_receber_cents: remaining }))
    const pendingSales = saleRows.map(row => ({ row, remaining: Number(row.total_cents || 0) - (paidSales.get(String(row.id)) || 0) })).filter(item => item.remaining > 0).slice(0, 30)
      .map(({ row, remaining }) => ({ sale_id: row.id, quando: `${localParts(row.created_at, tz).br} ${localParts(row.created_at, tz).time}`, cliente: clientName.get(String(row.client_id)) || 'Cliente avulso',
        itens: (itemsOf.get(String(row.id)) || []).join(', '), falta_receber: reais(remaining), falta_receber_cents: remaining }))
    return { caixa: cash, atendimentos_a_receber: pendingAppointments, comandas_a_receber: pendingSales }
  }
  throw new HttpError(422, 'Consulta desconhecida.')
}
