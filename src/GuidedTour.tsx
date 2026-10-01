import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { ArrowDownLeft, ArrowLeft, ArrowRight, Check, RotateCcw, Volume2, VolumeX, X } from 'lucide-react'
import type { TourStep } from './tour'

interface GuidedTourProps {
  steps: TourStep[]
  index: number
  onBack: () => void
  onNext: () => void
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

function audioStorageKey(): string { return 'barber-guided-tour-audio:v1' }

function readAudioEnabled(): boolean {
  try { return localStorage.getItem(audioStorageKey()) !== 'off' } catch { return true }
}

function pickPortugueseVoice(): SpeechSynthesisVoice | null {
  if (!('speechSynthesis' in window)) return null
  const voices = window.speechSynthesis.getVoices()
  const roberta = voices.find(voice => voice.lang.toLowerCase().startsWith('pt-br') && voice.name.toLowerCase().includes('roberta'))
  return roberta || voices.find(voice => voice.lang.toLowerCase().startsWith('pt-br')) || voices.find(voice => voice.lang.toLowerCase().startsWith('pt')) || null
}

export function GuidedTour({ steps, index, onBack, onNext, onClose }: GuidedTourProps) {
  const step = steps[index]
  const [bounds, setBounds] = useState<Bounds | null>(null)
  const [fallback, setFallback] = useState(false)
  const [cardHeight, setCardHeight] = useState(285)
  const [practiceDone, setPracticeDone] = useState(false)
  const [audioEnabled, setAudioEnabled] = useState(readAudioEnabled)
  const [voiceName, setVoiceName] = useState('')
  const cardRef = useRef<HTMLDivElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)

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

  useEffect(() => {
    if (!('speechSynthesis' in window)) return
    const updateVoice = () => setVoiceName(pickPortugueseVoice()?.name || '')
    updateVoice()
    window.speechSynthesis.addEventListener('voiceschanged', updateVoice)
    return () => window.speechSynthesis.removeEventListener('voiceschanged', updateVoice)
  }, [])

  function speakCurrentStep() {
    if (!step || !audioEnabled || !('speechSynthesis' in window)) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(`${step.title}. ${step.description}${step.practice ? ` Teste prático: ${step.practice.instruction}` : ''}`)
    utterance.lang = 'pt-BR'
    utterance.rate = 0.96
    utterance.pitch = 1
    const voice = pickPortugueseVoice()
    if (voice) utterance.voice = voice
    window.speechSynthesis.speak(utterance)
  }

  useEffect(() => {
    setPracticeDone(!step?.practice)
    if (!step) return
    speakCurrentStep()
    return () => { if ('speechSynthesis' in window) window.speechSynthesis.cancel() }
  }, [step, audioEnabled])

  useEffect(() => {
    if (!step?.practice) return
    let target: HTMLElement | null = targetFor(step)
    if (!target) {
      setPracticeDone(true)
      return
    }
    let done = false
    const complete = () => {
      if (done) return
      done = true
      setPracticeDone(true)
      if (step.kind === 'nav') window.setTimeout(onNext, 120)
    }
    const eventName = step.practice.completeOn === 'input' ? 'input' : step.practice.completeOn === 'focus' ? 'focusin' : 'click'
    target.addEventListener(eventName, complete, true)
    const retry = window.setTimeout(() => {
      const nextTarget = targetFor(step)
      if (nextTarget && nextTarget !== target) {
        target?.removeEventListener(eventName, complete, true)
        target = nextTarget
        target.addEventListener(eventName, complete, true)
      }
    }, 250)
    return () => {
      window.clearTimeout(retry)
      target?.removeEventListener(eventName, complete, true)
    }
  }, [step, onNext])

