import type { Config } from '@netlify/functions'
import { createHmac } from 'node:crypto'
import { body, db, email, failure, HttpError, json, optionalSetting, requirePlatformAdmin, setting, text, userFromRequest, uuid } from './_shared/core'
const sourcePaths = new Set(['/', '/agenda-online-para-barbearia', '/sistema-barbearia-por-assinatura', '/controle-financeiro-barbearia', '/site-para-barbearia', '/sistema-para-barbeiro-autonomo', '/aplicativo-cliente-barbearia', '/precos', '/blog'])
export default async (request: Request) => {
 try {
  const path = new URL(request.url).pathname
  const client = db()
  if (path === '/api/platform-leads/request' && request.method === 'POST') {
   const origin = request.headers.get('origin')
   if (!origin || !['https://sistemadebarbearia.com.br','https://www.sistemadebarbearia.com.br','https://barber-system-yqu5.netlify.app'].includes(origin)) throw new HttpError(403,'Solicitação não permitida.')
   if (Number(request.headers.get('content-length') || 0) > 8000) throw new HttpError(413,'Solicitação muito grande.')
   const input = await body<Record<string,unknown>>(request)
   if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400,'Solicitação inválida.')
   if (typeof input.website === 'string' && input.website.trim()) return json({ok:true,captured:false},202)
   if (input.consent !== true) throw new HttpError(400,'Confirme que podemos usar seus dados para responder à solicitação.')
   const profile = input.profile_type
   const team = Number(input.team_size)
   const source = typeof input.source_path === 'string' ? input.source_path : ''
   const phone = String(input.phone || '').replace(/\D/g,'')
   if (!sourcePaths.has(source) || !['shop_owner','independent'].includes(String(profile)) || !Number.isInteger(team) || team < 1 || team > 500 || !/^\d{10,15}$/.test(phone)) throw new HttpError(400,'Confira o perfil, o tamanho da equipe e seu telefone.')
   const ip = request.headers.get('x-nf-client-connection-ip') || 'unavailable'
   const bucket = createHmac('sha256',optionalSetting('SUPABASE_SECRET_KEY') || setting('SUPABASE_SERVICE_ROLE_KEY')).update(`platform-lead:${ip}`).digest('hex')
   const result = await client.rpc('capture_platform_lead',{p_name:text(input.full_name,'Nome',100),p_email:email(input.email),p_phone:phone,p_business:text(input.business_name,'Negócio',120),p_profile:profile,p_team:team,p_source:source,p_bucket:bucket})
   if (result.error) { if(result.error.message.includes('Aguarde'))throw new HttpError(429,'Muitas solicitações. Aguarde uma hora antes de tentar novamente.');throw result.error }
   return json({ok:true,captured:true},202)
  }
  const user = await userFromRequest(request,client)
  await requirePlatformAdmin(client,user.id)
  if (request.method === 'GET') {
   const params = new URL(request.url).searchParams
   const status = params.get('status') || 'new'
   const page = Number(params.get('page') || 1)
   if (!Number.isSafeInteger(page) || page < 1 || page > 10000) throw new HttpError(400,'Página inválida.')
   const search = (params.get('q') || '').trim().slice(0,80).replace(/[^\p{L}\p{N}\s@.+-]/gu,'')
   if(!['new','contacted','qualified','converted','archived','all'].includes(status))throw new HttpError(400,'Filtro inválido.')
   let query = client.from('platform_leads').select('*',{count:'exact'}).order('created_at',{ascending:false}).range((page-1)*50,page*50-1)
   if(status!=='all')query=query.eq('status',status)
   if(search)query=query.or(`full_name.ilike.%${search}%,business_name.ilike.%${search}%,email.ilike.%${search}%`)
   const result=await query
   if(result.error)throw result.error
   return json({leads:result.data || [],total:result.count || 0,page,page_size:50})
  }
  if(request.method!=='POST')throw new HttpError(405,'Método não permitido.')
  const input = await body<Record<string,unknown>>(request)
  if(!input || typeof input!=='object' || Array.isArray(input) || !['new','contacted','qualified','converted','archived'].includes(String(input.status)) || !Number.isSafeInteger(input.revision) || Number(input.revision)<1)throw new HttpError(400,'Situação inválida.')
  const notes = typeof input.notes==='string' ? input.notes.trim():''
  if(notes.length>2000)throw new HttpError(400,'Use até 2.000 caracteres nas notas.')
  const result=await client.from('platform_leads').update({status:input.status,notes,revision:Number(input.revision)+1,updated_at:new Date().toISOString()}).eq('id',uuid(input.id)).eq('revision',input.revision).select('id').maybeSingle()
  if(result.error)throw result.error
  if(!result.data)throw new HttpError(409,'Esta solicitação foi alterada. Atualize a lista.')
  return json({ok:true})
 } catch(error){ return failure(error) }
}
export const config:Config={path:['/api/platform-leads','/api/platform-leads/request'],method:['GET','POST']}
