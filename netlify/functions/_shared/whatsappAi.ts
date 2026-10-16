import type { SupabaseClient } from '@supabase/supabase-js'
import OpenAI, { toFile } from 'openai'
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions'
import { downloadMedia } from './whatsapp'

// Cérebro do atendimento por IA no WhatsApp: monta o contexto da barbearia e conversa com o modelo,
// usando ferramentas para consultar horários livres e agendar.

export type AiSettings = { ai_instructions: string | null; ai_can_book: boolean }
export type Conversation = { id: string; barbershop_id: string; wa_id: string; contact_name: string | null; client_id: string | null; ai_paused_until: string | null }
export type ChatTurn = { role: 'user' | 'assistant'; content: string }

const MODEL = 'gpt-5.4-mini'

type Shop = { id: string; name: string; slug: string; timezone: string | null; address: string | null; phone: string | null; whatsapp: string | null; instagram_url: string | null }
type Service = { id: string; name: string; description: string | null; duration_minutes: number; price_cents: number; requires_subscription: boolean }
type Barber = { id: string; display_name: string }
type Slot = { starts_at: string; ends_at: string }

const money = (cents: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)

function localParts(date: Date, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(p => [p.type, p.value]))
  return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` }
}

function calendar(timeZone: string): string {
  const lines: string[] = []
  for (let offset = 0; offset < 21; offset++) {
    const date = new Date(Date.now() + offset * 86_400_000)
    const label = new Intl.DateTimeFormat('pt-BR', { timeZone, weekday: 'long', day: '2-digit', month: '2-digit' }).format(date)
    lines.push(`${localParts(date, timeZone).day} = ${label}${offset === 0 ? ' (hoje)' : offset === 1 ? ' (amanhã)' : ''}`)
  }
  return lines.join('\n')
}

class Bot {
  clientId: string | null
  constructor(private client: SupabaseClient, private shop: Shop, private conversation: Conversation | null, private services: Service[], private barbers: Barber[], private tz: string) {
    this.clientId = conversation?.client_id ?? null
  }

  async ensureClient(): Promise<string> {
    if (this.clientId) return this.clientId
    if (!this.conversation) throw new Error('Teste: sem cliente real.')
    const { data, error } = await this.client.rpc('whatsapp_bot_client', { p_barbershop_id: this.shop.id, p_wa_id: this.conversation.wa_id, p_name: this.conversation.contact_name })
    if (error) throw new Error(error.message)
    this.clientId = data as string
    await this.client.from('whatsapp_conversations').update({ client_id: this.clientId }).eq('id', this.conversation.id)
    return this.clientId
  }

  serviceIds(value: unknown): string[] {
    const ids = Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
    const valid = ids.filter(id => this.services.some(s => s.id === id))
    if (!valid.length) throw new Error('Informe ao menos um serviço válido da lista.')
    return valid
  }

  barberIds(value: unknown): string[] {
    if (typeof value === 'string' && value) {
      if (!this.barbers.some(b => b.id === value)) throw new Error('Profissional não encontrado.')
      return [value]
    }
    return this.barbers.map(b => b.id)
  }

  day(value: unknown): string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Data inválida: use AAAA-MM-DD.')
    const today = localParts(new Date(), this.tz).day
    if (value < today) throw new Error('Essa data já passou.')
    if (Date.parse(`${value}T12:00:00Z`) - Date.now() > 90 * 86_400_000) throw new Error('Só é possível agendar até 90 dias à frente.')
    return value
  }

  async slots(barberId: string, services: string[], day: string): Promise<Slot[]> {
    const { data, error } = await this.client.rpc('available_slots', { p_barbershop_id: this.shop.id, p_barber_membership_id: barberId, p_service_ids: services, p_day: day })
    if (error) throw new Error(error.message)
    const minimum = Date.now() + 15 * 60_000
    return ((data ?? []) as Slot[]).filter(slot => Date.parse(slot.starts_at) >= minimum)
  }

  async run(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (name === 'horarios_disponiveis') {
      const services = this.serviceIds(args.servicos)
      const day = this.day(args.data)
      const result = []
      for (const barberId of this.barberIds(args.barbeiro_id)) {
        const slots = await this.slots(barberId, services, day)
        result.push({ barbeiro_id: barberId, barbeiro: this.barbers.find(b => b.id === barberId)?.display_name, horarios: slots.map(s => localParts(new Date(s.starts_at), this.tz).time) })
      }
      return { data: day, profissionais: result }
    }
    if (name === 'agendar') {
      const services = this.serviceIds(args.servicos)
      const [barberId] = this.barberIds(args.barbeiro_id)
      if (typeof args.barbeiro_id !== 'string') throw new Error('Escolha o profissional antes de agendar.')
      const day = this.day(args.data)
      const time = typeof args.hora === 'string' && /^\d{2}:\d{2}$/.test(args.hora) ? args.hora : ''
      if (!time) throw new Error('Hora inválida: use HH:MM.')
      const slot = (await this.slots(barberId, services, day)).find(s => localParts(new Date(s.starts_at), this.tz).time === time)
      if (!slot) return { ok: false, erro: 'Esse horário não está mais disponível. Consulte os horários de novo.' }
      if (!this.conversation) return { ok: true, simulacao: 'Teste no painel: nada foi gravado na agenda.', resumo: { servicos: this.services.filter(s => services.includes(s.id)).map(s => s.name), profissional: this.barbers.find(b => b.id === barberId)?.display_name, data: day, hora: time } }
      const clientId = await this.ensureClient()
      const { data, error } = await this.client.rpc('whatsapp_bot_book', { p_barbershop_id: this.shop.id, p_client_id: clientId, p_barber_membership_id: barberId, p_service_ids: services, p_starts_at: slot.starts_at })
      if (error) return { ok: false, erro: error.message }
      const total = this.services.filter(s => services.includes(s.id)).reduce((sum, s) => sum + s.price_cents, 0)
      return { ok: true, agendamento_id: data, resumo: { servicos: this.services.filter(s => services.includes(s.id)).map(s => s.name), profissional: this.barbers.find(b => b.id === barberId)?.display_name, data: day, hora: time, total: money(total) } }
    }
    if (name === 'meus_agendamentos') {
      if (!this.conversation) return { agendamentos: [], simulacao: 'Teste no painel: cliente fictício sem agendamentos.' }
      const clientId = await this.ensureClient()
      const { data, error } = await this.client.from('appointments')
        .select('id,starts_at,status,barber_membership_id,appointment_services(services(name))')
        .eq('barbershop_id', this.shop.id).eq('client_id', clientId).in('status', ['pending', 'confirmed'])
        .gte('starts_at', new Date().toISOString()).order('starts_at').limit(5)
      if (error) throw new Error(error.message)
      return { agendamentos: (data ?? []).map(row => {
        const local = localParts(new Date(row.starts_at as string), this.tz)
        const items = (row.appointment_services as unknown as { services: { name: string } | null }[] | null) ?? []
        return { agendamento_id: row.id, data: local.day, hora: local.time, profissional: this.barbers.find(b => b.id === row.barber_membership_id)?.display_name || 'Profissional', servicos: items.map(i => i.services?.name).filter(Boolean) }
      }) }
    }
    if (name === 'cancelar_agendamento') {
      if (!this.conversation) return { ok: true, simulacao: 'Teste no painel: nada foi cancelado.' }
      const clientId = await this.ensureClient()
      if (typeof args.agendamento_id !== 'string') throw new Error('Informe o agendamento.')
      const { error } = await this.client.rpc('whatsapp_bot_cancel', { p_barbershop_id: this.shop.id, p_client_id: clientId, p_appointment_id: args.agendamento_id })
      return error ? { ok: false, erro: error.message } : { ok: true }
    }
    if (name === 'chamar_atendente') {
      if (this.conversation) await this.client.from('whatsapp_conversations').update({ ai_paused_until: new Date(Date.now() + 7 * 86_400_000).toISOString() }).eq('id', this.conversation.id)
      return { ok: true, instrucao: 'Avise o cliente que uma pessoa da equipe vai continuar o atendimento por aqui em breve. Não responda mais nada depois disso.' }
    }
    throw new Error('Ferramenta desconhecida.')
  }
}

function tools(canBook: boolean): ChatCompletionTool[] {
  const list: ChatCompletionTool[] = [
    { type: 'function', function: { name: 'horarios_disponiveis', description: 'Consulta os horários livres na agenda para os serviços escolhidos em uma data. Sem barbeiro_id, consulta todos os profissionais.', parameters: { type: 'object', properties: { data: { type: 'string', description: 'AAAA-MM-DD' }, servicos: { type: 'array', items: { type: 'string' }, description: 'IDs dos serviços' }, barbeiro_id: { type: 'string', description: 'ID do profissional (opcional)' } }, required: ['data', 'servicos'] } } },
    { type: 'function', function: { name: 'chamar_atendente', description: 'Passa a conversa para uma pessoa da equipe (reclamação, pagamento, pedido para falar com humano, assunto que você não consegue resolver).', parameters: { type: 'object', properties: { motivo: { type: 'string' } }, required: ['motivo'] } } },
  ]
  if (canBook) list.push(
    { type: 'function', function: { name: 'agendar', description: 'Cria o agendamento. Só use depois que o cliente confirmar serviço, profissional, data e hora.', parameters: { type: 'object', properties: { servicos: { type: 'array', items: { type: 'string' } }, barbeiro_id: { type: 'string' }, data: { type: 'string', description: 'AAAA-MM-DD' }, hora: { type: 'string', description: 'HH:MM' } }, required: ['servicos', 'barbeiro_id', 'data', 'hora'] } } },
    { type: 'function', function: { name: 'meus_agendamentos', description: 'Lista os próximos agendamentos deste cliente.', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'cancelar_agendamento', description: 'Cancela um agendamento futuro do cliente. Só use depois que o cliente confirmar o cancelamento.', parameters: { type: 'object', properties: { agendamento_id: { type: 'string' } }, required: ['agendamento_id'] } } },
  )
  return list
}

function systemPrompt(shop: Shop, services: Service[], barbers: Barber[], connection: AiSettings, tz: string, contactName: string | null): string {
  const now = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, dateStyle: 'full', timeStyle: 'short' }).format(new Date())
  const bookingUrl = `https://sistemadebarbearia.com.br/b/${shop.slug}/agendar`
  return [
    `Você é o atendente virtual da barbearia "${shop.name}" no WhatsApp. Responda sempre em português do Brasil, com tom cordial, simples e direto, em mensagens curtas (no máximo 3 ou 4 frases). Não use markdown com # ou tabelas; pode usar *negrito* do WhatsApp com moderação.`,
    `Agora: ${now} (fuso ${tz}). Use esta tabela para entender "hoje", "amanhã", "sábado" etc.:\n${calendar(tz)}`,
    `Dados da barbearia: ${[shop.address && `endereço ${shop.address}`, shop.phone && `telefone ${shop.phone}`, shop.instagram_url && `Instagram ${shop.instagram_url}`].filter(Boolean).join('; ') || 'sem endereço cadastrado'}. Página de agendamento: ${bookingUrl}`,
    `Serviços (id | nome | duração | preço):\n${services.map(s => `${s.id} | ${s.name} | ${s.duration_minutes} min | ${money(s.price_cents)}${s.requires_subscription ? ' | só para assinantes' : ''}${s.description ? ` | ${s.description.slice(0, 120)}` : ''}`).join('\n') || 'nenhum serviço cadastrado'}`,
    `Profissionais (id | nome):\n${barbers.map(b => `${b.id} | ${b.display_name}`).join('\n') || 'nenhum profissional ativo'}`,
    contactName ? `Nome do cliente no WhatsApp: ${contactName}.` : '',
    'Regras:',
    '- Nunca invente preços, serviços, horários ou informações. Para horários use sempre a ferramenta horarios_disponiveis.',
    '- Ofereça poucas opções de horário por vez (até 4), perto do que o cliente pediu.',
    connection.ai_can_book
      ? '- Para agendar: confirme serviço, profissional, data e hora com o cliente e só então chame agendar. Depois, confirme o agendamento com um resumo.'
      : `- Você não agenda diretamente: mostre os horários livres e envie a página de agendamento (${bookingUrl}).`,
    '- Serviços "só para assinantes" devem ser agendados pelo cliente na página de agendamento.',
    '- Se o cliente pedir para falar com uma pessoa, reclamar, tratar de pagamento/reembolso ou de algo fora do atendimento da barbearia, use chamar_atendente.',
    '- Mensagens marcadas como [áudio não transcrito], [imagem] etc.: diga educadamente que no momento entende melhor mensagens de texto.',
    '- Não fale de assuntos que não sejam da barbearia. Não peça dados pessoais além do necessário.',
    connection.ai_instructions ? `Instruções da barbearia (siga, desde que não contrariem as regras acima):\n${connection.ai_instructions}` : '',
  ].filter(Boolean).join('\n\n')
}

