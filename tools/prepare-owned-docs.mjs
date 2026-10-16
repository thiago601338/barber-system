import fs from 'node:fs/promises'
import MarkdownIt from 'markdown-it'
import assert from 'node:assert/strict'
const directory=new URL('../../verification/backlink-articles-20261005/',import.meta.url)
const md=new MarkdownIt({html:false,linkify:false})
const files=(await fs.readdir(directory)).filter(file=>['manifest-owned1-45.json','manifest-owned46-90.json','manifest-owned91-134.json'].includes(file))
const articles=[]
for(const file of files)articles.push(...JSON.parse(await fs.readFile(new URL(file,directory),'utf8')))
assert.equal(new Set(articles.map(article=>article.id)).size,articles.length,'Duplicate canonical articles')
const output=new URL('google-doc-payloads/',directory);await fs.mkdir(output,{recursive:true})
for(const article of articles){
 let text=article.title+'\n',headings=[{startIndex:1,endIndex:text.length+1,type:'TITLE'}],styles=[]
 let nextHeading=null,listDepth=0
 const tokens=md.parse(article.body_md,{})
 for(const token of tokens){
  if(token.type==='heading_open')nextHeading=Number(token.tag.slice(1))
  if(token.type==='bullet_list_open'||token.type==='ordered_list_open')listDepth++
  if(token.type==='bullet_list_close'||token.type==='ordered_list_close')listDepth--
  if(token.type!=='inline')continue
  if(nextHeading===1&&token.content===article.title){nextHeading=null;continue}
  text+='\n';const start=text.length+1
  if(listDepth)text+='• '
  const stack=[]
  for(const child of token.children||[]){
   const index=text.length+1
   if(['text','code_inline','image'].includes(child.type))text+=child.content
   if(['softbreak','hardbreak'].includes(child.type))text+=' '
   if(['strong_open','em_open','link_open'].includes(child.type))stack.push({type:child.type,startIndex:index,url:child.attrGet('href')})
   if(['strong_close','em_close','link_close'].includes(child.type)){
    const item=stack.pop();if(!item||index<=item.startIndex)continue
    const style=item.type==='link_open'?{link:{url:item.url}}:item.type==='strong_open'?{bold:true}:{italic:true}
    if(style.link){assert(/^https:\/\//.test(String(item.url)));assert(!String(item.url).includes('localhost'))}
    styles.push({updateTextStyle:{range:{startIndex:item.startIndex,endIndex:index},textStyle:style,fields:style.link?'link':style.bold?'bold':'italic'}})
   }
  }
  text+='\n';if(nextHeading){headings.push({startIndex:start,endIndex:text.length+1,type:`HEADING_${Math.min(3,Math.max(1,nextHeading))}`});nextHeading=null}
 }
 const requests=[{insertText:{location:{index:1},text}},
  {updateDocumentStyle:{documentStyle:{marginTop:{magnitude:54,unit:'PT'},marginBottom:{magnitude:54,unit:'PT'},marginLeft:{magnitude:54,unit:'PT'},marginRight:{magnitude:54,unit:'PT'}},fields:'marginTop,marginBottom,marginLeft,marginRight'}},
  {updateTextStyle:{range:{startIndex:1,endIndex:text.length+1},textStyle:{weightedFontFamily:{fontFamily:'Arial'},fontSize:{magnitude:11,unit:'PT'},foregroundColor:{color:{rgbColor:{red:.09,green:.16,blue:.25}}}},fields:'weightedFontFamily,fontSize,foregroundColor'}},
  {updateParagraphStyle:{range:{startIndex:1,endIndex:text.length+1},paragraphStyle:{lineSpacing:115,spaceAbove:{magnitude:0,unit:'PT'},spaceBelow:{magnitude:6,unit:'PT'}},fields:'lineSpacing,spaceAbove,spaceBelow'}},
  ...headings.flatMap(heading=>[{updateParagraphStyle:{range:{startIndex:heading.startIndex,endIndex:heading.endIndex},paragraphStyle:{namedStyleType:heading.type},fields:'namedStyleType'}},{updateTextStyle:{range:{startIndex:heading.startIndex,endIndex:heading.endIndex-1},textStyle:{bold:true,fontSize:{magnitude:heading.type==='TITLE'?20:heading.type==='HEADING_2'?14:12,unit:'PT'},foregroundColor:{color:{rgbColor:{red:.08,green:.19,blue:.38}}}},fields:'bold,fontSize,foregroundColor'}}]),...styles]
 const id=String(article.id)
 await fs.writeFile(new URL(id+'.json',output),JSON.stringify({id,title:article.title,domain:article.domain,expected_text:text,target_urls:article.target_urls,requests},null,2))
}
console.log(JSON.stringify({prepared:articles.length,ids:articles.map(article=>article.id)}))
