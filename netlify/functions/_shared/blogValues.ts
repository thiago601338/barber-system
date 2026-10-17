import {HttpError} from './core.ts'
export const blogSlug=/^[a-z0-9]+(?:-[a-z0-9]+)*$/
export function blogImage(value:unknown):string|null {
 if(typeof value!=='string'||!value||value.length>2048)return null
 if(/^\/(?:blog|brands|assets)\/[a-zA-Z0-9/_-]+\.(?:webp|png|jpe?g|avif|svg)$/.test(value)&&!value.includes('..'))return value
 try {const url=new URL(value);if(url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&/^[a-z0-9.-]+$/i.test(url.hostname)&&url.hostname.includes('.')&&!/^\d+(?:\.\d+){3}$/.test(url.hostname)&&!url.hostname.endsWith('.local')&&!url.hostname.endsWith('.localhost'))return url.href}catch{/* Invalid image stays unset. */}
 return null
}
/** Gravações de tela do próprio site (com capa .jpg ao lado), para embutir em artigos com ![legenda](/marketing/videos/x.mp4). */
export function blogVideo(value:unknown):string|null {return typeof value==='string'&&/^\/marketing\/videos\/[a-z0-9]+(?:-[a-z0-9]+)*\.mp4$/.test(value)?value:null}
function string(value:unknown,label:string,min:number,max:number):string {if(typeof value!=='string'||value.trim().length<min||value.trim().length>max)throw new HttpError(422,`${label}: informe entre ${min} e ${max} caracteres.`);return value.trim()}
export function blogPostValues(value:unknown,partial=false):Record<string,unknown> {
 if(!value||typeof value!=='object'||Array.isArray(value))throw new HttpError(422,'Artigo inválido.')
 const raw=value as Record<string,unknown>,result:Record<string,unknown>={}
 const limits:Record<string,[string,number,number]>={slug:['Endereço',1,160],title:['Título',4,180],excerpt:['Resumo',0,500],body_md:['Conteúdo',1,120000],seo_title:['Título SEO',0,160],seo_description:['Descrição SEO',0,320],cover_alt:['Descrição da capa',0,240],author_name:['Autor',2,120]}
 for(const [key,item]of Object.entries(raw)){
  if(key in limits){const [label,min,max]=limits[key];result[key]=item===null&&min===0?null:string(item,label,min,max)}
  else if(key==='status'){if(!['draft','scheduled','published'].includes(String(item)))throw new HttpError(422,'Situação inválida.');result[key]=item}
  else if(key==='category_id'){if(item!==null&&item!==''&&(typeof item!=='string'||!/^[a-f0-9-]{36}$/i.test(item)))throw new HttpError(422,'Categoria inválida.');result[key]=item||null}
  else if(key==='tags'){if(!Array.isArray(item)||item.length>12)throw new HttpError(422,'Use no máximo 12 marcadores.');result[key]=[...new Set(item.map(tag=>string(tag,'Marcador',1,40)))]}
  else if(key==='scheduled_at'){if(item!==null&&item!==''&&(typeof item!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(item)||Number.isNaN(Date.parse(item))))throw new HttpError(422,'Informe a data e hora com fuso.');result[key]=item?new Date(String(item)).toISOString():null}
  else if(key==='cover_url'){if(item&& !blogImage(item))throw new HttpError(422,'Use uma imagem HTTPS ou um arquivo válido de /blog/, /brands/ ou /assets/.');result[key]=blogImage(item)}
  else throw new HttpError(422,`Campo não permitido: ${key}`)
 }
 if(result.slug!==undefined&&!blogSlug.test(String(result.slug)))throw new HttpError(422,'O endereço aceita apenas letras minúsculas, números e hífens.')
 if(!partial)for(const key of ['slug','title','body_md'])if(!result[key])throw new HttpError(422,'Preencha título, endereço e conteúdo.')
 if(result.status==='scheduled'&&!result.scheduled_at)throw new HttpError(422,'Escolha a data e hora da publicação agendada.')
 return result
}
