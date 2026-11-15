import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { createRow, updateRow } from '../lib/useRows'
import { asText, money, type Row } from '../types'
import { Field, Modal, Notice, PrimaryButton } from '../ui'
import '../styles-extras.css'

const ruleText = (rule: Row | undefined) => !rule ? 'sem regra' : rule.mode === 'fixed' ? `${money(rule.rate)} fixo` : `${Number(rule.rate).toLocaleString('pt-BR')}%`

/** Percentual de comissão de um profissional em cada serviço, editado de uma vez só. */
export function CommissionMatrix({ shopId, barbers, services, rules, onClose, onSaved }: {
  shopId: string; barbers: Row[]; services: Row[]; rules: Row[]; onClose: () => void; onSaved: (changed: number) => void | Promise<void>
}) {
  const [member, setMember] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const active = useMemo(() => rules.filter(rule => rule.active && rule.item_kind === 'service')
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))), [rules])
  const pairRule = (serviceId: string) => active.find(rule => rule.barber_membership_id === member && rule.item_id === serviceId)
  // Mesma prioridade usada no lançamento: regra do profissional, depois a do serviço, depois a geral.
  const inherited = (serviceId: string) => active.find(rule => rule.barber_membership_id === member && !rule.item_id)
    || active.find(rule => !rule.barber_membership_id && rule.item_id === serviceId)
    || active.find(rule => !rule.barber_membership_id && !rule.item_id)
  const listed = useMemo(() => services.filter(service => service.active)
    .sort((a, b) => String(a.category || '').localeCompare(String(b.category || ''), 'pt-BR') || String(a.name).localeCompare(String(b.name), 'pt-BR')), [services])
  useEffect(() => {
    setError(null)
    setValues(member ? Object.fromEntries(listed.map(service => {
      const rule = pairRule(service.id)
      return [service.id, rule && rule.mode === 'percent' ? String(Number(rule.rate)) : '']
    })) : {})
  }, [member, listed, active])
  async function save(event: FormEvent) {
    event.preventDefault()
    if (!member) return
    setBusy(true); setError(null)
    let changed = 0
    try {
      for (const service of listed) {
        const rule = pairRule(service.id)
        if (rule && rule.mode !== 'percent') continue
        const raw = (values[service.id] ?? '').trim().replace(',', '.')
        if (raw === '') {
          if (rule) { await updateRow('commission_rules', rule.id, { active: false }); changed++ }
          continue
        }
        const rate = Number(raw)
        if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new Error(`Informe um percentual entre 0 e 100 para ${asText(service.name)}.`)
        if (rule) { if (Number(rule.rate) !== rate) { await updateRow('commission_rules', rule.id, { rate }); changed++ } }
        else { await createRow('commission_rules', { barbershop_id: shopId, barber_membership_id: member, item_kind: 'service', item_id: service.id, mode: 'percent', rate, subscription_basis_cents: null, active: true }); changed++ }
      }
      await onSaved(changed)
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Não foi possível salvar os percentuais.')
      if (changed) await onSaved(-1)
    } finally { setBusy(false) }
  }
  return <Modal wide title="Comissão por serviço" subtitle="Defina o percentual de um profissional em cada serviço. Em branco, vale a regra geral." onClose={() => { if (!busy) onClose() }}>
    <form className="form-grid" onSubmit={save}>
      <Field label="Profissional"><select required value={member} onChange={event => setMember(event.target.value)}><option value="">Selecione</option>{barbers.map(barber => <option key={barber.id} value={barber.id}>{asText(barber.display_name)}</option>)}</select></Field>
      {member && <div className="table-scroll commission-matrix"><table>
        <thead><tr><th>Serviço</th><th>Preço</th><th>Regra geral</th><th>Percentual deste profissional</th></tr></thead>
        <tbody>{listed.map(service => {
          const rule = pairRule(service.id)
          return <tr key={service.id}>
            <td><div className="cell-stack"><strong>{asText(service.name)}</strong>{Boolean(service.category) && <small>{String(service.category)}</small>}</div></td>
            <td className="num">{money(service.price_cents)}</td>
            <td className="num">{ruleText(inherited(service.id))}</td>
            <td>{rule && rule.mode !== 'percent'
              ? <span className="muted">{ruleText(rule)} · edite em Regras</span>
              : <label className="percent-input"><input type="number" min="0" max="100" step="0.001" inputMode="decimal" aria-label={`Percentual em ${asText(service.name)}`} placeholder="—" value={values[service.id] ?? ''} onChange={event => setValues({ ...values, [service.id]: event.target.value })}/><span>%</span></label>}</td>
          </tr>
        })}</tbody>
      </table></div>}
      <Notice text={error}/>
      <div className="form-actions"><button type="button" className="button ghost" disabled={busy} onClick={onClose}>Cancelar</button><PrimaryButton type="submit" disabled={busy || !member}>{busy ? 'Salvando...' : 'Salvar percentuais'}</PrimaryButton></div>
    </form>
  </Modal>
}
