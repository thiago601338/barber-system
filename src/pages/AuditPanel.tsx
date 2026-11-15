import { useEffect, useState } from 'react'
import { History } from 'lucide-react'
import { shopDateTime } from '../lib/shopTime'
import { requireSupabase } from '../lib/supabase'
import { asText, date, money, type Row } from '../types'
import { DataTable, Loading, Modal, Notice, Panel } from '../ui'
import '../styles-extras.css'

const entityLabels: Record<string, string> = {
  service: 'Serviço', product: 'Produto', plan: 'Plano', subscription: 'Contrato de assinatura', sale: 'Comanda', sale_item: 'Item de comanda',
  payment: 'Pagamento', appointment: 'Agendamento', commission_rule: 'Regra de comissão', expense: 'Despesa',
}
const actionLabels: Record<string, string> = { insert: 'Criou', update: 'Alterou', delete: 'Excluiu' }
const fieldLabels: Record<string, string> = {
  name: 'Nome', price_cents: 'Preço', cost_cents: 'Custo', duration_minutes: 'Duração (min)', active: 'Ativo', category: 'Categoria',
  frequency_months: 'Ciclo (meses)', visits_per_cycle: 'Visitas por ciclo', status: 'Situação', cancel_at_period_end: 'Pré-cancelamento',
  cancel_reason: 'Motivo', plan_id: 'Plano', total_cents: 'Total', client_id: 'Cliente', barber_membership_id: 'Profissional',
  description: 'Descrição', quantity: 'Quantidade', unit_price_cents: 'Preço unitário', amount_cents: 'Valor', method: 'Forma',
  total_price_cents: 'Valor', starts_at: 'Horário', cancellation_reason: 'Motivo', item_kind: 'Tipo', item_id: 'Item', mode: 'Cálculo',
  rate: 'Regra', occurred_on: 'Data',
}
const statusLabels: Record<string, string> = {
  pending: 'Pendente', confirmed: 'Confirmado', in_progress: 'Em atendimento', completed: 'Concluído', cancelled: 'Cancelado', no_show: 'Faltou',
  open: 'Aberta', delivered: 'Entregue', paid: 'Pago', refunded: 'Estornado', charged_back: 'Contestado', active: 'Ativo', authorized: 'Ativo',
  past_due: 'Em atraso', paused: 'Pausado', expired: 'Expirado',
}
const methodLabels: Record<string, string> = { cash: 'Dinheiro', pix: 'Pix', card: 'Cartão', other: 'Outro meio', percent: 'Percentual', fixed: 'Valor fixo', service: 'Serviço', product: 'Produto', subscription: 'Assinatura' }

/** Trilha de alterações feitas pela equipe em preços, comandas, pagamentos, planos, contratos e regras. */
export function AuditPanel({ shopId, timezone, members }: { shopId: string; timezone: string; members: Row[] }) {
  const [open, setOpen] = useState(false)
  const [entity, setEntity] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true); setError(null)
    let query = requireSupabase().from('audit_events').select('*').eq('barbershop_id', shopId).order('created_at', { ascending: false }).limit(500)
    if (entity) query = query.eq('entity', entity)
    void query.then(({ data, error: problem }) => {
      if (cancelled) return
      if (problem) { setError(problem.message); setRows([]) } else setRows((data ?? []) as Row[])
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [open, shopId, entity])
  function show(field: string, value: unknown): string {
    if (value == null || value === '') return 'vazio'
    if (field.endsWith('_cents')) return money(value)
    if (typeof value === 'boolean') return value ? 'sim' : 'não'
    if (field === 'starts_at') return shopDateTime(value, timezone)
    if (field === 'occurred_on') return date(value)
    if (field === 'status') return statusLabels[String(value)] || String(value)
    if (field === 'method' || field === 'mode' || field === 'item_kind') return methodLabels[String(value)] || String(value)
    if (field === 'barber_membership_id') return asText(members.find(member => member.id === value)?.display_name)
    if (field.endsWith('_id')) return 'outro registro'
    return String(value)
  }
  function changes(row: Row) {
    const entries = Object.entries((row.changes || {}) as Record<string, [unknown, unknown]>)
    if (!entries.length) return '—'
    return <ul className="audit-changes">{entries.map(([field, [before, after]]) => <li key={field}>
      <span>{fieldLabels[field] || field}</span>
      {row.action === 'insert' ? <b>{show(field, after)}</b> : row.action === 'delete' ? <s>{show(field, before)}</s> : <><s>{show(field, before)}</s><i aria-hidden="true">→</i><b>{show(field, after)}</b></>}
    </li>)}</ul>
  }
  return <Panel title="Auditoria de alterações" subtitle="Quem mudou preços, comandas, pagamentos, planos e regras de comissão, e quando" action={<button type="button" className="button outline" onClick={() => setOpen(true)}><History size={16}/>Ver alterações</button>}>
    <p className="muted audit-hint">Cada mudança feita pela equipe fica registrada com o valor anterior e o novo.</p>
    {open && <Modal wide title="Auditoria de alterações" subtitle="As 500 mudanças mais recentes" onClose={() => setOpen(false)}>
      <div className="audit-toolbar"><select className="panel-select" aria-label="Filtrar por área" value={entity} onChange={event => setEntity(event.target.value)}><option value="">Todas as áreas</option>{Object.entries(entityLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
      <Notice text={error}/>
      {loading ? <Loading text="Carregando alterações..."/> : <DataTable rows={rows} empty="Nenhuma alteração registrada" columns={[
        { key: 'created_at', label: 'Quando', render: row => <span className="num">{shopDateTime(row.created_at, timezone)}</span> },
        { key: 'actor_name', label: 'Quem', render: row => asText(row.actor_name) },
        { key: 'entity', label: 'Onde', render: row => <div className="cell-stack"><strong>{actionLabels[String(row.action)] || ''} {(entityLabels[String(row.entity)] || String(row.entity)).toLowerCase()}</strong>{Boolean(row.label) && <small>{String(row.label)}</small>}</div> },
        { key: 'changes', label: 'O que mudou', render: changes },
      ]}/>}
    </Modal>}
  </Panel>
}
