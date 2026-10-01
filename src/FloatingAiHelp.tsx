import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Check, CheckCircle2, LoaderCircle, MessageCircle, Minimize2, Send, ShieldCheck, Sparkles, X } from 'lucide-react'
import { authedApi } from './lib/supabase'
import { SpeechInputButton } from './SpeechInputButton'
import type { Identity, Role } from './types'

type Quota = { daily_limit: number; remaining: number }
type Action = { type: string; label: string; values: Record<string, unknown> }
type Plan = { plan_id: string; summary: string; action: Action; expires_at: string; quota?: Quota }
type Answer = { mode: 'answer'; answer: string; quota?: Quota }
type Execution = { status: 'completed'; result: Record<string, unknown> }
type Turn = { id: number; prompt: string; status: 'loading' | 'answer' | 'plan' | 'error'; answer?: string; plan?: Plan; execution?: Execution; error?: string }

function roleText(role: Role, identity: Identity): string {
  if (role === 'master') return identity.shop ? `Master em ${identity.shop.name}` : 'Master da plataforma'
  if (role === 'admin') return `Gestão da ${identity.shop?.name || 'barbearia'}`
  return 'Área do barbeiro'
}

function readableActionValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Não informado'
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não'
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(item => String(item)).join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function FloatingAiHelp({ identity, role, notify }: { identity: Identity; role: Role; notify: (message: string, kind?: 'success' | 'error') => void }) {
  const [open, setOpen] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [quota, setQuota] = useState<Quota | null>(null)
  const [busy, setBusy] = useState<'request' | 'execute' | null>(null)
  const [executingTurnId, setExecutingTurnId] = useState<number | null>(null)
  const nextTurnId = useRef(0)
  const threadRef = useRef<HTMLDivElement>(null)

  useEffect(() => { if (open) threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' }) }, [turns, open])

  function openPanel() {
    setOpen(true)
    setMinimized(false)
  }

  function closePanel() {
    setOpen(false)
    setMinimized(false)
  }

  async function sendPrompt(event: FormEvent) {
    event.preventDefault()
    const text = prompt.trim()
    if (text.length < 3 || busy) return
    const id = ++nextTurnId.current
    setTurns(current => [...current, { id, prompt: text, status: 'loading' }])
    setPrompt('')
    setBusy('request')
    try {
      const response = await authedApi<Plan | Answer>('/api/ai-help/plan', { ...(identity.shop?.id ? { barbershop_id: identity.shop.id } : {}), prompt: text })
      if (response.quota) setQuota(response.quota)
      if ('mode' in response && response.mode === 'answer') {
        setTurns(current => current.map(turn => turn.id === id ? { ...turn, status: 'answer', answer: response.answer } : turn))
      } else if ('plan_id' in response) {
        setTurns(current => current.map(turn => turn.id === id ? { ...turn, status: 'plan', plan: response } : turn))
      } else throw new Error('A IA não conseguiu preparar uma resposta.')
    } catch (problem) {
      setTurns(current => current.map(turn => turn.id === id ? { ...turn, status: 'error', error: problem instanceof Error ? problem.message : 'Não foi possível responder agora.' } : turn))
    } finally {
      setBusy(null)
    }
  }

  async function executePlan(turnId: number) {
    const turn = turns.find(item => item.id === turnId)
    if (!turn?.plan || turn.execution || busy) return
    setBusy('execute')
    setExecutingTurnId(turnId)
    try {
      const response = await authedApi<Execution>('/api/ai-help/execute', { plan_id: turn.plan.plan_id })
      if (response.status !== 'completed') throw new Error('A ação não foi confirmada pelo servidor.')
      setTurns(current => current.map(item => item.id === turnId ? { ...item, execution: response, error: undefined } : item))
      notify('Ação criada pela Ajuda de IA.')
    } catch (problem) {
      setTurns(current => current.map(item => item.id === turnId ? { ...item, error: problem instanceof Error ? problem.message : 'Não foi possível concluir a ação.' } : item))
    } finally {
      setBusy(null)
      setExecutingTurnId(null)
    }
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  if (role === 'client') return null

  return <>
    {!open && <button type="button" className={`floating-ai-trigger ${minimized ? 'is-minimized' : ''}`} onClick={openPanel} aria-label="Abrir Ajuda de IA">
      <Sparkles size={20}/><span>{minimized ? 'IA' : 'Ajuda de IA'}</span>
    </button>}
    {open && <div className="floating-ai-layer" role="dialog" aria-modal="false" aria-label="Ajuda de IA flutuante">
      <section className="floating-ai-panel">
        <header className="floating-ai-head">
          <div><span><Sparkles size={14}/> Ajuda de IA</span><strong>{roleText(role, identity)}</strong></div>
          <div className="floating-ai-controls">
            <button type="button" onClick={() => { setOpen(false); setMinimized(true) }} aria-label="Minimizar Ajuda de IA" title="Minimizar"><Minimize2 size={17}/></button>
            <button type="button" onClick={closePanel} aria-label="Fechar Ajuda de IA" title="Fechar"><X size={18}/></button>
          </div>
        </header>
        <div className="floating-ai-thread" ref={threadRef}>
          {!turns.length && <div className="floating-ai-empty"><MessageCircle size={25}/><strong>Peça ajuda sem sair da página</strong><p>Use texto ou voz. A IA respeita o seu perfil e pede confirmação antes de salvar qualquer cadastro.</p></div>}
          {turns.map(turn => <div className="floating-ai-turn" key={turn.id}>
            <div className="floating-ai-bubble user"><span>Você</span><p>{turn.prompt}</p></div>
            <div className="floating-ai-bubble assistant">
              <span>Ajuda de IA</span>
              {turn.status === 'loading' && <p className="floating-ai-thinking"><LoaderCircle size={16} className="spin"/> Pensando...</p>}
              {turn.status === 'answer' && <p>{turn.answer}</p>}
              {turn.status === 'error' && <p className="floating-ai-error">{turn.error}</p>}
              {turn.plan && <div className="floating-ai-plan">
                <p>{turn.plan.summary}</p>
                <div className="floating-ai-plan-title"><ShieldCheck size={16}/><strong>{turn.plan.action.label}</strong></div>
                <dl>{Object.entries(turn.plan.action.values || {}).slice(0, 5).map(([key, value]) => <div key={key}><dt>{key.replace(/_/g, ' ')}</dt><dd>{readableActionValue(value)}</dd></div>)}</dl>
                {turn.execution ? <div className="floating-ai-done"><CheckCircle2 size={16}/> Salvo</div> : <button type="button" className="button primary" onClick={() => void executePlan(turn.id)} disabled={busy !== null}>{busy === 'execute' && executingTurnId === turn.id ? <><LoaderCircle size={16} className="spin"/> Salvando</> : <><Check size={16}/> Confirmar</>}</button>}
                {turn.error && <p className="floating-ai-error">{turn.error}</p>}
              </div>}
            </div>
          </div>)}
        </div>
        <form className="floating-ai-form" onSubmit={sendPrompt}>
          <div className="floating-ai-input-row">
            <SpeechInputButton className="floating-ai-mic" disabled={busy !== null} value={prompt} onChange={setPrompt} onUnavailable={() => notify('Seu navegador não liberou ditado por voz para esta página.', 'error')} onError={message => notify(message, 'error')}/>
            <textarea value={prompt} onChange={event => setPrompt(event.target.value)} onKeyDown={keyDown} minLength={3} maxLength={1500} rows={2} placeholder="Pergunte para a IA..." disabled={busy !== null}/>
            <button type="submit" className="floating-ai-send" aria-label="Enviar para a Ajuda de IA" disabled={busy !== null || prompt.trim().length < 3}>{busy === 'request' ? <LoaderCircle size={18} className="spin"/> : <Send size={18}/>}</button>
          </div>
          {quota && <small>{quota.remaining} de {quota.daily_limit} pedidos disponíveis</small>}
        </form>
      </section>
    </div>}
  </>
}
