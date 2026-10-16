import {publicContentSecurityPolicy} from './_shared/publicAnalytics'
import type {Config} from '@netlify/functions'
import {db,HttpError} from './_shared/core.ts'
import {blogSlug} from './_shared/blogValues.ts'
import {renderBlogArticle,renderBlogIndex,renderBlogRss,renderBlogSitemap,renderBlogUnavailable,type BlogIndex,type BlogPost} from './_shared/blogRender.ts'
export const config:Config={path:['/blog','/blog/','/blog/:slug','/blog/categoria/:category','/blog/rss.xml','/sitemap.xml'],excludedPath:['/blog/blog.css','/blog/blog.js','/blog/brand-mark.svg','/blog/barbershop-hero.webp']}
export function blogResponse(content:string,status=200,type='text/html; charset=utf-8',head=false){return new Response(head?null:content,{status,headers:{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'strict-origin-when-cross-origin','content-security-policy':publicContentSecurityPolicy}})}
export default async function handler(request:Request){
 const head=request.method==='HEAD';if(request.method!=='GET'&&!head)return new Response(null,{status:405,headers:{allow:'GET, HEAD'}})
 try{
  const url=new URL(request.url),path=url.pathname.replace(/\/$/,''),client=db()
  async function rpc<T>(name:string,args?:Record<string,unknown>){const {data,error}=await client.rpc(name,args);if(error)throw new HttpError(503,'Conteúdo temporariamente indisponível.');return data as T}
  if(path==='/sitemap.xml')return blogResponse(renderBlogSitemap(await rpc('blog_public_sitemap')),200,'application/xml; charset=utf-8',head)
  if(path==='/blog/rss.xml'){const data=await rpc<BlogIndex>('blog_public_index',{p_size:24});return blogResponse(renderBlogRss(data.posts),200,'application/rss+xml; charset=utf-8',head)}
  const category=/^\/blog\/categoria\/([^/]+)$/.exec(path)?.[1]
  if(path==='/blog'||category){
   const search=(url.searchParams.get('q')||'').trim(),pageText=url.searchParams.get('pagina')||'1',page=Number(pageText)
   if(search.length>100||!/^\d+$/.test(pageText)||!Number.isInteger(page)||page<1||page>10000||(category&&!blogSlug.test(category)))throw new HttpError(400,'Revise os filtros de busca.')
   const data=await rpc<BlogIndex>('blog_public_index',{p_search:search,p_category:category||null,p_page:page,p_size:12})
   if(data.category_missing||(page>1&&!data.posts.length))return blogResponse(renderBlogUnavailable(),404,undefined,head)
   return blogResponse(renderBlogIndex(data,search),200,undefined,head)
  }
  const slug=/^\/blog\/([^/]+)$/.exec(path)?.[1]
  if(!slug||slug.length>160||!blogSlug.test(slug))return blogResponse(renderBlogUnavailable(),404,undefined,head)
  const post=await rpc<BlogPost|null>('blog_public_article',{p_slug:slug});if(!post)return blogResponse(renderBlogUnavailable(),404,undefined,head)
  const related=await rpc<BlogIndex>('blog_public_index',{p_category:post.category_slug||null,p_size:4})
  const visible=await rpc<{posts:Array<{slug:string}>}>('blog_public_sitemap')
  return blogResponse(renderBlogArticle(post,related.posts.filter(item=>item.slug!==slug).slice(0,3),false,new Set(visible.posts.map(item=>item.slug))),200,undefined,head)
 }catch(error){const status=error instanceof HttpError?error.status:503;return blogResponse(renderBlogUnavailable(status===400?'Revise os filtros de busca.':'Tente novamente em instantes.',status===400?'Busca inválida':'Blog temporariamente indisponível'),status,undefined,head)}
}
