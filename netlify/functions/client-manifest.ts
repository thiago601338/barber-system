import type { Config } from '@netlify/functions'
import { db, failure, HttpError } from './_shared/core'

export function buildClientManifest(shop: { name:string;slug:string;logo_url?:unknown;brand_theme?:unknown }) {
 const theme=shop.brand_theme&&typeof shop.brand_theme==='object'?shop.brand_theme as Record<string,unknown>:{}
 const palette=theme.palette&&typeof theme.palette==='object'?theme.palette as Record<string,unknown>:{}
 const color=(value:unknown,fallback:string)=>typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value)?value:fallback
 const raw=theme.logoUrl||shop.logo_url
 let logo:string|null=null
 if(typeof raw==='string'&&/^\/brands\/[a-z0-9/_-]+\.(?:png|jpg|jpeg|svg|webp)$/i.test(raw)&&!raw.includes('..'))logo=raw
 else if(typeof raw==='string')try{const url=new URL(raw);if(url.protocol==='https:'&&!url.username&&!url.password&&!url.port)logo=url.href}catch{/* Invalid imagery is omitted. */}
 const query=`shop=${encodeURIComponent(shop.slug)}`
 return { id:`/b/${shop.slug}/app`,name:shop.name,short_name:shop.name.slice(0,30),description:`Sua conta em ${shop.name}: agendamentos, assinatura e benefícios.`,lang:'pt-BR',start_url:`/?${query}`,scope:'/',display:'standalone',background_color:color(palette.background,'#ffffff'),theme_color:color(palette.accent,'#2563eb'),icons:[...(logo?[{src:logo,purpose:'any'}]:[]),{src:'/client-app-icon.svg',sizes:'192x192 512x512 any',type:'image/svg+xml',purpose:'any maskable'}],shortcuts:[{name:'Agendar atendimento',short_name:'Agendar',url:`/b/${shop.slug}/agendar`},{name:'Minha conta',short_name:'Minha conta',url:`/?${query}`}] }
}
export default async(request:Request)=>{
 try{
  if(request.method!=='GET')throw new HttpError(405,'Método não permitido.')
  const slug=new URL(request.url).searchParams.get('shop')||''
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)||slug.length>100)throw new HttpError(400,'Barbearia inválida.')
  const {data,error}=await db().from('barbershops').select('name,slug,logo_url,brand_theme').eq('slug',slug).eq('active',true).maybeSingle()
  if(error)throw error
  if(!data)throw new HttpError(404,'Barbearia não encontrada.')
  return new Response(JSON.stringify(buildClientManifest(data)),{headers:{'content-type':'application/manifest+json; charset=utf-8','cache-control':'public, max-age=300','x-content-type-options':'nosniff'}})
 }catch(p){return failure(p)}
}
export const config:Config={path:'/api/client-manifest',method:'GET'}
