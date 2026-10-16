const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process')
const project=path.resolve(__dirname,'..'),generated=path.join(project,'node_modules/.cache/blog-ssr-tests'),base=fs.existsSync(path.join(project,'netlify/functions/blog-public.ts'))?'netlify/functions':'tools/blog-staging'
fs.mkdirSync(generated,{recursive:true});fs.writeFileSync(path.join(generated,'package.json'),'{"type":"commonjs"}')
execFileSync(process.execPath,[path.join(project,'node_modules/typescript/bin/tsc'),'--ignoreConfig','--target','es2022','--module','commonjs','--moduleResolution','bundler','--rewriteRelativeImportExtensions','--esModuleInterop','--skipLibCheck','--types','vite/client,@netlify/functions','--rootDir','.','--outDir',generated,`${base}/blog-public.ts`,`${base}/blog-admin.ts`],{cwd:project,stdio:'pipe'})
const render=require(path.join(generated,base,'_shared/blogRender.js')),values=require(path.join(generated,base,'_shared/blogValues.js')),core=require(path.join(generated,'netlify/functions/_shared/core.js'))
const publicHandler=require(path.join(generated,base,'blog-public.js')).default,adminHandler=require(path.join(generated,base,'blog-admin.js')).default
const post={id:'00000000-0000-0000-0000-000000000001',slug:'agenda-para-barbearia',title:'Agenda & atendimento',excerpt:'Organização <segura>',body_md:'## Agenda\n\nConteúdo útil.\n\n## Agenda\n\n### Primeiro passo\n\n[Link](https://example.com)',author_name:'Equipe Barber System',visible_at:'2026-10-05T12:00:00Z',updated_at:'2026-10-05T13:00:00Z'}
test('Markdown refuses raw HTML, dangerous links and unsafe image schemes while creating stable unique TOC',()=>{
 const data=render.renderBlogMarkdown(post.body_md+'\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1))\n\n![x](data:image/png;base64,evil)\n\n<img src=x onerror=alert(1)>')
 assert.deepEqual(data.toc.map(x=>x.id),['agenda','agenda-2','primeiro-passo']);assert(!data.html.includes('<script>'));assert(!data.html.includes('<img src=x'));assert(!/href="javascript:/.test(data.html));assert(!/src="data:/.test(data.html));assert(data.html.includes('&lt;script&gt;'));assert(data.html.includes('rel="noopener noreferrer"'))
})
test('article HTML is complete without JavaScript and structured data cannot break out of its script',()=>{
 const html=render.renderBlogArticle({...post,title:'Título </script><script>alert(1)</script>'})
 assert(html.startsWith('<!doctype html>'));assert(html.includes('Conteúdo útil.'));assert(html.includes('id="agenda-2"'));assert.equal((html.match(/<h1>/g)||[]).length,1)
 const json=/<script type="application\/ld\+json">([^]*?)<\/script>/.exec(html)[1];assert.doesNotThrow(()=>JSON.parse(json));assert(!json.includes('</script>'));assert(html.includes('href="https://sistemadebarbearia.com.br/blog/agenda-para-barbearia"'));assert(html.includes('BlogPosting'))
 assert(render.renderBlogArticle(post,[],true).includes('noindex,follow'));assert(!render.renderBlogArticle(post,[],true).includes('BlogPosting'))
})
test('article figures preserve three distinct assets with safe captions, accessible expansion and structured images',()=>{
 const body='## Entenda o processo\n\n![Mapa de etapas](/blog/articles/agenda-detail.webp "Uma sequência <segura>")\n\n![Infográfico de agenda](/blog/articles/agenda-infographic.svg "Critérios completos")\n\nTexto com ![ícone](/blog/articles/icon.svg) junto da frase.'
 const data=render.renderBlogMarkdown(body),html=render.renderBlogArticle({...post,body_md:body,cover_url:'/blog/articles/agenda-cover.webp',cover_alt:'Capa original'})
 assert.equal((data.html.match(/<figure /g)||[]).length,2);assert(!data.html.includes('<p><figure'));assert(data.html.includes('<figcaption>'));assert(data.html.includes('Uma sequência &lt;segura&gt;'));assert(data.html.includes('Ver infográfico em tamanho maior'));assert(data.html.includes('target="_blank" rel="noopener noreferrer"'));assert(data.html.includes('loading="lazy"'))
 const schema=JSON.parse(/<script type="application\/ld\+json">([^]*?)<\/script>/.exec(html)[1]);assert.deepEqual(schema['@graph'][0].image.slice(0,3),['agenda-cover.webp','agenda-detail.webp','agenda-infographic.svg'].map(file=>'https://sistemadebarbearia.com.br/blog/articles/'+file));assert.equal((html.match(/src="\/blog\/articles\/agenda-(cover|detail|infographic)\.(webp|svg)"/g)||[]).length,3)
 const unsafe=render.renderBlogMarkdown('![malicioso](/blog/../secret.svg "<script>não executar</script>")').html;assert(!unsafe.includes('src="/blog/../secret.svg"'));assert(!unsafe.includes('<figure'));assert(!unsafe.includes('<script>'))
})
test('RSS and sitemap escape XML and include only explicitly public paths',()=>{
 const rss=render.renderBlogRss([post]),sitemap=render.renderBlogSitemap({posts:[post],categories:[{slug:'gestao',updated_at:post.updated_at}]})
 assert(rss.includes('Agenda &amp; atendimento'));assert(rss.includes('&lt;segura&gt;'));assert(sitemap.includes('/precos'));assert(sitemap.includes('/blog/categoria/gestao'));assert(!sitemap.includes('/b/kingsman'));assert(!sitemap.includes('/entrar'));assert(!sitemap.includes('/app'))
})
test('scheduled article links become clickable only after the target is visible',()=>{
 const source='Leia [já publicado](/blog/existente), [a próxima pauta](/blog/futuro) e [a agenda](/agenda-online-para-barbearia).'
 const first=render.renderBlogMarkdown(source,new Set(['existente'])).html
 assert(first.includes('href="/blog/existente"'));assert(!first.includes('href="/blog/futuro"'));assert(first.includes('a próxima pauta'));assert(first.includes('href="/agenda-online-para-barbearia"'))
 const later=render.renderBlogMarkdown(source,new Set(['existente','futuro'])).html
 assert(later.includes('href="/blog/futuro"'))
})
test('public endpoint uses restricted public RPCs, keeps future content identical to missing and sets no-store',async()=>{
 const calls=[];core.db=()=>({rpc:async(name,args)=>{calls.push([name,args]);return{data:name==='blog_public_article'?null:{posts:[post],categories:[],total:1,page:1,page_size:12},error:null}}})
 const missing=await publicHandler(new Request('https://host.invalid/blog/futuro'));assert.equal(missing.status,404);assert.equal(missing.headers.get('cache-control'),'no-store');assert(calls.every(([name])=>name.startsWith('blog_public_')))
 const index=await publicHandler(new Request('https://host.invalid/blog?q=%3Cscript%3E'));assert.equal(index.status,200);assert((await index.text()).includes('&lt;script&gt;'))
 assert.equal((await publicHandler(new Request('https://host.invalid/blog?pagina=-1'))).status,400)
 const head=await publicHandler(new Request('https://host.invalid/blog',{method:'HEAD'}));assert.equal(await head.text(),'')
})
test('master API refuses unauthorized callers and preview never writes a record',async()=>{
 let writes=0;core.db=()=>({rpc:async()=>{writes++;return{data:null,error:null}},from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:null,error:null})})})
 core.userFromRequest=async()=>{throw new core.HttpError(401,'Faça login.')};assert.equal((await adminHandler(new Request('https://host.invalid/api/blog-admin/list'))).status,401)
 core.userFromRequest=async()=>({id:'master'});core.requirePlatformAdmin=async()=>{throw new core.HttpError(403,'Master somente.')};assert.equal((await adminHandler(new Request('https://host.invalid/api/blog-admin/list'))).status,403)
 core.requirePlatformAdmin=async()=>{};const preview=await adminHandler(new Request('https://host.invalid/api/blog-admin/preview',{method:'POST',body:JSON.stringify({values:{slug:post.slug,title:post.title,body_md:post.body_md,author_name:post.author_name,status:'draft'}})}))
 assert.equal(preview.status,200);assert((await preview.json()).html.includes('Prévia privada'));assert.equal(writes,0)
})
test('editor values reject metadata, malformed schedules and image URLs, preserving explicit safe Markdown',()=>{
 assert.throws(()=>values.blogPostValues({...post,created_by:'master'}),/Campo não permitido/)
 assert.throws(()=>values.blogPostValues({slug:'teste',title:'Título',body_md:'Texto',status:'scheduled',scheduled_at:'2026-10-05T12:00'}),/fuso/)
 assert.equal(values.blogImage('javascript:alert(1)'),null);assert.equal(values.blogImage('//evil.test/x.svg'),null);assert.equal(values.blogImage('/blog/../secret.svg'),null)
 assert(values.blogImage('/blog/barbershop-hero.webp'));assert.equal(values.blogPostValues({slug:'teste',title:'Título',body_md:'<script>literal</script>'}).body_md,'<script>literal</script>')
})
