import { ArrowRight, Check, Compass, Play } from 'lucide-react'
import type { Identity, ModuleKey, Role } from '../types'
import { getTourChapters, readFinishedTours, tourStorageKey } from '../tour'

interface TutorialPageProps {
  identity: Identity
  role: Role
  allowedModules: ModuleKey[]
  onStart: (chapterIds: string[]) => void
}

const roleTitle: Record<Role, string> = {
  master: 'Conheça sua plataforma por dentro.',
  admin: 'Aprenda fazendo, tela por tela.',
  barber: 'Domine as ferramentas do seu dia.',
  client: 'Sua barbearia, sem dúvidas.',
}

export function TutorialPage({ identity, role, allowedModules, onStart }: TutorialPageProps) {
  const chapters = getTourChapters(role, allowedModules, Boolean(identity.shop))
  const storageKey = tourStorageKey(identity.user.id, identity.shop?.id, role)
  const finished = readFinishedTours(storageKey)
  const groups = [...new Set(chapters.map(chapter => chapter.group))]
  return <div className="tour-hub">
    <section className="tour-hub-hero">
      <div><span className="tour-hub-eyebrow">PASSO A PASSO · GUIA INTERATIVO</span><h1>{roleTitle[role]}</h1><p>Um pop-up mostra exatamente onde olhar. Use as setas para avançar entre as abas; o destaque acompanha cada ação na tela. Você pode sair e recomeçar quando quiser.</p></div>
      <button className="tour-hub-start" onClick={() => onStart(chapters.map(chapter => chapter.id))} disabled={!chapters.length}><Play size={17} fill="currentColor"/> Iniciar tour completo <ArrowRight size={16}/></button>
    </section>
    <div className="tour-hub-meta"><span><strong>{chapters.length}</strong> {chapters.length === 1 ? 'área disponível' : 'áreas disponíveis'} para o seu perfil</span><span>{finished.filter(id => chapters.some(chapter => chapter.id === id)).length} guias vistos neste dispositivo</span></div>
    {groups.map(group => <section className="tour-hub-group" key={group}><div className="tour-hub-group-heading"><span>{group}</span><i/></div><div className="tour-hub-grid">{chapters.filter(chapter => chapter.group === group).map(chapter => <article className={`tour-hub-card ${finished.includes(chapter.id) ? 'is-finished' : ''}`} key={chapter.id}><div className="tour-hub-card-index">{finished.includes(chapter.id) ? <Check size={22}/> : String(chapters.indexOf(chapter) + 1).padStart(2, '0')}</div><div className="tour-hub-card-copy"><small>{finished.includes(chapter.id) ? 'PODE REVER' : `${chapter.steps.length} ETAPAS`}</small><h2>{chapter.title}</h2><p>{chapter.summary}</p></div><button onClick={() => onStart([chapter.id])} aria-label={`Iniciar guia: ${chapter.title}`} title={finished.includes(chapter.id) ? 'Rever guia' : 'Iniciar guia'}><Compass size={18}/></button></article>)}</div></section>)}
  </div>
}
