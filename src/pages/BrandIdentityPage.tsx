import { useCallback, useEffect, useState } from 'react'
import { ArrowUpRight, Camera, Check, Palette, Sparkles } from 'lucide-react'
import type { PageProps } from '../App'
import { authedApi, authedGet } from '../lib/supabase'
import { brandStyle, readBrandTheme, safeBrandImage, safeInstagramUrl, ShopBrand, type BrandTheme } from '../shopBrand'
import type { Shop } from '../types'
import { Field, Loading, Notice, PageHeader, Panel, PrimaryButton } from '../ui'

interface BrandProposal {
  id: string
  barbershop_id: string
  instagram_url: string
  source_status: string
  source_evidence?: unknown
  operator_notes?: string | null
  proposed_theme: unknown
  rationale?: string | null
  limitations?: string[] | null
  status: 'pending' | 'published' | 'superseded' | string
  created_at: string
  published_at?: string | null
}
interface BrandOverview { shop: Shop; proposals: BrandProposal[] }

function BrandPreview({ shop, theme, label }: { shop: Shop; theme: BrandTheme; label: string }) {
  const previewShop = { ...shop, brand_theme: theme }
  return <section className="brand-preview shop-themed" data-shop-theme style={brandStyle(theme)} aria-label={`Prévia da identidade ${label}`}>
    <header className="brand-preview-top"><ShopBrand shop={previewShop} compact/><span>AGENDA <span className="brand-preview-dot">✦</span> SERVIÇOS</span></header>
    <div className="brand-preview-hero">
      {theme.heroImageUrl && <img src={theme.heroImageUrl} alt="Imagem de destaque proposta para a barbearia"/>}
      <div className="brand-preview-hero-copy"><small>IDENTIDADE {label.toUpperCase()}</small><h2>{shop.name}</h2><p>{theme.tagline || 'Seu estilo começa aqui.'}</p><span>Agendar um horário <ArrowUpRight size={16}/></span></div>
    </div>
    <div className="brand-preview-bottom"><div><small>ÁREA DO CLIENTE</small><strong>Um atendimento à sua altura.</strong></div><div className="brand-preview-mini"><span>PRÓXIMO HORÁRIO</span><strong>Seu momento de cuidado</strong><small>Agenda e benefícios em um só lugar</small></div></div>
  </section>
}

