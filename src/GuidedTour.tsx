import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { ArrowDownLeft, ArrowLeft, ArrowRight, Check, ChevronDown, ChevronUp, LoaderCircle, RotateCcw, Volume2, VolumeX, X } from 'lucide-react'
import type { TourStep } from './tour'
import { requireSupabase } from './lib/supabase'

interface GuidedTourProps {
  steps: TourStep[]
  index: number
  onBack: () => void
  onNext: (completed?: boolean) => void
  onClose: () => void
}

interface Bounds { top: number; left: number; width: number; height: number }

function visibleTarget(selector: string): HTMLElement | null {
  const candidate = document.querySelector<HTMLElement>(selector)
  if (!candidate) return null
  const style = getComputedStyle(candidate)
  return style.display !== 'none' && style.visibility !== 'hidden' && candidate.getBoundingClientRect().width > 0 ? candidate : null
}

function targetFor(step: TourStep): HTMLElement | null {
  const opened = step.practice?.openedSelector ? visibleTarget(step.practice.openedSelector) : null
  if (opened) return opened
  if (step.kind === 'nav' && window.innerWidth <= 980) {
    if (!document.querySelector('.sidebar.open')) return visibleTarget('.mobile-menu')
    return visibleTarget(step.selector) || visibleTarget('.mobile-menu')
  }
  return visibleTarget(step.selector)
    || (step.kind === 'nav' ? visibleTarget('.sidebar .nav-list') : visibleTarget('[data-tour-client="summary"]') || visibleTarget('.content .page-header'))
}

function boundsFor(element: HTMLElement): Bounds {
  const rect = element.getBoundingClientRect()
  const pad = 7
  const left = Math.max(6, rect.left - pad)
  const top = Math.max(6, rect.top - pad)
  return {
    top,
    left,
    width: Math.max(20, Math.min(window.innerWidth - left - 6, rect.width + pad * 2)),
    height: Math.max(20, Math.min(window.innerHeight - top - 6, rect.height + pad * 2)),
  }
}

function scrollTargetIntoView(element: HTMLElement) {
  const mobile = window.innerWidth <= 760
  const oldMargin = element.style.scrollMarginTop
  if (mobile) {
    const header = element.closest('.modal') ? null : document.querySelector<HTMLElement>('.topbar, .client-header')
    element.style.scrollMarginTop = `${Math.max(20, (header?.getBoundingClientRect().height || 0) + 14)}px`
  }
  element.scrollIntoView({ behavior: 'auto', block: mobile ? 'start' : 'center', inline: 'nearest' })
  element.style.scrollMarginTop = oldMargin
}

function audioStorageKey(): string { return 'barber-guided-tour-audio:v1' }

function readAudioEnabled(): boolean {
  try { return localStorage.getItem(audioStorageKey()) !== 'off' } catch { return true }
}


const tutorialAudioCache = new Map<string, Promise<string>>()

function narrationText(step: TourStep, index: number, total: number): string {
  return step.audioText || `Etapa ${String(index + 1).padStart(2, '0')} de ${String(total).padStart(2, '0')}. ${step.title}. ${step.description}${step.practice ? ` Teste prático: ${step.practice.instruction}` : ''}`
}

async function tutorialAudioUrl(text: string): Promise<string> {
  const cached = tutorialAudioCache.get(text)
  if (cached) return cached
  const promise = (async () => {
    const supabase = requireSupabase()
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) throw new Error('Faça login para ouvir a narração do guia.')
    const response = await fetch('/api/tutorial-audio', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ text }),
    })
    if (!response.ok) {
      let message = 'Não foi possível gerar o áudio ElevenLabs.'
      try {
        const payload = await response.json() as { error?: string }
        if (payload.error) message = payload.error
      } catch { /* Binary endpoint may not return JSON on all failures. */ }
      throw new Error(message)
    }
    const blob = await response.blob()
    return URL.createObjectURL(blob)
  })().catch(error => {
    tutorialAudioCache.delete(text)
    throw error
  })
  tutorialAudioCache.set(text, promise)
  return promise
}

