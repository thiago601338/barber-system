import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
const base=process.argv[2]
const expectedPricing=(process.argv[3]||'2990,790,9690').split(',').map(Number)
assert(expectedPricing.length===3&&expectedPricing.every(n=>Number.isSafeInteger(n)&&n>=0),'Provide the current configured base, barber and cap cents')
assert(/^https:\/\/[a-z0-9.-]+$/.test(base),'Use an explicit HTTPS deployment origin')
const paths=['/','/agenda-online-para-barbearia','/sistema-barbearia-por-assinatura','/controle-financeiro-barbearia','/site-para-barbearia','/sistema-para-barbeiro-autonomo','/aplicativo-cliente-barbearia','/atendimento-whatsapp-ia-barbearia','/precos','/blog','/blog/como-comecar-no-barber-system']
const results=[]
const pagePhotos=new Set()
for(const path of paths){
 const response=await fetch(base+path),html=await response.text()
 assert.equal(response.status,200,path)
 assert.equal((html.match(/<h1(?:\s|>)/g)||[]).length,1,path+' needs one H1')
 assert(html.includes('https://sistemadebarbearia.com.br'+path),'Canonical missing: '+path)
 assert(!html.includes('<div id="root"></div>'),'Missing server-rendered page: '+path)
 assert(html.includes('/brand/barber-system-logo.png'),'New public logo missing: '+path)
 if(!path.startsWith('/blog')){
  const photo=html.match(/src="\/marketing\/([a-z-]+\.webp)"/)?.[1]
  assert(photo,'Page-specific photo missing: '+path)
  assert(!pagePhotos.has(photo),'Commercial pages repeat a photo: '+path)
  pagePhotos.add(photo)
  assert(html.includes('<svg'),'Public page lacks icons: '+path)
  assert(html.includes('content="#AC492F"'),'Public theme does not use copper: '+path)
  assert(!html.includes('id="lead-request"'),'Old commercial form remains: '+path)
  assert(!html.includes('name="full_name"')&&!html.includes('name="business_name"'),'Commercial lead fields remain: '+path)
  const contactLinks=Array.from(html.matchAll(/<a\b([^>]*data-whatsapp-contact[^>]*)>/g))
  assert(contactLinks.length>=3,'WhatsApp contact buttons missing: '+path)
  for(const [,attributes] of contactLinks){
   const href=attributes.match(/href="([^"]+)"/)?.[1]
   const url=new URL(href.replaceAll('&amp;','&'))
   assert.equal(url.origin,'https://wa.me',path)
   assert.equal(url.pathname,'/5582996443151',path)
   assert(url.searchParams.get('text')?.includes('Barber System'),'Contact message missing: '+path)
   assert(attributes.includes('target="_blank"')&&attributes.includes('rel="noopener noreferrer"'),'External contact link needs safe new tab: '+path)
  }
  assert(html.includes('(82) 99644-3151'),'Contact number missing: '+path)
  if(path==='/precos'){
   assert(html.includes(`data-base-cents="${expectedPricing[0]}"`)&&html.includes(`data-barber-cents="${expectedPricing[1]}"`)&&html.includes(`data-cap-cents="${expectedPricing[2]}"`),'Public plan differs from current configured pricing')
  }
 }
 results.push({path,status:response.status,title:html.match(/<title>(.*?)<\/title>/)?.[1]})
}
for(const path of ['/marketing.css','/marketing.js','/blog/blog.css','/blog/blog.js','/brand/barber-system-logo.png','/brand/barber-system-mark.svg','/analytics.css','/analytics.js','/analytics-config.json',...Array.from(pagePhotos,x=>'/marketing/'+x),...['agenda','assinaturas','clientes','financeiro','gestao','marketing'].flatMap(t=>[1,2,3,'hero'].map(n=>`/blog/covers/${t}-${n}.svg`))]){
 const response=await fetch(base+path);assert.equal(response.status,200,path);assert(!response.headers.get('content-type')?.includes('text/html'),'Asset served as HTML: '+path)
}
const sitemap=await fetch(base+'/sitemap.xml'),xml=await sitemap.text()
assert.equal(sitemap.status,200)
assert(xml.includes('<urlset')&&xml.includes('/blog/como-comecar-no-barber-system'),'Sitemap needs published article')
assert(!xml.includes('/b/')&&!xml.includes('/app')&&!xml.includes('/entrar'),'Private/tenant routes excluded from sitemap')
assert(!xml.includes('como-organizar-a-agenda-da-barbearia-rotina-pratica-para-reduzir-conflitos'),'Future article leaked to sitemap')
const scheduled=JSON.parse(await fs.readFile(new URL('../../verification/blog-content-20261005/calendar-60.json',import.meta.url),'utf8'))
const hidden=await fetch(base+'/blog/'+scheduled[0].values.slug);assert.equal(hidden.status,404,'Scheduled article exposed too early')
const protectedApi=await fetch(base+'/api/platform-leads');assert.equal(protectedApi.status,401,'Master leads exposed without login')
const app=await fetch(base+'/app'),appHtml=await app.text();assert.equal(app.status,200);assert(appHtml.includes('assets/index-'),'App route no longer works')
const blogAdmin=await fetch(base+'/api/blog-admin/list');assert.equal(blogAdmin.status,401,'Blog administration exposed without login')
const marketingScript=await (await fetch(base+'/marketing.js')).text();assert(!marketingScript.includes('/api/platform-leads/request'),'Commercial form submission remains active')
console.log(JSON.stringify({origin:base,pages:results,distinctCommercialPhotos:pagePhotos.size,newPublicLogo:true,configuredPricingVerified:true,expectedPricingCents:expectedPricing,whatsappContact:{commercialPages:pagePhotos.size,phone:'5582996443151',oldFormsRemoved:true},sitemap:{status:sitemap.status,urls:(xml.match(/<loc>/g)||[]).length,miniBioExcluded:true},scheduledHidden:true,masterLeadsProtected:true,blogAdminProtected:true,app:true},null,2))
