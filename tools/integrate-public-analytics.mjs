import fs from 'node:fs/promises';
const base = new URL('../', import.meta.url);
async function replace(relative, oldText, newText) {
 const file = new URL(relative, base), source = await fs.readFile(file,'utf8');
 if(source.includes(newText))return;
 if(!source.includes(oldText))throw new Error('Integration target missing: '+relative);
 await fs.writeFile(file,source.replace(oldText,newText));
}
for(const relative of ['netlify/functions/_shared/marketingPages.ts','netlify/functions/_shared/blogRender.ts']) {
 const file=new URL(relative,base),source=await fs.readFile(file,'utf8');
 if(!source.includes("import {publicAnalyticsAssets}"))await fs.writeFile(file,"import {publicAnalyticsAssets} from './publicAnalytics'\n"+source);
 await replace(relative,'</head><body>','${publicAnalyticsAssets}</head><body>');
}
const policy = "default-src 'none'; img-src 'self' https:; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'; object-src 'none'";
await replace('netlify/functions/blog-public.ts',JSON.stringify(policy),'publicContentSecurityPolicy');
const blogFile=new URL('netlify/functions/blog-public.ts',base),blog=await fs.readFile(blogFile,'utf8');
if(!blog.includes("import {publicContentSecurityPolicy}"))await fs.writeFile(blogFile,"import {publicContentSecurityPolicy} from './_shared/publicAnalytics'\n"+blog);
await replace('public/marketing.js',"window.dispatchEvent(new CustomEvent('barber:lead-submitted'","document.dispatchEvent(new CustomEvent('barber:lead-submitted'");
