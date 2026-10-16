import type { SupabaseClient } from '@supabase/supabase-js'
import OpenAI from 'openai'
import { HttpError, optionalSetting, setting } from './core'
import { sha256Hex } from './mpCrypto'

// Foto automática do produto: quando o produto é cadastrado sem imagem, a IA pesquisa como ele é
// e gera uma foto de catálogo que represente o item o mais fielmente possível.

export const PRODUCT_IMAGE_BUCKET = 'shop-assets'
const DAILY_LIMIT_PER_SHOP = 40
const TEXT_MODEL = 'gpt-5.4-mini'
const IMAGE_MODELS = ['gpt-image-2', 'gpt-image-1.5', 'gpt-image-1'] as const

export type ProductForPhoto = { id: string; barbershop_id: string; name: string; sku: string | null; description: string | null; category: string; image_path: string | null; image_ai_status?: string | null; image_ai_at?: string | null }

export const productPhotoToken = (productId: string) => sha256Hex(`${setting('TOKEN_ENCRYPTION_KEY')}:product-photo:${productId}`)

export function productPhotoReady(): boolean {
  return Boolean(optionalSetting('OPENAI_API_KEY') || optionalSetting('OPENAI_BASE_URL'))
}

export async function loadProduct(client: SupabaseClient, productId: string): Promise<ProductForPhoto | null> {
  const { data, error } = await client.from('products').select('id,barbershop_id,name,sku,description,category,image_path,image_ai_status,image_ai_at').eq('id', productId).maybeSingle()
  if (error) throw error
  return data as ProductForPhoto | null
}

// Marca o produto como "buscando foto" e chama a função em segundo plano. Retorna false quando não há o que fazer.
export async function queueProductPhoto(client: SupabaseClient, product: ProductForPhoto, origin: string): Promise<boolean> {
  if (product.image_path || !productPhotoReady()) return false
  if (product.image_ai_status === 'pending' && product.image_ai_at && Date.now() - Date.parse(product.image_ai_at) < 10 * 60_000) return true
  const since = new Date(Date.now() - 86_400_000).toISOString()
  const { count } = await client.from('products').select('id', { count: 'exact', head: true }).eq('barbershop_id', product.barbershop_id).gte('image_ai_at', since)
  if ((count || 0) >= DAILY_LIMIT_PER_SHOP) throw new HttpError(429, 'Limite diário de fotos geradas por IA atingido. Tente novamente amanhã ou envie uma foto.')
  const { error } = await client.from('products').update({ image_ai_status: 'pending', image_ai_at: new Date().toISOString() }).eq('id', product.id).is('image_path', null)
  if (error) throw error
  try {
    await fetch(`${origin}/.netlify/functions/product-photo-background`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-product-photo': await productPhotoToken(product.id) },
      body: JSON.stringify({ product_id: product.id }),
      signal: AbortSignal.timeout(8_000),
    })
  } catch (problem) {
    console.error('product photo dispatch', problem)
    await client.from('products').update({ image_ai_status: 'failed' }).eq('id', product.id)
    return false
  }
  return true
}

const categoryHint: Record<string, string> = {
  retail: 'produto de barbearia/cuidados masculinos vendido no balcão (pomada, óleo, shampoo, balm, pente, etc.)',
  bar: 'bebida servida ou vendida no bar da barbearia',
  kitchen: 'comida/petisco servido na cozinha da barbearia',
  supply: 'insumo de uso profissional na barbearia',
}

// 1) Pesquisa na web como o produto realmente é (embalagem, cores, formato). 2) Gera a foto.
async function describeProduct(openai: OpenAI, product: ProductForPhoto): Promise<string> {
  const facts = [`Nome: ${product.name}`, product.sku ? `Código/SKU: ${product.sku}` : '', product.description ? `Descrição do cadastro: ${product.description}` : '', `Tipo: ${categoryHint[product.category] || product.category}`].filter(Boolean).join('\n')
  const instructions = 'Você ajuda a criar a foto de catálogo de um produto cadastrado por uma barbearia brasileira. Descubra como esse produto é visualmente (se for um produto de marca, pesquise e descreva a embalagem real: formato, material, cores, tampa, rótulo, logotipo e textos principais; se for comida ou bebida, como ele costuma ser servido). Responda em inglês, em um único parágrafo de até 120 palavras, só com a descrição visual objetiva do item, sem preço e sem comentários.'
  try {
    const result = await openai.responses.create({ model: TEXT_MODEL, tools: [{ type: 'web_search' }], instructions, input: facts, max_output_tokens: 1200 })
    const text = result.output_text?.trim()
    if (text) return text
  } catch (problem) { console.warn('product photo web search unavailable', problem) }
  const completion = await openai.chat.completions.create({ model: TEXT_MODEL, max_completion_tokens: 900, messages: [{ role: 'system', content: instructions }, { role: 'user', content: facts }] })
  return completion.choices[0]?.message?.content?.trim() || facts
}

function imagePrompt(product: ProductForPhoto, description: string): string {
  const food = product.category === 'bar' || product.category === 'kitchen'
  return [
    `Professional e-commerce catalog photo of: ${product.name}.`,
    `What it looks like: ${description}`,
    food
      ? 'Show it served and appetizing, realistic, centered, on a clean neutral surface with soft light, square framing.'
      : 'Show the product alone, front-facing and centered, on a clean light neutral studio background with soft shadow, realistic packshot, square framing.',
    'Faithful to the real product. No people, no hands, no extra objects, no watermark, no price tags, no added captions.',
  ].join('\n')
}

async function generateImage(openai: OpenAI, prompt: string): Promise<Uint8Array> {
  let lastError: unknown = null
  for (const model of IMAGE_MODELS) {
    try {
      const result = await openai.images.generate({ model, prompt, size: '1024x1024', quality: 'medium', output_format: 'webp', output_compression: 82, n: 1 })
      const b64 = result.data?.[0]?.b64_json
      if (b64) return Uint8Array.from(Buffer.from(b64, 'base64'))
    } catch (problem) { lastError = problem; console.warn(`product photo ${model} failed`, problem) }
  }
  throw lastError instanceof Error ? lastError : new Error('Nenhuma imagem gerada.')
}

export async function createProductPhoto(client: SupabaseClient, product: ProductForPhoto): Promise<string | null> {
  if (product.image_path) return null
  const openai = new OpenAI()
  const description = await describeProduct(openai, product)
  const bytes = await generateImage(openai, imagePrompt(product, description))
  if (bytes.byteLength > 2 * 1024 * 1024) throw new Error('Imagem gerada maior que o limite.')
  const path = `${product.barbershop_id}/products/${crypto.randomUUID()}.webp`
  const { error: uploadError } = await client.storage.from(PRODUCT_IMAGE_BUCKET).upload(path, bytes, { contentType: 'image/webp', cacheControl: '31536000', upsert: false })
  if (uploadError) throw uploadError
  // Só grava se o produto continuar sem foto (o cliente pode ter enviado uma enquanto a IA trabalhava).
  const { data, error } = await client.from('products').update({ image_path: path, image_ai_status: 'done' }).eq('id', product.id).is('image_path', null).select('id')
  if (error || !data?.length) {
    await client.storage.from(PRODUCT_IMAGE_BUCKET).remove([path])
    if (error) throw error
    return null
  }
  return path
}
