const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const slugPattern = '[a-z0-9]+(?:-[a-z0-9]+)*'
const invitePathPattern = new RegExp(`^/b/${slugPattern}/assinar(?:\\?plano=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$`, 'i')

function planQuery(planId?: string | null): string {
  return planId && uuid.test(planId) ? `?plano=${planId.toLowerCase()}` : ''
}

/** Caminho do convite dentro do site: a página de assinatura da barbearia, já no plano escolhido quando houver um. */
export function invitePath(slug: string, planId?: string | null): string {
  return `/b/${encodeURIComponent(slug)}/assinar${planQuery(planId)}`
}

/** Trecho final do endereço do convite, depois do endereço público da barbearia. */
export function inviteSuffix(planId?: string | null): string {
  return `/assinar${planQuery(planId)}`
}

/** Plano indicado no endereço do convite; qualquer valor que não seja um código de plano é ignorado. */
export function invitedPlanId(search: string): string | null {
  const value = new URLSearchParams(search).get('plano')
  return value && uuid.test(value) ? value.toLowerCase() : null
}

/** Só um caminho de convite pode ser usado para voltar depois do login. */
export function isInviteReturn(value: string | null | undefined): value is string {
  return typeof value === 'string' && invitePathPattern.test(value)
}

export function inviteMessage(input: { shopName: string; planName?: string | null; url: string }): string {
  const what = input.planName ? `o plano ${input.planName.trim()} da ${input.shopName}` : `um plano da ${input.shopName}`
  return `Olá! Este é o seu convite para assinar ${what}. Abra o link, confira as condições e conclua a assinatura:\n${input.url}`
}

/** Descrição do plano para o cliente. Anotações internas da importação não são texto de venda e ficam de fora. */
export function planBlurb(description: unknown): string | null {
  const text = String(description ?? '').trim()
  if (!text || /^plano migrado do cashbarber/i.test(text)) return null
  return text
}

/** "por mês", "a cada 3 meses": o intervalo de cobrança ao lado do preço. */
export function cycleLabel(months: unknown): string {
  const value = Number(months)
  return Number.isInteger(value) && value > 1 ? `a cada ${value} meses` : 'por mês'
}
