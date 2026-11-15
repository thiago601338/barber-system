import { useEffect, useState } from 'react'
import { requireSupabase } from '../lib/supabase'

export interface ShopTerms { version: string; title: string; statement: string }

/** Termo de aceite vigente da barbearia para novas assinaturas. `terms` fica null quando ela não publicou nenhum. */
export function useSubscriptionTerms(shopId: string | null | undefined): { terms: ShopTerms | null; failed: boolean } {
  const [state, setState] = useState<{ terms: ShopTerms | null; failed: boolean }>({ terms: null, failed: false })
  useEffect(() => {
    if (!shopId) { setState({ terms: null, failed: false }); return }
    let cancelled = false
    void Promise.resolve(requireSupabase().from('subscription_terms').select('version,title,statement').eq('barbershop_id', shopId).eq('active', true).maybeSingle())
      .then(({ data, error }) => { if (!cancelled) setState({ terms: error ? null : (data as ShopTerms | null) ?? null, failed: Boolean(error) }) })
      .catch(() => { if (!cancelled) setState({ terms: null, failed: true }) })
    return () => { cancelled = true }
  }, [shopId])
  return state
}

/** Parágrafos do termo; os títulos de cláusula viram subtítulos. */
export function termBlocks(body: string): { text: string; heading: boolean }[] {
  return body.split(/\n\s*\n/).map(block => block.trim()).filter(Boolean).map(text => ({
    text,
    heading: text.length <= 90 && /\p{L}/u.test(text) && (/^\d{1,2}\.\s/.test(text) || text === text.toUpperCase()),
  }))
}

/**
 * Leitura do termo e, quando há `onChange`, a caixa de aceite. O texto integral só é buscado quando a pessoa abre o termo.
 * `statement` troca a frase do aceite (a equipe confirma em nome do cliente; o cliente aceita por conta própria).
 */
export function TermsAcceptance({ shopId, terms, accepted, onChange, statement }: { shopId: string; terms: ShopTerms; accepted?: boolean; onChange?: (accepted: boolean) => void; statement?: string }) {
  const [open, setOpen] = useState(false)
  const [body, setBody] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  async function toggle() {
    const next = !open
    setOpen(next)
    if (!next || body !== null) return
    setFailed(false)
    try {
      const result = await requireSupabase().from('subscription_terms').select('body').eq('barbershop_id', shopId).eq('version', terms.version).eq('active', true).maybeSingle()
      if (result.error || !result.data) throw result.error || new Error('Termo indisponível')
      setBody(String((result.data as { body: string }).body))
    } catch { setFailed(true) }
  }
  return <div className="terms-acceptance">
    {onChange && <label className="terms-check"><input type="checkbox" checked={Boolean(accepted)} onChange={event => onChange(event.target.checked)}/><span>{statement || terms.statement}</span></label>}
    <button type="button" className="terms-toggle" aria-expanded={open} onClick={() => void toggle()}>{open ? 'Fechar o termo' : `Ler o ${terms.title}`}</button>
    {open && <div className="terms-body" tabIndex={0} role="document" aria-label={terms.title}>
      {failed ? <p>Não foi possível abrir o termo agora. Feche e abra de novo.</p>
        : body === null ? <p>Abrindo o termo...</p>
        : termBlocks(body).map((block, index) => block.heading ? <h4 key={index}>{block.text}</h4> : <p key={index}>{block.text}</p>)}
    </div>}
  </div>
}
