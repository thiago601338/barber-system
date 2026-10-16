import fs from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'
import {gunzipSync} from 'node:zlib'

const workspace=path.resolve('../verification/backlink-covers-20261005')
const skill=path.resolve('C:/Users/V15/.codex/plugins/cache/openai-curated-remote/google-drive/0.1.16/skills/google-docs')
const native=input=>path.resolve(String(input).replace(/^\/([A-Za-z]:\/)/,'$1'))
const inside=(candidate,root)=>candidate===root||candidate.startsWith(root+path.sep)
function valid(input,write=false){
 const candidate=native(input)
 if(!inside(candidate,workspace)&&!( !write&&inside(candidate,skill)))throw Error('File is outside the approved document workspace')
 return candidate
}
if(process.stdin.isTTY)process.stdin.setRawMode(true)
const lines=readline.createInterface({input:process.stdin,terminal:false})
console.log('DOCS_WINDOWS_IO_READY')
lines.on('line',async input=>{
 try{
  const task=JSON.parse(input)
  if(task.operation==='exists'){
   const file=valid(task.path)
   console.log(JSON.stringify({exists:await fs.stat(file).then(()=>true,()=>false)}))
  }else if(task.operation==='read'){
   console.log(JSON.stringify({text:await fs.readFile(valid(task.path),'utf8')}))
  }else if(task.operation==='writeBatch'||task.operation==='writeCompressedBatch'){
   const payload=task.operation==='writeCompressedBatch'?JSON.parse(gunzipSync(Buffer.from(task.data,'base64')).toString('utf8')):task.files
   if(!Array.isArray(payload))throw Error('Expected file batch')
   const files=payload.map(item=>({path:valid(item.path,true),text:item.text}))
   for(const file of files){await fs.mkdir(path.dirname(file.path),{recursive:true});await fs.writeFile(file.path,file.text,'utf8')}
   console.log(JSON.stringify({written:files.length}))
  }else if(task.operation==='close'){
   lines.close();process.exit(0)
  }else throw Error('Unknown file operation')
 }catch(error){console.log(JSON.stringify({error:error.message}))}
})
