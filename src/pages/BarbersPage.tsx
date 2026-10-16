import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { Camera, CircleDollarSign, Copy, MailPlus, Power, Scissors, Search, Trash2, UserPlus, Users } from 'lucide-react'
import type { PageProps } from '../App'
import { TeamAvatar, teamAvatarUrl } from '../TeamAvatar'
import { validateProductImageChoice, verifyImageSignature } from '../lib/productImages'
import { authedApi, requireSupabase } from '../lib/supabase'
import { money, type ModuleKey } from '../types'
import { BarberFinancials } from './BarberFinancials'
import { AddButton, Empty, Field, Loading, Modal, Notice, PageHeader, PrimaryButton, Stat } from '../ui'

interface TeamMember {
  membership_id: string
  role: 'admin' | 'barber'
  display_name: string
  active: boolean
  avatar_path: string | null
  has_login: boolean
  email: string | null
  invite_pending: boolean
  last_sign_in_at: string | null
  imported: boolean | null
  created_at: string
  completed_month: number
  completed_total: number
  revenue_month_cents: number
  upcoming_today: number
  work_days: number[]
}
type InviteResponse = { delivery: 'email' | 'manual_link' | 'existing_account'; email_sent: boolean; invite_url?: string }

const dayLabels = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const imageTypes: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
const number = (value: number) => value.toLocaleString('pt-BR')

function statusOf(member: TeamMember): { label: string; tone: 'good' | 'warn' | 'muted' } {
  if (!member.active) return { label: member.imported ? 'Histórico do Cashbarber' : 'Inativo', tone: 'muted' }
  if (!member.has_login) return { label: 'Na agenda · sem login', tone: 'warn' }
  if (member.invite_pending) return { label: 'Convite enviado', tone: 'warn' }
  return { label: 'Ativo', tone: 'good' }
}

