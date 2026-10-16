import type { Config } from '@netlify/functions'
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js'
import { body, db, failure, HttpError, requirePlatformAdmin, userFromRequest } from './_shared/core.ts'
import { AUDIO_BUCKET, elevenLabsApiKey, getOrCreateTutorialAudio, resolveTutorialVoiceId, tutorialAudioPath, tutorialModelId } from './_shared/tutorialAudio.ts'
import { uniqueTutorialTexts } from './_shared/tutorialAudioCatalog.ts'

export default async (request: Request) => {
  try {
    const client = db()
    const user = await userFromRequest(request, client)
    await requirePlatformAdmin(client, user.id)
    const url = new URL(request.url)
    const offset = Math.max(0, Number(url.searchParams.get('offset') || 0) || 0)
    const rawLimit = Math.max(1, Number(url.searchParams.get('limit') || 6) || 6)
    const limit = Math.min(10, rawLimit)
    const elevenlabs = new ElevenLabsClient({ apiKey: elevenLabsApiKey() })
    const texts = uniqueTutorialTexts()
    const voiceId=await resolveTutorialVoiceId(elevenlabs),modelId=tutorialModelId()
    const prefix=`v1/${voiceId}/${modelId}`
    const stored=await client.storage.from(AUDIO_BUCKET).list(prefix,{limit:1000})
    if(stored.error)throw new HttpError(503,'Não foi possível conferir os áudios armazenados. Nenhuma geração foi iniciada.')
    const existing=new Set((stored.data||[]).map(item=>item.name))
    const missing=texts.filter(value=>!existing.has(tutorialAudioPath(voiceId,modelId,value).split('/').pop()!))
    const requiredCredits=missing.reduce((n,value)=>n+value.length,0)
    const subscription=await elevenlabs.user.subscription.get()
    const remainingCredits=Math.max(0,subscription.characterLimit-subscription.characterCount)
    if(url.searchParams.get('dry_run')==='true')return Response.json({total:texts.length,cached:texts.length-missing.length,missing:missing.length,requiredCredits,remainingCredits,voiceId,modelId,tier:subscription.tier},{headers:{'cache-control':'no-store'}})
    const payload=await body<{approved_credits?:number}>(request)
    const approved=Number(payload.approved_credits||0)
    if(!Number.isSafeInteger(approved)||approved<requiredCredits||requiredCredits>remainingCredits)throw new HttpError(409,'Confira e aprove a estimativa primeiro. O lote precisa caber na autorização e no saldo incluído, sem cobrança excedente.')
    const selected = texts.slice(offset, offset + limit)
    if (!selected.length && offset < texts.length) throw new HttpError(400, 'Lote inválido.')
    let generated = 0
    let reused = 0
    const items: Array<{ index: number; cache: 'HIT' | 'MISS'; path: string }> = []
    for (let index = 0; index < selected.length; index += 1) {
      if(!existing.has(tutorialAudioPath(voiceId,modelId,selected[index]).split('/').pop()!)){
        const current=await elevenlabs.user.subscription.get()
        if(current.characterLimit-current.characterCount<selected[index].length)throw new HttpError(409,'Saldo incluído insuficiente. A geração foi pausada para evitar cobrança excedente.')
      }
      const result = await getOrCreateTutorialAudio(client, elevenlabs, selected[index])
      if (result.cache === 'HIT') reused += 1
      else generated += 1
      items.push({ index: offset + index + 1, cache: result.cache, path: result.path })
    }
    const nextOffset = offset + selected.length
    return Response.json({ total: texts.length, offset, limit, processed: selected.length, nextOffset: nextOffset < texts.length ? nextOffset : null, generated, reused, bucket: 'tutorial-audio', items }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    return failure(error)
  }
}

export const config: Config = {
  path: '/api/tutorial-audio-prewarm',
  method: ['POST'],
}



