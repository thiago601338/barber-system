import type { Config } from '@netlify/functions'
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js'
import { body, db, failure, text, userFromRequest } from './_shared/core.ts'
import { elevenLabsApiKey, getOrCreateTutorialAudio, tutorialAudioResponse } from './_shared/tutorialAudio.ts'
import { requireTutorialText } from './_shared/tutorialAudioCatalog.ts'

type AudioInput = { text?: unknown }

export default async (request: Request) => {
  try {
    const client = db()
    const user = await userFromRequest(request, client)
    const payload = await body<AudioInput>(request)
    const tutorialText = text(payload.text, 'Texto do tutorial', 1200)
    await requireTutorialText(client, user.id, tutorialText)
    const elevenlabs = new ElevenLabsClient({ apiKey: elevenLabsApiKey() })
    const result = await getOrCreateTutorialAudio(client, elevenlabs, tutorialText, false)
    return tutorialAudioResponse(result.audio, result.cache)
  } catch (error) {
    return failure(error)
  }
}

export const config: Config = {
  path: '/api/tutorial-audio',
  method: ['POST'],
}
