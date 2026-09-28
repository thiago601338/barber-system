import { HttpError, setting } from './core'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_+/-]+={0,2}$/.test(value)) throw new HttpError(400, 'Dados criptografados inválidos.')
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/g, '')
  const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4))
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

let encryptionKey: Promise<CryptoKey> | undefined
function key(): Promise<CryptoKey> {
  encryptionKey ??= (async () => {
    const raw = fromBase64Url(setting('TOKEN_ENCRYPTION_KEY'))
    if (raw.length !== 32) throw new HttpError(503, 'TOKEN_ENCRYPTION_KEY deve conter 32 bytes em base64.')
    return crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt'])
  })()
  return encryptionKey
}

export function randomToken(bytes = 32): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)))
}

export async function sha256Base64Url(value: string): Promise<string> {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))))
}

export async function sha256Hex(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))), byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function seal(value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = encoder.encode(JSON.stringify(value))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), plaintext)
  return `v1.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`
}

export async function unseal<T>(envelope: string): Promise<T> {
  const parts = envelope.split('.')
  if (parts.length !== 3 || parts[0] !== 'v1') throw new HttpError(400, 'Dados criptografados inválidos.')
  try {
    const iv = fromBase64Url(parts[1])
    if (iv.length !== 12) throw new Error('invalid iv')
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, await key(), fromBase64Url(parts[2]) as BufferSource)
    return JSON.parse(decoder.decode(plaintext)) as T
  } catch {
    throw new HttpError(400, 'Dados criptografados inválidos.')
  }
}

export function constantTimeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length)
  let different = a.length ^ b.length
  for (let index = 0; index < length; index++) different |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0)
  return different === 0
}

export async function verifyWebhookSignature(request: Request, secret: string, dataId: string): Promise<void> {
  const requestId = request.headers.get('x-request-id') || ''
  const signature = request.headers.get('x-signature') || ''
  const fields = Object.fromEntries(signature.split(',').map(part => part.trim().split('=')))
  const timestamp = fields.ts
  const supplied = fields.v1
  if (!requestId || !timestamp || !/^\d{10,16}$/.test(timestamp) || !supplied || !/^[a-fA-F0-9]{64}$/.test(supplied)) {
    throw new HttpError(401, 'Assinatura do webhook inválida.')
  }
  const manifest = `id:${dataId};request-id:${requestId};ts:${timestamp};`
  const signingKey = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const expected = Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', signingKey, encoder.encode(manifest))), byte => byte.toString(16).padStart(2, '0')).join('')
  if (!constantTimeEqual(expected, supplied.toLowerCase())) throw new HttpError(401, 'Assinatura do webhook inválida.')
}
