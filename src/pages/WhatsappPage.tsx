import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Bot, CheckCheck, Hand, MessageCircle, PhoneCall, Power, RefreshCw, Send, Smartphone, Sparkles } from 'lucide-react'
import type { PageProps } from '../App'
import { authedApi, requireSupabase } from '../lib/supabase'
import { Empty, Field, Loading, Notice, PageHeader, PrimaryButton } from '../ui'
import '../styles-whatsapp.css'

interface Connection {
  barbershop_id: string
  waba_id: string
  phone_number_id: string
  display_phone_number: string | null
  verified_name: string | null
  coexistence: boolean
  status: 'connected' | 'disconnected' | 'error'
  ai_enabled: boolean
  ai_instructions: string | null
  ai_can_book: boolean
  human_pause_minutes: number
  last_error: string | null
  connected_at: string
}
interface Conversation { id: string; wa_id: string; contact_name: string | null; last_message_at: string | null; last_message_preview: string | null; last_customer_message_at: string | null; ai_paused_until: string | null; unread_count: number }
interface Message { id: string; direction: 'in' | 'out'; author: 'customer' | 'ai' | 'staff' | 'phone'; kind: string; body: string | null; status: string | null; created_at: string }
interface WaConfig { ready: boolean; app_id: string | null; config_id: string | null; graph_version: string; ai_ready: boolean }

type FbLoginResponse = { authResponse?: { code?: string } | null; status?: string }
type FbSdk = { init: (options: Record<string, unknown>) => void; login: (callback: (response: FbLoginResponse) => void, options: Record<string, unknown>) => void }
declare global { interface Window { FB?: FbSdk; fbAsyncInit?: () => void } }

const pauseOptions = [[30, '30 minutos'], [60, '1 hora'], [120, '2 horas'], [240, '4 horas'], [720, '12 horas'], [1440, '24 horas']] as const

