import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import {renderMarketingPage,marketingPages} from '../netlify/functions/_shared/marketingPages.ts'
const directory=new URL('../public/tests/marketing/',import.meta.url)
await fs.mkdir(directory,{recursive:true})
for (const page of marketingPages){
 const html=renderMarketingPage(page.path)
 assert.equal((html.match(/<h1>/g)||[]).length,1)
 assert.ok(html.includes(`href="https://sistemadebarbearia.com.br${page.path}"`))
 assert.ok(html.includes('https://wa.me/5582996443151?text='))
 assert.ok(!html.includes('id="lead-request"'))
 assert.ok(!html.includes('/b/kingsman'))
 const file=page.path==='/'?'index.html':page.path.slice(1)+'.html'
 await fs.writeFile(new URL(file,directory),html)
}
assert.equal(renderMarketingPage('/nao-existe'),null)
assert.equal(new Set(marketingPages.map(page=>page.title)).size,9)
console.log('9 páginas comerciais com título, canonical, H1 e contato por WhatsApp validados. Prévia local criada.')
