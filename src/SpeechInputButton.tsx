import { useRef, useState } from 'react'
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

type SpeechRecognitionEvent = { results: SpeechRecognitionResultList }
type SpeechRecognitionInstance = {
  lang: string
  interimResults: boolean
  continuous: boolean
  start: () => void
  stop: () => void
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance

function recognitionConstructor(): SpeechRecognitionConstructor | null {
  const source = window as unknown as { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor }
  return source.SpeechRecognition || source.webkitSpeechRecognition || null
}

export function speechInputAvailable(): boolean {
  return typeof window !== 'undefined' && Boolean(recognitionConstructor())
}

export function SpeechInputButton({ disabled, onText, onUnavailable, className }: { disabled?: boolean; onText: (text: string) => void; onUnavailable?: () => void; className?: string }) {
  const [listening, setListening] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)

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
    recognition.lang = 'pt-BR'
    recognition.interimResults = false
    recognition.continuous = false
    recognition.onresult = event => {
      const text = Array.from({ length: event.results.length }, (_, index) => event.results[index]?.[0]?.transcript || '').join(' ').trim()
      if (text) onText(text)
    }
    recognition.onerror = () => setListening(false)
    recognition.onend = () => setListening(false)
    setListening(true)
    recognition.start()
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
