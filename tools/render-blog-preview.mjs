import fs from 'node:fs/promises'
import {renderBlogArticle,renderBlogIndex} from '../netlify/functions/_shared/blogRender.ts'
const posts=JSON.parse(await fs.readFile(new URL('../../verification/blog-content-20261005/manifest-posts1-30.json',import.meta.url),'utf8')).slice(0,6).map(post=>({...post,author_name:'Equipe Barber System',visible_at:'2026-10-05T12:00:00Z',category_name:'Agenda e operação',cover_url:'/blog/barbershop-hero.webp',reading_minutes:4}))
const directory=new URL('../public/tests/blog/',import.meta.url)
await fs.mkdir(directory,{recursive:true})
await fs.writeFile(new URL('index.html',directory),renderBlogIndex({posts,total:6,page:1,page_size:12,categories:[{slug:'agenda',name:'Agenda'},{slug:'financeiro',name:'Financeiro'},{slug:'assinaturas',name:'Assinaturas'},{slug:'gestao',name:'Gestão'}]}))
await fs.writeFile(new URL('article.html',directory),renderBlogArticle(posts[0],posts.slice(1,4),false,new Set(posts.map(post=>post.slug))))
console.log('Prévias do blog e artigo geradas com seis conteúdos ficticiamente visíveis apenas no ambiente local.')
