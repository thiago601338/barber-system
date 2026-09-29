import type { SupabaseClient } from '@supabase/supabase-js'

export type HelpScope = {
  role: 'master' | 'admin' | 'barber'
  shopId: string | null
  shopName: string | null
  memberId: string | null
  modules: string[]
  timezone: string
}

function requireData<T>(result: { data: T; error: unknown }): T {
  if (result.error) throw result.error
  return result.data
}

function countBy<T extends { status: string }>(rows: T[]): Record<string, number> {
  return rows.reduce<Record<string, number>>((result, row) => {
    result[row.status] = (result[row.status] || 0) + 1
    return result
  }, {})
}

function dateWindow(timezone: string): { since: string; now: string; until: string; today: string } {
  const now = new Date()
  const localParts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const local = Object.fromEntries(localParts.map(part => [part.type, part.value]))
  const localDayUtc = Date.UTC(Number(local.year), Number(local.month) - 1, Number(local.day))
  return {
    since: new Date(now.getTime() - 30 * 86_400_000).toISOString(),
    now: now.toISOString(),
    until: new Date(localDayUtc + 30 * 86_400_000).toISOString().slice(0, 10),
    today: `${local.year}-${local.month}-${local.day}`,
  }
}

/** Only server-authorized, bounded rows enter the model context. No customer records or secrets. */
export async function loadAiHelpContext(client: SupabaseClient, scope: HelpScope): Promise<string> {
  const { since, now, today, until } = dateWindow(scope.timezone)
  if (!scope.shopId) {
    if (scope.role !== 'master') throw new Error('Escopo de plataforma exige master.')
    const [shopsResponse, barbersResponse, settingsResponse, subscriptionsResponse, invoicesResponse] = await Promise.all([
      client.from('barbershops').select('id', { count: 'exact', head: true }).eq('active', true),
      client.from('memberships').select('id', { count: 'exact', head: true }).eq('role', 'barber').eq('active', true),
      client.from('platform_settings').select('seat_price_cents,billing_enabled').eq('id', 1).single(),
      client.from('platform_subscriptions').select('status,amount_cents').order('updated_at', { ascending: false }).limit(200),
      client.from('platform_invoices').select('status,amount_cents').gte('created_at', since).order('created_at', { ascending: false }).limit(500),
    ])
    requireData(shopsResponse)
    requireData(barbersResponse)
    const settings = requireData(settingsResponse)
    if (!settings) throw new Error('Configuração da plataforma indisponível.')
    const subscriptions = requireData(subscriptionsResponse) || []
    const invoices = requireData(invoicesResponse) || []
    return JSON.stringify({
      scope: 'platform', reference_date: today,
      active_shops: shopsResponse.count || 0, active_barber_memberships: barbersResponse.count || 0,
      default_price_per_barber_cents: settings.seat_price_cents,
      central_billing_enabled: settings.billing_enabled,
      central_subscriptions_sample: { limit: 200, truncated: subscriptions.length === 200, by_status: countBy(subscriptions),
        active_contract_cents_in_sample: subscriptions.filter(row => row.status === 'active').reduce((sum, row) => sum + Number(row.amount_cents || 0), 0) },
      central_invoices_last_30_days_sample: { limit: 500, truncated: invoices.length === 500, by_status: countBy(invoices),
        paid_cents_in_sample: invoices.filter(row => row.status === 'paid').reduce((sum, row) => sum + Number(row.amount_cents || 0), 0) },
      caveat: 'O total de vínculos de barbeiros ativos pode incluir loja inativa. Amostras truncadas não são totais globais. Não confunda valor contratado com dinheiro recebido.',
    })
  }

  const shopId = scope.shopId
  const barber = scope.role === 'barber'
  if (barber && !scope.memberId) throw new Error('Escopo do barbeiro sem vínculo próprio.')
  const canReadServices = !barber || scope.modules.includes('services')
  const canReadAvailability = !barber || scope.modules.includes('services') || scope.modules.includes('availability')
  const canReadAppointments = !barber || scope.modules.includes('appointments')
  const canReadGoals = !barber || scope.modules.includes('goals')
  const ruleQuery = canReadAvailability ? client.from('availability_rules').select('barber_membership_id,weekday,start_time,end_time')
    .eq('barbershop_id', shopId).eq('active', true).limit(200) : null
  const exceptionQuery = canReadAvailability ? client.from('availability_exceptions').select('barber_membership_id,day,unavailable,start_time,end_time')
    .eq('barbershop_id', shopId).gte('day', today).lte('day', until).limit(100) : null
  const appointmentQuery = canReadAppointments ? client.from('appointments').select('starts_at,status,barber_membership_id')
    .eq('barbershop_id', shopId).gte('starts_at', since).lte('starts_at', now).order('starts_at', { ascending: false }).limit(500) : null
  const goalQuery = canReadGoals ? client.from('goals').select('title,metric,target_value,period_start,period_end,barber_membership_id')
    .eq('barbershop_id', shopId).gte('period_end', today).limit(20) : null
  if (barber) {
    ruleQuery?.eq('barber_membership_id', scope.memberId!)
    exceptionQuery?.eq('barber_membership_id', scope.memberId!)
    appointmentQuery?.eq('barber_membership_id', scope.memberId!)
    goalQuery?.eq('barber_membership_id', scope.memberId!)
  }
  const [servicesResponse, rulesResponse, exceptionsResponse, appointmentsResponse, membersResponse, goalsResponse, paymentsResponse] = await Promise.all([
    canReadServices ? client.from('services').select('name,price_cents,duration_minutes').eq('barbershop_id', shopId).eq('active', true).limit(30) : null,
    ruleQuery, exceptionQuery, appointmentQuery,
    barber ? Promise.resolve(null) : client.from('memberships').select('id,display_name').eq('barbershop_id', shopId).eq('role', 'barber').eq('active', true).limit(100),
    goalQuery,
    barber ? Promise.resolve(null) : client.from('payments').select('amount_cents').eq('barbershop_id', shopId)
      .eq('status', 'paid').gte('paid_at', since).order('paid_at', { ascending: false }).limit(500),
  ])
  const services = servicesResponse ? requireData(servicesResponse) || [] : []
  const rules = rulesResponse ? requireData(rulesResponse) || [] : []
  const exceptions = exceptionsResponse ? requireData(exceptionsResponse) || [] : []
  const appointments = appointmentsResponse ? requireData(appointmentsResponse) || [] : []
  const members = membersResponse ? requireData(membersResponse) || [] : []
  const goals = goalsResponse ? requireData(goalsResponse) || [] : []
  const payments = paymentsResponse ? requireData(paymentsResponse) || [] : []
  const activeMemberNames = new Map(members.map(row => [row.id, row.display_name || 'Profissional sem nome']))
  const visibleRules = barber ? rules : rules.filter(row => activeMemberNames.has(row.barber_membership_id))
  const visibleExceptions = barber ? exceptions : exceptions.filter(row => activeMemberNames.has(row.barber_membership_id))
  const byHour: Record<string, number> = {}
  const byWeekday: Record<string, number> = {}
  for (const row of appointments) {
    if (row.status === 'cancelled' || row.status === 'no_show') continue
    const date = new Date(row.starts_at)
    const parts = new Intl.DateTimeFormat('pt-BR', { timeZone: scope.timezone, weekday: 'long', hour: '2-digit', hourCycle: 'h23' }).formatToParts(date)
    const hour = parts.find(part => part.type === 'hour')?.value || '??'
    const weekday = parts.find(part => part.type === 'weekday')?.value || 'desconhecido'
    byHour[hour] = (byHour[hour] || 0) + 1
    byWeekday[weekday] = (byWeekday[weekday] || 0) + 1
  }
  return JSON.stringify({
    scope: barber ? 'own_barber_activity' : 'one_barbershop', shop: scope.shopName, reference_date: today,
    official_public_opening_hours: 'Não existe campo de horário oficial da barbearia; as regras abaixo são de disponibilidade dos profissionais.',
    ...(canReadServices ? { active_services_sample: { limit: 30, truncated: services.length === 30, items: services } } : {}),
    ...(canReadAvailability ? { weekly_availability_sample: { limit: 200, truncated: rules.length === 200,
      items: visibleRules.map(row => ({ professional: barber ? 'você' : activeMemberNames.get(row.barber_membership_id), weekday: row.weekday,
        start: row.start_time, end: row.end_time })) },
      next_30_days_availability_exceptions_sample: { limit: 100, truncated: exceptions.length === 100,
      items: visibleExceptions.map(row => ({ professional: barber ? 'você' : activeMemberNames.get(row.barber_membership_id),
        day: row.day, unavailable: row.unavailable, start: row.start_time, end: row.end_time })) } } : {}),
    ...(canReadAppointments ? { appointments_last_30_days_sample: { limit: 500, truncated: appointments.length === 500, count_in_sample: appointments.length,
      by_status: countBy(appointments), by_hour_local: byHour, by_weekday_local: byWeekday,
      timezone: scope.timezone, warning: 'Amostras truncadas não são totais; horários refletem o fuso da barbearia.' } } : {}),
    ...(canReadGoals ? { goals_sample: { limit: 20, truncated: goals.length === 20, items: goals.map(row => ({ ...row,
      professional: barber ? 'você' : row.barber_membership_id ? activeMemberNames.get(row.barber_membership_id) || 'Profissional' : 'Barbearia' })) } } : {}),
    ...(barber ? {} : { paid_transactions_last_30_days_sample: { limit: 500, truncated: payments.length === 500,
      count_in_sample: payments.length, paid_cents_in_sample: payments.reduce((sum, row) => sum + Number(row.amount_cents || 0), 0) } }),
    ...(barber ? { unavailable_modules: ['services','appointments','goals'].filter(module => !scope.modules.includes(module)) } : {}),
    caveat: 'Não há dados de clientes neste contexto. Nunca infira histórico individual, faturamento total a partir de amostra truncada ou horário oficial a partir da disponibilidade.',
  })
}
