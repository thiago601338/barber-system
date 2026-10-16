import { useMemo, useState, type FormEvent } from 'react'
import { ArrowLeft, History, Plus, UserRound } from 'lucide-react'
import type { PageProps } from '../App'
import { createRow, updateRow, useRows } from '../lib/useRows'
import { requireSupabase } from '../lib/supabase'
import { asText, cents, date, dateTime, money, today, type Row } from '../types'
import { ClientRecordsPanel } from './ClientRecordsPanel'
import { CrmPanel } from './CrmPanel'
import { LoyaltyPanel } from './LoyaltyPanel'
import { AddButton, DataTable, Field, Loading, Modal, Notice, PageHeader, Panel, PrimaryButton, Status } from '../ui'

type Editor = { id?: string; full_name: string; phone: string; email: string; birth_date: string; notes: string; barber_membership_id: string }
const blank: Editor = { full_name: '', phone: '', email: '', birth_date: '', notes: '', barber_membership_id: '' }

export function ClientsPage(props: PageProps) {
  const [section,setSection] = useState('directory')
  return <div className="page-stack"><div className="segmented"><button className={section==='directory'?'selected':''} onClick={()=>setSection('directory')}>Cadastro e histórico</button><button className={section==='crm'?'selected':''} onClick={()=>setSection('crm')}>CRM e retorno</button><button className={section==='loyalty'?'selected':''} onClick={()=>setSection('loyalty')}>Fidelidade e indicação</button></div>{section==='crm'?<CrmPanel {...props}/>:section==='loyalty'?<LoyaltyPanel {...props}/>:<ClientDirectory {...props}/>}</div>
}

