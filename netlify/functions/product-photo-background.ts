import { db } from './_shared/core'
import { constantTimeEqual } from './_shared/mpCrypto'
import { createProductPhoto, loadProduct, productPhotoToken } from './_shared/productPhoto'

// Gera a foto do produto em segundo plano (até 15 min). Chamada apenas pelo próprio sistema.
export default async (request: Request): Promise<void> => {
  let input: { product_id?: string }
  try { input = await request.json() } catch { return }
  const productId = typeof input.product_id === 'string' && /^[0-9a-f-]{36}$/i.test(input.product_id) ? input.product_id : null
  if (!productId) return
  if (!constantTimeEqual(request.headers.get('x-product-photo') || '', await productPhotoToken(productId))) return
  const client = db()
  const product = await loadProduct(client, productId)
  if (!product) return
  if (product.image_path) { await client.from('products').update({ image_ai_status: null }).eq('id', productId); return }
  try {
    await createProductPhoto(client, product)
  } catch (problem) {
    console.error('product photo', problem)
    await client.from('products').update({ image_ai_status: 'failed' }).eq('id', productId).is('image_path', null)
  }
}
