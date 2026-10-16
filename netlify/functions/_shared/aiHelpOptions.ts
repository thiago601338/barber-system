import type { SupabaseClient } from '@supabase/supabase-js'
import type { HelpAccess } from './aiHelpAccess'
import { HttpError } from './core.ts'

/** Catalog names and assigned client names only; no contacts or full customer histories reach the model. */
export async function loadHelpOptions(client: SupabaseClient, access: HelpAccess) {
  if(!access.shopId) return {allowed:access.allowed,clients:[],barbers:[],services:[],products:[]}
  const shop=access.shopId; const barber=access.role==='barber'
  const needsClients=access.allowed.some(action=>['book_appointment','update_client'].includes(action))
  const needsServices=access.allowed.some(action=>['book_appointment','update_service'].includes(action))
  const needsProducts=access.allowed.includes('update_product')
  let assigned: string[]=[]
  if(barber && needsClients) {
    const {data,error}=await client.from('client_barbers').select('client_id').eq('barbershop_id',shop).eq('barber_membership_id',access.memberId!).limit(100)
    if(error) throw error
    assigned=(data||[]).map(row=>row.client_id)
  }
  let clientsQuery=needsClients && (!barber || assigned.length>0) ? client.from('clients').select('id,full_name,updated_at').eq('barbershop_id',shop).order('full_name').limit(100) : null
  if(barber) clientsQuery=clientsQuery?.in('id',assigned)??null
  const results=await Promise.all([
    clientsQuery,
    access.allowed.some(action=>['book_appointment','create_schedule_block'].includes(action)) ?
      (barber ? client.from('memberships').select('id,display_name').eq('barbershop_id',shop).eq('id',access.memberId!).eq('active',true).eq('role','barber')
      :client.from('memberships').select('id,display_name').eq('barbershop_id',shop).eq('active',true).eq('role','barber').limit(100)) : null,
    needsServices?client.from('services').select('id,name,description,duration_minutes,requires_subscription,active,updated_at').eq('barbershop_id',shop).order('name').limit(100):null,
    needsProducts?client.from('products').select('id,name,description,sku,category,active,updated_at').eq('barbershop_id',shop).order('name').limit(100):null,
  ])
  for(const result of results) if(result?.error) throw result.error
  return {allowed:access.allowed,clients:results[0]?.data||[],barbers:results[1]?.data||[],services:results[2]?.data||[],products:results[3]?.data||[],
    limit:100,warning:'Listas limitadas a 100 itens. Use a área própria se o cadastro não estiver nesta lista. Só use identificadores fornecidos aqui.'}
}

export async function validateOperationalProposal(client: SupabaseClient,userId:string,access:HelpAccess,type:string,values:unknown) {
  const {data,error}=await client.rpc('validate_ai_help_action',{p_actor_id:userId,p_barbershop_id:access.shopId,p_action_type:type,p_values:values})
  if(error) throw new HttpError(error.code==='42501'?403:422,error.message||'Os dados ou a vaga selecionada não estão disponíveis.')
  return data as Record<string,unknown>
}
