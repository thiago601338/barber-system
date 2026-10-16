import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { SpeechInputButton } from '../src/SpeechInputButton'

// Controlled browser fixture: no microphone, audio provider or database access.
let currentRecognition: FakeRecognition | null = null
class FakeRecognition {
  lang = ''
  continuous = false
  interimResults = false
  onresult: ((event: { results: never }) => void) | null = null
  onerror = null
  onend: (() => void) | null = null
  start() { currentRecognition = this }
  stop() { this.onend?.() }
  emit(parts: string[]) {
    const results = parts.map(transcript => ({ 0: { transcript }, length: 1, isFinal: true }))
    this.onresult?.({ results: results as never })
  }
}
Object.assign(window, { SpeechRecognition: FakeRecognition })

function Fixture() {
  const [text, setText] = useState('')
  const [disabled, setDisabled] = useState(false)
  const [error, setError] = useState('')
  return <main style={{ padding: 32, fontFamily: 'Arial', display: 'grid', gap: 16, maxWidth: 640 }}>
    <h1>Verificação controlada do ditado</h1>
    <p>Eventos de fala simulados; nenhum microfone é acionado.</p>
    <textarea aria-label="Texto transcrito" value={text} onChange={event => setText(event.target.value)} />
    <SpeechInputButton value={text} disabled={disabled} onChange={setText} onError={setError} />
    <button onClick={() => currentRecognition?.emit(['Agende amanhã'])}>Simular primeira frase</button>
    <button onClick={() => currentRecognition?.emit(['Agende amanhã', 'às dez horas'])}>Simular resultado acumulado</button>
    <button onClick={() => { setText(''); setDisabled(true) }}>Enviar pedido fictício</button>
    <button onClick={() => currentRecognition?.emit(['Resultado atrasado'])}>Simular resultado depois de enviar</button>
    <output>{error}</output>
  </main>
}

createRoot(document.getElementById('root')!).render(<Fixture />)