export async function transcribe(openai: OpenAI, mediaId: string, token: string): Promise<string | null> {
  try {
    const media = await downloadMedia(mediaId, token)
    const extension = media.mime.includes('ogg') ? 'ogg' : media.mime.includes('mpeg') ? 'mp3' : media.mime.includes('mp4') ? 'm4a' : 'ogg'
    const result = await openai.audio.transcriptions.create({ file: await toFile(new Uint8Array(media.bytes), `audio.${extension}`, { type: media.mime }), model: 'gpt-4o-mini-transcribe', language: 'pt' })
    return result.text?.trim() || null
  } catch (error) {
    console.warn('whatsapp audio transcription', error)
    return null
  }
}


export async function aiReply(client: SupabaseClient, openai: OpenAI, shopId: string, settings: AiSettings, turns: ChatTurn[], contactName: string | null, conversation: Conversation | null): Promise<string> {
  const [{ data: shopRow, error: shopError }, { data: serviceRows }, { data: barberRows }] = await Promise.all([
    client.from('barbershops').select('id,name,slug,timezone,address,phone,whatsapp,instagram_url').eq('id', shopId).single(),
    client.from('services').select('id,name,description,duration_minutes,price_cents,requires_subscription').eq('barbershop_id', shopId).eq('active', true).order('name'),
    client.rpc('public_barber_profiles', { p_barbershop_id: shopId }),
  ])
  if (shopError || !shopRow) throw new Error('Barbearia não encontrada.')
  const shop = shopRow as Shop
  const tz = shop.timezone || 'America/Sao_Paulo'
  const services = (serviceRows ?? []) as Service[]
  const barbers = (barberRows ?? []) as Barber[]
  const bot = new Bot(client, shop, conversation, services, barbers, tz)
  const chat: ChatCompletionMessageParam[] = [
    { role: 'developer', content: systemPrompt(shop, services, barbers, settings, tz, contactName) },
    ...turns.filter(t => t.content.trim()).map(t => ({ role: t.role, content: t.content.slice(0, 2000) }) as ChatCompletionMessageParam),
  ]
  for (let step = 0; step < 6; step++) {
    const completion = await openai.chat.completions.create({ model: MODEL, messages: chat, tools: tools(settings.ai_can_book), max_completion_tokens: 3000 })
    const choice = completion.choices[0]?.message
    if (!choice) break
    const calls = choice.tool_calls ?? []
    if (!calls.length) return choice.content?.trim() || ''
    chat.push({ role: 'assistant', content: choice.content ?? null, tool_calls: calls })
    for (const call of calls) {
      if (call.type !== 'function') continue
      let result: unknown
      try { result = await bot.run(call.function.name, JSON.parse(call.function.arguments || '{}') as Record<string, unknown>) }
      catch (error) { result = { ok: false, erro: error instanceof Error ? error.message : 'Falha ao consultar.' } }
      chat.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) })
    }
  }
  return ''
}
