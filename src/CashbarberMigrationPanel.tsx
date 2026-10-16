import { useEffect, useState } from 'react'
import { requireSupabase } from './lib/supabase'
import { DataTable, Notice, Panel } from './ui'
import type { Row } from './types'
import { SourceArchiveExplorer } from './SourceArchiveExplorer'

const labels: Record<string,string> = { clients:'Clientes',memberships:'Profissionais',services:'Serviços',products:'Produtos',appointments:'Agendamentos',payments:'Recebimentos',sales:'Comandas',contracts:'Contratos',plans:'Planos',orders:'Comandas',appointment_services:'Procedimentos vinculados',expenses:'Despesas',availability_rules:'Horários',availability_blocks:'Bloqueios de agenda',overdue:'Falhas de cobrança',sales_summary:'Vendas mensais',receivables:'Recebíveis',product_history:'Histórico de produtos' }
interface ImportSummary { datasets:{dataset:string;extracted:number;imported:number;preserved:number;review:number}[]; issues:{dataset:string;source_id:string;issue:string}[];last_import:string|null }
export function CashbarberMigrationPanel({shopId}:{shopId:string}) {
  const [summary,setSummary]=useState<ImportSummary|null>(null),[error,setError]=useState<string|null>(null)
  useEffect(()=>{let cancelled=false;void requireSupabase().rpc('cashbarber_import_summary',{p_barbershop_id:shopId}).then(({data,error})=>{if(cancelled)return;if(error)setError(error.message);else setSummary(data as ImportSummary)});return()=>{cancelled=true}},[shopId])
  if(error)return <Notice text={error}/>
  if(!summary?.datasets.length)return null
  return <><Panel title="Migração do Cashbarber" subtitle="Conferência dos registros extraídos e incorporados nesta barbearia">
    <div className="import-summary-grid">{summary.datasets.map(item=><div key={item.dataset}><span>{labels[item.dataset]||item.dataset}</span><strong>{(item.imported+item.preserved).toLocaleString('pt-BR')}</strong><small>{item.extracted.toLocaleString('pt-BR')} extraídos · {item.imported.toLocaleString('pt-BR')} integrados{item.preserved?` · ${item.preserved.toLocaleString('pt-BR')} preservados`:''}{item.review?` · ${item.review} para revisão`:''}</small></div>)}</div>
    <p className="panel-footnote">Profissionais importados preservam o histórico e não possuem acesso até serem convidados. Valores e procedimentos ausentes na origem aparecem como não informados. Contratos legados não ativam cobranças no Mercado Pago.</p>
    {!!summary.issues.length && <DataTable rows={summary.issues.map(item=>({...item,id:item.dataset+':'+item.source_id})) as Row[]} empty="Nenhuma divergência" columns={[{key:'dataset',label:'Origem',render:r=>labels[String(r.dataset)]||String(r.dataset)},{key:'source_id',label:'ID no Cashbarber'},{key:'issue',label:'Revisão necessária',render:r=>String(r.issue).includes('appointments_no_barber_overlap')?'Agendamento com conflito de horário na origem. Preservado para revisão.':String(r.issue)}]}/>}
  </Panel><SourceArchiveExplorer shopId={shopId}/></>
}
