import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
const origin=process.argv[2]
assert(/^https:\/\/[a-z0-9.-]+$/.test(origin),'Explicit HTTPS origin required')
const manifest=JSON.parse(await fs.readFile(new URL('../../verification/blog-assets-20261005/VERIFIED.json',import.meta.url),'utf8'))
assert.equal(manifest.files.length,450)
let next=0
const receipts=[]
await Promise.all(Array.from({length:8},async()=>{
 while(next<manifest.files.length){
  const item=manifest.files[next++]
  const response=await fetch(origin+item.url)
  assert.equal(response.status,200,item.url)
  const bytes=Buffer.from(await response.arrayBuffer())
  const expected=await fs.readFile(new URL('../public'+item.url,import.meta.url))
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),crypto.createHash('sha256').update(expected).digest('hex'),'Deployed bytes differ: '+item.url)
  assert(!response.headers.get('content-type')?.includes('text/html'),'Asset served as app HTML: '+item.url)
  receipts.push({url:item.url,status:200,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')})
 }
}))
const output={origin,assets:receipts.length,verified_at:new Date().toISOString(),allMatchLocal:true,receipts}
await fs.writeFile(new URL('../../verification/blog-assets-20261005/live-assets-verified.json',import.meta.url),JSON.stringify(output,null,2)+'\n')
console.log(JSON.stringify({origin,assets:receipts.length,allMatchLocal:true}))
