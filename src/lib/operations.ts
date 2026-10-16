import { requireSupabase } from './supabase'
import { errorMessage } from './errorMessage'

export async function operation<T = unknown>(name: string, params: Record<string, unknown>): Promise<T> {
  const result = await requireSupabase().rpc(name, params)
  if (result.error) throw new Error(errorMessage(result.error))
  return result.data as T
}

export const cashMethods: Record<string, string> = { cash: 'Dinheiro', card: 'Cartão', pix: 'Pix', other: 'Outro' }
export const stockReasons: Record<string, string> = { initial: 'Cadastro inicial', opening_balance: 'Saldo na implantação', purchase: 'Compra recebida', sale_or_cancellation: 'Reserva de comanda', sale_cancelled: 'Cancelamento de comanda', refund_return: 'Devolução de produtos', cost_review: 'Revisão de custo', internal_use: 'Consumo interno', loss: 'Perda', adjustment: 'Ajuste de inventário' }
export const commissionStates: Record<string, string> = { review: 'Revisar regra/profissional', awaiting_payment: 'Aguardando recebimento', accrued: 'Disponível', closed: 'Extrato fechado' }

export function safeAmount(value: string, allowZero = false): number {
  const amount = Math.round(Number(value.replace(',', '.')) * 100)
  if (!Number.isSafeInteger(amount) || amount < (allowZero ? 0 : 1) || amount > 2147483647) throw new Error('Informe um valor válido em reais.')
  return amount
}
