import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { Camera, Check, Copy, CreditCard, MailPlus, ShieldCheck, Trash2 } from 'lucide-react'
import type { PageProps } from '../App'
import { TeamAvatar, teamAvatarUrl } from '../TeamAvatar'
import { validateProductImageChoice, verifyImageSignature } from '../lib/productImages'
import { authedApi, authedGet, requireSupabase } from '../lib/supabase'
import { useRows } from '../lib/useRows'
import { asText, moduleLabels, type ModuleKey, type Row } from '../types'
import { AddButton, DataTable, Field, Modal, Notice, PageHeader, Panel, PrimaryButton, Status } from '../ui'

type PermissionKey = ModuleKey
type InviteResponse = { ok: boolean; invited: boolean; delivery: 'email' | 'manual_link' | 'existing_account'; email_sent: boolean; invite_url?: string }
const permissionLabels = moduleLabels
const permissionModules = Object.keys(moduleLabels).filter(key => key !== 'settings' && key !== 'tutorial' && key !== 'dashboard' && key !== 'branding') as PermissionKey[]
const imageTypes: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

export function SettingsPage({ identity, role, notify, onRefresh, onGoBranding }: PageProps & { onRefresh: () => Promise<void>; onGoBranding: () => void }) {
  const shop = identity.shop!
  const members = useRows('memberships', shop.id)
  const permissions = useRows('module_permissions', shop.id)
  const [shopForm, setShopForm] = useState({ name: shop.name, phone: shop.phone || '', whatsapp: shop.whatsapp || '', pix_key: '' })
  const [pixReady, setPixReady] = useState(false)
  const [invite, setInvite] = useState(false)
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [inviteForm, setInviteForm] = useState({ email: '', role: 'barber', display_name: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedBarber, setSelectedBarber] = useState<Row | null>(null)
  const [photoMember, setPhotoMember] = useState<Row | null>(null)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const admin = role === 'admin' || role === 'master'
  const canConnectMp = identity.membership?.role === 'admin'
  const [mpConnection, setMpConnection] = useState<{ connected: boolean; configured: boolean } | null>(null)
  const [mpError, setMpError] = useState(false)
  useEffect(() => () => { if (photoPreview) URL.revokeObjectURL(photoPreview) }, [photoPreview])
  useEffect(() => {
    setShopForm({ name: shop.name, phone: shop.phone || '', whatsapp: shop.whatsapp || '', pix_key: '' })
    setPixReady(false)
    setMpConnection(null)
    setMpError(false)
    setSelectedBarber(null)
    setPhotoMember(null)
    setPhotoFile(null)
    setPhotoPreview(null)
    setInvite(false)
    setInviteUrl(null)
    setError(null)
  }, [shop.id])
  useEffect(() => {
    if (!admin) return
    let cancelled = false
    void requireSupabase().rpc('shop_financial_settings', { p_barbershop_id: shop.id }).then(({ data, error: settingsError }) => {
      if (cancelled) return
      if (settingsError) setError(settingsError.message)
      else { setShopForm(previous => ({ ...previous, pix_key: String((data as { pix_key?: string | null })?.pix_key || '') })); setPixReady(true) }
    })
    return () => { cancelled = true }
  }, [admin, shop.id])
  useEffect(() => { if (!canConnectMp) return; let cancelled = false; void authedGet<{ connected: boolean; configured: boolean }>(`/api/mercadopago/connection?barbershop_id=${encodeURIComponent(shop.id)}`).then(data => { if (!cancelled) { setMpConnection({ connected: data.connected === true, configured: data.configured === true }); setMpError(false) } }).catch(err => { if (!cancelled) { setMpError(true); setError(err instanceof Error ? err.message : 'Não foi possível consultar Mercado Pago.') } }); return () => { cancelled = true } }, [canConnectMp, shop.id])
  async function connectMp() { setSaving(true); setError(null); try { const result = await authedApi<{ authorization_url: string }>('/api/mercadopago/oauth-start', { barbershop_id: shop.id }); if (!result.authorization_url) throw new Error('O provedor não retornou o endereço de autorização.'); window.location.assign(result.authorization_url) } catch (err) { setError(err instanceof Error ? err.message : 'Conexão indisponível.') } finally { setSaving(false) } }
  async function saveShop(event: FormEvent) { event.preventDefault(); setSaving(true); setError(null); try { const { error } = await requireSupabase().from('barbershops').update({ name: shopForm.name.trim(), phone: shopForm.phone.trim() || null, whatsapp: shopForm.whatsapp.trim() || null, ...(pixReady ? { pix_key: shopForm.pix_key.trim() || null } : {}) }).eq('id', shop.id); if (error) throw error; notify('Dados da barbearia atualizados.'); await onRefresh() } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao salvar.') } finally { setSaving(false) } }
  async function inviteMember(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(null); setInviteUrl(null)
    try {
      const result = await authedApi<InviteResponse>('/api/admin/invite', { barbershop_id: shop.id, email: inviteForm.email.trim(), role: inviteForm.role, display_name: inviteForm.display_name.trim() || null })
      if (result.delivery === 'manual_link' && result.invite_url?.startsWith('https://')) {
        setInviteUrl(result.invite_url)
        notify('Acesso criado. Copie o link abaixo; o e-mail não foi enviado.')
      } else if (result.delivery === 'email' && result.email_sent) {
        notify('Convite enviado por e-mail e acesso cadastrado.'); setInvite(false)
      } else if (result.delivery === 'existing_account') {
        notify('Acesso cadastrado. A pessoa já tem conta e pode entrar com sua senha.'); setInvite(false)
      } else throw new Error('O resultado do convite não foi confirmado. Confira a equipe antes de tentar novamente.')
      void members.refresh().catch(() => { /* The invite result remains available even if this list refresh fails. */ })
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível criar o convite.') }
    finally { setSaving(false) }
  }
  async function copyInviteUrl() {
    if (!inviteUrl) return
    try { await navigator.clipboard.writeText(inviteUrl); notify('Link do convite copiado.') }
    catch { setError('Não foi possível copiar automaticamente. Selecione o link abaixo e copie manualmente.') }
  }
  async function togglePermission(module: PermissionKey, allowed: boolean) { if (!selectedBarber) return; setSaving(true); setError(null); try { await authedApi('/api/admin/permission', { barbershop_id: shop.id, user_id: selectedBarber.user_id, module, allowed }); await permissions.refresh(); notify(`Acesso a ${permissionLabels[module]} ${allowed ? 'liberado' : 'removido'}.`) } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao alterar permissão.') } finally { setSaving(false) } }
  function selectPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null
    setError(null)
    if (!file) { setPhotoFile(null); setPhotoPreview(null); return }
    try { validateProductImageChoice(file) }
    catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Imagem inválida.')
      setPhotoFile(null)
      setPhotoPreview(null)
      event.target.value = ''
      return
    }
    setPhotoFile(file)
    setPhotoPreview(URL.createObjectURL(file))
  }
  function closePhoto() { setPhotoMember(null); setPhotoFile(null); setPhotoPreview(null); setError(null) }
  async function savePhoto(event: FormEvent) {
    event.preventDefault()
    if (!photoMember || !photoFile || !admin) return
    if (!members.rows.some(member => member.id === photoMember.id && member.barbershop_id === shop.id)) { setError('Este integrante não pertence à barbearia selecionada.'); return }
    setSaving(true); setError(null)
    const oldPath = teamAvatarUrl(photoMember.avatar_path, shop.id, photoMember.id) ? String(photoMember.avatar_path) : null
    const path = `${shop.id}/team/${photoMember.id}/${crypto.randomUUID()}.${imageTypes[photoFile.type]}`
    try {
      validateProductImageChoice(photoFile)
      await verifyImageSignature(photoFile)
      const client = requireSupabase()
      const uploaded = await client.storage.from('shop-assets').upload(path, photoFile, { contentType: photoFile.type, upsert: false })
      if (uploaded.error) throw uploaded.error
      const updated = await client.from('memberships').update({ avatar_path: path }).eq('barbershop_id', shop.id).eq('id', photoMember.id).select('id').single()
      if (updated.error) { await client.storage.from('shop-assets').remove([path]); throw updated.error }
      const cleanup = oldPath ? await client.storage.from('shop-assets').remove([oldPath]) : null
      await members.refresh()
      closePhoto()
      notify(cleanup?.error ? 'Foto atualizada. A limpeza do arquivo anterior ficou pendente.' : 'Foto do integrante atualizada.')
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível salvar a foto.') }
    finally { setSaving(false) }
  }
  async function removePhoto() {
    if (!photoMember || !admin) return
    setSaving(true); setError(null)
    try {
      const client = requireSupabase()
      const oldPath = teamAvatarUrl(photoMember.avatar_path, shop.id, photoMember.id) ? String(photoMember.avatar_path) : null
      const updated = await client.from('memberships').update({ avatar_path: null }).eq('barbershop_id', shop.id).eq('id', photoMember.id).select('id').single()
      if (updated.error) throw updated.error
      const cleanup = oldPath ? await client.storage.from('shop-assets').remove([oldPath]) : null
      await members.refresh()
      closePhoto()
      notify(cleanup?.error ? 'Foto removida do perfil. A limpeza do arquivo anterior ficou pendente.' : 'Foto removida.')
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível remover a foto.') }
    finally { setSaving(false) }
  }
  const barbers = members.rows.filter(row => row.role === 'barber')
  const assigned = (userId: unknown, module: string) => permissions.rows.find(row => row.user_id === userId && row.module === module)?.allowed === true
  return <div className="page-stack settings-page">
    <PageHeader eyebrow="CONTROLE E ACESSO" title="Configurações" description="Informações da barbearia, equipe e permissões por aba e por profissional."/>
    <Notice text={members.error || permissions.error || error}/>
    <div className="dashboard-grid">
      <Panel title="Dados da barbearia" subtitle="Usados na página pública e nas integrações">
        <form className="form-grid" onSubmit={saveShop}>
          <Field label="Nome"><input required value={shopForm.name} disabled={!admin} onChange={event => setShopForm({ ...shopForm, name: event.target.value })}/></Field>
          <div className="form-row">
            <Field label="Telefone"><input value={shopForm.phone} disabled={!admin} onChange={event => setShopForm({ ...shopForm, phone: event.target.value })}/></Field>
            <Field label="WhatsApp"><input value={shopForm.whatsapp} disabled={!admin} onChange={event => setShopForm({ ...shopForm, whatsapp: event.target.value })}/></Field>
          </div>
          <div className="brand-settings-jump">
            <div><strong>Instagram e identidade visual</strong><p>Cadastre o perfil, peça a análise da IA e publique a aparência da barbearia na aba Identidade visual.</p></div>
            <button type="button" className="button outline" onClick={onGoBranding}>Abrir identidade visual</button>
          </div>
          <Field label="Chave Pix informativa" hint="Cadastrar uma chave não ativa cobrança automática nem confirma pagamento."><input value={shopForm.pix_key} disabled={!admin || !pixReady} onChange={event => setShopForm({ ...shopForm, pix_key: event.target.value })}/></Field>
          {admin && <PrimaryButton type="submit" disabled={saving}>{saving ? 'Salvando...' : 'Salvar dados'}</PrimaryButton>}
        </form>
      </Panel>
      <Panel title="Pagamento da barbearia" subtitle="Assinaturas de clientes recebem na conta própria">
        <div className="integration-box">
          <div className="integration-icon"><CreditCard size={24}/></div>
          <strong>Mercado Pago</strong>
          <p>A integração da conta da barbearia habilita a cobrança de assinaturas conforme os meios confirmados no checkout. A mensalidade de uso do sistema é cobrada separadamente pelo administrador master.</p>
          <span className={`status ${mpConnection?.connected ? 'good' : 'warn'}`}>
            {!canConnectMp ? 'Conexão gerenciada pelo admin da barbearia' : mpError ? 'Não foi possível verificar a integração' : mpConnection === null ? 'Verificando integração' : !mpConnection.configured ? 'Integração aguardando ativação na plataforma' : mpConnection.connected ? 'Conta conectada' : 'Conta não conectada'}
          </span>
          {canConnectMp && !mpError && mpConnection?.configured && !mpConnection.connected && <button className="button outline" type="button" onClick={() => void connectMp()} disabled={saving}>Conectar Mercado Pago</button>}
        </div>
      </Panel>
    </div>
    <Panel title="Equipe" subtitle="Profissionais e administradores com acesso por e-mail" action={admin && <AddButton onClick={() => { setInviteUrl(null); setError(null); setInvite(true) }}>Convidar pessoa</AddButton>}>
      <DataTable rows={members.rows} empty="Nenhum integrante cadastrado" columns={[
        { key: 'display_name', label: 'Integrante', render: row => <div className="person-cell"><TeamAvatar path={row.avatar_path} name={String(row.display_name || 'B')} shopId={shop.id} memberId={row.id}/><strong>{asText(row.display_name)}</strong></div> },
        { key: 'role', label: 'Perfil', render: row => row.role === 'admin' ? 'Administrador' : 'Barbeiro' },
        { key: 'active', label: 'Status', render: row => <Status value={row.active ? 'active' : 'paused'}/> },
        { key: 'photo', label: 'Foto', render: row => admin ? <button type="button" className="table-action-button" onClick={() => { setPhotoMember(row); setPhotoFile(null); setPhotoPreview(null); setError(null) }}><Camera size={15}/> {row.avatar_path ? 'Trocar' : 'Adicionar'}</button> : null },
        { key: 'id', label: 'Permissões', render: row => admin && row.role === 'barber' ? <button type="button" className="table-action-button" onClick={() => setSelectedBarber(row)}><ShieldCheck size={15}/> Configurar</button> : null },
      ]}/>
    </Panel>
    {admin && <Panel title="Permissões individuais" subtitle="Cada aba pode ser liberada separadamente para cada barbeiro">
      <div className="permission-overview">
        {barbers.length ? barbers.map(row => <button key={row.id} className="permission-person" onClick={() => setSelectedBarber(row)}><TeamAvatar path={row.avatar_path} name={String(row.display_name || 'B')} shopId={shop.id} memberId={row.id}/><span><strong>{asText(row.display_name)}</strong><small>{permissionModules.filter(module => assigned(row.user_id, module)).length} abas liberadas</small></span><ShieldCheck size={18}/></button>) : <p className="muted">Convide um barbeiro para definir seus acessos.</p>}
      </div>
    </Panel>}
    {invite && <Modal title="Convidar integrante" subtitle={inviteUrl ? 'Acesso criado; compartilhe o link com a pessoa convidada.' : 'Cadastre o acesso por e-mail e senha.'} onClose={() => { setInvite(false); setInviteUrl(null) }}>
      {inviteUrl ? <div className="form-grid invite-manual-link">
        <Notice kind="info" text="E-mail não enviado. Compartilhe o link somente com a pessoa convidada. O link é de uso único e tem prazo limitado."/>
        <Field label="Link individual de convite"><input readOnly value={inviteUrl} onFocus={event => event.currentTarget.select()}/></Field>
        <div className="form-actions"><button type="button" className="button outline" onClick={() => void copyInviteUrl()}><Copy size={16}/> Copiar link</button><button type="button" className="button primary" onClick={() => { setInvite(false); setInviteUrl(null) }}>Concluir</button></div>
      </div> : <form className="form-grid" onSubmit={inviteMember}>
        <Field label="E-mail"><input type="email" required value={inviteForm.email} onChange={event => setInviteForm({ ...inviteForm, email: event.target.value })}/></Field>
        <Field label="Nome exibido"><input value={inviteForm.display_name} onChange={event => setInviteForm({ ...inviteForm, display_name: event.target.value })}/></Field>
        <Field label="Perfil"><select value={inviteForm.role} onChange={event => setInviteForm({ ...inviteForm, role: event.target.value })}><option value="barber">Barbeiro</option><option value="admin">Administrador</option></select></Field>
        <Notice text={error}/>
        <div className="form-actions"><button type="button" className="button ghost" onClick={() => setInvite(false)}>Cancelar</button><PrimaryButton type="submit" disabled={saving}><MailPlus size={16}/>{saving ? 'Criando...' : 'Criar convite'}</PrimaryButton></div>
      </form>}
    </Modal>}
    {photoMember && <Modal title={`Foto de ${asText(photoMember.display_name)}`} subtitle="Aparece para a equipe e na escolha pública do barbeiro." onClose={closePhoto}>
      <form className="form-grid" onSubmit={savePhoto}>
        <div className="team-photo-preview">
          {photoPreview || teamAvatarUrl(photoMember.avatar_path, shop.id, photoMember.id) ? <img src={photoPreview || teamAvatarUrl(photoMember.avatar_path, shop.id, photoMember.id) || undefined} alt={`Foto de ${asText(photoMember.display_name)}`}/> : <TeamAvatar name={String(photoMember.display_name || 'B')}/>}
        </div>
        <Field label="Escolher foto" hint="JPG, PNG ou WebP. Até 2 MB."><input type="file" accept="image/jpeg,image/png,image/webp" onChange={selectPhoto}/></Field>
        <Notice text={error}/>
        <div className="form-actions team-photo-actions">
          {Boolean(photoMember.avatar_path) && <button className="button ghost danger-text" type="button" disabled={saving} onClick={() => void removePhoto()}><Trash2 size={16}/> Remover foto</button>}
          <button className="button ghost" type="button" disabled={saving} onClick={closePhoto}>Cancelar</button>
          <PrimaryButton type="submit" disabled={saving || !photoFile}><Camera size={16}/>{saving ? 'Salvando...' : 'Salvar foto'}</PrimaryButton>
        </div>
      </form>
    </Modal>}
    {selectedBarber && <Modal title={`Acessos de ${asText(selectedBarber.display_name)}`} subtitle="Alterações são salvas no banco e aplicadas pelo controle de acesso." onClose={() => setSelectedBarber(null)}>
      <div className="permission-list">{permissionModules.map(module => { const allowed = assigned(selectedBarber.user_id, module); return <div key={module}><span>{permissionLabels[module]}</span><button className={`permission-toggle ${allowed ? 'on' : ''}`} disabled={saving} onClick={() => void togglePermission(module, !allowed)} aria-label={`${allowed ? 'Remover' : 'Liberar'} ${permissionLabels[module]}`}><span>{allowed && <Check size={13}/>}</span></button></div> })}</div>
      <Notice text={error}/>
    </Modal>}
  </div>
}
