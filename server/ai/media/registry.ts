import type { GenerationProvider } from '../../../shared/types/generation'
import type { MediaBackend, MediaBackendStartResult, MediaJobDocument } from './types'
import { generationProvider } from '../../utils/generationJobs'
import { arkImageBackend } from './arkImage'
import { arkVideoBackend } from './arkVideo'

const UNKNOWN_BACKEND_MESSAGE = 'This generation backend is not available. Please generate again.'

const localMediaBackend: MediaBackend = {
  provider: 'local',
  protocolVersion: 'local-v1',
  async start() {
    throw new Error('The local generation worker is not available.')
  },
  async sync(job) {
    return job
  },
}

export const MEDIA_BACKENDS: Partial<Record<GenerationProvider, MediaBackend>> = {
  'ark-image': arkImageBackend,
  'ark-video': arkVideoBackend,
  'local': localMediaBackend,
}

export function mediaBackendFor(provider: GenerationProvider | undefined) {
  return provider ? MEDIA_BACKENDS[provider] : undefined
}

async function failUnknownBackend(job: MediaJobDocument) {
  job.state = 'fail'
  job.failCode = 'backend_unavailable'
  job.failMsg = UNKNOWN_BACKEND_MESSAGE
  job.lastSyncAt = new Date()
  await job.save()
  return job
}

export async function startMediaBackend(job: MediaJobDocument): Promise<MediaBackendStartResult | null> {
  const backend = mediaBackendFor(generationProvider(job))
  if (!backend) {
    await failUnknownBackend(job)
    return null
  }
  return backend.start(job)
}

export async function syncMediaBackend(job: MediaJobDocument) {
  const backend = mediaBackendFor(generationProvider(job))
  if (!backend)
    return failUnknownBackend(job)
  return backend.sync(job)
}

export async function removeMediaBackend(job: MediaJobDocument) {
  const backend = mediaBackendFor(generationProvider(job))
  if (!backend?.remove)
    return
  await backend.remove(job)
}