export function GuidedTour({ steps, index, onBack, onNext, onClose }: GuidedTourProps) {
  const step = steps[index]
  const [bounds, setBounds] = useState<Bounds | null>(null)
  const [fallback, setFallback] = useState(false)
  const [cardHeight, setCardHeight] = useState(285)
  const [practiceDone, setPracticeDone] = useState(false)
  const [practiceResult, setPracticeResult] = useState('')
  const editedFields = useRef(new Set<Element>())
  const [needsCloseBeforeNext, setNeedsCloseBeforeNext] = useState(false)
  const [needsCloseBeforeBack, setNeedsCloseBeforeBack] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [audioEnabled, setAudioEnabled] = useState(readAudioEnabled)
  const [audioLoading, setAudioLoading] = useState(false)
  const [audioError, setAudioError] = useState('')
  const cardRef = useRef<HTMLDivElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioRequestRef = useRef(0)
  const nextRef = useRef(onNext)
  nextRef.current = onNext

  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    return () => { if (previousFocus.current?.isConnected) previousFocus.current.focus() }
  }, [])

  useEffect(() => {
    if (!cardRef.current) return
    const observer = new ResizeObserver(() => {
      const height = cardRef.current?.getBoundingClientRect().height || 285
      setCardHeight(previous => Math.abs(previous - height) < 1 ? previous : height)
    })
    observer.observe(cardRef.current)
    return () => observer.disconnect()
  }, [])

  async function playCurrentStep(force = false) {
    if (!step || (!audioEnabled && !force)) return
    const requestId = audioRequestRef.current + 1
    audioRequestRef.current = requestId
    setAudioError('')
    setAudioLoading(true)
    try {
      const url = await tutorialAudioUrl(narrationText(step, index, steps.length))
      if (audioRequestRef.current !== requestId) return
      const audio = audioRef.current || new Audio()
      audioRef.current = audio
      audio.pause()
      audio.src = url
      audio.currentTime = 0
      await audio.play()
    } catch (error) {
      if (audioRequestRef.current === requestId) setAudioError(error instanceof Error ? error.message : 'Não foi possível tocar a narração ElevenLabs.')
    } finally {
      if (audioRequestRef.current === requestId) setAudioLoading(false)
    }
  }

  useEffect(() => {
    setPracticeDone(!step?.practice)
    setPracticeResult(''); editedFields.current.clear()
    setNeedsCloseBeforeNext(false)
    setNeedsCloseBeforeBack(false)
    setAudioError('')
    setMinimized(Boolean(window.innerWidth <= 760 && step?.practice?.openedSelector && visibleTarget(step.practice.openedSelector)))
  }, [step])

  useEffect(() => {
    if (step && audioEnabled) void playCurrentStep()
    return () => {
      audioRequestRef.current += 1
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.currentTime = 0
      }
    }
  }, [step, index, steps.length, audioEnabled])

  useEffect(() => {
    if (!step?.practice) return
    // A heading or menu used as a visual fallback is not the requested test.
    let target: HTMLElement | null = visibleTarget(step.selector)
    let done = false
    let navigationTimer: number | undefined
    const completeNow = () => {
      if (done) return
      done = true
      setPracticeDone(true)
      if (step.kind === 'nav') navigationTimer = window.setTimeout(() => nextRef.current(), 120)
    }
    const complete = () => {
      if (step.practice?.completeOn === 'valid_form' || step.practice?.completeOn === 'quiz') return
      if (!step.practice?.openedSelector) { completeNow(); return }
      const checkOpened = () => {
        if (visibleTarget(step.practice?.openedSelector || '')) completeNow()
      }
      checkOpened()
    }
    const eventName = step.practice.completeOn === 'input' ? 'input' : step.practice.completeOn === 'focus' ? 'focusin' : 'click'
    if (step.practice.completeOn !== 'valid_form' && step.practice.openedSelector && visibleTarget(step.practice.openedSelector)) completeNow()
    target?.addEventListener(eventName, complete, true)
    const observeTarget = () => {
      const nextTarget = visibleTarget(step.selector)
      if (nextTarget !== target) {
        target?.removeEventListener(eventName, complete, true)
        target = nextTarget
        target?.addEventListener(eventName, complete, true)
      }
      if (step.practice?.completeOn !== 'valid_form' && step.practice?.openedSelector && visibleTarget(step.practice.openedSelector)) completeNow()
      const opened = step.practice?.openedSelector ? visibleTarget(step.practice.openedSelector) : null
      const nextStep = steps[index + 1]
      const nextIsInsideForm = Boolean(opened && nextStep && (opened.matches(nextStep.selector) || opened.querySelector(nextStep.selector)))
      const mustClose = Boolean(opened && (!nextStep || !nextIsInsideForm))
      setNeedsCloseBeforeNext(previous => previous === mustClose ? previous : mustClose)
      const previousStep = steps[index - 1]
      const previousIsInsideForm = Boolean(opened && previousStep && (opened.matches(previousStep.selector) || opened.querySelector(previousStep.selector)))
      const mustCloseBeforeBack = Boolean(opened && previousStep && !previousIsInsideForm)
      setNeedsCloseBeforeBack(previous => previous === mustCloseBeforeBack ? previous : mustCloseBeforeBack)
    }
    const observer = new MutationObserver(observeTarget)
    const root = document.querySelector('#root')
    if (root) observer.observe(root, { childList: true, subtree: true })
    observeTarget()
    return () => {
      observer.disconnect()
      if (navigationTimer) window.clearTimeout(navigationTimer)
      target?.removeEventListener(eventName, complete, true)
    }
  }, [step])

  function practiceForm(): HTMLFormElement | null {
    const target = step?.practice?.openedSelector ? visibleTarget(step.practice.openedSelector) : step ? visibleTarget(step.selector) : null
    return target instanceof HTMLFormElement ? target : target?.closest('form') || null
  }
  function validatePractice(): boolean {
    const form = practiceForm()
    if (!form) { setPracticeResult('Abra o formulário indicado para fazer o exercício.'); return false }
    if (!editedFields.current.size) { setPracticeResult('Altere pelo menos um campo para praticar antes de validar.'); return false }
    if (!form.reportValidity()) { setPracticeResult('Ainda há campos obrigatórios ou valores inválidos. Confira o formulário.'); return false }
    const times = [...form.querySelectorAll<HTMLInputElement>('input[type="time"]')].filter(input => !input.disabled && input.value)
    if (times.length === 2 && times[1].value <= times[0].value) { setPracticeResult('O fim do horário precisa ser posterior ao início.'); return false }
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')
    if (submit?.disabled) { setPracticeResult('O cadastro ainda não está pronto. Confira as seleções, itens, regras e carregamentos pendentes.'); return false }
    const count = [...form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input:not([type="file"]),select,textarea')].filter(field => !field.disabled && field.value).length
    setPracticeDone(true); setPracticeResult(`Treino validado: ${count} campo(s) conferido(s). Nenhum registro real foi salvo. Feche o cadastro para continuar.`)
    return true
  }
  function exitTour() {
    const form = practiceForm()
    const close = form?.closest('.modal')?.querySelector<HTMLButtonElement>('button[aria-label="Fechar"]')
    close?.click()
    onClose()
  }
  // Training uses the actual forms and constraints, while preventing real writes,
  // invitations, provider calls and uploads triggered by form submission.
  useEffect(() => {
    const disabledFiles = new Map<HTMLInputElement, boolean>()
    function protectUploads() {
      for (const input of document.querySelectorAll<HTMLInputElement>('.content input[type="file"],.modal input[type="file"]')) {
        if (!disabledFiles.has(input)) disabledFiles.set(input,input.disabled)
        input.disabled=true
      }
    }
    function protectActions(event:MouseEvent){
      const source=event.target instanceof Element?event.target:null
      const button=source?.closest<HTMLButtonElement>('button')
      if(!button||button.closest('.guided-tour')||!button.closest('.content,.client-content,.modal'))return
      // Opening the exact exercise form is safe. Other state changes (including
      // icon-only permission toggles) must not execute during a training step.
      if(step?.practice?.openedSelector&&button.matches(step.selector))return
      const label=(button.getAttribute('aria-label')||button.textContent||'').trim()
      if(button.matches('.permission-toggle,[data-tour-mutation]')||/^(salvar|enviar|confirmar|recebido|receber|excluir|apagar|remover|liberar|desativar|ativar|conectar|pagar|finalizar|executar|entregar|marcar|concluir atendimento|aceitar oferta|registrar|abrir caixa|encerrar|repor|estornar|gerar|publicar|analisar|cancelar (comanda|agendamento|assinatura)|solicitar benefício)\b/i.test(label)){
        event.preventDefault();event.stopImmediatePropagation()
        if(step?.practice?.completeOn==='valid_form')validatePractice()
        else setPracticeResult('Modo de treino: nenhuma ação real foi enviada. Use as instruções e o teste do guia.')
      }
    }
    function edited(event: Event) {
      const target=event.target
      if (target instanceof Element && practiceForm()?.contains(target)) {
        editedFields.current.add(target);setPracticeResult('')
        if(step?.practice?.completeOn==='valid_form')setPracticeDone(false)
      }
    }
    function submit(event: Event) {
      const form=event.target
      if (!(form instanceof HTMLFormElement) || !form.closest('.content,.client-layout,.modal')) return
      event.preventDefault(); event.stopImmediatePropagation()
      if(step?.practice?.completeOn==='valid_form'&&form===practiceForm())validatePractice()
      else setPracticeResult('Modo de treino: preencha o exercício indicado e use Validar treino. Nenhum dado real foi enviado.')
    }
    document.addEventListener('submit',submit,true); document.addEventListener('input',edited,true); document.addEventListener('change',edited,true); document.addEventListener('click',protectActions,true)
    const observer=new MutationObserver(protectUploads);observer.observe(document.querySelector('#root')||document.body,{childList:true,subtree:true});protectUploads()
    return()=>{document.removeEventListener('submit',submit,true);document.removeEventListener('input',edited,true);document.removeEventListener('change',edited,true);document.removeEventListener('click',protectActions,true);observer.disconnect();for(const[input,disabled]of disabledFiles)input.disabled=disabled}
  },[step])

  useLayoutEffect(() => {
    if (!step) return
    let active = true
    let timer: number | undefined
    let frame = 0
    let observed: HTMLElement | null = null
    let revealed = false
    const resizeObserver = new ResizeObserver(() => scheduleMeasure())
    const measure = () => {
      if (!active) return
      if (!revealed && step.revealSelector && !visibleTarget(step.selector)) {
        const reveal = visibleTarget(step.revealSelector)
        if (reveal instanceof HTMLButtonElement && !reveal.disabled) {
          revealed = true
          reveal.click()
        }
      }
      const target = targetFor(step)
      const missingOriginal = !visibleTarget(step.selector)
      const nextBounds = target ? boundsFor(target) : null
      setFallback(previous => previous === missingOriginal ? previous : missingOriginal)
      setBounds(previous => previous?.top === nextBounds?.top
        && previous?.left === nextBounds?.left
        && previous?.width === nextBounds?.width
        && previous?.height === nextBounds?.height ? previous : nextBounds)
      if (target !== observed) {
        if (observed) resizeObserver.unobserve(observed)
        observed = target
        if (target) {
          resizeObserver.observe(target)
          // Async pages and newly opened forms need their own scroll position.
          scrollTargetIntoView(target)
          if (window.innerWidth <= 760 && step.practice?.openedSelector && target === visibleTarget(step.practice.openedSelector)) {
            setMinimized(true)
          }
          scheduleMeasure()
        }
      }
    }
    const scheduleMeasure = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    const target = targetFor(step)
    if (target) scrollTargetIntoView(target)
    measure()
    timer = window.setTimeout(scheduleMeasure, 60)
    window.addEventListener('resize', scheduleMeasure)
    window.addEventListener('scroll', scheduleMeasure, true)
    const observer = new MutationObserver(scheduleMeasure)
    const contentRoot = document.querySelector('.main-area') || document.querySelector('.client-content')
    if (contentRoot) observer.observe(contentRoot, { childList: true, subtree: true })
    cardRef.current?.focus()
    return () => {
      active = false
      if (timer) window.clearTimeout(timer)
      cancelAnimationFrame(frame)
      observer.disconnect()
      resizeObserver.disconnect()
      window.removeEventListener('resize', scheduleMeasure)
      window.removeEventListener('scroll', scheduleMeasure, true)
    }
  }, [step])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); exitTour(); return }
      const source = event.target instanceof HTMLElement ? event.target : null
      if (source?.closest('input, textarea, select, [contenteditable="true"]') && event.key !== 'Tab') return
      if (event.key === 'ArrowRight') { event.preventDefault(); if (!needsCloseBeforeNext && (practiceDone || fallback)) onNext(!fallback || practiceDone); return }
      if (event.key === 'ArrowLeft') { event.preventDefault(); if (index > 0 && !needsCloseBeforeBack) onBack(); return }
      if (event.key !== 'Tab' || !cardRef.current) return
      const practiceTarget = targetFor(step)
      const focusable = [...new Set([
        ...cardRef.current.querySelectorAll<HTMLElement>('button:not([disabled])'),
        ...(practiceTarget?.matches('button, input, textarea, select, a[href], [tabindex="0"]') ? [practiceTarget] : []),
        ...practiceTarget?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex="0"]') || [],
      ])].filter(element => element.getClientRects().length > 0)
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === cardRef.current)) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      else if (!cardRef.current.contains(document.activeElement) && !practiceTarget?.contains(document.activeElement)) { event.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [index, onBack, onNext, onClose, practiceDone, fallback, needsCloseBeforeNext, needsCloseBeforeBack])

  if (!step) return null
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const mobile = viewportWidth <= 760
  const cardWidth = Math.min(386, viewportWidth - 32)
  const safeTop = (desired: number) => Math.max(16, Math.min(viewportHeight - cardHeight - 16, desired))
  let side: 'right' | 'left' | 'top' | 'bottom' = 'bottom'
  const cardStyle: CSSProperties = { width: cardWidth }
  if (mobile || !bounds) {
    cardStyle.left = 16
    if (bounds && bounds.top > viewportHeight - bounds.top - bounds.height) cardStyle.top = 16
    else cardStyle.bottom = 16
  } else if (bounds.left + bounds.width + cardWidth + 25 < viewportWidth) {
    side = 'right'
    cardStyle.left = bounds.left + bounds.width + 17
    cardStyle.top = safeTop(bounds.top - 20)
  } else if (bounds.left - cardWidth - 25 > 0) {
    side = 'left'
    cardStyle.left = bounds.left - cardWidth - 17
    cardStyle.top = safeTop(bounds.top - 20)
  } else if (bounds.top + bounds.height + cardHeight + 34 < viewportHeight) {
    side = 'bottom'
    cardStyle.left = Math.max(16, Math.min(viewportWidth - cardWidth - 16, bounds.left))
    cardStyle.top = bounds.top + bounds.height + 18
  } else if (bounds.top - cardHeight - 34 > 0) {
    side = 'top'
    cardStyle.left = Math.max(16, Math.min(viewportWidth - cardWidth - 16, bounds.left))
    cardStyle.bottom = viewportHeight - bounds.top + 18
  } else {
    side = 'bottom'
    cardStyle.left = Math.max(16, Math.min(viewportWidth - cardWidth - 16, bounds.left))
    cardStyle.top = safeTop(bounds.top + bounds.height + 18)
  }
  const last = index === steps.length - 1
  const canAdvance = !needsCloseBeforeNext && (practiceDone || fallback || !step.practice)
  const practiceLabel = fallback && !practiceDone ? 'Etapa indisponível nesta tela' : practiceDone ? 'Teste concluído' : step.practice?.completeOn === 'valid_form' ? 'Preencha os campos para praticar' : step.practice?.openedSelector ? 'Abra o cadastro indicado' : step.kind === 'nav' ? 'Clique na aba destacada' : 'Faça o teste destacado'
  const shade = bounds ? [
    { top: 0, left: 0, width: viewportWidth, height: bounds.top },
    { top: bounds.top, left: 0, width: bounds.left, height: bounds.height },
    { top: bounds.top, left: bounds.left + bounds.width, width: Math.max(0, viewportWidth - bounds.left - bounds.width), height: bounds.height },
    { top: bounds.top + bounds.height, left: 0, width: viewportWidth, height: Math.max(0, viewportHeight - bounds.top - bounds.height) },
  ] : [{ top: 0, left: 0, width: viewportWidth, height: viewportHeight }]
  const arrowStyle: CSSProperties | undefined = !bounds || mobile ? undefined : side === 'right'
    ? { left: Number(cardStyle.left) - 7, top: Number(cardStyle.top) + 35 }
    : side === 'left'
      ? { left: Number(cardStyle.left) + cardWidth - 7, top: Number(cardStyle.top) + 35 }
      : side === 'bottom'
        ? { left: Number(cardStyle.left) + 32, top: Number(cardStyle.top) - 7 }
        : { left: Number(cardStyle.left) + 32, top: bounds.top - 25 }

  return <div className="guided-tour" aria-live="polite">
    {shade.map((part, partIndex) => <div className="guided-tour-shade" key={partIndex} style={part}/>) }
    {bounds && <div className="guided-tour-focus" style={bounds} aria-hidden="true"><span className="guided-tour-focus-arrow"><ArrowDownLeft size={21} strokeWidth={2.4}/></span></div>}
    {arrowStyle && <div className={`guided-tour-card-arrow side-${side}`} style={arrowStyle} aria-hidden="true"/>}
    <div className={`guided-tour-card side-${side}${minimized ? ' is-minimized' : ''}`} style={cardStyle} role="dialog" aria-modal="false" aria-labelledby="guided-tour-title" aria-describedby="guided-tour-description" tabIndex={-1} ref={cardRef}>
      <div className="guided-tour-topline"><span>{minimized ? `ETAPA ${String(index + 1).padStart(2, '0')} / ${String(steps.length).padStart(2, '0')}` : 'GUIA INTERATIVO · ELEVENLABS'}</span><div className="guided-tour-top-actions"><button className={`guided-tour-audio ${audioEnabled ? 'on' : ''}`} onClick={() => { const next = !audioEnabled; setAudioEnabled(next); try { localStorage.setItem(audioStorageKey(), next ? 'on' : 'off') } catch { /* Audio preference is optional. */ }; if (!next) { audioRequestRef.current += 1; setAudioLoading(false); audioRef.current?.pause() } }} aria-label={audioEnabled ? 'Desativar narração ElevenLabs' : 'Ativar narração ElevenLabs'} title={audioEnabled ? 'Narração ElevenLabs ativa' : 'Ativar narração ElevenLabs'}>{audioEnabled ? <Volume2 size={17}/> : <VolumeX size={17}/>}</button><button className={`guided-tour-audio ${audioLoading ? 'loading' : ''}`} onClick={() => void playCurrentStep(true)} aria-label="Repetir narração ElevenLabs" title="Repetir narração ElevenLabs" disabled={audioLoading}>{audioLoading ? <LoaderCircle size={16}/> : <RotateCcw size={16}/>}</button><button className="guided-tour-close" onClick={() => setMinimized(current => !current)} aria-label={minimized ? 'Mostrar instruções do guia' : 'Recolher instruções do guia'} title={minimized ? 'Mostrar instruções' : 'Recolher para praticar'} aria-expanded={!minimized}>{minimized ? <ChevronUp size={18}/> : <ChevronDown size={18}/>}</button><button className="guided-tour-close" onClick={exitTour} aria-label="Sair do guia"><X size={18}/></button></div></div>
      <div className="guided-tour-counter"><span>ETAPA {String(index + 1).padStart(2, '0')} / {String(steps.length).padStart(2, '0')}</span><div className="guided-tour-progress"><i style={{ width: `${(index + 1) / steps.length * 100}%` }}/></div></div>
      <h2 id="guided-tour-title">{step.title}</h2>
      <p id="guided-tour-description">{step.description}</p>
      <small className="guided-tour-training">MODO DE TREINO · formulários não gravam dados reais nem enviam convites</small>
      {step.practice && <div className={`guided-tour-practice ${practiceDone ? 'done' : ''}`}><div><strong>{practiceLabel}</strong><p>{step.practice.instruction}</p></div>{practiceDone && <Check size={18}/>}</div>}
      {step.practice?.completeOn === 'valid_form' && !practiceDone && <button className="guided-tour-validate" onClick={validatePractice}>Validar treino</button>}
      {step.practice?.quiz && <div className="guided-tour-quiz"><strong>{step.practice.quiz.question}</strong>{step.practice.quiz.choices.map((choice,choiceIndex)=><button key={choice} disabled={practiceDone} onClick={()=>{if(choiceIndex===step.practice!.quiz!.correct){setPracticeDone(true);setPracticeResult(step.practice!.quiz!.explanation)}else setPracticeResult('Ainda não. Confira a explicação da área e tente outra resposta.')}}>{choice}</button>)}</div>}
      {practiceResult && <p className="guided-tour-result" role="status">{practiceResult}</p>}
      {fallback && !practiceDone && <small className="guided-tour-hint">O recurso ainda não está disponível. Aguarde a tela carregar ou pule esta etapa; ela não será marcada como concluída.</small>}
      {(needsCloseBeforeNext || needsCloseBeforeBack) && <small className="guided-tour-transition">Depois de validar o treino, feche ou cancele o cadastro para mudar de atividade. Os dados do exercício não serão gravados.</small>}
      {audioError && <small className="guided-tour-audio-error">{audioError}</small>}
      <div className="guided-tour-actions"><button className="guided-tour-skip" onClick={exitTour}>Sair do guia</button><div>{index > 0 && <button className="guided-tour-back" onClick={onBack} disabled={needsCloseBeforeBack}><ArrowLeft size={16}/> Voltar</button>}<button className="guided-tour-next" onClick={() => onNext(!fallback || practiceDone)} disabled={!canAdvance}>{fallback && !practiceDone ? <>Pular etapa <ArrowRight size={17}/></> : last ? <>Concluir <Check size={17}/></> : <>Próximo <ArrowRight size={17}/></>}</button></div></div>
      <div className="guided-tour-keyboard">{canAdvance ? 'Use ← → para navegar · Esc para sair' : 'Faça o teste destacado para liberar o próximo passo'}</div>
    </div>
  </div>
}
