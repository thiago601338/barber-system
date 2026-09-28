type AuthFailure = { code?: string; message?: string; status?: number } | null
type InviteUser = { id?: string; email?: string | null; email_confirmed_at?: string | null } | null
type AuthResult<T> = { data: T | null; error: AuthFailure }

export type InviteDelivery = 'email' | 'manual_link' | 'existing_account'
export type MemberInviteResult = {
  delivery: InviteDelivery
  invited: boolean
  email_sent: boolean
  invite_url?: string
}

export class InviteFlowError extends Error {
  stage: 'lookup' | 'send' | 'generate' | 'membership'
  constructor(stage: 'lookup' | 'send' | 'generate' | 'membership', message: string) {
    super(message)
    this.stage = stage
  }
}

export function isEmailSendRateLimit(error: AuthFailure): boolean {
  if (!error) return false
  if (error.code === 'over_email_send_rate_limit') return true
  return error.status === 429 && /email\s+rate\s+limit\s+exceeded/i.test(error.message || '')
}

function verifiedUserId(user: InviteUser, email: string, stage: 'lookup' | 'send' | 'generate'): string {
  if (!user?.id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id)
    || user.email?.toLowerCase() !== email) {
    throw new InviteFlowError(stage, 'O provedor não confirmou a identidade do convite.')
  }
  return user.id
}

function verifiedInviteLink(raw: string | undefined, authOrigin: string, redirectTo: string): string {
  try {
    const link = new URL(raw)
    if (link.protocol !== 'https:' || link.origin !== authOrigin || !link.pathname.endsWith('/auth/v1/verify')
      || link.searchParams.get('type') !== 'invite' || !link.searchParams.get('token')
      || link.searchParams.get('redirect_to') !== redirectTo) {
      throw new Error('invalid invite link')
    }
    return link.toString()
  } catch {
    throw new InviteFlowError('generate', 'O provedor não retornou um link de convite válido.')
  }
}

export async function prepareAndSaveMemberInvite(args: {
  email: string
  existingUserId?: string
  authOrigin: string
  redirectTo: string
  lookupExistingUser: (userId: string) => Promise<AuthResult<{ user: InviteUser }>>
  sendInvite: () => Promise<AuthResult<{ user: InviteUser }>>
  generateInvite: () => Promise<AuthResult<{ user: InviteUser; properties?: { action_link?: string } }>>
  saveMembership: (userId: string) => Promise<{ error: { message?: string } | null }>
}): Promise<MemberInviteResult> {
  let targetUserId = args.existingUserId
  let delivery: InviteDelivery = 'existing_account'
  let inviteUrl: string | undefined

  async function generateManualLink(expectedUserId?: string) {
    let generated: AuthResult<{ user: InviteUser; properties?: { action_link?: string } }>
    try { generated = await args.generateInvite() }
    catch (error) { generated = { data: null, error: error as AuthFailure } }
    if (generated.error || !generated.data) {
      throw new InviteFlowError('generate', generated.error?.message || 'Não foi possível gerar o link manual.')
    }
    const generatedUserId = verifiedUserId(generated.data.user, args.email, 'generate')
    if (expectedUserId && generatedUserId !== expectedUserId) {
      throw new InviteFlowError('generate', 'A conta do convite mudou. Revise o cadastro antes de tentar novamente.')
    }
    targetUserId = generatedUserId
    inviteUrl = verifiedInviteLink(generated.data.properties?.action_link, args.authOrigin, args.redirectTo)
    delivery = 'manual_link'
  }

  if (targetUserId) {
    let lookup: AuthResult<{ user: InviteUser }>
    try { lookup = await args.lookupExistingUser(targetUserId) }
    catch (error) { lookup = { data: null, error: error as AuthFailure } }
    if (lookup.error || !lookup.data) {
      throw new InviteFlowError('lookup', lookup.error?.message || 'Não foi possível verificar a conta existente.')
    }
    if (verifiedUserId(lookup.data.user, args.email, 'lookup') !== targetUserId) {
      throw new InviteFlowError('lookup', 'O cadastro existente não corresponde ao e-mail informado.')
    }
    if (!lookup.data.user?.email_confirmed_at) await generateManualLink(targetUserId)
  } else {
    let sent: AuthResult<{ user: InviteUser }>
    try { sent = await args.sendInvite() }
    catch (error) { sent = { data: null, error: error as AuthFailure } }
    if (sent.error) {
      if (!isEmailSendRateLimit(sent.error)) {
        throw new InviteFlowError('send', sent.error.message || 'O convite por e-mail falhou.')
      }
      await generateManualLink()
    } else {
      targetUserId = verifiedUserId(sent.data?.user || null, args.email, 'send')
      delivery = 'email'
    }
  }

  const saved = await args.saveMembership(targetUserId)
  if (saved.error) throw new InviteFlowError('membership', saved.error.message || 'Não foi possível vincular o integrante.')
  return {
    delivery,
    invited: delivery !== 'existing_account',
    email_sent: delivery === 'email',
    ...(inviteUrl ? { invite_url: inviteUrl } : {}),
  }
}
