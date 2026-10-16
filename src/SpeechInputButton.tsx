import { useEffect, useRef, useState } from 'react'
import { Mic, MicOff } from 'lucide-react'

type SpeechRecognitionResultList = {
  length: number
  item(index: number): SpeechRecognitionResult
  [index: number]: SpeechRecognitionResult
}

type SpeechRecognitionAlternative = { transcript: string }
type SpeechRecognitionResult = {
  isFinal: boolean
  length: number
  item(index: number): SpeechRecognitionAlternative
  [index: number]: SpeechRecognitionAlternative
}

type SpeechRecognitionEvent = { resultIndex?: number; results: SpeechRecognitionResultList }
type SpeechRecognitionErrorEvent = { error?: string }
type SpeechRecognitionInstance = {
  lang: string
  interimResults: boolean
  continuous: boolean
  start: () => void
  stop: () => void
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance
type SpeechInputButtonProps = {
  disabled?: boolean
  value: string
  onChange: (text: string) => void
  onUnavailable?: () => void
  onError?: (message: string) => void
  className?: string
}

function recognitionConstructor(): SpeechRecognitionConstructor | null {
  const source = window as unknown as { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor }
  return source.SpeechRecognition || source.webkitSpeechRecognition || null
}

export function speechInputAvailable(): boolean {
  return typeof window !== 'undefined' && Boolean(recognitionConstructor())
}

function withTranscript(base: string, transcript: string): string {
  const cleanBase = base.trim()
  const cleanTranscript = transcript.trim()
  if (!cleanTranscript) return cleanBase
  return cleanBase ? `${cleanBase} ${cleanTranscript}` : cleanTranscript
}

export function SpeechInputButton({ disabled, value, onChange, onUnavailable, onError, className }: SpeechInputButtonProps) {
  const [listening, setListening] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const baseTextRef = useRef('')
  useEffect(() => () => {
    const recognition = recognitionRef.current
    if (!recognition) return
    recognition.onresult = null
    recognition.onerror = null
    recognition.onend = null
    recognition.stop()
  }, [])

  useEffect(() => {
    if (!disabled) return
    const recognition = recognitionRef.current
    if (recognition) {
      recognition.onresult = null
      recognition.onerror = null
      recognition.onend = null
      recognition.stop()
      recognitionRef.current = null
    }
    setListening(false)
  }, [disabled])

  function toggleSpeech() {
    if (disabled) return
    if (listening) {
      recognitionRef.current?.stop()
      setListening(false)
      return
    }
    const Recognition = recognitionConstructor()
    if (!Recognition) {
      onUnavailable?.()
      return
    }
    const recognition = new Recognition()
    recognitionRef.current = recognition
    baseTextRef.current = value
    recognition.lang = 'pt-BR'
    recognition.interimResults = true
    recognition.continuous = true
    recognition.onresult = event => {
      if (recognitionRef.current !== recognition) return
      let finalChunk = ''
      let interimChunk = ''
      // The browser returns the complete result list; rebuilding it prevents
      // a revised final result from being appended for a second time.
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index]
        const piece = result?.[0]?.transcript?.trim()
        if (!piece) continue
        if (result.isFinal) finalChunk = `${finalChunk} ${piece}`.trim()
        else interimChunk = `${interimChunk} ${piece}`.trim()
      }
      const transcript = `${finalChunk} ${interimChunk}`.trim()
      if (transcript) onChange(withTranscript(baseTextRef.current, transcript))
    }
    recognition.onerror = event => {
      if (recognitionRef.current !== recognition) return
      setListening(false)
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') onError?.('O navegador bloqueou o microfone para esta página.')
      else if (event.error && event.error !== 'no-speech') onError?.('Não consegui captar sua fala. Tente de novo falando um pouco mais perto do microfone.')
    }
    recognition.onend = () => {
      if (recognitionRef.current !== recognition) return
      setListening(false)
      recognitionRef.current = null
    }
    setListening(true)
    try { recognition.start() }
    catch {
      setListening(false)
      recognitionRef.current = null
      onError?.('Não foi possível iniciar o ditado. Confira a permissão do microfone e tente novamente.')
    }
  }

  return <button
    type="button"
    className={className || 'ai-speech-button'}
    onClick={toggleSpeech}
    disabled={disabled}
    aria-pressed={listening}
    aria-label={listening ? 'Parar gravação de voz' : 'Falar com a Ajuda de IA'}
    title={listening ? 'Parar gravação' : 'Falar com a IA'}
  >
    {listening ? <MicOff size={18}/> : <Mic size={18}/>}
  </button>
}
