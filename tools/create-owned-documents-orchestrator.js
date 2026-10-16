async function createOwnedDocs(ids, tools, load, store, notify) {
 const cwd='C:\\Users\\V15\\Documents\\Codex\\2026-09-28\\preciso-de-um-sistema-tipo-cashbarber-2';
 const base=cwd.replaceAll('\\','/')+'/work/verification/backlink-articles-20261005';
 let checkpoint=load('owned-doc-checkpoint');
 if(!checkpoint){const raw=await tools.exec_command({cmd:'Get-Content -Raw work/verification/backlink-articles-20261005/docs-checkpoint.json',workdir:cwd,max_output_tokens:18000});checkpoint=JSON.parse(raw.output);store('checkpoint-file-text',raw.output.trimEnd().replaceAll('\r',''));}
 async function persist(){
  let old=load('checkpoint-file-text');
  if(!old){const raw=await tools.exec_command({cmd:'Get-Content -Raw work/verification/backlink-articles-20261005/docs-checkpoint.json',workdir:cwd,max_output_tokens:18000});old=raw.output.trimEnd().replaceAll('\r','');}
  const next=JSON.stringify(checkpoint,null,2);
  if(old!==next){await tools.apply_patch('*** Begin Patch\n*** Update File: '+base+'/docs-checkpoint.json\n@@\n'+old.split('\n').map(x=>'-'+x).join('\n')+'\n'+next.split('\n').map(x=>'+'+x).join('\n')+'\n*** End Patch');}
  store('checkpoint-file-text',next);store('owned-doc-checkpoint',checkpoint);
 }
 const extract=doc=>doc.tabs.flatMap(t=>t.body?.content??[]).flatMap(e=>e.paragraph?.elements??[]).map(e=>e.textRun?.content??'').join('');
 for(const id of ids){
  if(!/^OWN-\d{3}$/.test(id))throw new Error('Invalid article id');
  if(checkpoint[id]?.status==='verified')continue;
  const raw=await tools.exec_command({cmd:'Get-Content -Raw work/verification/backlink-articles-20261005/google-doc-payloads/'+id+'.json',workdir:cwd,max_output_tokens:24000});
  if(raw.exit_code!==0)throw new Error('Payload missing: '+id);
  const payload=JSON.parse(raw.output);
  if(!checkpoint[id]){
   const created=await tools.mcp__codex_apps__google_drive_create_file({mime_type:'application/vnd.google-apps.document',title:payload.title});
   if(created.isError || !created.structuredContent?.fileId)throw new Error('Document creation outcome needs review: '+JSON.stringify(created));
   const meta=created.structuredContent;checkpoint[id]={document_id:meta.fileId,url:meta.url,status:'created'};await persist();
  }
  const docId=checkpoint[id].document_id;
  const before=await tools.mcp__codex_apps__google_drive_get_document({document_id:docId,fields:'documentId,revisionId,title,tabs(documentTab(body(content)),tabProperties)'});
  if(before.isError)throw new Error(JSON.stringify(before));
  const data=before.structuredContent,tab=data.tabs?.[0];
  if(!tab?.tabId)throw new Error('No document tab: '+id);
  const oldText=extract(data);
  if(oldText.trim()&&oldText.trimEnd()!==payload.expected_text.trimEnd())throw new Error('Unexpected existing content: '+id);
  const requests=payload.requests.filter(r=>!oldText.trim()||!r.insertText).map(r=>{
   const [key,value]=Object.entries(r)[0];if(value.range)value.range.tabId=tab.tabId;if(value.location)value.location.tabId=tab.tabId;return {[key]:value};
  });
  const updated=await tools.mcp__codex_apps__google_drive_batch_update_document({document_id:docId,requests,write_control:{requiredRevisionId:data.revisionId}});
  if(updated.isError)throw new Error(JSON.stringify(updated));
  const after=await tools.mcp__codex_apps__google_drive_get_document({document_id:docId,fields:'documentId,revisionId,title,tabs(documentTab(body(content)),tabProperties)'});
  if(after.isError)throw new Error(JSON.stringify(after));
  const result=after.structuredContent;
  if(extract(result).trimEnd()!==payload.expected_text.trimEnd())throw new Error('Text mismatch: '+id);
  const links=result.tabs.flatMap(t=>t.body?.content??[]).flatMap(e=>e.paragraph?.elements??[]).map(e=>e.textRun?.textStyle?.link?.url).filter(Boolean);
  if(payload.target_urls.some(url=>!links.includes(url)))throw new Error('Missing backlink: '+id);
  checkpoint[id].status='verified';checkpoint[id].verified_links=[...new Set(links)];await persist();
  notify(id+' verificado');
 }
 return {verified:Object.values(checkpoint).filter(x=>x.status==='verified').length};
}
