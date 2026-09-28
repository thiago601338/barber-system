import { HttpError, optionalSetting } from './core'
import { mpPublicUrl } from './mpApi'

export function oauthCallbackUri(): string {
  const uri = mpPublicUrl('MP_OAUTH_REDIRECT_URI')
  if (new URL(uri).pathname !== '/api/mercadopago/oauth-callback') {
    throw new HttpError(503, 'MP_OAUTH_REDIRECT_URI deve apontar para /api/mercadopago/oauth-callback.')
  }
  return uri
}

export function shopOauthConfigured(): boolean {
  if (!['MP_CLIENT_ID', 'MP_CLIENT_SECRET', 'MP_OAUTH_REDIRECT_URI', 'TOKEN_ENCRYPTION_KEY']
    .every(name => Boolean(optionalSetting(name)))) return false
  try {
    oauthCallbackUri()
    const key = optionalSetting('TOKEN_ENCRYPTION_KEY') || ''
    if (!/^[A-Za-z0-9_+/-]+={0,2}$/.test(key)) return false
    const normalized = key.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/g, '')
    return atob(normalized + '='.repeat((4 - normalized.length % 4) % 4)).length === 32
  }
  catch { return false }
}

function publicUrlConfigured(name: string): boolean {
  try { mpPublicUrl(name); return true }
  catch { return false }
}

export function paymentConfiguration() {
  return {
    shop_oauth_configured: shopOauthConfigured(),
    shop_webhook_secret_present: Boolean(optionalSetting('MP_WEBHOOK_SECRET')),
    shop_checkout_url_configured: publicUrlConfigured('MP_CUSTOMER_BACK_URL'),
    platform_credentials_present: Boolean(optionalSetting('MP_PLATFORM_ACCESS_TOKEN') && optionalSetting('MP_PLATFORM_ACCOUNT_ID')),
    platform_webhook_secret_present: Boolean(optionalSetting('MP_PLATFORM_WEBHOOK_SECRET')),
    platform_checkout_url_configured: publicUrlConfigured('MP_SAAS_BACK_URL'),
  }
}