export function BarbersPage({ identity, role, notify, onNavigate }: PageProps & { onNavigate?: (page: ModuleKey) => void }) {
  const shop = identity.shop!
  const admin = role === 'admin' || role === 'master'
  const [rows, setRows] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'active' | 'history'>('active')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<TeamMember | null>(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    const { data, error: rpcError } = await requireSupabase().rpc('team_overview', { p_barbershop_id: shop.id })
    if (rpcError) setError(rpcError.message)
    else setRows(((data ?? []) as TeamMember[]).filter(member => member.role === 'barber'))
    setLoading(false)
  }, [shop.id])
  useEffect(() => { void load() }, [load])
  useEffect(() => { if (selected) setSelected(rows.find(member => member.membership_id === selected.membership_id) ?? null) }, [rows]) // eslint-disable-line react-hooks/exhaustive-deps

  const active = rows.filter(member => member.active)
  const history = rows.filter(member => !member.active)
  const visible = useMemo(() => {
    const list = admin ? (tab === 'active' ? active : history) : rows
    const term = query.trim().toLowerCase()
    return term ? list.filter(member => `${member.display_name} ${member.email || ''}`.toLowerCase().includes(term)) : list
  }, [admin, tab, active, history, rows, query])

  return <div className="page-stack barbers-page">
    <PageHeader eyebrow="EQUIPE" title={admin ? 'Barbeiros' : 'Meu perfil'} description={admin ? 'Quem atende na barbearia: foto, contato, acesso ao sistema, dias de trabalho e atendimentos.' : 'Seus dados, seus dias de atendimento e seus números.'} action={admin ? <AddButton onClick={() => setAdding(true)}>Adicionar barbeiro</AddButton> : undefined}/>
    <Notice text={error}/>
    {admin && <div className="stats-grid barbers-stats">
      <Stat label="Barbeiros ativos" value={active.length} foot={`${active.filter(m => m.has_login && !m.invite_pending).length} já entraram no sistema`} icon={<Users size={19}/>}/>
      <Stat label="Faturamento da equipe no mês" value={money(active.reduce((n, m) => n + (m.revenue_month_cents || 0), 0))} foot="Recebido nos atendimentos dos barbeiros ativos" icon={<CircleDollarSign size={19}/>}/>
      <Stat label="Atendimentos no mês" value={number(active.reduce((n, m) => n + m.completed_month, 0))} foot={`${active.reduce((n, m) => n + m.upcoming_today, 0)} agendados para hoje`} icon={<Scissors size={19}/>}/>
      <Stat label="Convites pendentes" value={active.filter(m => m.invite_pending).length} foot="Ainda não fizeram o primeiro acesso" icon={<MailPlus size={19}/>}/>
    </div>}
    {admin && <div className="barbers-toolbar">
      <div className="barbers-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'active'} className={tab === 'active' ? 'on' : ''} onClick={() => setTab('active')}>Ativos <span>{active.length}</span></button>
        <button role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>Histórico <span>{history.length}</span></button>
      </div>
      <label className="barbers-search"><Search size={16}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar por nome ou e-mail" aria-label="Buscar barbeiro"/></label>
    </div>}
    {loading ? <Loading text="Carregando barbeiros..."/> : !visible.length
      ? <Empty title={tab === 'history' ? 'Nenhum barbeiro no histórico' : 'Nenhum barbeiro por aqui'} text={tab === 'history' ? 'Profissionais desativados ou trazidos do sistema antigo aparecem aqui.' : 'Adicione quem atende na barbearia para montar a agenda.'} action={admin && tab === 'active' ? <AddButton onClick={() => setAdding(true)}>Adicionar barbeiro</AddButton> : undefined}/>
      : <div className="barbers-grid">{visible.map(member => { const status = statusOf(member); return <button key={member.membership_id} className={`barber-card ${member.active ? '' : 'inactive'}`} onClick={() => setSelected(member)}>
        <TeamAvatar path={member.avatar_path} name={member.display_name} shopId={shop.id} memberId={member.membership_id} className="barber-card-photo"/>
        <div className="barber-card-body">
          <strong>{member.display_name}</strong>
          <span className={`barber-chip ${status.tone}`}>{status.label}</span>
          <small className="barber-email">{member.email || 'Sem e-mail cadastrado'}</small>
          <div className="barber-days" aria-label="Dias de atendimento">{dayLabels.map((label, day) => <i key={label} className={member.work_days.includes(day) ? 'on' : ''}>{label[0]}</i>)}</div>
        </div>
        <div className="barber-revenue"><span>Rendimento no mês</span><strong>{money(member.revenue_month_cents || 0)}</strong></div>
        <dl className="barber-metrics"><div><dt>No mês</dt><dd>{number(member.completed_month)}</dd></div><div><dt>Hoje</dt><dd>{member.upcoming_today}</dd></div><div><dt>Total</dt><dd>{number(member.completed_total)}</dd></div></dl>
      </button> })}</div>}
    {selected && <BarberProfile member={selected} shopId={shop.id} timezone={shop.timezone || 'America/Sao_Paulo'} admin={admin} onClose={() => setSelected(null)} onChanged={load} notify={notify} onNavigate={admin && onNavigate ? page => { setSelected(null); onNavigate(page) } : undefined}/>}
    {adding && <AddBarber shopId={shop.id} onClose={() => setAdding(false)} onSaved={async () => { setAdding(false); await load() }} notify={notify}/>}
  </div>
}

function InviteLink({ url }: { url: string }) {
  return <div className="barber-invite-link"><Notice kind="info" text="O e-mail não pôde ser enviado agora. Compartilhe este link de uso único só com o barbeiro."/><Field label="Link do convite"><input readOnly value={url} onFocus={event => event.currentTarget.select()}/></Field><button type="button" className="button outline" onClick={() => void navigator.clipboard?.writeText(url)}><Copy size={16}/> Copiar link</button></div>
}

