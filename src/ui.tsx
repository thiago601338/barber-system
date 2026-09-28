import { isValidElement, useEffect, useRef, type ReactNode } from 'react'
import { AlertCircle, ArrowUpRight, LoaderCircle, Plus, Search, X } from 'lucide-react'
import type { Row } from './types'

export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="page-header"><div><div className="eyebrow">{eyebrow || 'BARBER SYSTEM'}</div><h1>{title}</h1>{description && <p>{description}</p>}</div>{action && <div className="page-actions">{action}</div>}</div>
}

export function Panel({ title, subtitle, action, children, className = '' }: { title?: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`panel ${className}`}><div className="panel-head">{(title || subtitle) && <div>{title && <h2>{title}</h2>}{subtitle && <p>{subtitle}</p>}</div>}{action}</div>{children}</section>
}

export function Empty({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return <div className="empty"><div className="empty-icon"><Search size={21} /></div><h3>{title}</h3><p>{text}</p>{action}</div>
}

export function Notice({ text, kind = 'error' }: { text: string | null | undefined; kind?: 'error' | 'info' | 'success' }) {
  if (!text) return null
  return <div className={`notice ${kind}`}><AlertCircle size={17}/><span>{text}</span></div>
}

export function Loading({ text = 'Carregando dados...' }: { text?: string }) { return <div className="loading"><LoaderCircle size={20} className="spin"/> {text}</div> }

export function PrimaryButton({ children, onClick, type = 'button', disabled = false }: { children: ReactNode; onClick?: () => void; type?: 'button' | 'submit'; disabled?: boolean }) {
  return <button className="button primary" type={type} onClick={onClick} disabled={disabled}>{children}</button>
}

export function AddButton({ children, onClick }: { children: ReactNode; onClick: () => void }) { return <PrimaryButton onClick={onClick}><Plus size={17}/>{children}</PrimaryButton> }

export function Modal({ title, subtitle, onClose, children, wide = false }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const frame = window.requestAnimationFrame(() => {
      const first = dialogRef.current?.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href]')
      ;(first || dialogRef.current)?.focus()
    })
    function handleKey(event: KeyboardEvent) {
      const dialog = dialogRef.current
      const dialogs = document.querySelectorAll('[role="dialog"]:not([aria-hidden="true"])')
      if (!dialog || dialogs.item(dialogs.length - 1) !== dialog) return
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return }
      if (event.key !== 'Tab') return
      const focusable = [...dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        .filter(element => element.getClientRects().length > 0)
      if (!focusable.length) { event.preventDefault(); dialog.focus(); return }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      else if (!dialog.contains(document.activeElement)) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = previousOverflow
      previousFocus?.focus()
    }
  }, [])
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}><div ref={dialogRef} tabIndex={-1} className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><div className="modal-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={19}/></button></div>{children}</div></div>
}

export function Stat({ label, value, foot, icon }: { label: string; value: string | number; foot?: string; icon?: ReactNode }) {
  return <div className="stat"><div className="stat-top"><span>{label}</span><div className="stat-icon">{icon || <ArrowUpRight size={19}/>}</div></div><strong>{value}</strong><small>{foot || 'Dados atualizados'}</small></div>
}

export function DataTable({ rows, columns, empty, onRowClick }: { rows: Row[]; columns: { key: string; label: string; render?: (row: Row) => ReactNode }[]; empty: string; onRowClick?: (row: Row) => void }) {
  if (rows.length === 0) return <Empty title={empty} text="Os registros aparecerão aqui assim que forem cadastrados." />
  return <div className="table-scroll"><table><thead><tr>{columns.map(column => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.id} className={onRowClick ? 'clickable' : ''} tabIndex={onRowClick ? 0 : undefined} onClick={event => { if (event.target instanceof Element && event.target.closest('button, a, input, select, textarea')) return; onRowClick?.(row) }} onKeyDown={event => { if (event.target !== event.currentTarget) return; if (onRowClick && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onRowClick(row) } }}>{columns.map(column => <td key={column.key}>{column.render ? column.render(row) : String(row[column.key] ?? '—')}</td>)}</tr>)}</tbody></table></div>
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  const directControl = isValidElement(children) && typeof children.type === 'string' && ['input', 'select', 'textarea'].includes(children.type)
  if (directControl) return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
  return <div className="field" role="group" aria-label={label}><span>{label}</span>{children}{hint && <small>{hint}</small>}</div>
}

export function Status({ value }: { value: unknown }) {
  const text = String(value || '—')
  const tone = ['paid', 'active', 'authorized', 'completed', 'confirmed', 'delivered', 'done'].includes(text) ? 'good' : ['pending', 'in_process', 'in_mediation', 'scheduled', 'draft', 'open'].includes(text) ? 'warn' : ['cancelled', 'canceled', 'failed', 'rejected', 'refunded', 'charged_back', 'overdue'].includes(text) ? 'bad' : ''
  const labels: Record<string, string> = { paid: 'Pago', active: 'Ativo', authorized: 'Ativa', completed: 'Concluído', confirmed: 'Confirmado', delivered: 'Entregue', done: 'Feito', pending: 'Pendente', in_process: 'Processando', in_mediation: 'Em análise', scheduled: 'Agendado', draft: 'Rascunho', open: 'Aberto', cancelled: 'Cancelado', canceled: 'Cancelado', failed: 'Falhou', rejected: 'Recusado', refunded: 'Estornado', charged_back: 'Contestado', overdue: 'Vencido', paused: 'Pausado' }
  return <span className={`status ${tone}`}>{labels[text] || text}</span>
}
