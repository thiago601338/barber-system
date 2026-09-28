export function canUseAiKind(kind: 'marketing' | 'request', allowedModules: readonly string[]): boolean {
  return allowedModules.includes('ai') && (kind !== 'marketing' || allowedModules.includes('marketing'))
}