function BarberProfile({ member, shopId, timezone, admin, onClose, onChanged, notify, onNavigate }: { member: TeamMember; shopId: string; timezone: string; admin: boolean; onClose: () => void; onChanged: () => Promise<void>; notify: PageProps['notify']; onNavigate?: (page: ModuleKey) => void }) {
  const [section, setSection] = useState<'finance' | 'profile'>('finance')
  const [name, setName] = useState(member.display_name)
  const [email, setEmail] = useState(member.email || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const status = statusOf(member)
  async function run(task: () => Promise<void>) {
    setBusy(true); setError(null)
    try { await task(); await onChanged() } catch (problem) { setError(problem instanceof Error ? problem.message : (problem as { message?: string })?.message || 'Não foi possível salvar.') } finally { setBusy(false) }
  }
  function saveName(event: FormEvent) {
    event.preventDefault()
    if (name.trim().length < 2) { setError('Informe o nome do barbeiro.'); return }
    void run(async () => { await authedApi('/api/admin/member-update', { barbershop_id: shopId, membership_id: member.membership_id, display_name: name.trim() }); notify('Nome atualizado.') })
  }
  function invite() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('Informe um e-mail válido para enviar o convite.'); return }
    void run(async () => {
      const result = await authedApi<InviteResponse>('/api/admin/invite', { barbershop_id: shopId, email: email.trim(), role: 'barber', display_name: name.trim() || member.display_name })
      if (result.invite_url) setInviteUrl(result.invite_url)
      notify(result.email_sent ? `Convite enviado para ${email.trim()}.` : result.delivery === 'existing_account' ? 'Essa pessoa já tem conta e foi vinculada à barbearia.' : 'Convite criado. Compartilhe o link com o barbeiro.')
    })
  }
  function toggleActive() {
    if (!member.active && !window.confirm(`Ativar ${member.display_name}? Profissionais ativos entram na agenda e contam na mensalidade.`)) return
    void run(async () => { await authedApi('/api/admin/member-update', { barbershop_id: shopId, membership_id: member.membership_id, active: !member.active }); notify(member.active ? 'Barbeiro desativado.' : 'Barbeiro ativado.') })
  }
  function remove() {
    if (!window.confirm(`Excluir ${member.display_name}? Se ele já tiver atendimentos, fica guardado no histórico (desativado) para não perder relatórios e comissões.`)) return
    void (async () => {
      setBusy(true); setError(null)
      try {
        const result = await authedApi<{ deleted: boolean; deactivated?: boolean }>('/api/admin/member-delete', { barbershop_id: shopId, membership_id: member.membership_id })
        notify(result.deleted ? 'Barbeiro excluído.' : `${member.display_name} saiu da equipe, da agenda e dos filtros. Os atendimentos antigos continuam nos relatórios.`)
        onClose()
        await onChanged()
      } catch (problem) { setError(problem instanceof Error ? problem.message : 'Não foi possível excluir.') }
      finally { setBusy(false) }
    })()
  }
  async function changePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    await run(async () => {
      validateProductImageChoice(file)
      await verifyImageSignature(file)
      const client = requireSupabase()
      const oldPath = teamAvatarUrl(member.avatar_path, shopId, member.membership_id) ? member.avatar_path : null
      const path = `${shopId}/team/${member.membership_id}/${crypto.randomUUID()}.${imageTypes[file.type]}`
      const uploaded = await client.storage.from('shop-assets').upload(path, file, { contentType: file.type, upsert: false })
      if (uploaded.error) throw uploaded.error
      const updated = await client.from('memberships').update({ avatar_path: path }).eq('barbershop_id', shopId).eq('id', member.membership_id).select('id').single()
      if (updated.error) { await client.storage.from('shop-assets').remove([path]); throw updated.error }
      if (oldPath) await client.storage.from('shop-assets').remove([oldPath])
      notify('Foto atualizada.')
    })
  }
  const canInvite = admin && (!member.has_login || member.invite_pending)
  const firstName = member.display_name.split(' ')[0]
  return <Modal title={member.display_name} subtitle={status.label} onClose={onClose} wide>
    <div className="barber-profile-hero">
      {section === 'finance' && <TeamAvatar path={member.avatar_path} name={member.display_name} shopId={shopId} memberId={member.membership_id} className="barber-hero-avatar"/>}
      <dl>
        <div><dt>Rendimento no mês</dt><dd>{money(member.revenue_month_cents || 0)}</dd></div>
        <div><dt>Atendimentos no mês</dt><dd>{number(member.completed_month)}</dd></div>
        <div><dt>Agendados hoje</dt><dd>{member.upcoming_today}</dd></div>
        <div><dt>Atendimentos no total</dt><dd>{number(member.completed_total)}</dd></div>
      </dl>
    </div>
    <div className="barbers-tabs barber-profile-tabs" role="tablist">
      <button role="tab" aria-selected={section === 'finance'} className={section === 'finance' ? 'on' : ''} onClick={() => setSection('finance')}>Rendimentos</button>
      <button role="tab" aria-selected={section === 'profile'} className={section === 'profile' ? 'on' : ''} onClick={() => setSection('profile')}>Perfil e acesso</button>
    </div>
    {section === 'finance' ? <BarberFinancials shopId={shopId} timezone={timezone} membershipId={member.membership_id} firstName={firstName} notify={notify} onNavigate={onNavigate}/> :
    <div className="barber-profile">
      <div className="barber-profile-photo">
        <TeamAvatar path={member.avatar_path} name={member.display_name} shopId={shopId} memberId={member.membership_id} className="barber-profile-avatar"/>
        {admin && <label className="button outline barber-photo-button"><Camera size={16}/> {member.avatar_path ? 'Trocar foto' : 'Adicionar foto'}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => void changePhoto(event)} hidden disabled={busy}/></label>}
      </div>
      <div className="barber-profile-info">
        <div className="barber-profile-days"><span>Dias de atendimento</span><div className="barber-days large">{dayLabels.map((label, day) => <i key={label} className={member.work_days.includes(day) ? 'on' : ''}>{label}</i>)}</div><small>Os horários de cada dia ficam em Serviços e horários.</small></div>
        <p className="barber-profile-meta">{member.has_login ? member.last_sign_in_at ? `Último acesso em ${new Date(member.last_sign_in_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` : 'Ainda não fez o primeiro acesso.' : 'Sem acesso ao sistema: aparece na agenda, mas não entra no painel.'}{member.imported ? ' · Cadastro trazido do Cashbarber.' : ''}</p>
        {admin && <form className="form-grid" onSubmit={saveName}>
          <Field label="Nome exibido"><div className="barber-inline"><input value={name} onChange={event => setName(event.target.value)} maxLength={120}/><button className="button outline" type="submit" disabled={busy || name.trim() === member.display_name}>Salvar</button></div></Field>
          <Field label="E-mail" hint={member.has_login && !member.invite_pending ? 'E-mail de acesso ao sistema.' : 'Com o e-mail, o barbeiro recebe o convite para entrar com o próprio acesso.'}><div className="barber-inline"><input type="email" value={email} onChange={event => setEmail(event.target.value)} readOnly={member.has_login && !member.invite_pending}/>{canInvite && <PrimaryButton onClick={invite} disabled={busy}><MailPlus size={16}/>{member.invite_pending ? 'Reenviar convite' : 'Enviar convite'}</PrimaryButton>}</div></Field>
        </form>}
        {!admin && <p className="barber-profile-meta">E-mail: {member.email || '—'}</p>}
        {inviteUrl && <InviteLink url={inviteUrl}/>}
        <Notice text={error}/>
        {admin && <div className="form-actions"><button type="button" className={`button ${member.active ? 'ghost danger-text' : 'outline'}`} onClick={toggleActive} disabled={busy}><Power size={16}/>{member.active ? 'Desativar barbeiro' : 'Ativar barbeiro'}</button><button type="button" className="button ghost danger-text" onClick={remove} disabled={busy}><Trash2 size={16}/>Excluir barbeiro</button></div>}
      </div>
    </div>}
  </Modal>
}

