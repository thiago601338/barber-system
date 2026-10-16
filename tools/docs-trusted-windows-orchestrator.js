async function trustedOwnedDocRead(id,documentId,version,tools,load,store){
 const work='C:/Users/V15/Documents/Codex/2026-09-28/preciso-de-um-sistema-tipo-cashbarber-2/work'
 const skill='C:/Users/V15/.codex/plugins/cache/openai-curated-remote/google-drive/0.1.16/skills/google-docs'
 if(!/^OWN-\d{3}$/.test(id)||!/^\d{2}$/.test(version))throw Error('Invalid trusted-read target')
 const source=load('docs-trusted-bridge-windows-source')
 if(!source)throw Error('Load and byte-check the checked-in trusted bridge first')
 const bridge=new Function(source.replace(/^\s*export\s+\{[^}]*\};?\s*$/gm,'').replace(/^\s*export\s+/gm,'')+'\nreturn {executeDocsTrustedReadToFiles};')()
 const pakoSource=load('docs-io-pako-source')
 if(!pakoSource)throw Error('Load the bundled compression library before document reads')
 const pakoModule={exports:{}}
 const pako=new Function('exports','module',pakoSource+'\nreturn module.exports;')(pakoModule.exports,pakoModule)
 function base64(bytes){
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let output=''
  for(let i=0;i<bytes.length;i+=3){const a=bytes[i],b=bytes[i+1],c=bytes[i+2];output+=alphabet[a>>2]+alphabet[((a&3)<<4)|((b||0)>>4)]+(i+1<bytes.length?alphabet[((b&15)<<2)|((c||0)>>6)]:'=')+(i+2<bytes.length?alphabet[c&63]:'=')}
  return output
 }
 async function request(task){
  let result=await tools.write_stdin({session_id:load('docs-windows-io-session'),chars:JSON.stringify(task)+'\n',yield_time_ms:1000,max_output_tokens:1200})
  let output=result.output
  for(let poll=0;poll<5&&!/\{[^\r\n]*\}/.test(output);poll++){
   result=await tools.write_stdin({session_id:load('docs-windows-io-session'),chars:'',yield_time_ms:1000,max_output_tokens:1200})
   output+=result.output
  }
  const clean=output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/\x1b\][^\x07]*\x07/g,'')
  const messages=clean.match(/\{[^\r\n]*\}/g)
  if(!messages?.length)throw Error('No receipt from the no-echo Windows file receiver')
  const data=JSON.parse(messages.at(-1))
  if(data.error)throw Error(data.error)
  return data
 }
 const fileIO={
  readText:async p=>{
   const native=p.replace(/^\/([A-Za-z]:\/)/,'$1')
   if(!native.startsWith(skill+'/'))throw Error('Only trusted module sources may be read by this adapter')
   const key='docs-trusted-module-source:'+native
   let source=load(key)
   if(!source){
    const result=await tools.exec_command({cmd:'node -e "process.stdout.write(JSON.stringify({text:require(\'node:fs\').readFileSync(\''+native+'\',\'utf8\')}));"',workdir:work+'/barber-system',max_output_tokens:25000})
    if(result.exit_code!==0)throw Error('Trusted module read failed')
    source=JSON.parse(result.output).text
    store(key,source)
   }
   return source
  },
  exists:async p=>{
   const native=p.replace(/^\/([A-Za-z]:\/)/,'$1')
   if(!native.startsWith(work+'/verification/backlink-covers-20261005/'))throw Error('Invalid document artifact path')
   const result=await tools.exec_command({cmd:'node -e "process.stdout.write(JSON.stringify({exists:require(\'node:fs\').existsSync(\''+native+'\')}));"',workdir:work+'/barber-system',max_output_tokens:1000})
   if(result.exit_code!==0)throw Error('Artifact existence check failed')
   return JSON.parse(result.output).exists
  },
  writeBatch:async files=>{
   const encoded=base64(pako.gzip(JSON.stringify(files)))
   if(encoded.length>24000)return request({operation:'writeCompressedBatch',data:encoded})
   const result=await tools.exec_command({cmd:"node tools/docs-bridge-windows-write.mjs '"+encoded+"'",workdir:work+'/barber-system',max_output_tokens:1000})
   if(result.exit_code!==0)throw Error('No-echo artifact write failed')
   return JSON.parse(result.output)
  }
 }
 return bridge.executeDocsTrustedReadToFiles({documentId,workspaceRoot:'/'+work+'/verification/backlink-covers-20261005',outputDir:'/'+work+'/verification/backlink-covers-20261005/trusted/'+id+'-'+version,skillRoot:'/'+skill,tools,fileIO})
}
