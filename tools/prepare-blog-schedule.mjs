import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
const out=new URL('../../verification/blog-content-20261005/',import.meta.url)
const first=JSON.parse(await fs.readFile(new URL('manifest-posts1-30.json',out),'utf8'))
const second=JSON.parse(await fs.readFile(new URL('manifest-posts31-60.json',out),'utf8'))
const posts=[...first,...second].sort((a,b)=>a.id-b.id)
assert.equal(posts.length,60);assert.equal(new Set(posts.map(post=>post.slug)).size,60)
let day=new Date('2026-10-06T12:00:00Z')
const entries=posts.map(post=>{
 while(![2,4,6].includes(day.getUTCDay()))day.setUTCDate(day.getUTCDate()+1)
 const scheduled_at=day.toISOString();day.setUTCDate(day.getUTCDate()+1)
 const {id,category_slug,sources,word_count,conversion_target,...values}=post
 return {id,category_slug:category_slug.normalize('NFD').replace(/[\u0300-\u036f]/g,''),values:{slug:values.slug,title:values.title,excerpt:values.excerpt,body_md:values.body_md,tags:values.tags,seo_title:values.seo_title,seo_description:values.seo_description,cover_alt:values.cover_alt,cover_url:'/blog/barbershop-hero.webp',author_name:'Equipe Barber System',status:'scheduled',scheduled_at}}
})
await fs.writeFile(new URL('calendar-60.json',out),JSON.stringify(entries,null,2))
for(let offset=0;offset<entries.length;offset+=5){
 const batch=entries.slice(offset,offset+5)
 const payload=JSON.stringify(batch)
 assert(!payload.includes('$scheduled_batch$'))
 const sql=`begin;\ndo $seed$\ndeclare actor uuid;item jsonb;cat uuid;v_values jsonb;\nbegin\n select p.user_id into actor from public.platform_admins p join auth.users u on u.id=p.user_id where lower(u.email)='thiagosilvacandido60@gmail.com';\n if actor is null then raise exception 'Master não localizado';end if;\n for item in select * from jsonb_array_elements($scheduled_batch$${payload}$scheduled_batch$::jsonb) loop\n  if exists(select 1 from public.platform_blog_posts where slug=item->'values'->>'slug') then raise exception 'Artigo já existe: %',item->'values'->>'slug';end if;\n  select id into cat from public.platform_blog_categories where slug=item->>'category_slug';\n  if cat is null then raise exception 'Categoria ausente: %',item->>'category_slug';end if;\n  v_values:=(item->'values')||jsonb_build_object('category_id',cat);\n  perform public.manage_platform_blog_post(actor,null,v_values,null);\n end loop;\nend $seed$;\ncommit;`
 await fs.writeFile(new URL(`seed-schedule-${String(offset+1).padStart(2,'0')}-${offset+batch.length}.sql`,out),sql)
}
console.log(JSON.stringify({posts:entries.length,first:entries[0].values.scheduled_at,last:entries.at(-1).values.scheduled_at,batches:12}))
