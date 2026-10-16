import type {Config} from '@netlify/functions'
import {renderLegalPage} from './_shared/legalPages'
import {publicContentSecurityPolicy} from './_shared/publicAnalytics'
export default async(request:Request)=>{
 if(request.method!=='GET'&&request.method!=='HEAD')return new Response(null,{status:405,headers:{Allow:'GET, HEAD'}})
 const path=new URL(request.url).pathname.replace(/\/$/,'')
 const html=renderLegalPage(path)
 return new Response(request.method==='HEAD'?null:html||'Página não encontrada.',{status:html?200:404,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'public,max-age=0,must-revalidate','Netlify-CDN-Cache-Control':'public,max-age=600','X-Content-Type-Options':'nosniff','Content-Security-Policy':publicContentSecurityPolicy,'Referrer-Policy':'strict-origin-when-cross-origin'}})
}
export const config:Config={path:['/sobre','/contato','/politica-de-privacidade','/termos-de-uso','/politica-de-cancelamento-e-reembolso','/politica-de-cookies'],preferStatic:false}
