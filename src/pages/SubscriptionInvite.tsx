import { useEffect, useState } from 'react'
import { Copy, ExternalLink, MessageCircle } from 'lucide-react'
import { requireSupabase } from '../lib/supabase'
import { publicShopUrl } from '../lib/publicUrl'
import { inviteMessage, inviteSuffix } from '../lib/subscriptionInvite'
import { asText, money, type Row, type Shop } from '../types'
import { Field, Modal, Notice } from '../ui'

/** Link que a barbearia envia ao cliente para ele mesmo assinar um plano, pela página pública. */
export function InviteLinkModal({ shop, plans, onClose, notify }: { shop: Shop; plans: Row[]; onClose: () => void; notify: (message: string, kind?: 'success' | 'error') => void }) {
  const [planId, setPlanId] = useState('')
  const [ready, setReady] = useState<boolean | null>(null)
  useEffect(() => {
    let cancelled = false
    void Promise.resolve(requireSupabase().rpc('subscription_checkout_ready', { p_barbershop_id: shop.id }))
      .then(({ data, error }) => { if (!cancelled && !error) setReady(data === true) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [shop.id])
  const available = plans.filter(row => row.active)
  const plan = available.find(row => row.id === planId) || null
  const url = publicShopUrl(shop.slug, inviteSuffix(plan ? String(plan.id) : null))
  const message = inviteMessage({ shopName: shop.name, planName: plan ? asText(plan.name) : null, url })
  async function copy() {
    try { await navigator.clipboard.writeText(url); notify('Link de convite copiado.') }
    catch { notify('Não foi possível copiar. Selecione o link e copie manualmente.', 'error') }
  }
  return <Modal title="Link de convite" subtitle="Envie ao cliente. Ele abre o link, entra na conta dele e conclui a assinatura." onClose={onClose}>
    <div className="form-grid">
      <Field label="Plano do convite"><select value={planId} onChange={event => setPlanId(event.target.value)}><option value="">Todos os planos (o cliente escolhe)</option>{available.map(row => <option key={row.id} value={row.id}>{asText(row.name)} · {money(row.price_cents)}</option>)}</select></Field>
      <label className="field"><span>Link</span><input readOnly value={url} onFocus={event => event.currentTarget.select()}/><small>{plan ? 'Abre direto neste plano.' : 'Abre a lista dos planos ativos da barbearia.'}</small></label>
      {available.length === 0 && <Notice kind="info" text="Nenhum plano ativo. Ative um plano para o convite ter o que mostrar."/>}
      {ready === false && <Notice kind="info" text="O Mercado Pago desta barbearia ainda não está conectado. O cliente consegue abrir o convite, mas a assinatura só é liberada depois da conexão, em Configurações."/>}
      <div className="form-actions tv-link-actions">
        <a className="button ghost" href={url} target="_blank" rel="noreferrer"><ExternalLink size={15}/>Abrir</a>
        <button type="button" className="button outline" onClick={() => void copy()}><Copy size={15}/>Copiar link</button>
        <a className="button primary" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer"><MessageCircle size={15}/>Enviar no WhatsApp</a>
      </div>
    </div>
  </Modal>
}
