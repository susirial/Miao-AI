import type { GenerationProvider } from '../../../shared/types/generation'
import { isArkImageModelId, isArkVideoModelId } from '../../../shared/constants/aiModels'
import { ARK_IMAGE_PROTOCOL_VERSION } from './arkImage'
import { ARK_IMAGE_MODEL_ID } from './arkImageInput'
import { ARK_VIDEO_PROTOCOL_VERSION } from './arkVideo'
import { ARK_VIDEO_MODEL_ID } from './arkVideoInput'

export interface ResolvedMediaBackend {
  provider: GenerationProvider
  backendModelId: string
  protocolVersion: string
}

function badRequest(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 400, statusMessage: message })
}

export function resolveMediaGenerationBackend(model: string): ResolvedMediaBackend {
  if (isArkImageModelId(model)) {
    return {
      provider: 'ark-image',
      backendModelId: ARK_IMAGE_MODEL_ID,
      protocolVersion: ARK_IMAGE_PROTOCOL_VERSION,
    }
  }
  if (isArkVideoModelId(model)) {
    return {
      provider: 'ark-video',
      backendModelId: ARK_VIDEO_MODEL_ID,
      protocolVersion: ARK_VIDEO_PROTOCOL_VERSION,
    }
  }
  return badRequest('This model is not available for generation')
}
