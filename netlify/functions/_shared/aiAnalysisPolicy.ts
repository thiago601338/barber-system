export type AiAnalysisKind = 'financial' | 'marketing' | 'request'
export type AiAnalysisRole = 'master' | 'admin' | 'barber' | 'client'

export function canAnalyzeWithAi(kind: AiAnalysisKind, role: AiAnalysisRole, allowedModules: readonly string[] = []): boolean {
  if (role === 'master' || role === 'admin') return true
  if (role !== 'barber' || kind === 'financial') return false
  return allowedModules.includes('ai') && (kind !== 'marketing' || allowedModules.includes('marketing'))
}

export function aiAnalysisDailyLimit(role: AiAnalysisRole): number {
  return role === 'master' ? 50 : role === 'admin' ? 20 : role === 'barber' ? 10 : 0
}
