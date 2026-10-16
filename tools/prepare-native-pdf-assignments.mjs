import fs from 'node:fs/promises'
const root=new URL('../../verification/',import.meta.url)
const audit=JSON.parse(await fs.readFile(new URL('backlink-articles-20261005/semantic-quality-audit-20261005.json',root),'utf8'))
const approved=audit.reviews.filter(r=>r.required_corrections.length===0).map(r=>r.id)
const corrections=audit.reviews.filter(r=>r.required_corrections.length>0).map(r=>r.id)
if(approved.length!==98||corrections.length!==36)throw Error('Unexpected audit counts')
const assignment={visual_agent:approved.slice(0,49),editorial_agent:approved.slice(49),audit_agent:corrections,require_full_page_visual_review:true}
await fs.writeFile(new URL('backlink-covers-20261005/pdf-qa-assignment.json',root),JSON.stringify(assignment,null,2)+'\n')
console.log(JSON.stringify(Object.fromEntries(Object.entries(assignment).map(([k,v])=>[k,Array.isArray(v)?v.length:v]))))
