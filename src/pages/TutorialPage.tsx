import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRight, BookOpenCheck, Check, Circle, Sparkles } from 'lucide-react'
import type { Identity, ModuleKey, Role, Row } from '../types'
import { asText, moduleLabels } from '../types'
import { requireSupabase } from '../lib/supabase'
import { Empty, Loading, Notice, PageHeader } from '../ui'

interface TutorialStep extends Row {
  role: Role
  module_key: string
  position: number
  title: string
  description: string
  action_label: string
  active: boolean
}

interface TutorialProgress {
  user_id: string
  barbershop_id: string | null
  step_id: string
  completed_at: string | null
}

interface TutorialPageProps {
  identity: Identity
  role: Role
  allowedModules: ModuleKey[]
  onNavigate: (key: ModuleKey | 'master', step: TutorialStep) => void
}

const roleTitle: Record<Role, string> = {
  master: 'Configure e acompanhe a plataforma',
  admin: 'Organize sua barbearia passo a passo',
  barber: 'Seu trabalho, mais simples a cada passo',
  client: 'Aproveite melhor sua barbearia',
}

export function TutorialPage({ identity, role, allowedModules, onNavigate }: TutorialPageProps) {
  const [steps, setSteps] = useState<TutorialStep[]>([])
  const [progress, setProgress] = useState<TutorialProgress[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const progressShopId = role === 'master' ? null : identity.shop?.id ?? null

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const client = requireSupabase()
      const stepsResult = await client.from('tutorial_steps').select('id,role,module_key,position,title,description,action_label,active,created_at').eq('role', role).eq('active', true).order('position')
      if (stepsResult.error) throw stepsResult.error
      let progressQuery = client.from('tutorial_progress').select('user_id,barbershop_id,step_id,completed_at').eq('user_id', identity.user.id)
      progressQuery = progressShopId ? progressQuery.eq('barbershop_id', progressShopId) : progressQuery.is('barbershop_id', null)
      const progressResult = await progressQuery
      if (progressResult.error) throw progressResult.error
      setSteps((stepsResult.data ?? []) as TutorialStep[])
      setProgress((progressResult.data ?? []) as TutorialProgress[])
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Não foi possível carregar o passo a passo.') }
    finally { setLoading(false) }
  }, [identity.user.id, role, progressShopId])

  useEffect(() => { void load() }, [load])

  const visibleSteps = useMemo(() => steps.filter(step =>
    step.module_key === 'master' ? role === 'master' : allowedModules.includes(step.module_key as ModuleKey)
  ), [steps, allowedModules, role])
  const done = (stepId: string) => progress.some(item => item.step_id === stepId && item.completed_at)
  const completed = visibleSteps.filter(step => done(step.id)).length
  const percent = visibleSteps.length ? Math.round(completed / visibleSteps.length * 100) : 0
  const grouped = useMemo(() => {
    const groups: { module: string; items: TutorialStep[] }[] = []
    for (const step of visibleSteps) {
      let group = groups.find(item => item.module === step.module_key)
      if (!group) { group = { module: step.module_key, items: [] }; groups.push(group) }
      group.items.push(step)
    }
    return groups
  }, [visibleSteps])

  async function toggle(step: TutorialStep) {
    setSavingId(step.id); setError(null)
    try {
      const client = requireSupabase()
      const existing = progress.find(item => item.step_id === step.id)
      const completedAt = existing?.completed_at ? null : new Date().toISOString()
      if (existing) {
        let query = client.from('tutorial_progress').update({ completed_at: completedAt }).eq('user_id', identity.user.id).eq('step_id', step.id)
        query = progressShopId ? query.eq('barbershop_id', progressShopId) : query.is('barbershop_id', null)
        const { error: saveError } = await query
        if (saveError) throw saveError
      } else {
        const { error: saveError } = await client.from('tutorial_progress').insert({ user_id: identity.user.id, barbershop_id: progressShopId, step_id: step.id, completed_at: completedAt })
        if (saveError) throw saveError
      }
      setProgress(previous => existing
        ? previous.map(item => item.step_id === step.id ? { ...item, completed_at: completedAt } : item)
        : [...previous, { user_id: identity.user.id, barbershop_id: progressShopId, step_id: step.id, completed_at: completedAt }])
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Não foi possível salvar seu progresso.') }
    finally { setSavingId(null) }
  }

  return <div className="page-stack tutorial-page"><PageHeader eyebrow="PASSO A PASSO" title={roleTitle[role]} description="Avance no seu ritmo. Cada etapa abre a parte certa do sistema e seu progresso fica salvo na sua conta."/><div className="tutorial-overview"><div className="tutorial-overview-icon"><BookOpenCheck size={27}/></div><div className="tutorial-overview-copy"><span>SEU PROGRESSO</span><strong>{completed} de {visibleSteps.length} etapas concluídas</strong><p>{visibleSteps.length ? 'Escolha uma etapa, faça a ação e marque como concluída.' : 'As etapas aparecerão aqui quando o guia for configurado.'}</p></div><div className="tutorial-progress-ring" style={{ '--tutorial-progress': `${percent}%` } as React.CSSProperties}><div>{percent}%</div></div></div><Notice text={error}/>{loading ? <Loading text="Carregando seu guia..."/> : grouped.length ? <div className="tutorial-grid">{grouped.map(group => <section className="tutorial-module" key={group.module}><div className="tutorial-module-head"><div className="tutorial-module-icon"><Sparkles size={19}/></div><div><small>TRILHA</small><h2>{group.module === 'master' ? 'Painel master' : moduleLabels[group.module as ModuleKey] || group.module}</h2></div><span>{group.items.filter(item => done(item.id)).length}/{group.items.length}</span></div><div className="tutorial-steps">{group.items.map((step, index) => <div className={`tutorial-step ${done(step.id) ? 'is-done' : ''}`} key={step.id}><div className="tutorial-step-index">{done(step.id) ? <Check size={16}/> : String(index+1).padStart(2,'0')}</div><div className="tutorial-step-content"><h3>{asText(step.title)}</h3><p>{asText(step.description)}</p><div className="tutorial-step-actions"><button className="button outline" onClick={() => onNavigate(step.module_key as ModuleKey | 'master', step)}>{asText(step.action_label) || 'Abrir tela'} <ArrowRight size={15}/></button><button className={`tutorial-complete ${done(step.id) ? 'completed' : ''}`} disabled={savingId === step.id} onClick={() => void toggle(step)}>{done(step.id) ? <Check size={15}/> : <Circle size={15}/>} {savingId === step.id ? 'Salvando...' : done(step.id) ? 'Concluída' : 'Marcar concluída'}</button></div></div></div>)}</div></section>)}</div> : <Empty title="Guia ainda não disponível" text="As trilhas serão exibidas após a configuração dos passos no banco de dados."/>}</div>
}
