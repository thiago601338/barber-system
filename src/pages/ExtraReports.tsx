import { useEffect, useState, type ReactNode } from 'react'
import { ArrowDownToLine, MessageCircle } from 'lucide-react'
import { downloadCsv } from '../lib/csv'
import { requireSupabase } from '../lib/supabase'
import { shopDateTime } from '../lib/shopTime'
import { whatsappUrl } from '../lib/whatsapp'
import { asText, date, money, type Row } from '../types'
import { DataTable, Loading, Notice, Panel, Status } from '../ui'
import '../styles-extras.css'

export type ExtraReportKind = 'services' | 'origin' | 'refunds' | 'birthdays' | 'absent' | 'acquisition' | 'frequency'

export const financeReportOptions: [string, string][] = [
  ['payments', 'Movimentações e ticket'], ['services', 'Serviços por período'], ['origin', 'Origem dos agendamentos'], ['refunds', 'Estornos'],
]
export const clientReportOptions: [string, string][] = [
  ['overview', 'Novos clientes e retorno'], ['birthdays', 'Aniversariantes'], ['absent', 'Clientes ausentes'], ['acquisition', 'Captação de clientes'], ['frequency', 'Frequência dos clientes'],
]

const originLabels: Record<string, string> = { reception: 'Recepção', app: 'App do cliente', site: 'Site', whatsapp: 'WhatsApp', unknown: 'Sem origem registrada' }
const refundOrigins: Record<string, string> = { subscription: 'Assinatura', sale: 'Comanda', appointment: 'Agendamento', other: 'Outro' }
const methodLabels: Record<string, string> = { cash: 'Dinheiro', pix: 'Pix', card: 'Cartão', other: 'Outro meio' }
const number = (value: unknown) => Number(value || 0)
const first = (name: unknown) => String(name || '').trim().split(/\s+/)[0] || ''
const percent = (part: number, total: number) => total > 0 ? `${(part / total * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '—'
const brNumber = (value: unknown) => number(value).toLocaleString('pt-BR')
const csvMoney = (cents: unknown) => (number(cents) / 100).toFixed(2).replace('.', ',')
const shortDay = (value: unknown) => String(value || '').slice(8, 10) + '/' + String(value || '').slice(5, 7)

function Contact({ phone, message, label }: { phone: unknown; message: string; label: string }) {
  const link = whatsappUrl(phone, message)
  return link ? <a className="whatsapp-link" href={link} target="_blank" rel="noreferrer"><MessageCircle size={14}/>{label}</a> : <span className="muted">Sem telefone</span>
}

function Share({ part, total }: { part: number; total: number }) {
  const ratio = total > 0 ? Math.min(100, part / total * 100) : 0
  return <span className="share-bar"><span className="share-track" aria-hidden="true"><i style={{ width: `${ratio}%` }}/></span><b>{percent(part, total)}</b></span>
}

interface Acquisition { total: number; sources: Row[]; referrers: Row[]; clients: Row[] }

/** Relatórios extras da aba de relatórios, todos alimentados pela mesma consulta (report_extra). */
export function ExtraReport({ kind, shopId, shopName, timezone, from, to, barberId, admin }: {
  kind: ExtraReportKind; shopId: string; shopName: string; timezone: string; from: string; to: string; barberId: string; admin: boolean
}) {
  const [days, setDays] = useState(45)
  const [data, setData] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    void requireSupabase().rpc('report_extra', {
      p_barbershop_id: shopId, p_kind: kind, p_from: from, p_to: to,
      p_barber_membership_id: ['services', 'origin', 'frequency'].includes(kind) && barberId ? barberId : null,
      p_days: kind === 'absent' ? days : null,
    }).then(({ data: result, error: problem }) => {
      if (cancelled) return
      if (problem) { setError(problem.message === 'Report access denied' ? 'Seu acesso não inclui este relatório.' : problem.message); setData(null) }
      else setData(result)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [shopId, kind, from, to, barberId, days])

  const rows = Array.isArray(data) ? data as Row[] : []
  const period = `${date(from)} a ${date(to)}`
  const csvButton = (name: string, header: string[], lines: unknown[][]) => lines.length > 0 && <button className="button outline" onClick={() => downloadCsv(`${name}-${from}-${to}.csv`, [header, ...lines])}><ArrowDownToLine size={16}/> Baixar CSV</button>
  let body: ReactNode = null

  if (loading) body = <Loading text="Calculando relatório..."/>
  else if (error) body = null
  else if (kind === 'services') {
    const total = rows.reduce((sum, row) => sum + number(row.quantity), 0)
    const revenue = rows.reduce((sum, row) => sum + number(row.revenue_cents), 0)
    body = <Panel title="Serviços por período" subtitle={`${brNumber(total)} serviço(s) realizados · ${money(revenue)} cobrados fora dos planos · ${period}`}
      action={csvButton('servicos', ['Serviço', 'Categoria', 'Realizados', 'Pelo plano', 'Clientes', 'Valor cobrado (R$)'], rows.map(row => [row.name, row.category || '', row.quantity, row.plan_covered, row.clients, csvMoney(row.revenue_cents)]))}>
      <DataTable rows={rows} empty="Nenhum serviço concluído no período" columns={[
        { key: 'name', label: 'Serviço', render: row => <div className="cell-stack"><strong>{asText(row.name)}</strong>{Boolean(row.category) && <small>{String(row.category)}</small>}</div> },
        { key: 'quantity', label: 'Realizados', render: row => <span className="num">{brNumber(row.quantity)}</span> },
        { key: 'plan_covered', label: 'Pelo plano', render: row => <span className="num">{brNumber(row.plan_covered)}</span> },
        { key: 'clients', label: 'Clientes', render: row => <span className="num">{brNumber(row.clients)}</span> },
        { key: 'revenue_cents', label: 'Valor cobrado', render: row => <span className="num">{money(row.revenue_cents)}</span> },
        { key: 'id', label: 'Participação', render: row => <Share part={number(row.quantity)} total={total}/> },
      ]}/>
    </Panel>
  } else if (kind === 'origin') {
    const total = rows.reduce((sum, row) => sum + number(row.total), 0)
    body = <Panel title="Origem dos agendamentos" subtitle={`${brNumber(total)} agendamento(s) · ${period}`}
      action={csvButton('origem-agendamentos', ['Origem', 'Agendamentos', 'Concluídos', 'Cancelados', 'Faltas', 'Recebido (R$)'], rows.map(row => [originLabels[String(row.origin)] || row.origin, row.total, row.completed, row.cancelled, row.no_show, row.paid_cents == null ? '' : csvMoney(row.paid_cents)]))}>
      <DataTable rows={rows} empty="Nenhum agendamento no período" columns={[
        { key: 'origin', label: 'Origem', render: row => <strong>{originLabels[String(row.origin)] || asText(row.origin)}</strong> },
        { key: 'total', label: 'Agendamentos', render: row => <span className="num">{brNumber(row.total)}</span> },
        { key: 'completed', label: 'Concluídos', render: row => <span className="num">{brNumber(row.completed)}</span> },
        { key: 'cancelled', label: 'Cancelados', render: row => <span className="num">{brNumber(row.cancelled)}</span> },
        { key: 'no_show', label: 'Faltas', render: row => <span className="num">{brNumber(row.no_show)}</span> },
        ...(admin ? [{ key: 'paid_cents', label: 'Recebido', render: (row: Row) => <span className="num">{money(row.paid_cents)}</span> }] : []),
        { key: 'id', label: 'Participação', render: row => <Share part={number(row.total)} total={total}/> },
      ]}/>
      <p className="panel-footnote">Recepção reúne o que a equipe agenda; App do cliente, o que o próprio cliente reserva. Horários importados sem essa informação ficam em “Sem origem registrada”.</p>
    </Panel>
  } else if (kind === 'refunds') {
    const total = rows.reduce((sum, row) => sum + number(row.amount_cents), 0)
    body = <Panel title="Estornos e devoluções" subtitle={`${rows.length} registro(s) · ${money(total)} devolvidos · ${period}`}
      action={csvButton('estornos', ['Estornado em', 'Cliente', 'Origem', 'Forma', 'Valor (R$)', 'Motivo', 'Registrado por'], rows.map(row => [shopDateTime(row.refunded_at, timezone), row.client_name || '', refundOrigins[String(row.origin)], methodLabels[String(row.method)] || '', csvMoney(row.amount_cents), row.reason || '', row.actor_name || '']))}>
      <DataTable rows={rows} empty="Nenhum estorno no período" columns={[
        { key: 'refunded_at', label: 'Estornado em', render: row => shopDateTime(row.refunded_at, timezone) },
        { key: 'client_name', label: 'Cliente', render: row => asText(row.client_name) },
        { key: 'origin', label: 'Origem', render: row => refundOrigins[String(row.origin)] || '—' },
        { key: 'method', label: 'Forma', render: row => methodLabels[String(row.method)] || '—' },
        { key: 'amount_cents', label: 'Valor', render: row => <span className="num">{money(row.amount_cents)}</span> },
        { key: 'reason', label: 'Motivo', render: row => row.status === 'charged_back' ? 'Contestação no cartão' : asText(row.reason) },
        { key: 'actor_name', label: 'Registrado por', render: row => asText(row.actor_name) },
      ]}/>
    </Panel>
  } else if (kind === 'birthdays') {
    body = <Panel title="Aniversariantes" subtitle={`${rows.length} cliente(s) fazem aniversário entre ${period}`}
      action={csvButton('aniversariantes', ['Aniversário', 'Cliente', 'Telefone', 'Idade', 'Última visita'], rows.map(row => [date(row.birthday), row.full_name, row.phone || '', row.age, row.last_visit ? date(row.last_visit) : '']))}>
      <DataTable rows={rows} empty="Nenhum aniversariante no período" columns={[
        { key: 'birthday', label: 'Dia', render: row => <div className="cell-stack"><strong className="num">{shortDay(row.birthday)}</strong><small>faz {String(row.age)} anos</small></div> },
        { key: 'full_name', label: 'Cliente', render: row => asText(row.full_name) },
        { key: 'last_visit', label: 'Última visita', render: row => row.last_visit ? date(row.last_visit) : 'Sem visita registrada' },
        { key: 'visits', label: 'Visitas', render: row => <span className="num">{brNumber(row.visits)}</span> },
        { key: 'phone', label: 'Contato', render: row => <Contact phone={row.phone} label="Parabenizar" message={`Olá, ${first(row.full_name)}! A equipe da ${shopName} deseja um feliz aniversário! 🎉`}/> },
      ]}/>
    </Panel>
  } else if (kind === 'absent') {
    body = <Panel title="Clientes ausentes" subtitle={`${rows.length} cliente(s) sem visita há ${days} dias ou mais e sem horário marcado`}
      action={<div className="panel-actions"><select className="panel-select" aria-label="Dias sem visita" value={days} onChange={event => setDays(Number(event.target.value))}>{[30, 45, 60, 90, 120, 180].map(value => <option key={value} value={value}>Há {value} dias ou mais</option>)}</select>{csvButton('clientes-ausentes', ['Cliente', 'Telefone', 'Última visita', 'Dias ausente', 'Visitas', 'Último profissional', 'Assinante'], rows.map(row => [row.full_name, row.phone || '', date(row.last_visit), row.days_absent, row.visits, row.last_barber, row.subscriber ? 'Sim' : 'Não']))}</div>}>
      <DataTable rows={rows} empty="Nenhum cliente ausente nesse critério" columns={[
        { key: 'full_name', label: 'Cliente', render: row => <div className="cell-stack"><strong>{asText(row.full_name)}</strong>{Boolean(row.subscriber) && <small>Assinante</small>}</div> },
        { key: 'last_visit', label: 'Última visita', render: row => date(row.last_visit) },
        { key: 'days_absent', label: 'Ausente há', render: row => <span className="num">{brNumber(row.days_absent)} dias</span> },
        { key: 'visits', label: 'Visitas', render: row => <span className="num">{brNumber(row.visits)}</span> },
        { key: 'last_barber', label: 'Último profissional', render: row => asText(row.last_barber) },
        { key: 'phone', label: 'Contato', render: row => <Contact phone={row.phone} label="Chamar" message={`Olá, ${first(row.full_name)}! Aqui é da ${shopName}. Faz um tempo que você não aparece por aqui. Quer que eu veja um horário para você?`}/> },
      ]}/>
      <p className="panel-footnote">Este relatório não depende do período escolhido: considera a última visita concluída de cada cliente.</p>
    </Panel>
  } else if (kind === 'acquisition') {
    const info = (data && typeof data === 'object' && !Array.isArray(data) ? data : { total: 0, sources: [], referrers: [], clients: [] }) as Acquisition
    const sources = (info.sources || []).map(row => ({ ...row, id: String(row.source) }))
    const referrers = (info.referrers || []).map(row => ({ ...row, id: String(row.name) }))
    body = <>
      <div className="dashboard-grid report-split">
        <Panel title="Como os clientes chegaram" subtitle={`${brNumber(info.total)} cadastro(s) novos · ${period}`}>
          <DataTable rows={sources} empty="Nenhum cliente cadastrado no período" columns={[
            { key: 'source', label: 'Como conheceu', render: row => <strong>{asText(row.source)}</strong> },
            { key: 'clients', label: 'Clientes', render: row => <span className="num">{brNumber(row.clients)}</span> },
            { key: 'visited', label: 'Já atendidos', render: row => <span className="num">{brNumber(row.visited)}</span> },
            { key: 'id', label: 'Participação', render: row => <Share part={number(row.clients)} total={number(info.total)}/> },
          ]}/>
        </Panel>
        <Panel title="Quem mais indicou" subtitle="Nomes informados no cadastro">
          <DataTable rows={referrers} empty="Nenhuma indicação registrada" columns={[
            { key: 'name', label: 'Indicado por', render: row => asText(row.name) },
            { key: 'clients', label: 'Clientes', render: row => <span className="num">{brNumber(row.clients)}</span> },
          ]}/>
        </Panel>
      </div>
      <Panel title="Clientes cadastrados no período" subtitle="Preencha “Como conheceu” no cadastro do cliente para alimentar este relatório"
        action={csvButton('captacao', ['Cadastro', 'Cliente', 'Telefone', 'Como conheceu', 'Indicado por', 'Já atendido'], (info.clients || []).map(row => [date(row.created_at), row.full_name, row.phone || '', row.source || '', row.referred_by || '', row.visited ? 'Sim' : 'Não']))}>
        <DataTable rows={info.clients || []} empty="Nenhum cliente cadastrado no período" columns={[
          { key: 'created_at', label: 'Cadastro', render: row => date(row.created_at) },
          { key: 'full_name', label: 'Cliente', render: row => asText(row.full_name) },
          { key: 'source', label: 'Como conheceu', render: row => asText(row.source) },
          { key: 'referred_by', label: 'Indicado por', render: row => asText(row.referred_by) },
          { key: 'visited', label: 'Atendimento', render: row => row.visited ? <Status value="done"/> : <span className="status">Ainda não veio</span> },
        ]}/>
      </Panel>
    </>
  } else if (kind === 'frequency') {
    const visits = rows.reduce((sum, row) => sum + number(row.visits), 0)
    body = <Panel title="Frequência dos clientes" subtitle={`${rows.length} cliente(s) atendidos · ${brNumber(visits)} atendimento(s) · ${period}`}
      action={csvButton('frequencia', ['Cliente', 'Telefone', 'Atendimentos', 'Dias com visita', 'Intervalo médio (dias)', 'Última visita', 'Assinante', 'Recebido (R$)'], rows.map(row => [row.full_name, row.phone || '', row.visits, row.days, row.interval_days ?? '', date(row.last_visit), row.subscriber ? 'Sim' : 'Não', row.paid_cents == null ? '' : csvMoney(row.paid_cents)]))}>
      <DataTable rows={rows} empty="Nenhum atendimento concluído no período" columns={[
        { key: 'full_name', label: 'Cliente', render: row => <div className="cell-stack"><strong>{asText(row.full_name)}</strong>{Boolean(row.subscriber) && <small>Assinante</small>}</div> },
        { key: 'visits', label: 'Atendimentos', render: row => <span className="num">{brNumber(row.visits)}</span> },
        { key: 'days', label: 'Dias com visita', render: row => <span className="num">{brNumber(row.days)}</span> },
        { key: 'interval_days', label: 'Volta a cada', render: row => row.interval_days == null ? '—' : <span className="num">{number(row.interval_days).toLocaleString('pt-BR')} dias</span> },
        { key: 'last_visit', label: 'Última visita', render: row => date(row.last_visit) },
        ...(admin && !barberId ? [{ key: 'paid_cents', label: 'Recebido', render: (row: Row) => <span className="num">{money(row.paid_cents)}</span> }] : []),
      ]}/>
    </Panel>
  }
  return <><Notice text={error}/>{body}</>
}
