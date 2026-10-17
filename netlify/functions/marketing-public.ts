import type {Config} from '@netlify/functions'
import {renderMarketingPage} from './_shared/marketingPages'
import {publicContentSecurityPolicy} from './_shared/publicAnalytics'
import {db} from './_shared/core'
import {defaultPublicPricing} from './_shared/platformPricing'
export default async(request:Request)=>{
 if(request.method!=='GET'&&request.method!=='HEAD')return new Response(null,{status:405,headers:{Allow:'GET, HEAD'}})
 const url=new URL(request.url)
 const path=url.pathname==='/inicio'?'/':url.pathname
 if(path==='/' && (url.searchParams.has('shop')||url.searchParams.has('page')||url.searchParams.has('return')))return Response.redirect(new URL('/app'+url.search,url),302)
 if(path==='/' && url.searchParams.has('type'))return Response.redirect(new URL('/entrar'+url.search,url),302)
 let pricing={...defaultPublicPricing}
 try {
  const result=await db().from('platform_settings').select('base_monthly_cents,seat_price_cents,monthly_cap_cents').eq('id',1).single()
  if(!result.error && result.data && [result.data.base_monthly_cents,result.data.seat_price_cents,result.data.monthly_cap_cents].every(value=>Number.isSafeInteger(value)&&value>=0))
   pricing={base_cents:result.data.base_monthly_cents,barber_cents:result.data.seat_price_cents,monthly_cap_cents:result.data.monthly_cap_cents,currency:'BRL'}
 } catch { /* Keep the published tariff available if the database is temporarily unavailable. */ }
 const html=renderMarketingPage(path.replace(/\/$/,'')||'/',pricing)
 return new Response(request.method==='HEAD'?null:html||'Página não encontrada.',{status:html?200:404,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'public,max-age=0,must-revalidate','Netlify-CDN-Cache-Control':'public,max-age=600','X-Content-Type-Options':'nosniff','Content-Security-Policy':publicContentSecurityPolicy,'Referrer-Policy':'strict-origin-when-cross-origin'}})
}
export const config:Config={path:['/inicio','/agenda-online-para-barbearia','/sistema-barbearia-por-assinatura','/controle-financeiro-barbearia','/site-para-barbearia','/sistema-para-barbeiro-autonomo','/aplicativo-cliente-barbearia','/atendimento-whatsapp-ia-barbearia','/precos'],preferStatic:false}
