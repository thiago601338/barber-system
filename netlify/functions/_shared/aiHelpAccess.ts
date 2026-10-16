import type { SupabaseClient } from '@supabase/supabase-js'
import { HttpError } from './core.ts'
import type { HelpScope } from './aiHelpContext'
import type { ActionType } from './aiHelpActions'

export type HelpAccess = HelpScope & { allowed: ActionType[]; dailyLimit: number }
const administration: ActionType[] = ['create_service','create_product','create_shop_goal','create_marketing_task',
  'book_appointment','create_schedule_block','update_service','update_product','create_client','update_client']

export function actionsForProfile(role: HelpScope['role'], hasShop: boolean, modules: readonly string[]): ActionType[] {
  if(role==='master' && !hasShop) return ['create_shop']
  if(role==='master' || role==='admin') return [...administration]
  if(!modules.includes('ai')) return []
  return [
    ...(modules.includes('goals') ? ['create_personal_goal'] as const : []),
    ...(modules.includes('marketing') ? ['create_marketing_task'] as const : []),
    ...(modules.includes('appointments') ? ['book_appointment'] as const : []),
    ...(modules.includes('availability') ? ['create_schedule_block'] as const : []),
    ...(modules.includes('clients') ? ['create_client','update_client'] as const : []),
  ]
}

export async function resolveHelpAccess(client: SupabaseClient,userId: string,shopId: string|null): Promise<HelpAccess> {
  const { data: platform,error: platformError }=await client.from('platform_admins').select('user_id').eq('user_id',userId).maybeSingle()
  if(platformError) throw platformError
  const master=Boolean(platform)
  let scope: HelpScope
  if(!shopId) {
    if(!master) throw new HttpError(403,'Somente o master pode usar o contexto da plataforma.')
    scope={role:'master',shopId:null,shopName:null,memberId:null,modules:[],timezone:'America/Sao_Paulo'}
  } else {
    const { data: shop,error: shopError }=await client.from('barbershops').select('id,name,active,timezone').eq('id',shopId).maybeSingle()
    if(shopError) throw shopError
    if(!shop?.active) throw new HttpError(404,'Barbearia indisponível.')
    if(master) scope={role:'master',shopId,shopName:shop.name,memberId:null,modules:[],timezone:shop.timezone||'America/Sao_Paulo'}
    else {
      const { data: member,error: memberError }=await client.from('memberships').select('id,role').eq('barbershop_id',shopId).eq('user_id',userId).eq('active',true).maybeSingle()
      if(memberError) throw memberError
      if(!member || !['admin','barber'].includes(member.role)) throw new HttpError(403,'Seu acesso à equipe desta barbearia não está ativo.')
      let modules: string[]=[]
      if(member.role==='barber') {
        const { data: permissions,error: permissionError }=await client.from('module_permissions').select('module,allowed').eq('barbershop_id',shopId).eq('user_id',userId)
        if(permissionError) throw permissionError
        modules=(permissions||[]).filter(row=>row.allowed).map(row=>row.module)
        if(!modules.includes('ai')) throw new HttpError(403,'A Ajuda de IA não foi liberada para este barbeiro.')
      }
      scope={role:member.role,shopId,shopName:shop.name,memberId:member.id,modules,timezone:shop.timezone||'America/Sao_Paulo'}
    }
  }
  const { data: limits,error }=await client.rpc('ai_help_limits',{p_actor_id:userId,p_barbershop_id:shopId})
  if(error) throw error
  if(!limits?.enabled) throw new HttpError(403,'A Ajuda de IA está desativada para este contexto pelo master.')
  return {...scope,allowed:actionsForProfile(scope.role,Boolean(shopId),scope.modules),dailyLimit:Number(limits.daily_limit)}
}