  useLayoutEffect(() => {
    if (!step) return
    let active = true
    let timer: number | undefined
    let frame = 0
    let observed: HTMLElement | null = null
    const resizeObserver = new ResizeObserver(() => scheduleMeasure())
    const measure = () => {
      if (!active) return
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
        if (target) resizeObserver.observe(target)
      }
    }
    const scheduleMeasure = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    const target = targetFor(step)
    if (target) target.scrollIntoView({ behavior: 'auto', block: window.innerWidth <= 760 ? 'start' : 'center', inline: 'nearest' })
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
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
      if (event.key === 'ArrowRight') { event.preventDefault(); if (practiceDone || fallback) onNext(); return }
      if (event.key === 'ArrowLeft') { event.preventDefault(); if (index > 0) onBack(); return }
      if (event.key !== 'Tab' || !cardRef.current) return
      const focusable = [...cardRef.current.querySelectorAll<HTMLElement>('button:not([disabled])')]
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === cardRef.current)) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      else if (!cardRef.current.contains(document.activeElement)) { event.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [index, onBack, onNext, onClose, practiceDone, fallback])

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
    cardStyle.bottom = 16
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
  const canAdvance = practiceDone || fallback || !step.practice
  const practiceLabel = practiceDone ? 'Teste concluído' : step.kind === 'nav' ? 'Clique na aba destacada' : 'Faça o teste destacado'
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
    <div className={`guided-tour-card side-${side}`} style={cardStyle} role="dialog" aria-modal="true" aria-labelledby="guided-tour-title" aria-describedby="guided-tour-description" tabIndex={-1} ref={cardRef}>
      <div className="guided-tour-topline"><span>GUIA INTERATIVO</span><div className="guided-tour-top-actions"><button className={`guided-tour-audio ${audioEnabled ? 'on' : ''}`} onClick={() => { const next = !audioEnabled; setAudioEnabled(next); try { localStorage.setItem(audioStorageKey(), next ? 'on' : 'off') } catch { /* Audio preference is optional. */ }; if (!next && 'speechSynthesis' in window) window.speechSynthesis.cancel() }} aria-label={audioEnabled ? 'Desativar narração' : 'Ativar narração'} title={audioEnabled ? `Narração ativa${voiceName ? `: ${voiceName}` : ''}` : 'Ativar narração'}>{audioEnabled ? <Volume2 size={17}/> : <VolumeX size={17}/>}</button><button className="guided-tour-audio" onClick={speakCurrentStep} aria-label="Repetir narração" title="Repetir narração"><RotateCcw size={16}/></button><button className="guided-tour-close" onClick={onClose} aria-label="Sair do guia"><X size={18}/></button></div></div>
      <div className="guided-tour-counter"><span>ETAPA {String(index + 1).padStart(2, '0')} / {String(steps.length).padStart(2, '0')}</span><div className="guided-tour-progress"><i style={{ width: `${(index + 1) / steps.length * 100}%` }}/></div></div>
      <h2 id="guided-tour-title">{step.title}</h2>
      <p id="guided-tour-description">{step.description}</p>
      {step.practice && <div className={`guided-tour-practice ${practiceDone ? 'done' : ''}`}><div><strong>{practiceLabel}</strong><p>{step.practice.instruction}</p></div>{practiceDone && <Check size={18}/>}</div>}
      {fallback && <small className="guided-tour-hint">O destaque foi movido para a área disponível desta tela.</small>}
      <div className="guided-tour-actions"><button className="guided-tour-skip" onClick={onClose}>Sair do guia</button><div>{index > 0 && <button className="guided-tour-back" onClick={onBack}><ArrowLeft size={16}/> Voltar</button>}<button className="guided-tour-next" onClick={onNext} disabled={!canAdvance}>{last ? <>Concluir <Check size={17}/></> : <>Próximo <ArrowRight size={17}/></>}</button></div></div>
      <div className="guided-tour-keyboard">{canAdvance ? 'Use ← → para navegar · Esc para sair' : 'Faça o teste destacado para liberar o próximo passo'}</div>
    </div>
  </div>
}
