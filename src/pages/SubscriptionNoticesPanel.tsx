import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { PageProps } from '../App'
import { authedApi, requireSupabase } from '../lib/supabase'
import { Loading, Notice } from '../ui'

interface NoticeTemplate { kind: string; name: string; label: string; body: string; status: string }
interface SentNotice { id: string; kind: string; status: string; created_at: string; sent_at: string | null; last_error: string | null; subscription_id: string }

const templateLabel: Record<string, string> = { APPROVED: 'Aprovado', PENDING: 'Em análise da Meta', REJECTED: 'Recusado pela Meta', PAUSED: 'Pausado', DISABLED: 'Desativado', MISSING: 'Não criado' }
const kindLabel: Record<string, string> = { welcome: 'Assinatura confirmada', payment_failed: 'Cobrança recusada', payment_reminder: 'Lembrete antes do cancelamento', cancelled: 'Assinatura cancelada' }
const statusLabel: Record<string, string> = { pending: 'Na fila', sending: 'Enviando', sent: 'Enviado', failed: 'Falhou', skipped: 'Não enviado', expired: 'Venceu sem envio' }
const when = (value: string) => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value))

/** Avisos automáticos de assinatura: modelos na Meta e últimos envios. */
export function SubscriptionNoticesPanel({ shopId, notify }: { shopId: string; notify: PageProps['notify'] }) {
  const [templates, setTemplates] = useState<NoticeTemplate[] | null>(null)
  const [recent, setRecent] = useState<(SentNotice & { client: string })[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    setError(null)
    try {
      const client = requireSupabase()
      const [status, notices] = await Promise.all([
        authedApi<{ templates: NoticeTemplate[] }>('/api/whatsapp/notice-templates', { barbershop_id: shopId }),
        client.from('subscription_notices').select('id,kind,status,created_at,sent_at,last_error,subscription_id').eq('barbershop_id', shopId).order('created_at', { ascending: false }).limit(12),
      ])
      setTemplates(status.templates)
      const rows = (notices.data ?? []) as SentNotice[]
      const subs = rows.length ? await client.from('subscriptions').select('id,client_id').in('id', [...new Set(rows.map(r => r.subscription_id))]) : { data: [] }
      const clientIds = [...new Set(((subs.data ?? []) as { client_id: string }[]).map(s => s.client_id))]
      const people = clientIds.length ? await client.from('clients').select('id,full_name').in('id', clientIds) : { data: [] }
      const nameOf = (subscriptionId: string) => {
        const clientId = ((subs.data ?? []) as { id: string; client_id: string }[]).find(s => s.id === subscriptionId)?.client_id
        return String(((people.data ?? []) as { id: string; full_name: string }[]).find(p => p.id === clientId)?.full_name || '—')
      }
      setRecent(rows.map(row => ({ ...row, client: nameOf(row.subscription_id) })))
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Não foi possível carregar os avisos.'); setTemplates(previous => previous ?? []) }
  }, [shopId])
  useEffect(() => { void load() }, [load])
  async function create() {
    setBusy(true); setError(null)
    try {
      const result = await authedApi<{ templates: NoticeTemplate[]; errors: string[] }>('/api/whatsapp/notice-templates-create', { barbershop_id: shopId })
      setTemplates(result.templates)
      if (result.errors.length) setError(result.errors.join(' · '))
      else notify('Modelos enviados para aprovação da Meta. Os avisos começam a sair quando forem aprovados.')
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Não foi possível criar os modelos.') }
    finally { setBusy(false) }
  }
  const missing = (templates ?? []).filter(t => t.status === 'MISSING').length
  const allApproved = templates !== null && templates.length > 0 && templates.every(t => t.status === 'APPROVED')
  return <section className="panel wa-templates wa-notices">
    <div className="panel-head"><div><h2>Avisos de assinatura</h2><p>Mensagens automáticas para assinantes do Mercado Pago: assinatura confirmada, cobrança recusada (na hora e um lembrete 6 dias depois, se continuar em aberto) e assinatura cancelada por falta de pagamento.</p></div><button type="button" className="icon-button" onClick={() => void load()} aria-label="Atualizar avisos"><RefreshCw size={16}/></button></div>
    {templates === null ? <Loading text="Carregando avisos..."/> : <>
      <ul className="wa-notice-list">{templates.map(t => <li key={t.name}><div><strong>{t.label}</strong><small>{t.body}</small></div><span className={`wa-notice-status ${t.status === 'APPROVED' ? 'ok' : t.status === 'MISSING' || t.status === 'REJECTED' ? 'bad' : ''}`}>{templateLabel[t.status] || t.status}</span></li>)}</ul>
      {allApproved ? <Notice kind="success" text="Avisos ligados. Eles saem sozinhos, conferidos a cada 10 minutos."/> : <Notice kind="info" text="Os avisos só saem com os quatro modelos aprovados pela Meta. A análise costuma levar de minutos a algumas horas."/>}
      {missing > 0 && <div className="form-actions"><button type="button" className="button primary" disabled={busy} onClick={() => void create()}>{busy ? 'Enviando...' : `Enviar ${missing === 1 ? 'modelo' : `${missing} modelos`} para aprovação`}</button></div>}
    </>}
    <Notice text={error}/>
    {recent.length > 0 && <div className="table-scroll"><table><thead><tr><th>Quando</th><th>Cliente</th><th>Aviso</th><th>Situação</th></tr></thead><tbody>{recent.map(row => <tr key={row.id}><td>{when(row.sent_at || row.created_at)}</td><td>{row.client}</td><td>{kindLabel[row.kind] || row.kind}</td><td title={row.last_error || undefined}>{statusLabel[row.status] || row.status}{row.last_error && row.status !== 'sent' ? ` · ${row.last_error}` : ''}</td></tr>)}</tbody></table></div>}
  </section>
}