function ClientDirectory({ identity, role, notify }: PageProps) {
  const shopId = identity.shop?.id ?? null
  const [selected, setSelected] = useState<Row | null>(null)
  const clients = useRows('clients', shopId)
  const clientFilter = { client_id: selected?.id || '' }
  const procedures = useRows('procedure_records', shopId, !!selected, 'performed_at', clientFilter)
  const chemicals = useRows('chemical_records', shopId, !!selected, 'performed_at', clientFilter)
  const appointments = useRows('appointments', shopId, !!selected, 'starts_at', clientFilter)
  const members = useRows('memberships', shopId)
  const [search, setSearch] = useState('')
  const [editor, setEditor] = useState<Editor | null>(null)
  const [recordType, setRecordType] = useState<'procedure' | 'chemical' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const filtered = useMemo(() => clients.rows.filter(c => `${c.full_name} ${c.phone} ${c.email}`.toLowerCase().includes(search.toLowerCase())), [clients.rows, search])
  const barberRows = members.rows.filter(row => row.role === 'barber' && row.active)
  async function saveClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editor || !shopId) return
    setBusy(true); setError(null)
    try {
      const values = { full_name: editor.full_name.trim(), phone: editor.phone.trim() || null, email: editor.email.trim() || null, birth_date: editor.birth_date || null, notes: editor.notes.trim() || null }
      const row = editor.id ? await updateRow('clients', editor.id, values) : await createRow('clients', { ...values, barbershop_id: shopId })
      // Keep the saved identity if assigning the barber fails, so retrying cannot create a second client.
      if (!editor.id) setEditor({ ...editor, id: row.id })
      if (editor.barber_membership_id && role !== 'barber') {
        const { error: assignError } = await requireSupabase().from('client_barbers').upsert({ barbershop_id: shopId, client_id: row.id, barber_membership_id: editor.barber_membership_id }, { onConflict: 'barbershop_id,client_id,barber_membership_id' })
        if (assignError) throw new Error(`Cliente salvo, mas a atribuição ao barbeiro falhou: ${assignError.message}`)
      }
      notify(editor.id ? 'Cliente atualizado.' : 'Cliente cadastrado.'); setEditor(null); await clients.refresh()
    } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao salvar cliente.') }
    finally { setBusy(false) }
  }
  if (selected) {
    const person = clients.rows.find(row => row.id === selected.id) || selected
    const ownProcedures = procedures.rows.filter(row => row.client_id === person.id)
    const ownChemicals = chemicals.rows.filter(row => row.client_id === person.id)
    const ownAppointments = appointments.rows.filter(row => row.client_id === person.id)
    return <div className="page-stack"><button className="back-button" onClick={() => setSelected(null)}><ArrowLeft size={17}/> Todos os clientes</button><PageHeader eyebrow="PRONTUÁRIO" title={asText(person.full_name)} description={`${asText(person.phone)} · ${asText(person.email)}`} action={<button className="button outline" onClick={() => setEditor({ id: person.id, full_name: String(person.full_name || ''), phone: String(person.phone || ''), email: String(person.email || ''), birth_date: String(person.birth_date || ''), notes: String(person.notes || ''), barber_membership_id: '' })}>Editar cliente</button>}/><div className="details-grid"><Panel title="Resumo do cliente"><div className="detail-list"><div><span>Cadastrado em</span><strong>{date(person.created_at)}</strong></div><div><span>Atendimentos registrados</span><strong>{ownAppointments.length}</strong></div><div><span>Valores informados dos procedimentos</span><strong>{money(ownProcedures.reduce((sum, row) => sum + Number(row.price_cents || 0), 0))}</strong></div><div><span>Observações</span><strong>{asText(person.notes)}</strong></div></div></Panel><Panel title="Últimas visitas"><DataTable rows={ownAppointments.slice(0, 5)} empty="Nenhuma visita registrada" columns={[{ key: 'starts_at', label: 'Data', render: row => dateTime(row.starts_at) }, { key: 'status', label: 'Status', render: row => <Status value={row.status}/> }]} /></Panel></div><Notice text={appointments.error || procedures.error || chemicals.error}/><Panel title="Histórico de procedimentos" subtitle="Serviços realizados e informações clínicas registradas" action={<AddButton onClick={() => setRecordType('procedure')}>Registrar procedimento</AddButton>}><DataTable rows={ownProcedures} empty="Nenhum procedimento registrado" columns={[{ key: 'performed_at', label: 'Data', render: row => date(row.performed_at) }, { key: 'description', label: 'Procedimento' }, { key: 'price_cents', label: 'Valor', render: row => row.import_price_known===false?'Não informado':money(row.price_cents) }, { key: 'notes', label: 'Observações', render: row => asText(row.notes) }]} /></Panel><Panel title="Histórico de química" subtitle="Fórmulas, produtos e testes de contato" action={<AddButton onClick={() => setRecordType('chemical')}>Registrar química</AddButton>}><DataTable rows={ownChemicals} empty="Nenhum registro de química" columns={[{ key: 'performed_at', label: 'Data', render: row => date(row.performed_at) }, { key: 'product_name', label: 'Produto' }, { key: 'formula', label: 'Fórmula', render: row => asText(row.formula) }, { key: 'patch_test', label: 'Teste', render: row => row.patch_test ? 'Realizado' : 'Não informado' }]} /></Panel><LoyaltyPanel identity={identity} role={role} notify={notify} clientId={person.id}/><ClientRecordsPanel shopId={shopId!} clientId={person.id} timezone={identity.shop?.timezone || 'America/Sao_Paulo'} barbers={barberRows} fixedBarberId={role==='barber'?identity.membership?.id:undefined} procedures={ownProcedures}/>{recordType && <RecordModal type={recordType} shopId={shopId!} clientId={person.id} barberId={role==='barber'?identity.membership?.id:undefined} barbers={barberRows} onClose={() => setRecordType(null)} onSaved={async () => { setRecordType(null); notify('Registro salvo.'); await Promise.all([procedures.refresh(), chemicals.refresh()]) }}/>} {editor && <ClientModal editor={editor} setEditor={setEditor} onSubmit={saveClient} busy={busy} error={error} barberRows={barberRows} role={role}/>}</div>
  }
  return <div className="page-stack"><PageHeader eyebrow="RELACIONAMENTO" title="Clientes" description="Cadastro, histórico de atendimentos e química em um só prontuário." action={<AddButton onClick={() => { setEditor({ ...blank, barber_membership_id: role === 'barber' ? identity.membership?.id || '' : '' }); setError(null) }} data-tour-action="client-create">Novo cliente</AddButton>}/><div className="toolbar"><div className="search-wrap"><UserRound size={17} aria-hidden="true"/><input type="search" aria-label="Buscar clientes por nome, telefone ou e-mail" placeholder="Buscar por nome, telefone ou e-mail" value={search} onChange={e => setSearch(e.target.value)}/></div><span>{filtered.length} cliente{filtered.length === 1 ? '' : 's'}</span></div><Notice text={clients.error || procedures.error || chemicals.error}/>{clients.loading ? <Loading/> : <Panel><DataTable rows={filtered} empty="Nenhum cliente cadastrado" onRowClick={setSelected} columns={[{ key: 'full_name', label: 'Cliente', render: row => <div className="person-cell"><div className="member-avatar">{String(row.full_name || 'C').charAt(0)}</div><div><strong>{asText(row.full_name)}</strong><small>{asText(row.email)}</small></div></div> }, { key: 'phone', label: 'Telefone', render: row => asText(row.phone) }, { key: 'created_at', label: 'Desde', render: row => date(row.created_at) }, { key: 'id', label: 'Histórico', render: () => <span className="table-action"><History size={15}/> Abrir prontuário</span> }]} /></Panel>}{editor && <ClientModal editor={editor} setEditor={setEditor} onSubmit={saveClient} busy={busy} error={error} barberRows={barberRows} role={role}/>}</div>
}

