import type { Config } from '@netlify/functions'
import { body, db, email, failure, HttpError, json, optionalSetting, requirePlatformAdmin, requireShopAdmin, setting, text, userFromRequest, uuid } from './_shared/core'
import { InviteFlowError, prepareAndSaveMemberInvite } from './_shared/inviteFallback'
import { paymentConfiguration } from './_shared/mpConfiguration'
import { readAllPages, summarizePlatformOverview } from './_shared/platformOverview'

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
      const [shops, settings, memberships, invoices, subscriptions] = await Promise.all([
        readAllPages(async (from, to) => client.from('barbershops')
          .select('id,name,slug,active,base_monthly_cents,per_barber_monthly_cents,monthly_cap_cents,created_at').order('name').order('id').range(from, to)),
        client.from('platform_settings').select('base_monthly_cents,seat_price_cents,monthly_cap_cents,billing_enabled,updated_at').eq('id', 1).single(),
        readAllPages(async (from, to) => client.from('memberships')
          .select('id,barbershop_id,role,active').order('id').range(from, to)),
        readAllPages(async (from, to) => client.from('platform_invoices')
          .select('id,barbershop_id,period_start,period_end,seat_count,amount_cents,status,created_at')
          .order('created_at', { ascending: false }).order('id', { ascending: false }).range(from, to)),
        readAllPages(async (from, to) => client.from('platform_subscriptions')
          .select('barbershop_id,status,amount_cents,seat_count,updated_at').order('barbershop_id').range(from, to)),
      ])
      if (settings.error) throw settings.error
      const metrics = summarizePlatformOverview({ shops, memberships, invoices, subscriptions, settings: settings.data })
      return json({ shops, settings: settings.data, memberships, invoices: invoices.slice(0, 100),
        subscriptions, payment_configuration: paymentConfiguration(), ...metrics })
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
      const price = input.seat_price_cents
      if (typeof price !== 'number' || !Number.isSafeInteger(price) || price < 0 || price > 100_000_00) throw new HttpError(400, 'Valor por barbeiro inválido.')
      const base = input.base_monthly_cents
      const cap = input.monthly_cap_cents
      if (base !== undefined && (!Number.isSafeInteger(base) || Number(base) < 0 || Number(base) > 100_000_00)) throw new HttpError(400, 'Mensalidade base inválida.')
      if (cap !== undefined && (!Number.isSafeInteger(cap) || Number(cap) < 0 || Number(cap) > 100_000_00)) throw new HttpError(400, 'Teto mensal inválido.')
      const enabled = input.billing_enabled === true
      const { error } = await client.from('platform_settings').update({ seat_price_cents: price, billing_enabled: enabled,
        ...(base !== undefined ? { base_monthly_cents: base } : {}),
        ...(cap !== undefined ? { monthly_cap_cents: cap } : {}),
      }).eq('id', 1)
      if (error) throw error
      return json({ ok: true })
    }

    if (action === 'set-shop-pricing') {
      await requirePlatformAdmin(client, user.id)
      const shopId = uuid(input.barbershop_id)
      const base = input.base_monthly_cents
      const perBarber = input.per_barber_monthly_cents
      const cap = input.monthly_cap_cents
      if (base !== null && (!Number.isSafeInteger(base) || Number(base) < 0 || Number(base) > 100_000_00)) {
        throw new HttpError(400, 'Mensalidade base inválida.')
      }
      if (perBarber !== null && (!Number.isSafeInteger(perBarber) ||
          Number(perBarber) < 0 || Number(perBarber) > 100_000_00)) {
        throw new HttpError(400, 'Valor por barbeiro inválido.')
      }
      if (cap !== undefined && cap !== null && (!Number.isSafeInteger(cap) || Number(cap) < 0 || Number(cap) > 100_000_00)) throw new HttpError(400, 'Teto mensal inválido.')
      const { data: shop, error } = await client.from('barbershops').update({
        base_monthly_cents: base,
        per_barber_monthly_cents: perBarber,
        ...(cap !== undefined ? { monthly_cap_cents: cap } : {}),
        updated_at: new Date().toISOString(),
      }).eq('id', shopId).select('id,base_monthly_cents,per_barber_monthly_cents,monthly_cap_cents').maybeSingle()
      if (error) throw error
      if (!shop) throw new HttpError(404, 'Barbearia não encontrada.')
      return json({ shop })
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
      const importedContacts = await client.rpc('imported_member_contacts', { p_barbershop_id: shopId })
      if (importedContacts.error) throw importedContacts.error
      const matchingContacts = ((importedContacts.data || []) as { membership_id: string; email: string }[]).filter(record => record.email?.trim().toLowerCase() === address)
      let importedMemberId: string | null = null
      if (matchingContacts.length === 1) {
        const archived = await client.from('memberships').select('id').eq('barbershop_id', shopId).eq('id', matchingContacts[0].membership_id).is('user_id', null).maybeSingle()
        if (archived.error) throw archived.error
        importedMemberId = archived.data?.id || null
      }
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
            if (importedMemberId) {
              const existing = await client.from('memberships').select('id').eq('barbershop_id', shopId).eq('user_id', targetUserId).maybeSingle()
              if (existing.error) return { error: existing.error }
              if (!existing.data) {
                const updated = await client.from('memberships').update({ user_id: targetUserId, role, display_name: displayName, active: true }).eq('barbershop_id', shopId).eq('id', importedMemberId).is('user_id', null).select('id').maybeSingle()
                return { error: updated.error || (updated.data ? null : new Error('O profissional importado foi alterado. Refaça o convite.')) }
              }
            }
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

    // Cadastro da equipe: renomear, ativar/desativar, adicionar sem login e excluir profissionais.
    if (action === 'member-update' || action === 'member-delete' || action === 'member-create') {
      const shopId = uuid(input.barbershop_id)
      await canManageShop(client, user.id, shopId)
      if (action === 'member-create') {
        const name = text(input.display_name, 'Nome', 120)
        const { data, error } = await client.from('memberships').insert({ barbershop_id: shopId, user_id: null, role: 'barber', display_name: name, active: true }).select('id').single()
        if (error) throw error
        return json({ ok: true, id: data.id })
      }
      const memberId = uuid(input.membership_id)
      const { data: member, error: memberError } = await client.from('memberships').select('id,user_id,role,active,import_source').eq('barbershop_id', shopId).eq('id', memberId).maybeSingle()
      if (memberError) throw memberError
      if (!member) throw new HttpError(404, 'Profissional não encontrado.')
      const isSelf = member.user_id === user.id
      if (action === 'member-update') {
        const patch: Record<string, unknown> = {}
        if (input.display_name !== undefined) patch.display_name = text(input.display_name, 'Nome', 120)
        if (input.active !== undefined) {
          if (typeof input.active !== 'boolean') throw new HttpError(400, 'Situação inválida.')
          if (!input.active && isSelf) throw new HttpError(400, 'Você não pode desativar o seu próprio acesso.')
          patch.active = input.active
        }
        if (!Object.keys(patch).length) throw new HttpError(400, 'Nada para alterar.')
        const { error } = await client.from('memberships').update(patch).eq('barbershop_id', shopId).eq('id', memberId)
        if (error) {
          if (error.code === '23514') throw new HttpError(400, 'Esse profissional não pode ser reativado sem acesso ao sistema. Envie um convite por e-mail primeiro.')
          throw error
        }
        return json({ ok: true })
      }
      if (isSelf) throw new HttpError(400, 'Você não pode excluir o seu próprio acesso.')
      if (member.role === 'admin') throw new HttpError(400, 'Para excluir um administrador, fale com o suporte.')
      const { count: appointments } = await client.from('appointments').select('id', { count: 'exact', head: true }).eq('barbershop_id', shopId).eq('barber_membership_id', memberId)
      if ((appointments || 0) > 0 || member.import_source) {
        // Quem já atendeu fica no histórico (relatórios, comissões e pagamentos dependem dele): só desativa.
        const { error } = await client.from('memberships').update({ active: false }).eq('barbershop_id', shopId).eq('id', memberId)
        if (error) throw error
        return json({ ok: true, deleted: false, deactivated: true })
      }
      // Horários, serviços do barbeiro e permissões são apagados junto (cascata no banco).
      const { error } = await client.from('memberships').delete().eq('barbershop_id', shopId).eq('id', memberId)
      if (error) {
        if (error.code === '23503') {
          const { error: deactivateError } = await client.from('memberships').update({ active: false }).eq('barbershop_id', shopId).eq('id', memberId)
          if (deactivateError) throw deactivateError
          return json({ ok: true, deleted: false, deactivated: true })
        }
        throw error
      }
      return json({ ok: true, deleted: true })
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