function formatPhone(waId: string) {
  if (!/^\d+$/.test(waId)) return 'Usuário do WhatsApp (sem telefone visível)'
  const d = waId.replace(/\D/g, '')
  const local = d.startsWith('55') ? d.slice(2) : d
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`
  return `+${d}`
}
function when(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  const today = new Date()
  return date.toDateString() === today.toDateString() ? date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}
const paused = (c: Conversation) => !!c.ai_paused_until && Date.parse(c.ai_paused_until) > Date.now()
const windowOpen = (c: Conversation) => !!c.last_customer_message_at && Date.now() - Date.parse(c.last_customer_message_at) < 24 * 3_600_000

function loadFacebookSdk(appId: string, version: string): Promise<FbSdk> {
  return new Promise((resolve, reject) => {
    if (window.FB) { resolve(window.FB); return }
    window.fbAsyncInit = () => { window.FB!.init({ appId, autoLogAppEvents: true, xfbml: false, version }); resolve(window.FB!) }
    const script = document.createElement('script')
    script.src = 'https://connect.facebook.net/pt_BR/sdk.js'
    script.async = true; script.defer = true; script.crossOrigin = 'anonymous'
    script.onerror = () => reject(new Error('Não foi possível abrir a conexão com a Meta. Desative bloqueadores e tente de novo.'))
    document.body.appendChild(script)
  })
}

export function WhatsappPage({ identity, notify }: PageProps) {
  const shop = identity.shop!
  const [config, setConfig] = useState<WaConfig | null>(null)
  const [connection, setConnection] = useState<Connection | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [configResponse, row] = await Promise.all([
      fetch('/api/whatsapp/config').then(r => r.json() as Promise<WaConfig>).catch(() => null),
      requireSupabase().from('whatsapp_connections').select('*').eq('barbershop_id', shop.id).maybeSingle(),
    ])
    setConfig(configResponse)
    if (row.error) setError(row.error.message)
    else setConnection(row.data as Connection | null)
    setLoading(false)
  }, [shop.id])
  useEffect(() => { void load() }, [load])

  const connected = connection?.status === 'connected'
  return <div className="page-stack wa-page">
    <PageHeader eyebrow="CRESCIMENTO" title="Atendimento IA no WhatsApp" description="Conecte o WhatsApp da barbearia e deixe a IA responder os clientes: preços, horários livres e agendamento. Ela só responde quando o cliente manda mensagem primeiro."/>
    <Notice text={error}/>
    {loading ? <Loading text="Carregando o WhatsApp..."/> : connected
      ? <><ConnectedPanel connection={connection!} shopId={shop.id} aiReady={!!config?.ai_ready} onChanged={load} notify={notify}/><Inbox shopId={shop.id} notify={notify}/><TemplatesPanel shopId={shop.id} notify={notify}/></>
      : <><ConnectPanel config={config} shopId={shop.id} previous={connection} onConnected={load} notify={notify}/><TestPanel shopId={shop.id} aiReady={!!config?.ai_ready}/></>}
  </div>
}

function ConnectPanel({ config, shopId, previous, onConnected, notify }: { config: WaConfig | null; shopId: string; previous: Connection | null; onConnected: () => Promise<void>; notify: PageProps['notify'] }) {
  const [busy, setBusy] = useState<null | 'coexistence' | 'new'>(null)
  const [error, setError] = useState<string | null>(null)
  const signup = useRef<{ waba_id?: string; phone_number_id?: string; code?: string; coexistence: boolean; done: boolean; event?: boolean }>({ coexistence: true, done: false })

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!/(^|\.)facebook\.com$/.test(new URL(event.origin).hostname)) return
      let data: { type?: string; event?: string; data?: { waba_id?: string; phone_number_id?: string; error_message?: string } }
      try { data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data } catch { return }
      if (data?.type !== 'WA_EMBEDDED_SIGNUP') return
      if (data.event === 'CANCEL') { setBusy(null); setError(data.data?.error_message || 'A conexão foi interrompida antes de terminar.'); return }
      if (data.event === 'ERROR') { setBusy(null); setError('A Meta informou um erro durante a conexão. Tente de novo.'); return }
      if (data.data?.waba_id) signup.current.waba_id = data.data.waba_id
      if (data.data?.phone_number_id) signup.current.phone_number_id = data.data.phone_number_id
      if (data.event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING') signup.current.coexistence = true
      else if (data.event === 'FINISH') signup.current.coexistence = false
      signup.current.event = true
      void finish()
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }) // eslint-disable-line react-hooks/exhaustive-deps

  async function finish(force = false) {
    const s = signup.current
    // O código chega pelo login; a conta e o número chegam pelo aviso da janela da Meta (que pode demorar ou não vir).
    if (s.done || !s.code || (!s.event && !force)) return
    s.done = true
    try {
      await authedApi('/api/whatsapp/connect', { barbershop_id: shopId, code: s.code, waba_id: s.waba_id || null, phone_number_id: s.phone_number_id || null, coexistence: s.coexistence })
      notify('WhatsApp conectado.')
      await onConnected()
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Não foi possível conectar.'); s.done = false }
    finally { setBusy(null) }
  }

  async function start(coexistence: boolean) {
    if (!config?.ready || !config.app_id || !config.config_id) return
    setError(null); setBusy(coexistence ? 'coexistence' : 'new')
    signup.current = { coexistence, done: false }
    try {
      const fb = await loadFacebookSdk(config.app_id, config.graph_version)
      fb.login(response => {
        const code = response.authResponse?.code
        if (!code) { setBusy(null); if (!signup.current.done) setError('A conexão com a Meta não foi concluída.'); return }
        signup.current.code = code
        void finish()
        window.setTimeout(() => void finish(true), 4000)
      }, {
        config_id: config.config_id, response_type: 'code', override_default_response_type: true,
        extras: { setup: {}, ...(coexistence ? { featureType: 'whatsapp_business_app_onboarding' } : {}) },
      })
    } catch (problem) { setBusy(null); setError(problem instanceof Error ? problem.message : 'Não foi possível abrir a conexão.') }
  }

  const ready = !!config?.ready
  return <section className="panel wa-connect">
    <div className="wa-connect-head">
      <div className="wa-connect-icon"><MessageCircle size={26}/></div>
      <div><h2>Conecte o WhatsApp da barbearia</h2><p>A conexão é feita pela API oficial do WhatsApp (Meta). Você entra com o Facebook da barbearia e escolhe o número.</p></div>
    </div>
    {!ready && <Notice kind="info" text="A conexão oficial com o WhatsApp está em liberação pela Meta. Assim que for aprovada, os botões abaixo ficam disponíveis aqui."/>}
    {previous?.status === 'disconnected' && <Notice kind="info" text={`O número ${previous.display_phone_number || ''} foi desconectado. Conecte de novo quando quiser.`}/>}
    <div className="wa-connect-options">
      <button type="button" className="wa-option recommended" disabled={!ready || !!busy} onClick={() => void start(true)}>
        <Smartphone size={22}/><strong>Usar o número que já tenho no WhatsApp Business</strong>
        <span>A barbearia continua usando o app no celular normalmente. A IA responde junto, e quando alguém da equipe responde pelo celular, a IA pausa naquela conversa.</span>
        <em>{busy === 'coexistence' ? 'Abrindo a Meta...' : 'Recomendado'}</em>
      </button>
      <button type="button" className="wa-option" disabled={!ready || !!busy} onClick={() => void start(false)}>
        <PhoneCall size={22}/><strong>Conectar um número novo</strong>
        <span>Para um número que não está em uso no WhatsApp. Ele passa a funcionar só pelo sistema.</span>
        <em>{busy === 'new' ? 'Abrindo a Meta...' : 'Número exclusivo'}</em>
      </button>
    </div>
    <Notice text={error}/>
    <ul className="wa-facts">
      <li><Bot size={16}/>A IA só responde quando o cliente escreve primeiro. Ela nunca envia mensagem por conta própria.</li>
      <li><Sparkles size={16}/>Responde preços, serviços, endereço e horários livres, e pode agendar direto na agenda.</li>
      <li><CheckCheck size={16}/>As respostas são cobradas pela Meta na conta do WhatsApp da barbearia (cerca de R$ 0,04 por resposta).</li>
    </ul>
  </section>
}

function ConnectedPanel({ connection, shopId, aiReady, onChanged, notify }: { connection: Connection; shopId: string; aiReady: boolean; onChanged: () => Promise<void>; notify: PageProps['notify'] }) {
  const [form, setForm] = useState({ ai_instructions: connection.ai_instructions || '', ai_can_book: connection.ai_can_book, human_pause_minutes: connection.human_pause_minutes })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty = form.ai_instructions !== (connection.ai_instructions || '') || form.ai_can_book !== connection.ai_can_book || form.human_pause_minutes !== connection.human_pause_minutes

  async function save(patch: Record<string, unknown>, message: string) {
    setBusy(true); setError(null)
    try { await authedApi('/api/whatsapp/settings', { barbershop_id: shopId, ...patch }); notify(message); await onChanged() }
    catch (problem) { setError(problem instanceof Error ? problem.message : 'Não foi possível salvar.') }
    finally { setBusy(false) }
  }
  async function disconnect() {
    if (!window.confirm('Desconectar o WhatsApp? A IA para de responder e o número volta a funcionar só no aparelho.')) return
    setBusy(true)
    try { await authedApi('/api/whatsapp/disconnect', { barbershop_id: shopId }); notify('WhatsApp desconectado.'); await onChanged() }
    catch (problem) { setError(problem instanceof Error ? problem.message : 'Não foi possível desconectar.') }
    finally { setBusy(false) }
  }
  function submit(event: FormEvent) { event.preventDefault(); void save(form, 'Configurações da IA salvas.') }

  return <section className="wa-settings">
    <div className="panel wa-status">
      <div className="wa-status-line">
        <div className="wa-connect-icon small"><MessageCircle size={20}/></div>
        <div><strong>{connection.verified_name || 'WhatsApp conectado'}</strong><span>{connection.display_phone_number || connection.phone_number_id}{connection.coexistence ? ' · também no app do celular' : ''}</span></div>
        <span className="status good">Conectado</span>
      </div>
      <div className={`wa-ai-switch ${connection.ai_enabled ? 'on' : ''}`}>
        <div><strong>Atendimento por IA</strong><span>{connection.ai_enabled ? 'Ligado: a IA responde as mensagens que chegarem.' : 'Desligado: as mensagens chegam, mas ninguém responde automaticamente.'}</span></div>
        <button type="button" className={`permission-toggle ${connection.ai_enabled ? 'on' : ''}`} disabled={busy} onClick={() => void save({ ai_enabled: !connection.ai_enabled }, connection.ai_enabled ? 'Atendimento por IA desligado.' : 'Atendimento por IA ligado.')} aria-label={connection.ai_enabled ? 'Desligar atendimento por IA' : 'Ligar atendimento por IA'}><span/></button>
      </div>
      {connection.last_error && <Notice text={connection.last_error}/>}
      <button type="button" className="button ghost danger-text wa-disconnect" onClick={() => void disconnect()} disabled={busy}><Power size={15}/> Desconectar WhatsApp</button>
    </div>
    <form className="panel form-grid wa-ai-form" onSubmit={submit}>
      <div className="panel-head"><div><h2>Como a IA atende</h2><p>Ela já sabe os serviços, preços, profissionais e horários da agenda. Aqui você ajusta o jeito de atender.</p></div></div>
      <Field label="Instruções para a IA" hint="Ex.: tom de voz, regras de atraso, formas de pagamento, estacionamento, o que não oferecer.">
        <textarea rows={6} maxLength={4000} value={form.ai_instructions} onChange={event => setForm({ ...form, ai_instructions: event.target.value })} placeholder={'Ex.: Atenda de forma descontraída e use o nome do cliente.\nAceitamos Pix, cartão e dinheiro.\nTolerância de 10 minutos de atraso.\nTemos estacionamento na rua lateral.'}/>
      </Field>
      <label className="check-field"><input type="checkbox" checked={form.ai_can_book} onChange={event => setForm({ ...form, ai_can_book: event.target.checked })}/> A IA pode agendar e cancelar horários direto na agenda</label>
      <Field label="Quando alguém da equipe responder, a IA pausa na conversa por">
        <select value={form.human_pause_minutes} onChange={event => setForm({ ...form, human_pause_minutes: Number(event.target.value) })}>{pauseOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      </Field>
      <Notice text={error}/>
      <div className="form-actions"><PrimaryButton type="submit" disabled={busy || !dirty}>{busy ? 'Salvando...' : 'Salvar'}</PrimaryButton></div>
    </form>
    <TestPanel shopId={shopId} aiReady={aiReady} instructions={form.ai_instructions} canBook={form.ai_can_book}/>
  </section>
}

function Inbox({ shopId, notify }: { shopId: string; notify: PageProps['notify'] }) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const threadRef = useRef<HTMLDivElement>(null)
  const selected = useMemo(() => conversations.find(c => c.id === selectedId) || null, [conversations, selectedId])

  const loadConversations = useCallback(async () => {
    const { data, error: queryError } = await requireSupabase().from('whatsapp_conversations').select('id,wa_id,contact_name,last_message_at,last_message_preview,last_customer_message_at,ai_paused_until,unread_count').eq('barbershop_id', shopId).order('last_message_at', { ascending: false, nullsFirst: false }).limit(60)
    if (queryError) setError(queryError.message); else setConversations((data ?? []) as Conversation[])
    setLoading(false)
  }, [shopId])
  const loadMessages = useCallback(async (id: string) => {
    const { data, error: queryError } = await requireSupabase().from('whatsapp_messages').select('id,direction,author,kind,body,status,created_at').eq('conversation_id', id).order('created_at', { ascending: false }).limit(80)
    if (queryError) setError(queryError.message); else setMessages(((data ?? []) as Message[]).reverse())
  }, [])

  useEffect(() => { void loadConversations(); const timer = window.setInterval(() => void loadConversations(), 8000); return () => window.clearInterval(timer) }, [loadConversations])
  useEffect(() => {
    if (!selectedId) return
    void loadMessages(selectedId)
    const timer = window.setInterval(() => void loadMessages(selectedId), 6000)
    return () => window.clearInterval(timer)
  }, [selectedId, loadMessages])
  useEffect(() => { threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight }) }, [messages.length, selectedId])

  async function open(conversation: Conversation) {
    setSelectedId(conversation.id); setDraft(''); setError(null)
    if (conversation.unread_count) { try { await authedApi('/api/whatsapp/read', { barbershop_id: shopId, conversation_id: conversation.id }); void loadConversations() } catch { /* lido no próximo acesso */ } }
  }
  async function act(action: 'pause' | 'resume') {
    if (!selected) return
    setBusy(true)
    try { await authedApi(`/api/whatsapp/${action}`, { barbershop_id: shopId, conversation_id: selected.id }); notify(action === 'pause' ? 'Você assumiu a conversa. A IA não responde mais nela.' : 'A IA voltou a responder esta conversa.'); await loadConversations() }
    catch (problem) { setError(problem instanceof Error ? problem.message : 'Não foi possível alterar.') }
    finally { setBusy(false) }
  }
  async function send(event: FormEvent) {
    event.preventDefault()
    if (!selected || !draft.trim()) return
    setBusy(true); setError(null)
    try { await authedApi('/api/whatsapp/send', { barbershop_id: shopId, conversation_id: selected.id, text: draft.trim() }); setDraft(''); await Promise.all([loadMessages(selected.id), loadConversations()]) }
    catch (problem) { setError(problem instanceof Error ? problem.message : 'Não foi possível enviar.') }
    finally { setBusy(false) }
  }

  const authorLabel: Record<Message['author'], string> = { customer: '', ai: 'IA', staff: 'Equipe (painel)', phone: 'Equipe (celular)' }
  return <section className="panel wa-inbox">
    <div className="panel-head"><div><h2>Conversas</h2><p>Acompanhe o que a IA está respondendo e assuma qualquer conversa quando quiser.</p></div><button type="button" className="icon-button" onClick={() => void loadConversations()} aria-label="Atualizar conversas"><RefreshCw size={16}/></button></div>
    {loading ? <Loading text="Carregando conversas..."/> : !conversations.length
      ? <Empty title="Nenhuma conversa ainda" text="Quando um cliente mandar mensagem para o WhatsApp da barbearia, a conversa aparece aqui."/>
      : <div className={`wa-inbox-grid ${selected ? 'has-thread' : ''}`}>
        <ul className="wa-list">{conversations.map(c => <li key={c.id}><button type="button" className={c.id === selectedId ? 'on' : ''} onClick={() => void open(c)}>
          <span className="wa-avatar">{(c.contact_name || '#').trim().charAt(0).toUpperCase()}</span>
          <span className="wa-list-body"><strong>{c.contact_name || formatPhone(c.wa_id)}</strong><small>{c.last_message_preview || '—'}</small></span>
          <span className="wa-list-meta"><small>{when(c.last_message_at)}</small>{c.unread_count > 0 && <b>{c.unread_count}</b>}{paused(c) && <i title="IA pausada nesta conversa"><Hand size={12}/></i>}</span>
        </button></li>)}</ul>
        {selected ? <div className="wa-thread">
          <div className="wa-thread-head">
            <button type="button" className="back-button wa-back" onClick={() => setSelectedId(null)}>← Conversas</button>
            <div><strong>{selected.contact_name || formatPhone(selected.wa_id)}</strong><small>{formatPhone(selected.wa_id)} · {paused(selected) ? 'IA pausada nesta conversa' : 'IA respondendo'}</small></div>
            {paused(selected)
              ? <button type="button" className="button outline" disabled={busy} onClick={() => void act('resume')}><Bot size={15}/> Devolver para a IA</button>
              : <button type="button" className="button outline" disabled={busy} onClick={() => void act('pause')}><Hand size={15}/> Assumir conversa</button>}
          </div>
          <div className="wa-messages" ref={threadRef}>{messages.map(m => <div key={m.id} className={`wa-bubble ${m.direction} ${m.author}`}>
            {m.direction === 'out' && <span className="wa-author">{authorLabel[m.author]}</span>}
            <p>{m.body?.startsWith('media:') ? '🎤 Áudio (transcrevendo...)' : m.body || `[${m.kind}]`}</p>
            <small>{new Date(m.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}{m.status === 'failed' ? ' · não entregue' : m.status === 'read' ? ' · lida' : ''}</small>
          </div>)}</div>
          <form className="wa-compose" onSubmit={send}>
            <textarea rows={2} value={draft} onChange={event => setDraft(event.target.value)} maxLength={4000} disabled={!windowOpen(selected) || busy} placeholder={windowOpen(selected) ? 'Responder como equipe (a IA pausa nesta conversa)' : 'Passaram 24h desde a última mensagem do cliente: o WhatsApp não permite responder agora.'} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }}/>
            <PrimaryButton type="submit" disabled={busy || !draft.trim() || !windowOpen(selected)}><Send size={15}/> Enviar</PrimaryButton>
          </form>
          <Notice text={error}/>
        </div> : <div className="wa-thread empty"><MessageCircle size={28}/><p>Escolha uma conversa para ver as mensagens.</p></div>}
      </div>}
  </section>
}

function TestPanel({ shopId, aiReady, instructions, canBook }: { shopId: string; aiReady: boolean; instructions?: string; canBook?: boolean }) {
  const [turns, setTurns] = useState<{ role: 'user' | 'assistant'; content: string }[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  useEffect(() => { boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight }) }, [turns.length, busy])
  async function send(event: FormEvent) {
    event.preventDefault()
    const text = draft.trim()
    if (!text || busy) return
    const next = [...turns, { role: 'user' as const, content: text }]
    setTurns(next); setDraft(''); setBusy(true); setError(null)
    try {
      const result = await authedApi<{ reply: string }>('/api/whatsapp/simulate', { barbershop_id: shopId, turns: next, ...(instructions !== undefined ? { ai_instructions: instructions } : {}), ...(canBook !== undefined ? { ai_can_book: canBook } : {}) })
      setTurns([...next, { role: 'assistant', content: result.reply }])
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Não foi possível testar agora.') }
    finally { setBusy(false) }
  }
  return <section className="panel wa-test">
    <div className="panel-head"><div><h2>Testar a IA</h2><p>Escreva como se fosse um cliente e veja o que a IA responderia. Nada é enviado no WhatsApp nem gravado na agenda.</p></div>{turns.length > 0 && <button type="button" className="button ghost" onClick={() => { setTurns([]); setError(null) }}>Limpar</button>}</div>
    {!aiReady && <Notice kind="info" text="A IA de respostas ainda não está ativa no servidor."/>}
    <div className="wa-test-box" ref={boxRef}>
      {!turns.length && <p className="wa-test-hint">Ex.: "Oi, quanto custa o corte?" ou "Tem horário amanhã à tarde?"</p>}
      {turns.map((turn, index) => <div key={index} className={`wa-bubble ${turn.role === 'user' ? 'in' : 'out ai'}`}>{turn.role === 'assistant' && <span className="wa-author">IA</span>}<p>{turn.content}</p></div>)}
      {busy && <div className="wa-bubble out ai typing"><span className="wa-author">IA</span><p>digitando...</p></div>}
    </div>
    <form className="wa-compose" onSubmit={send}>
      <textarea rows={1} value={draft} onChange={event => setDraft(event.target.value)} maxLength={1000} placeholder="Mensagem do cliente" disabled={!aiReady} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }}/>
      <PrimaryButton type="submit" disabled={busy || !draft.trim() || !aiReady}><Send size={15}/> Testar</PrimaryButton>
    </form>
    <Notice text={error}/>
  </section>
}

interface Template { id: string; name: string; status: string; category: string; language: string; body: string }
const templateStatus: Record<string, string> = { APPROVED: 'Aprovado', PENDING: 'Em análise', REJECTED: 'Recusado', PAUSED: 'Pausado', DISABLED: 'Desativado' }

function TemplatesPanel({ shopId, notify }: { shopId: string; notify: PageProps['notify'] }) {
  const [list, setList] = useState<Template[] | null>(null)
  const [form, setForm] = useState({ name: '', category: 'UTILITY', body: '', examples: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    try { const result = await authedApi<{ templates: Template[] }>('/api/whatsapp/templates', { barbershop_id: shopId }); setList(result.templates) }
    catch (problem) { setError(problem instanceof Error ? problem.message : 'Não foi possível carregar os modelos.'); setList([]) }
  }, [shopId])
  useEffect(() => { void load() }, [load])
  const variables = useMemo(() => [...new Set([...form.body.matchAll(/\{\{(\d+)\}\}/g)].map(m => Number(m[1])))].sort((a, b) => a - b), [form.body])
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null)
    try {
      await authedApi('/api/whatsapp/template-create', { barbershop_id: shopId, name: form.name, category: form.category, body: form.body, examples: form.examples.split('|').map(v => v.trim()).filter(Boolean) })
      notify('Modelo enviado para aprovação da Meta.')
      setForm({ name: '', category: 'UTILITY', body: '', examples: '' })
      await load()
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Não foi possível criar o modelo.') }
    finally { setBusy(false) }
  }
  return <section className="panel wa-templates">
    <div className="panel-head"><div><h2>Modelos de mensagem</h2><p>Modelos aprovados pela Meta na conta do WhatsApp da barbearia. A IA não usa modelos: ela só responde quem escreveu primeiro.</p></div><button type="button" className="icon-button" onClick={() => void load()} aria-label="Atualizar modelos"><RefreshCw size={16}/></button></div>
    {list === null ? <Loading text="Carregando modelos..."/> : list.length ? <div className="table-scroll"><table><thead><tr><th>Nome</th><th>Categoria</th><th>Status</th><th>Texto</th></tr></thead><tbody>{list.map(t => <tr key={t.id}><td>{t.name}</td><td>{t.category === 'MARKETING' ? 'Marketing' : t.category === 'UTILITY' ? 'Utilidade' : t.category}</td><td>{templateStatus[t.status] || t.status}</td><td className="wa-template-body">{t.body}</td></tr>)}</tbody></table></div> : <p className="muted">Nenhum modelo criado ainda.</p>}
    <form className="form-grid wa-template-form" onSubmit={submit}>
      <div className="form-row">
        <Field label="Nome do modelo" hint="Só letras minúsculas, números e _"><input value={form.name} onChange={event => setForm({ ...form, name: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} placeholder="confirmacao_agendamento" maxLength={60} required/></Field>
        <Field label="Categoria"><select value={form.category} onChange={event => setForm({ ...form, category: event.target.value })}><option value="UTILITY">Utilidade</option><option value="MARKETING">Marketing</option></select></Field>
      </div>
      <Field label="Texto" hint="Use {{1}}, {{2}} para partes que mudam, como o nome do cliente ou o horário."><textarea rows={3} maxLength={1024} value={form.body} onChange={event => setForm({ ...form, body: event.target.value })} placeholder="Olá {{1}}, seu horário na barbearia está confirmado para {{2}}." required/></Field>
      {variables.length > 0 && <Field label={`Exemplos para ${variables.map(v => `{{${v}}}`).join(', ')}`} hint="Separe com | (ex.: João | sábado às 10h)"><input value={form.examples} onChange={event => setForm({ ...form, examples: event.target.value })} placeholder="João | sábado às 10h"/></Field>}
      <Notice text={error}/>
      <div className="form-actions"><PrimaryButton type="submit" disabled={busy}>{busy ? 'Enviando...' : 'Criar modelo'}</PrimaryButton></div>
    </form>
  </section>
}
