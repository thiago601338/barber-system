document.addEventListener('click',async event=>{
 const target=event.target instanceof Element?event.target:null;if(!target)return;
 const sizeButton=target.closest('[data-reader-toggle]');
 if(sizeButton){const large=sizeButton.getAttribute('aria-pressed')!=='true';sizeButton.setAttribute('aria-pressed',String(large));document.documentElement.dataset.readerFont=large?'large':'normal';const textNode=[...sizeButton.childNodes].find(node=>node.nodeType===Node.TEXT_NODE);if(textNode)textNode.textContent=large?' Tamanho normal':' Aumentar texto';return}
 const button=target.closest('[data-copy-link]');if(!button)return;
 const status=button.closest('.share')?.querySelector('.share-status');
 try{await navigator.clipboard.writeText(button.getAttribute('data-copy-link'));if(status)status.textContent='Link copiado.'}catch{if(status)status.textContent='Copie o endereço do navegador para compartilhar.'}
});
const readingBody=document.querySelector('[data-reading-body]'),readingProgress=document.querySelector('.reading-progress');
if(readingBody&&readingProgress){
 let framePending=false;
 const updateReading=()=>{framePending=false;const rect=readingBody.getBoundingClientRect(),distance=Math.max(1,rect.height-window.innerHeight*.45),progress=Math.max(0,Math.min(100,(-rect.top+window.innerHeight*.25)/distance*100));readingProgress.value=progress;const headings=[...readingBody.querySelectorAll('h2[id],h3[id]')];let active=headings[0]?.id;for(const heading of headings){if(heading.getBoundingClientRect().top<window.innerHeight*.3)active=heading.id;else break}document.querySelectorAll('.article-toc a').forEach(link=>{if(link.getAttribute('href')==='#'+active)link.setAttribute('aria-current','true');else link.removeAttribute('aria-current')})};
 const schedule=()=>{if(!framePending){framePending=true;requestAnimationFrame(updateReading)}};
 window.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule);document.addEventListener('click',schedule);updateReading();
}

document.querySelectorAll('.feature-video[data-video]').forEach(box=>{
 const start=()=>{
  if(box.classList.contains('is-playing'))return
  document.querySelectorAll('.feature-video.is-playing video').forEach(other=>other.pause())
  const video=document.createElement('video');;[['video/mp4',box.dataset.video],['video/webm',box.dataset.video.replace(/\.mp4$/,'.webm')]].forEach(([type,src])=>{const source=document.createElement('source');source.src=src;source.type=type;video.appendChild(source)});video.controls=true;video.playsInline=true;video.preload='auto';video.poster=box.querySelector('img')?.getAttribute('src')||''
  video.addEventListener('play',()=>document.querySelectorAll('.feature-video video').forEach(other=>{if(other!==video)other.pause()}))
  box.classList.add('is-playing');box.appendChild(video);video.play().catch(()=>{})
 }
 box.addEventListener('click',event=>{if(!event.target.closest('video'))start()})
})
