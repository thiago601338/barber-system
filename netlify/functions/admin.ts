import type { Config } from '@netlify/functions'
import { body, db, email, failure, HttpError, json, optionalSetting, requirePlatformAdmin, requireShopAdmin, setting, text, userFromRequest, uuid } from './_shared/core'
import { InviteFlowError, prepareAndSaveMemberInvite } from './_shared/inviteFallback'

type Payload = Record<string, unknown>

async function canManageShop(client: ReturnType<typeof db>, userId: string, shopId: string) {
  const { data } = await client.from('platform_admins').select('user_id').eq('user_id', userId).maybeSingle()
  if (data) return
  await requireShopAdmin(client, userId, shopId)
}

export default async (request: Request) => {
  try {
    const client = db()
    const user = await userFromRequest(request, client)
    const action = new URL(request.url).pathname.split('/').pop()

    if (request.method === 'POST' && action === 'bootstrap') {
      const configured = optionalSetting('MASTER_EMAIL')?.toLowerCase()
      if (!configured) throw new HttpError(503, 'Defina MASTER_EMAIL no servidor antes de ativar o administrador master.')
      if (!user.email || user.email.toLowerCase() !== configured || !user.email_confirmed_at) {
        throw new HttpError(403, 'Somente o e-mail master confirmado pode ativar este acesso.')
      }
      const { data: existing, error: listError } = await client.from('platform_admins').select('user_id').limit(1)
      if (listError) throw listError
      if (existing?.length && existing[0].user_id !== user.id) throw new HttpError(409, 'Já existe um administrador master.')
      const { error } = await client.from('platform_admins').upsert({ user_id: user.id })
      if (error) throw error
      return json({ ok: true })
    }

    if (request.method === 'GET' && action === 'bootstrap-eligibility') {
      const configured = optionalSetting('MASTER_EMAIL')?.toLowerCase()
      if (!configured || !user.email_confirmed_at || user.email?.toLowerCase() !== configured) {
        return json({ eligible: false })
      }
      const { data: existing, error } = await client.from('platform_admins').select('user_id').limit(1)
      if (error) throw error
      return json({ eligible: !existing?.length || existing[0].user_id === user.id })
    }

    if (action === 'overview' && request.method === 'GET') {
      await requirePlatformAdmin(client, user.id)
      const [shops, settings, memberships, invoices] = await Promise.all([
        client.from('barbershops').select('id,name,slug,active,created_at').order('name'),
        client.from('platform_settings').select('seat_price_cents,billing_enabled,updated_at').eq('id', 1).single(),
        client.from('memberships').select('barbershop_id,role,active'),
        client.from('platform_invoices').select('id,barbershop_id,period_start,period_end,seat_count,amount_cents,status,created_at').order('created_at', { ascending: false }).limit(100),
      ])
      for (const item of [shops, settings, memberships, invoices]) if (item.error) throw item.error
      return json({ shops: shops.data, settings: settings.data, memberships: memberships.data, invoices: invoices.data })
    }

    if (request.method !== 'POST') throw new HttpError(405, 'Método não permitido.')
    const input = await body<Payload>(request)

    if (action === 'create-shop') {
      await requirePlatformAdmin(client, user.id)
      const name = text(input.name, 'Nome', 120)
      const slug = text(input.slug, 'Endereço público', 80).toLowerCase()
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new HttpError(400, 'O endereço público aceita letras, números e hífens.')
      const { data: shop, error: shopError } = await client.from('barbershops').insert({ name, slug }).select('id,name,slug').single()
      if (shopError) throw shopError
      const { error: memberError } = await client.from('memberships').insert({ barbershop_id: shop.id, user_id: user.id, role: 'admin', display_name: user.email || 'Administrador', active: true })
      if (memberError) throw memberError
      return json({ shop }, 201)
    }

    if (action === 'set-seat-price') {
      await requirePlatformAdmin(client, user.id)
      const price = Number(input.seat_price_cents)
      if (!Number.isSafeInteger(price) || price < 0 || price > 100_000_00) throw new HttpError(400, 'Valor por barbeiro inválido.')
      const enabled = input.billing_enabled === true
      const { error } = await client.from('platform_settings').update({ seat_price_cents: price, billing_enabled: enabled }).eq('id', 1)
      if (error) throw error
      return json({ ok: true })
    }

    if (action === 'invite') {
      const shopId = uuid(input.barbershop_id)
      await canManageShop(client, user.id, shopId)
      const address = email(input.email)
      const role = input.role === 'admin' ? 'admin' : input.role === 'barber' ? 'barber' : null
      if (!role) throw new HttpError(400, 'Papel inválido.')
      const { data: profile, error: profileError } = await client.from('profiles').select('user_id').eq('email', address).maybeSingle()
      if (profileError) throw profileError
      const displayName = typeof input.display_name === 'string' && input.display_name.trim() ? text(input.display_name, 'Nome', 120) : address
      const redirectTo = new URL('/entrar', request.url).toString()
      try {
        const result = await prepareAndSaveMemberInvite({
          email: address,
          existingUserId: profile?.user_id,
          authOrigin: new URL(setting('SUPABASE_URL')).origin,
          redirectTo,
          lookupExistingUser: targetUserId => client.auth.admin.getUserById(targetUserId),
          sendInvite: () => client.auth.admin.inviteUserByEmail(address, { redirectTo }),
          generateInvite: () => client.auth.admin.generateLink({ type: 'invite', email: address, options: { redirectTo } }),
          saveMembership: async targetUserId => {
            const { error } = await client.from('memberships').upsert({
              barbershop_id: shopId, user_id: targetUserId, role, display_name: displayName, active: true,
            }, { onConflict: 'barbershop_id,user_id' })
            return { error }
          },
        })
        return json({ ok: true, ...result })
      } catch (error) {
        if (error instanceof InviteFlowError) {
          const message = error.stage === 'generate'
            ? 'Não foi possível gerar o link manual de convite. Tente novamente mais tarde.'
            : error.stage === 'lookup'
              ? 'Não foi possível verificar a conta existente. Tente novamente.'
            : error.stage === 'membership'
              ? 'A conta foi preparada, mas não foi possível vincular o integrante à barbearia. Tente novamente.'
              : error.message
          throw new HttpError(502, message)
        }
        throw error
      }
    }

    if (action === 'permission') {
      const shopId = uuid(input.barbershop_id)
      const targetUserId = uuid(input.user_id)
      await canManageShop(client, user.id, shopId)
      const module = text(input.module, 'Aba', 60)
      if (typeof input.allowed !== 'boolean') throw new HttpError(400, 'Permissão inválida.')
      const { data: target, error: targetError } = await client.from('memberships').select('role').eq('barbershop_id', shopId).eq('user_id', targetUserId).eq('active', true).maybeSingle()
      if (targetError || target?.role !== 'barber') throw new HttpError(400, 'Selecione um barbeiro ativo.')
      const { error } = await client.from('module_permissions').upsert({ barbershop_id: shopId, user_id: targetUserId, module, allowed: input.allowed }, { onConflict: 'barbershop_id,user_id,module' })
      if (error) throw error
      return json({ ok: true })
    }

    throw new HttpError(404, 'Ação não encontrada.')
  } catch (error) { return failure(error) }
}

export const config: Config = { path: '/api/admin/:action' }