export function BrandIdentityPage({ identity, notify, onRefresh }: PageProps & { onRefresh: () => Promise<void> }) {
  const shop = identity.shop!
  const [overview, setOverview] = useState<BrandOverview | null>(null)
  const [instagramUrl, setInstagramUrl] = useState(shop.instagram_url || '')
  const [notes, setNotes] = useState('')
  const [logoUrl, setLogoUrl] = useState(readBrandTheme(shop.brand_theme)?.logoUrl || shop.logo_url || '')
  const [proposalId, setProposalId] = useState<string | null>(null)
  const [busy, setBusy] = useState<'analyze' | 'publish' | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const result = await authedGet<BrandOverview>(`/api/brand/current?barbershop_id=${encodeURIComponent(shop.id)}`)
    setOverview(result)
    setInstagramUrl(result.shop.instagram_url || '')
    setLogoUrl(readBrandTheme(result.shop.brand_theme)?.logoUrl || shop.logo_url || '')
    setProposalId(previous => previous && result.proposals.some(item => item.id === previous) ? previous : result.proposals.find(item => item.status === 'pending')?.id || null)
  }, [shop.id])
  useEffect(() => {
    let active = true
    setLoading(true)
    void authedGet<BrandOverview>(`/api/brand/current?barbershop_id=${encodeURIComponent(shop.id)}`)
      .then(result => { if (!active) return; setOverview(result); setInstagramUrl(result.shop.instagram_url || ''); setLogoUrl(readBrandTheme(result.shop.brand_theme)?.logoUrl || shop.logo_url || ''); setProposalId(result.proposals.find(item => item.status === 'pending')?.id || null) })
      .catch(problem => { if (active) setError(problem instanceof Error ? problem.message : 'Não foi possível carregar a identidade visual.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [shop.id])

  async function analyze() {
    const safeUrl = safeInstagramUrl(instagramUrl)
    if (!safeUrl) { setError('Informe primeiro um link válido de perfil do Instagram.'); return }
    if (logoUrl.trim() && !safeBrandImage(logoUrl.trim())) { setError('A logo deve usar HTTPS ou um arquivo interno em /brands/.'); return }
    setBusy('analyze'); setError(null)
    let linkSaved = false
    try {
      await authedApi('/api/brand/link', { barbershop_id: shop.id, instagram_url: safeUrl })
      linkSaved = true
      const result = await authedApi<{ proposal: BrandProposal }>('/api/brand/analyze', {
        barbershop_id: shop.id, instagram_url: safeUrl,
        notes: notes.trim() || undefined, logo_url: logoUrl.trim() || undefined,
      })
      setOverview(previous => previous
        ? { shop: { ...previous.shop, instagram_url: safeUrl }, proposals: [result.proposal, ...previous.proposals.filter(item => item.id !== result.proposal.id)] }
        : { shop: { ...shop, instagram_url: safeUrl }, proposals: [result.proposal] })
      setProposalId(result.proposal.id)
      notify('Proposta de identidade criada. Revise a prévia antes de publicar.')
      const refreshes = await Promise.allSettled([reload(), onRefresh()])
      if (refreshes.some(item => item.status === 'rejected')) setError('Proposta criada, mas alguns dados da tela não atualizaram. Reabra a aba para conferir o estado atual.')
    } catch (problem) { setError(`${linkSaved ? 'Link salvo. ' : ''}${problem instanceof Error ? problem.message : 'Não foi possível analisar o perfil.'}`) }
    finally { setBusy(null) }
  }

  async function publish() {
    if (!proposalId) return
    setBusy('publish'); setError(null)
    try {
      const result = await authedApi<{ shop: Shop; proposal: BrandProposal }>('/api/brand/publish', { barbershop_id: shop.id, proposal_id: proposalId })
      setOverview(previous => previous ? { shop: result.shop, proposals: previous.proposals.map(item => item.id === result.proposal.id ? result.proposal : item) } : { shop: result.shop, proposals: [result.proposal] })
      notify('Identidade publicada para gestão, barbeiros e clientes.')
      const refreshes = await Promise.allSettled([reload(), onRefresh()])
      if (refreshes.some(item => item.status === 'rejected')) setError('Identidade publicada, mas alguns dados da tela não atualizaram. Reabra a aba para conferir o estado atual.')
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Não foi possível publicar a identidade.') }
    finally { setBusy(null) }
  }

  const publishedTheme = readBrandTheme(overview?.shop.brand_theme || shop.brand_theme)
  const proposal = overview?.proposals.find(item => item.id === proposalId) || null
  const proposedTheme = readBrandTheme(proposal?.proposed_theme)
  const currentInstagram = safeInstagramUrl(overview?.shop.instagram_url || shop.instagram_url)
  const instagramEdited = safeInstagramUrl(instagramUrl) !== currentInstagram
  const evidence = Array.isArray(proposal?.source_evidence)
    ? proposal.source_evidence.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
    : []

  return <div className="page-stack brand-identity-page">
    <PageHeader eyebrow="PRESENÇA DA MARCA" title="Identidade visual" description="Cada barbearia tem sua própria aparência na gestão, no acesso dos barbeiros, na área do cliente e na página de agendamento." action={<span className="brand-page-badge"><Palette size={16}/> {publishedTheme ? 'Identidade publicada' : 'Aguardando primeira identidade'}</span>}/>
    <Notice text={error}/>
    {loading ? <Loading text="Carregando identidade da barbearia..."/> : <>
      <div className="brand-studio-grid">
        <Panel title="Instagram da barbearia" subtitle="A referência principal para criar uma proposta coerente com a empresa">
          <form className="form-grid" onSubmit={event => { event.preventDefault(); void analyze() }}>
            <Field label="Link do perfil no Instagram"><input type="url" required value={instagramUrl} onChange={event => setInstagramUrl(event.target.value)} placeholder="https://www.instagram.com/suabarbearia/"/></Field>
            <div className="brand-link-actions"><PrimaryButton type="submit" disabled={!!busy}><Sparkles size={16}/>{busy === 'analyze' ? 'Analisando...' : 'Salvar e analisar com IA'}</PrimaryButton>{currentInstagram && <a className="button outline" href={currentInstagram} target="_blank" rel="noreferrer"><Camera size={16}/> Abrir perfil <ArrowUpRight size={15}/></a>}</div>
          </form>
          <p className="brand-help">O link também aparece para os clientes. Para métricas e anúncios, conecte a conta profissional na aba Marketing.</p>
        </Panel>
        <Panel title="Analisar e criar" subtitle="A IA propõe cores, tipografia e direção visual a partir das fontes disponíveis">
          <div className="form-grid"><Field label="Referências adicionais (opcional)" hint="Descreva detalhes da fachada, uniforme, ambiente ou posicionamento da marca."><textarea rows={3} maxLength={1200} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Ex.: ambiente clássico, tons escuros, acabamento em dourado..."/></Field><Field label="Logo oficial (opcional)" hint="Use uma imagem HTTPS ou arquivo interno em /brands/."><input value={logoUrl} onChange={event => setLogoUrl(event.target.value)} placeholder="https://... ou /brands/logo.webp"/></Field><button className="button outline" type="button" onClick={() => void analyze()} disabled={!!busy}><Sparkles size={16}/>{busy === 'analyze' ? 'Analisando...' : 'Reanalisar com IA'}</button></div>
          <p className="brand-help">A proposta indica as referências usadas. Se o conteúdo do Instagram não estiver acessível, a análise informa a limitação e usa somente as referências verificáveis.</p>
        </Panel>
      </div>

      <div className="brand-review-grid">
        <Panel title="Propostas" subtitle="Revise antes de trocar a aparência da barbearia">
          {overview?.proposals.length ? <div className="brand-proposal-list">{overview.proposals.map(item => <button type="button" key={item.id} className={`brand-proposal-item ${proposalId === item.id ? 'selected' : ''}`} onClick={() => setProposalId(item.id)}><span><strong>{item.status === 'published' ? 'Identidade publicada' : item.status === 'superseded' ? 'Proposta substituída' : 'Proposta para revisão'}</strong><small>{new Date(item.created_at).toLocaleString('pt-BR')} · {item.source_status === 'public_metadata' ? 'Metadados públicos do Instagram' : item.source_status === 'admin_notes_only' ? 'Referências do administrador' : 'Fonte registrada'}</small></span>{proposalId === item.id && <Check size={17}/>}</button>)}</div> : <div className="brand-empty"><Sparkles size={25}/><strong>Nenhuma proposta ainda</strong><p>{publishedTheme ? 'A identidade atual foi publicada manualmente. A análise com IA ainda não foi registrada.' : 'Informe o Instagram e peça uma análise para criar a primeira identidade.'}</p></div>}
          {proposal?.rationale && <div className="brand-rationale"><strong>Por que esta proposta?</strong><p>{proposal.rationale}</p></div>}
          {evidence.length > 0 && <div className="brand-evidence"><strong>Referências usadas</strong>{evidence.map((item, index) => <p key={index}><b>{item.source === 'instagram_public_metadata' ? 'Metadados públicos do Instagram' : item.source === 'instagram_public_avatar' ? 'Foto pública do perfil' : 'Informações do administrador'}:</b> {String(item.description || item.visual_asset || item.text || item.title || 'Fonte registrada').slice(0, 360)}</p>)}</div>}
          {proposal?.limitations?.length ? <div className="brand-limitations"><strong>Fontes e limites da análise</strong>{proposal.limitations.map((limit, index) => <p key={index}>{limit}</p>)}</div> : null}
          {proposal?.status === 'pending' && (instagramEdited || currentInstagram !== safeInstagramUrl(proposal.instagram_url)) && <Notice kind="info" text="O link do Instagram mudou. Salve e faça uma nova análise antes de publicar esta proposta."/>}
          {proposal?.status === 'pending' && <PrimaryButton onClick={() => void publish()} disabled={!!busy || !proposedTheme || instagramEdited || currentInstagram !== safeInstagramUrl(proposal.instagram_url)}>{busy === 'publish' ? 'Publicando...' : 'Publicar esta identidade'}</PrimaryButton>}
        </Panel>
        <Panel title="Prévia da interface" subtitle={proposal && proposedTheme ? 'Proposta selecionada' : publishedTheme ? 'Identidade atual' : 'Aguardando proposta'}>
          {proposedTheme ? <BrandPreview shop={shop} theme={proposedTheme} label="proposta"/> : publishedTheme ? <BrandPreview shop={shop} theme={publishedTheme} label="publicada"/> : <div className="brand-empty"><Palette size={25}/><strong>Seu espaço, sua marca</strong><p>A prévia da gestão e da experiência dos clientes aparecerá aqui.</p></div>}
          {(proposedTheme || publishedTheme) && <div className="brand-preview-caption"><span>As cores e imagens da prévia também serão usadas no painel e na página pública.</span><a href={`/b/${shop.slug}`} target="_blank" rel="noreferrer">Abrir página pública <ArrowUpRight size={14}/></a></div>}
        </Panel>
      </div>
    </>}
  </div>
}