function AddBarber({ shopId, onClose, onSaved, notify }: { shopId: string; onClose: () => void; onSaved: () => Promise<void>; notify: PageProps['notify'] }) {
  const [form, setForm] = useState({ name: '', email: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(null)
    if (form.name.trim().length < 2) { setError('Informe o nome do barbeiro.'); return }
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) { setError('Confira o e-mail.'); return }
    setBusy(true)
    try {
      if (form.email.trim()) {
        const result = await authedApi<InviteResponse>('/api/admin/invite', { barbershop_id: shopId, email: form.email.trim(), role: 'barber', display_name: form.name.trim() })
        notify(result.email_sent ? `Convite enviado para ${form.email.trim()}.` : 'Barbeiro adicionado.')
        if (result.invite_url) { setInviteUrl(result.invite_url); setBusy(false); return }
      } else {
        await authedApi('/api/admin/member-create', { barbershop_id: shopId, display_name: form.name.trim() })
        notify('Barbeiro adicionado à agenda.')
      }
      await onSaved()
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Não foi possível adicionar.'); setBusy(false) }
  }
  return <Modal title="Adicionar barbeiro" subtitle="Ele passa a aparecer na agenda e na página de agendamento." onClose={() => { if (inviteUrl) void onSaved(); else onClose() }}>
    {inviteUrl ? <div className="form-grid"><InviteLink url={inviteUrl}/><div className="form-actions"><PrimaryButton onClick={() => void onSaved()}>Concluir</PrimaryButton></div></div>
      : <form className="form-grid" onSubmit={submit}>
        <Field label="Nome"><input value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} maxLength={120} required/></Field>
        <Field label="E-mail (opcional)" hint="Se informar, o barbeiro recebe um convite para entrar no sistema com o próprio acesso."><input type="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })}/></Field>
        <Notice kind="info" text="Cada barbeiro ativo conta na mensalidade do sistema."/>
        <Notice text={error}/>
        <div className="form-actions"><button type="button" className="button ghost" onClick={onClose}>Cancelar</button><PrimaryButton type="submit" disabled={busy}><UserPlus size={16}/>{busy ? 'Salvando...' : 'Adicionar'}</PrimaryButton></div>
      </form>}
  </Modal>
}
