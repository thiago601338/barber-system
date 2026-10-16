import { createHash } from 'node:crypto'
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { HttpError, optionalSetting } from './core.ts'

export const AUDIO_BUCKET = 'tutorial-audio'

type VoiceCandidate = { voiceId?: string; name?: string; labels?: Record<string, string>; verifiedLanguages?: Array<{ language?: string; accent?: string }> }

let cachedVoiceId: string | null = null
let bucketReady = false

export function elevenLabsApiKey(): string {
  const key = optionalSetting('ELEVENLABS_API_KEY')
  if (!key) throw new HttpError(503, 'Integração não configurada: ELEVENLABS_API_KEY')
  return key
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

function voiceScore(voice: VoiceCandidate, search: string): number {
  const name = normalize(voice.name || '')
  const target = normalize(search)
  let score = 0
  if (name === target) score += 100
  if (name.includes(target)) score += 70
  const languageBlob = normalize(JSON.stringify({ labels: voice.labels, verifiedLanguages: voice.verifiedLanguages }))
  if (languageBlob.includes('pt') || languageBlob.includes('brazil') || languageBlob.includes('brasil')) score += 15
  return score
}

export async function resolveTutorialVoiceId(client: ElevenLabsClient): Promise<string> {
  const configured = optionalSetting('ELEVENLABS_VOICE_ID')
  if (configured) return configured
  if (cachedVoiceId) return cachedVoiceId
  const search = optionalSetting('ELEVENLABS_VOICE_SEARCH') || 'Roberta'
  const response = await client.voices.search({ search, pageSize: 30 })
  const candidates = [...response.voices].sort((a, b) => voiceScore(b, search) - voiceScore(a, search))
  const voice = candidates.find(candidate => candidate.voiceId && voiceScore(candidate, search) >= 70)
  if (!voice?.voiceId) throw new HttpError(503, 'Voz Roberta não encontrada na conta ElevenLabs. Configure ELEVENLABS_VOICE_ID com o ID da voz Roberta.')
  cachedVoiceId = voice.voiceId
  return voice.voiceId
}

export function tutorialAudioPath(voiceId: string, modelId: string, tutorialText: string): string {
  const hash = createHash('sha256').update(JSON.stringify({ voiceId, modelId, tutorialText })).digest('hex')
  return `v1/${voiceId}/${modelId}/${hash}.mp3`
}

export async function ensureTutorialAudioBucket(client: SupabaseClient): Promise<void> {
  if (bucketReady) return
  const { error } = await client.storage.getBucket(AUDIO_BUCKET)
  if (!error) { bucketReady = true; return }
  const { error: createError } = await client.storage.createBucket(AUDIO_BUCKET, {
    public: false,
    allowedMimeTypes: ['audio/mpeg'],
    fileSizeLimit: '3MB',
  })
  if (createError && !/already exists|already_exist|Duplicate/i.test(createError.message)) throw createError
  bucketReady = true
}

export async function cachedTutorialAudio(client: SupabaseClient, path: string): Promise<Blob | null> {
  const { data, error } = await client.storage.from(AUDIO_BUCKET).download(path)
  if (data && !error) return data
  return null
}

export async function saveTutorialAudio(client: SupabaseClient, path: string, audio: Blob): Promise<void> {
  const { error } = await client.storage.from(AUDIO_BUCKET).upload(path, audio, {
    contentType: 'audio/mpeg',
    cacheControl: '31536000',
    upsert: false,
  })
  if (error && !/already exists|already_exist|Duplicate/i.test(error.message)) throw error
}

export function tutorialAudioResponse(audio: Blob, cacheStatus: 'HIT' | 'MISS'): Response {
  return new Response(audio.stream(), {
    headers: {
      'content-type': 'audio/mpeg',
      'cache-control': 'private, max-age=86400',
      'x-tutorial-audio-cache': cacheStatus,
    },
  })
}

export function tutorialModelId(): string {
  return optionalSetting('ELEVENLABS_MODEL_ID') || 'eleven_multilingual_v2'
}

export async function getOrCreateTutorialAudio(client: SupabaseClient, elevenlabs: ElevenLabsClient, tutorialText: string, allowGeneration = true): Promise<{ audio: Blob; cache: 'HIT' | 'MISS'; path: string; voiceId: string; modelId: string }> {
  const modelId = tutorialModelId()
  const voiceId = await resolveTutorialVoiceId(elevenlabs)
  const path = tutorialAudioPath(voiceId, modelId, tutorialText)
  await ensureTutorialAudioBucket(client)
  const stored = await cachedTutorialAudio(client, path)
  if (stored) return { audio: stored, cache: 'HIT', path, voiceId, modelId }
  if (!allowGeneration) throw new HttpError(503,'A narração desta etapa ainda está sendo preparada. Você pode seguir o guia pelo texto; o administrador deve concluir a pré-geração dos áudios.')
  const stream = await elevenlabs.textToSpeech.convert(voiceId, {
    text: tutorialText,
    modelId,
    outputFormat: 'mp3_44100_128',
    voiceSettings: { stability: 0.58, similarityBoost: 0.82, style: 0.18, useSpeakerBoost: true },
  })
  const rawAudio = await new Response(stream).arrayBuffer()
  const generated = new Blob([rawAudio], { type: 'audio/mpeg' })
  await saveTutorialAudio(client, path, generated)
  return { audio: generated, cache: 'MISS', path, voiceId, modelId }
}
