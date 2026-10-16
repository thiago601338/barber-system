import { useEffect, useRef, useState } from 'react'
import { Download, Smartphone, WifiOff, X } from 'lucide-react'
import type { Shop } from '../types'
import { readBrandTheme } from '../shopBrand'
import { Modal, Notice } from '../ui'
import '../styles-client-portal.css'

type InstallEvent=Event&{prompt:()=>Promise<void>;userChoice:Promise<{outcome:'accepted'|'dismissed'}>}
export function ClientInstallPanel({shop,showCard=true}:{shop:Shop;showCard?:boolean}){
 const promptRef=useRef<InstallEvent|null>(null)
 const [ready,setReady]=useState(false),[installed,setInstalled]=useState(false),[dismissed,setDismissed]=useState(false),[instructions,setInstructions]=useState(false),[offline,setOffline]=useState(()=>!navigator.onLine),[error,setError]=useState<string|null>(null)
 useEffect(()=>{
  const install=(e:Event)=>{e.preventDefault();promptRef.current=e as InstallEvent;setReady(true)}
  const done=()=>{promptRef.current=null;setReady(false);setInstalled(true)}
  const connection=()=>setOffline(!navigator.onLine)
  const standalone=window.matchMedia('(display-mode: standalone)')
  setInstalled(standalone.matches || Boolean((navigator as Navigator&{standalone?:boolean}).standalone))
  window.addEventListener('beforeinstallprompt',install);window.addEventListener('appinstalled',done);window.addEventListener('online',connection);window.addEventListener('offline',connection)
  const manifest=document.createElement('link');manifest.rel='manifest';manifest.href=`/api/client-manifest?shop=${encodeURIComponent(shop.slug)}`;document.head.appendChild(manifest)
  const previousTitle=document.title;document.title=`Minha conta · ${shop.name}`
  const previousColor=document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content
  const color=document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');if(color)color.content=readBrandTheme(shop.brand_theme)?.palette.accent||'#2563eb'
  if('serviceWorker' in navigator&&window.isSecureContext) void navigator.serviceWorker.register('/client-sw.js',{scope:'/'}).catch(()=>setError('A instalação do aplicativo não está disponível agora. Você pode continuar usando sua conta pelo navegador.'))
  return()=>{window.removeEventListener('beforeinstallprompt',install);window.removeEventListener('appinstalled',done);window.removeEventListener('online',connection);window.removeEventListener('offline',connection);manifest.remove();document.title=previousTitle;if(color&&previousColor)color.content=previousColor}
 },[shop.name,shop.slug,shop.brand_theme])
 async function install(){const e=promptRef.current;if(!e){setInstructions(true);return}try{await e.prompt();await e.userChoice;promptRef.current=null;setReady(false)}catch{setError('Não foi possível abrir a instalação. Use o menu do navegador para adicionar o aplicativo.')}}
 const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)
 return <>{offline&&<div className="client-offline-banner" role="status"><WifiOff size={17}/><span>Você está sem conexão. Reconecte para conferir horários, pagamentos e concluir alterações.</span></div>}<Notice text={error}/>{showCard&&!installed&&!dismissed&&<aside className="client-install-card"><div className="client-install-symbol"><Smartphone size={24}/></div><div><strong>{shop.name} na sua tela inicial</strong><p>Abra sua conta como um aplicativo e acesse sua agenda e benefícios.</p></div><button className="button outline" type="button" onClick={()=>void install()}><Download size={16}/>{ready?'Instalar aplicativo':'Adicionar à tela inicial'}</button><button className="client-install-close icon-button" type="button" aria-label="Fechar sugestão de instalação" onClick={()=>setDismissed(true)}><X size={16}/></button></aside>}{instructions&&<Modal title="Leve sua conta para a tela inicial" onClose={()=>setInstructions(false)}><ol className="client-install-steps">{ios?<><li>Abra esta página no Safari.</li><li>Toque em Compartilhar.</li><li>Escolha “Adicionar à Tela de Início” e confirme.</li></>:<><li>Abra esta página no Chrome ou Edge.</li><li>No menu do navegador, procure “Instalar aplicativo” ou “Adicionar à tela inicial”. No computador, o ícone de instalação também pode aparecer na barra de endereço.</li><li>Confirme e abra o aplicativo pelo novo ícone.</li></>}</ol><p className="muted">As opções variam conforme o navegador. Seus agendamentos e pagamentos continuam precisando de conexão à internet.</p></Modal>}</>
}
