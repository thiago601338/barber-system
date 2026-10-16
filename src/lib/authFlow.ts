export function authCallbackMode(hash: string, search: string): 'invite' | 'recovery' | null {
  const type = new URLSearchParams(hash.replace(/^#/, '')).get('type')
    || new URLSearchParams(search).get('type')
  return type === 'invite' || type === 'recovery' ? type : null
}

export function authRedirectUrl(origin: string, search: string): string {
  const url = new URL('/entrar', origin)
  const params = new URLSearchParams(search)
  for (const key of ['shop', 'return']) {
    const value = params.get(key)
    if (value) url.searchParams.set(key, value)
  }
  return url.toString()
}
