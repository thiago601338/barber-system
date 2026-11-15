import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Search, X } from 'lucide-react'
import type { Row } from '../types'

const fold = (value: unknown) => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const digitsOf = (value: unknown) => String(value ?? '').replace(/\D/g, '')

export function formatPhone(value: unknown): string {
  let digits = digitsOf(value)
  if (digits.length > 11 && digits.startsWith('55')) digits = digits.slice(2)
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`
  return String(value ?? '')
}

/**
 * Clientes que batem com o que foi digitado: nome (sem acento, qualquer parte, cada palavra) ou
 * telefone (a partir de 3 dígitos, em qualquer formato, com ou sem 55). Quem começa com o termo vem primeiro.
 */
export function searchClients({ clients, term, limit = 8 }: { clients: Row[]; term: string; limit?: number }): Row[] {
  const text = fold(term)
  if (!text) return []
  const digits = digitsOf(term)
  const words = text.split(/\s+/).filter(Boolean)
  const byPhone = digits.length >= 3 && digits.length === text.replace(/[\s()+\-.]/g, '').length
  const scored: { row: Row; score: number }[] = []
  for (const row of clients) {
    const name = fold(row.full_name)
    let phone = digitsOf(row.phone)
    if (phone.startsWith('55') && phone.length > 11) phone = phone.slice(2)
    let score = -1
    if (byPhone) {
      // O termo pode vir com o 55 do país na frente (+55 82 9...).
      const queries = digits.startsWith('55') && digits.length >= 5 ? [digits, digits.slice(2)] : [digits]
      const query = queries.find(item => phone.includes(item))
      if (query) score = phone.startsWith(query) || phone.slice(2).startsWith(query) ? 0 : 1
    }
    else if (words.every(word => name.includes(word))) score = name.startsWith(text) ? 0 : name.split(/\s+/).some(part => part.startsWith(words[0])) ? 1 : 2
    if (score >= 0) scored.push({ row, score })
  }
  return scored.sort((a, b) => a.score - b.score || fold(a.row.full_name).localeCompare(fold(b.row.full_name), 'pt-BR')).slice(0, limit).map(item => item.row)
}

/** Campo de cliente com busca por nome ou telefone. */
export function ClientSearch({ clients, value, onChange, autoFocus }: { clients: Row[]; value: string; onChange: (id: string) => void; autoFocus?: boolean }) {
  const selected = clients.find(row => row.id === value) || null
  const [term, setTerm] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const results = useMemo(() => searchClients({ clients, term }), [clients, term])
  function choose(row: Row) { onChange(String(row.id)); setTerm(''); setOpen(false) }
  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActive(index => Math.min(index + 1, results.length - 1)) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => Math.max(index - 1, 0)) }
    else if (event.key === 'Enter' && open && results[active]) { event.preventDefault(); choose(results[active]) }
    else if (event.key === 'Escape') setOpen(false)
  }
  if (selected) return <div className="client-search chosen">
    <div><strong>{String(selected.full_name || 'Cliente')}</strong>{selected.phone ? <small>{formatPhone(selected.phone)}</small> : null}</div>
    <button type="button" className="icon-button" aria-label="Trocar cliente" onClick={() => { onChange(''); setTimeout(() => input.current?.focus(), 0) }}><X size={15}/></button>
  </div>
  return <div className="client-search">
    <Search size={15} aria-hidden="true"/>
    <input ref={input} type="search" autoFocus={autoFocus} autoComplete="off" role="combobox" aria-expanded={open && term.trim() !== ''} aria-autocomplete="list"
      placeholder="Digite o nome ou o telefone" value={term}
      onChange={event => { setTerm(event.target.value); setOpen(true); setActive(0) }}
      onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onKeyDown={onKey}/>
    {open && term.trim() !== '' && <ul className="client-search-list" role="listbox">
      {results.length ? results.map((row, index) => <li key={String(row.id)} role="option" aria-selected={index === active}
        className={index === active ? 'on' : ''} onMouseDown={event => { event.preventDefault(); choose(row) }} onMouseEnter={() => setActive(index)}>
        <strong>{String(row.full_name || 'Cliente')}</strong><small>{row.phone ? formatPhone(row.phone) : 'Sem telefone'}</small>
      </li>) : <li className="empty">Nenhum cliente com esse nome ou telefone.</li>}
    </ul>}
  </div>
}
