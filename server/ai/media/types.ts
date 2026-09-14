import type { GenerationProvider } from '../../../shared/types/generation'
import type { IGenerationJob } from '../../models/generationJob'
import type { StoredDocument } from '../../utils/sqlite'

export type MediaJobDocument = StoredDocument<IGenerationJob>

export interface MediaBackendStartResult {
  status: 'pending' | 'completed'
  providerTaskId: string
  providerMetadata: Record<string, unknown>
  requestBodyPatch?: Record<string, unknown>
  resultUrls?: string[]
  resultJson?: string
}

export interface MediaBackend {
  readonly provider: GenerationProvider
  readonly protocolVersion: string
  start: (job: MediaJobDocument) => Promise<MediaBackendStartResult>
  sync: (job: MediaJobDocument) => Promise<MediaJobDocument>
  remove?: (job: MediaJobDocument) => Promise<void>
}
