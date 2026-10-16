import type {Config} from '@netlify/functions'
import {body,db,failure,HttpError,json,requirePlatformAdmin,userFromRequest,uuid} from './_shared/core.ts'
import {blogPostValues,blogSlug} from './_shared/blogValues.ts'
import {renderBlogArticle,type BlogPost} from './_shared/blogRender.ts'
export const config:Config={path:'/api/blog-admin/:action'}
function categoryValues(value:unknown){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new HttpError(422,'Categoria inválida.');const raw=value as Record<string,unknown>,result:Record<string,unknown>={}
 for(const [key,v]of Object.entries(raw)){
  if(['slug','name','description'].includes(key)){const min=key==='description'?0:key==='name'?2:1,max=key==='description'?400:100;if(typeof v!=='string'||v.trim().length<min||v.trim().length>max||(key==='slug'&&!blogSlug.test(v)))throw new HttpError(422,'Revise o nome, endereço e descrição da categoria.');result[key]=v.trim()}
  else if(key==='active'){if(typeof v!=='boolean')throw new HttpError(422,'Situação da categoria inválida.');result[key]=v}
  else if(key==='position'){if(!Number.isInteger(v)||Number(v)<0||Number(v)>1000)throw new HttpError(422,'Ordem da categoria inválida.');result[key]=v}
  else throw new HttpError(422,'Campo de categoria não permitido.')
 }return result
}
export default async function handler(request:Request){try{
 const client=db(),user=await userFromRequest(request,client);await requirePlatformAdmin(client,user.id)
 const url=new URL(request.url),action=url.pathname.split('/').at(-1)
 async function query<T>(result:PromiseLike<{data:T|null;error:{code?:string;message:string}|null}>){const {data,error}=await result;if(error){if(error.code==='23505')throw new HttpError(409,'Esse endereço já existe.');if(error.code==='22023')throw new HttpError(error.message.includes('Recarregue')?409:422,error.message);if(['23514','22P02','23502','23503'].includes(error.code||''))throw new HttpError(422,'Revise os campos do conteúdo.');throw new HttpError(500,'Não foi possível carregar ou salvar o blog.')}return data}
 if(request.method==='GET'&&action==='list'){
  const posts=await query(client.from('platform_blog_posts').select('id,slug,title,excerpt,status,category_id,scheduled_at,published_at,ever_public,revision,author_name,updated_at').order('updated_at',{ascending:false}).limit(500))
  const categories=await query(client.from('platform_blog_categories').select('*').order('position').order('name'))
  return json({posts,categories})
 }
 if(request.method==='GET'&&action==='read'){
  const id=uuid(url.searchParams.get('id')),post=await query(client.from('platform_blog_posts').select('id,slug,title,excerpt,body_md,category_id,tags,status,scheduled_at,published_at,ever_public,seo_title,seo_description,cover_url,cover_alt,author_name,revision,created_at,updated_at').eq('id',id).maybeSingle())
  if(!post)throw new HttpError(404,'Artigo não encontrado.');const audit=await query(client.from('platform_blog_audit').select('action,status_before,status_after,revision,changed_fields,created_at').eq('record_type','post').eq('record_id',id).order('created_at',{ascending:false}).limit(20));return json({post,audit})
 }
 if(request.method!=='POST')throw new HttpError(405,'Método não permitido.')
 const payload=await body<Record<string,unknown>>(request)
 if(action==='save'){
  const id=payload.id?uuid(payload.id):null,values=blogPostValues(payload.values,!id?false:true)
  if(id&&(!Number.isInteger(payload.expected_revision)||Number(payload.expected_revision)<1))throw new HttpError(422,'Recarregue o artigo antes de salvar.')
  return json({post:await query(client.rpc('manage_platform_blog_post',{p_actor:user.id,p_id:id,p_values:values,p_expected_revision:id?payload.expected_revision:null}))})
 }
 if(action==='category')return json({category:await query(client.rpc('manage_platform_blog_category',{p_actor:user.id,p_id:payload.id?uuid(payload.id):null,p_values:categoryValues(payload.values)}))})
 if(action==='preview'){
  const values=blogPostValues(payload.values),post={...values,visible_at:new Date().toISOString()} as unknown as BlogPost
  if(values.category_id){const category=await query<{slug:string;name:string}>(client.from('platform_blog_categories').select('slug,name').eq('id',String(values.category_id)).maybeSingle());if(category){post.category_slug=category.slug;post.category_name=category.name}}
  return json({html:renderBlogArticle(post,[],true)})
 }
 throw new HttpError(404,'Operação não encontrada.')
 }catch(error){return failure(error)}}
