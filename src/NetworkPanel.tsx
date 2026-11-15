import { useEffect, useState } from 'react'
import { requireSupabase } from './lib/supabase'
import { date, money, type Identity, type Row } from './types'
import { DataTable, Panel } from './ui'
import './styles-extras.css'

/** Filiais: compara as barbearias em que a pessoa é administradora. Só aparece para quem tem mais de uma. */
export function NetworkPanel({ identity, period }: { identity: Identity; period: { from: string; to: string } }) {
  const adminShops = identity.memberships.filter(member => member.role === 'admin' && member.active).length
  const [rows, setRows] = useState<Row[]>([])
  useEffect(() => {
    if (adminShops < 2) { setRows([]); return }
    let cancelled = false
    void requireSupabase().rpc('network_overview', { p_from: period.from, p_to: period.to }).then(({ data, error }) => {
      if (!cancelled) setRows(error ? [] : (data ?? []) as Row[])
    })
    return () => { cancelled = true }
  }, [adminShops, period.from, period.to])
  if (rows.length < 2) return null
  const total = rows.reduce((sum, row) => sum + Number(row.revenue_cents || 0), 0)
  return <Panel title="Filiais" subtitle={`${rows.length} unidades · ${money(total)} recebidos de ${date(period.from)} a ${date(period.to)}`}>
    <DataTable rows={rows} empty="Nenhuma unidade" columns={[
      { key: 'name', label: 'Unidade', render: row => <div className="cell-stack"><strong>{String(row.name)}</strong>{row.id === identity.shop?.id && <small>Unidade aberta agora</small>}</div> },
      { key: 'revenue_cents', label: 'Recebido', render: row => <span className="num">{money(row.revenue_cents)}</span> },
      { key: 'completed', label: 'Atendimentos', render: row => <span className="num">{Number(row.completed || 0).toLocaleString('pt-BR')}</span> },
      { key: 'active_plans', label: 'Planos ativos', render: row => <span className="num">{Number(row.active_plans || 0).toLocaleString('pt-BR')}</span> },
      { key: 'new_clients', label: 'Novos clientes', render: row => <span className="num">{Number(row.new_clients || 0).toLocaleString('pt-BR')}</span> },
    ]}/>
    <p className="panel-footnote">Para abrir outra unidade, use o seletor de barbearia no topo da tela.</p>
  </Panel>
}