function ClientModal({ editor, setEditor, onSubmit, busy, error, barberRows, role }: { editor: Editor; setEditor: (value: Editor | null) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; busy: boolean; error: string | null; barberRows: Row[]; role: string }) {
  return <Modal title={editor.id ? 'Editar cliente' : 'Novo cliente'} subtitle="Os dados ficam visíveis somente aos usuários autorizados." onClose={() => setEditor(null)}><form className="form-grid" onSubmit={onSubmit} data-tour-form="client-create"><Field label="Nome completo"><input required value={editor.full_name} onChange={e => setEditor({ ...editor, full_name: e.target.value })}/></Field><div className="form-row"><Field label="Telefone"><input value={editor.phone} onChange={e => setEditor({ ...editor, phone: e.target.value })}/></Field><Field label="E-mail"><input type="email" value={editor.email} onChange={e => setEditor({ ...editor, email: e.target.value })}/></Field></div><Field label="Data de nascimento"><input type="date" min="1900-01-01" max={today()} value={editor.birth_date} onChange={e => setEditor({ ...editor, birth_date: e.target.value })}/></Field>{role !== 'barber' && <Field label="Barbeiro responsável"><select value={editor.barber_membership_id} onChange={e => setEditor({ ...editor, barber_membership_id: e.target.value })}><option value="">Sem atribuição</option>{barberRows.map(row => <option key={row.id} value={row.id}>{asText(row.display_name)}</option>)}</select></Field>}<Field label="Observações"><textarea rows={3} value={editor.notes} onChange={e => setEditor({ ...editor, notes: e.target.value })}/></Field><Notice text={error}/><div className="form-actions"><button className="button ghost" type="button" onClick={() => setEditor(null)}>Cancelar</button><PrimaryButton type="submit" disabled={busy}>{busy ? 'Salvando...' : 'Salvar cliente'}</PrimaryButton></div></form></Modal>
}

function RecordModal({ type, shopId, clientId, barberId: fixedBarberId, barbers, onClose, onSaved }: { type: 'procedure' | 'chemical'; shopId: string; clientId: string; barberId?: string; barbers: Row[]; onClose: () => void; onSaved: () => void }) {
  const [barberId,setBarberId]=useState(fixedBarberId||'')
  const [name, setName] = useState('')
  const [secondary, setSecondary] = useState('')
  const [notes, setNotes] = useState('')
  const [price, setPrice] = useState('')
  const [patchTest, setPatchTest] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!barberId) { setError('Escolha um barbeiro responsável antes de registrar.'); return }
    setBusy(true); setError(null)
    try {
      if (type === 'procedure') await createRow('procedure_records', { barbershop_id: shopId, client_id: clientId, barber_membership_id: barberId, description: name.trim(), price_cents: cents(price || '0'), notes: notes.trim() || null, performed_at: new Date().toISOString() })
      else await createRow('chemical_records', { barbershop_id: shopId, client_id: clientId, barber_membership_id: barberId, product_name: name.trim(), formula: secondary.trim() || null, patch_test: patchTest, notes: notes.trim() || null, performed_at: new Date().toISOString() })
      onSaved()
    } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao salvar registro.') }
    finally { setBusy(false) }
  }
  return <Modal title={type === 'procedure' ? 'Registrar procedimento' : 'Registrar química'} onClose={onClose}><form className="form-grid" onSubmit={submit}>{!fixedBarberId && <Field label="Profissional responsável"><select required value={barberId} onChange={e=>setBarberId(e.target.value)}><option value="">Selecione</option>{barbers.map(b=><option key={b.id} value={b.id}>{asText(b.display_name)}</option>)}</select></Field>}<Field label={type === 'procedure' ? 'Procedimento realizado' : 'Produto utilizado'}><input required value={name} onChange={e => setName(e.target.value)}/></Field>{type === 'chemical' ? <><Field label="Fórmula / proporção"><input value={secondary} onChange={e => setSecondary(e.target.value)}/></Field><label className="check-field"><input type="checkbox" checked={patchTest} onChange={e => setPatchTest(e.target.checked)}/> Teste de contato realizado</label></> : <Field label="Valor cobrado (R$)"><input type="number" min="0" step="0.01" value={price} onChange={e => setPrice(e.target.value)}/></Field>}<Field label="Observações"><textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)}/></Field><Notice text={error}/><div className="form-actions"><button className="button ghost" type="button" onClick={onClose}>Cancelar</button><PrimaryButton type="submit" disabled={busy}><Plus size={16}/>{busy ? 'Salvando...' : 'Salvar registro'}</PrimaryButton></div></form></Modal>
}
