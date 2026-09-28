import { requireSupabase } from './supabase'

export const productImageBucket = 'shop-assets'
export const productImageMaxBytes = 2 * 1024 * 1024

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const pathPattern = new RegExp(`^(${uuid})/products/${uuid}\\.(jpg|png|webp)$`)
const imageTypes = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const

export function validProductImagePath(value: unknown, shopId: string): value is string {
  return typeof value === 'string' && pathPattern.test(value) && value.startsWith(`${shopId}/products/`)
}

export function productImageUrl(value: unknown, shopId: string): string | null {
  if (!validProductImagePath(value, shopId)) return null
  return requireSupabase().storage.from(productImageBucket).getPublicUrl(value).data.publicUrl
}

export function validateProductImageChoice(file: File): void {
  if (!Object.prototype.hasOwnProperty.call(imageTypes, file.type)) {
    throw new Error('Use uma imagem JPEG, PNG ou WebP.')
  }
  if (file.size < 1 || file.size > productImageMaxBytes) {
    throw new Error('A imagem deve ter até 2 MB.')
  }
}

export async function verifyImageSignature(file: File): Promise<void> {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  const webp = String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  if (!(file.type === 'image/jpeg' && jpeg || file.type === 'image/png' && png || file.type === 'image/webp' && webp)) {
    throw new Error('O arquivo selecionado não é uma imagem válida.')
  }
}

export async function uploadProductImage(shopId: string, file: File): Promise<string> {
  validateProductImageChoice(file)
  await verifyImageSignature(file)
  if (!new RegExp(`^${uuid}$`).test(shopId)) throw new Error('Barbearia inválida para o envio da imagem.')
  const extension = imageTypes[file.type as keyof typeof imageTypes]
  const path = `${shopId}/products/${crypto.randomUUID()}.${extension}`
  const { data, error } = await requireSupabase().storage.from(productImageBucket).upload(path, file, {
    cacheControl: '3600', contentType: file.type, upsert: false,
  })
  if (error) throw new Error(error.message)
  return data.path
}

export async function removeProductImage(path: unknown, shopId: string): Promise<void> {
  if (!validProductImagePath(path, shopId)) return
  const { error } = await requireSupabase().storage.from(productImageBucket).remove([path])
  if (error) throw new Error(error.message)
}
