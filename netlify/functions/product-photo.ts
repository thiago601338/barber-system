import type { Config } from '@netlify/functions'
import { body, db, failure, HttpError, json, optionalSetting, userFromRequest, uuid } from './_shared/core'
import { loadProduct, productPhotoReady, queueProductPhoto } from './_shared/productPhoto'

// Pede uma foto gerada por IA para um produto sem imagem.
export default async (request: Request): Promise<Response> => {
  try {
    if (request.method !== 'POST') throw new HttpError(405, 'Método não permitido.')
    const client = db()
    const user = await userFromRequest(request, client)
    const input = await body<{ product_id?: unknown }>(request)
    const product = await loadProduct(client, uuid(input.product_id))
    if (!product) throw new HttpError(404, 'Produto não encontrado.')
    const [{ data: admin }, { data: platform }] = await Promise.all([
      client.from('memberships').select('id').eq('barbershop_id', product.barbershop_id).eq('user_id', user.id).eq('role', 'admin').eq('active', true).maybeSingle(),
      client.from('platform_admins').select('user_id').eq('user_id', user.id).maybeSingle(),
    ])
    if (!admin && !platform) throw new HttpError(403, 'Acesso restrito ao administrador da barbearia.')
    if (product.image_path) return json({ status: 'has_image' })
    if (!productPhotoReady()) throw new HttpError(503, 'A IA de imagens não está disponível agora.')
    const queued = await queueProductPhoto(client, product, optionalSetting('URL') || new URL(request.url).origin)
    return json({ status: queued ? 'pending' : 'failed' }, queued ? 202 : 502)
  } catch (error) {
    return failure(error)
  }
}

export const config: Config = { path: '/api/product-photo' }
