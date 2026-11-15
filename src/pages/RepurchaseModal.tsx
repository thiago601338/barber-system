import { MessageCircle } from 'lucide-react'
import { whatsappUrl } from '../lib/whatsapp'
import { asText, date, type Row } from '../types'
import { DataTable, Empty, Modal } from '../ui'
import '../styles-extras.css'

/** Clientes cuja última compra de um produto com prazo de recompra já venceu ou vence nos próximos dias. */
export function RepurchaseModal({ rows, shopName, configured, onClose }: { rows: Row[]; shopName: string; configured: boolean; onClose: () => void }) {
  return <Modal wide title="Recompra de produtos" subtitle="Quem já deve estar precisando repor, pela data da última compra e pelo prazo do produto." onClose={onClose}>
    {!configured
      ? <Empty title="Nenhum produto com prazo de recompra" text="Abra um produto e preencha “Prazo de recompra” (por exemplo, 60 dias). Quando o prazo de um cliente vencer, ele aparece aqui."/>
      : <DataTable rows={rows} empty="Nenhuma recompra para os próximos 7 dias" columns={[
        { key: 'client_name', label: 'Cliente', render: row => asText(row.client_name) },
        { key: 'product_name', label: 'Produto', render: row => asText(row.product_name) },
        { key: 'last_purchase', label: 'Última compra', render: row => date(row.last_purchase) },
        { key: 'due_on', label: 'Recompra', render: row => {
          const late = Number(row.days_late || 0)
          return <div className="cell-stack"><strong>{date(row.due_on)}</strong><small>{late > 0 ? `há ${late} dia(s)` : late === 0 ? 'hoje' : `em ${-late} dia(s)`}</small></div>
        } },
        { key: 'phone', label: 'Contato', render: row => {
          const link = whatsappUrl(row.phone, `Olá, ${String(row.client_name || '').trim().split(/\s+/)[0]}! Aqui é da ${shopName}. Você levou ${String(row.product_name)} em ${date(row.last_purchase)} e já deve estar acabando. Quer que eu separe outro para você?`)
          return link ? <a className="whatsapp-link" href={link} target="_blank" rel="noreferrer"><MessageCircle size={14}/>Oferecer</a> : <span className="muted">Sem telefone</span>
        } },
      ]}/>}
  </Modal>
}
