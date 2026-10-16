const applyOwnedCover = async function applyOwnedCover(id,cp,tools,load,store,replace=false){
 if(!load('docs-owned-trusted-'+id))throw Error(id+' missing initial trusted read');
 const docid=cp[id].document_id,path='C:/Users/V15/Documents/Codex/2026-09-28/preciso-de-um-sistema-tipo-cashbarber-2/work/verification/backlink-covers-20261005/'+id+'-cover.png';
 async function read(){
  const r=await tools.mcp__codex_apps__google_drive_get_document({document_id:docid,fields:"documentId,revisionId,title,tabs(tabProperties,documentTab(body(content),inlineObjects))"});
  const d=r.structuredContent;
  if(!d?.tabs||!d.revisionId)throw Error(id+' document read failed '+JSON.stringify(d));
  return d;
 }
 const before=await read();
 const flatten=d=>d.tabs.flatMap(t=>t.body?.content||[]).flatMap(e=>e.paragraph?.elements||[]);
 const textOf=d=>flatten(d).map(e=>e.textRun?.content||'').join('');
 const linksOf=d=>flatten(d).filter(e=>e.textRun?.textStyle?.link?.url).map(e=>({text:e.textRun.content,url:e.textRun.textStyle.link.url}));
 const beforeText=textOf(before), beforeLinks=JSON.stringify(linksOf(before));
 const t=before.tabs.find(t=>(t.body?.content||[]).some(e=>e.paragraph?.paragraphStyle?.namedStyleType==='TITLE'));
 if(!t)throw Error(id+' title not found');
 const title=t.body.content.find(e=>e.paragraph?.paragraphStyle?.namedStyleType==='TITLE');
 const images=(t.body.content||[]).flatMap(e=>e.paragraph?.elements||[]).filter(e=>e.inlineObjectElement);
 const blank=t.body.content.find(e=>e.startIndex===title.endIndex);
 if(!blank?.paragraph||blank.paragraph.elements.some(e=>e.textRun?.content.trim()))throw Error(id+' no empty paragraph after title');
 let requests;
 if(images.length){
  if(images.length!==1||images[0].startIndex!==blank.startIndex)throw Error(id+' existing images need review');
  if(!replace){
   const receipt={id,document_id:docid,status:'verified_existing',inlineObjectId:images[0].inlineObjectElement.inlineObjectId,textPreserved:true,linksPreserved:true};
   store('owned-doc-cover-'+id,receipt);return receipt;
  }
  requests=[{deleteContentRange:{range:{startIndex:images[0].startIndex,endIndex:images[0].endIndex,tabId:t.tabId}}},{insertInlineImage:{location:{index:blank.startIndex,tabId:t.tabId},uri:path,objectSize:{width:{magnitude:432,unit:'PT'},height:{magnitude:288,unit:'PT'}}}}];
 }else requests=[
  {insertInlineImage:{location:{index:blank.startIndex,tabId:t.tabId},uri:path,objectSize:{width:{magnitude:432,unit:'PT'},height:{magnitude:288,unit:'PT'}}}},
  {updateParagraphStyle:{range:{startIndex:blank.startIndex,endIndex:blank.endIndex+1,tabId:t.tabId},paragraphStyle:{alignment:'CENTER',spaceAbove:{magnitude:12,unit:'PT'},spaceBelow:{magnitude:18,unit:'PT'}},fields:'alignment,spaceAbove,spaceBelow'}}
 ];
 const delta=images.length?0:1;
 for(const heading of t.body.content.filter(e=>/^(TITLE|HEADING_[1-6])$/.test(e.paragraph?.paragraphStyle?.namedStyleType||''))) {
 const offset=heading.startIndex>=blank.startIndex?delta:0;
requests.push({updateParagraphStyle:{range:{startIndex:heading.startIndex+offset,endIndex:heading.endIndex+offset,tabId:t.tabId},paragraphStyle:{keepWithNext:true},fields:'keepWithNext'}});
 for(let pos=t.body.content.indexOf(heading)+1;pos<t.body.content.length;pos++){
 const next=t.body.content[pos];
 if(!next.paragraph||next.paragraph.elements.some(el=>el.inlineObjectElement||el.textRun?.content.trim()))break;
 const blankOffset=next.startIndex>=blank.startIndex?delta:0;
 requests.push({updateParagraphStyle:{range:{startIndex:next.startIndex+blankOffset,endIndex:next.endIndex+blankOffset,tabId:t.tabId},paragraphStyle:{keepWithNext:true},fields:'keepWithNext'}});
 }
 }
 const result=await tools.mcp__codex_apps__google_drive_batch_update_document({document_id:docid,image_uris:path,requests,write_control:{requiredRevisionId:before.revisionId}});
 if(result.isError||result.structuredContent?.error)throw Error(id+' write error '+JSON.stringify(result.structuredContent));
 const after=await read(), el=flatten(after).filter(e=>e.inlineObjectElement);
 if(el.length!==1||textOf(after)!==beforeText||JSON.stringify(linksOf(after))!==beforeLinks)throw Error(id+' readback mismatch');
 const tab=after.tabs.find(afterTab=>afterTab.tabId===t.tabId), object=tab.inlineObjects[el[0].inlineObjectElement.inlineObjectId];
 const size=object.inlineObjectProperties.embeddedObject.size;
 if(size.width.magnitude!==432||size.height.magnitude!==288)throw Error(id+' incorrect image size');
 if(after.tabs.flatMap(tab=>tab.body.content).some(e=>/^(TITLE|HEADING_[1-6])$/.test(e.paragraph?.paragraphStyle?.namedStyleType||'')&&e.paragraph.paragraphStyle.keepWithNext!==true))throw Error(id+' heading layout mismatch');
 const receipt={id,document_id:docid,headingLayoutVerified:true,status:replace?'verified_replacement':'verified_inserted',inlineObjectId:el[0].inlineObjectElement.inlineObjectId,textPreserved:true,linksPreserved:true,links:linksOf(after).length,revision:after.revisionId,widthPT:432,heightPT:288};
 store('owned-doc-cover-'+id,receipt);return receipt;
};
