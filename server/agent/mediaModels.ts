import type { AiModelConfig } from '~~/shared/types/aiModel'
import type { GenerationProvider } from '~~/shared/types/generation'
import type { GenerateImageArgs, ResolvedGenerateVideo } from './types'
import { AGENT_MODELS } from '~~/shared/utils/agentModels'
import { sanitizeArkImageInput } from '../ai/media/arkImageInput'
import { sanitizeArkVideoInput } from '../ai/media/arkVideoInput'
import { resolveMediaGenerationBackend } from '../ai/media/resolve'
import { publicServiceStatus, readServiceSettings } from '../utils/serviceSettings'

export interface AgentGenerationSpec {
  modelId: string
  modelName: string
  category: string
  task: string
  input: Record<string, unknown>
  provider: GenerationProvider
  backendModelId: string
  protocolVersion: string
  providerMetadata: Record<string, unknown>
  requestBody: Record<string, unknown>
}

function serviceError() {
  return new Error('Configure and test Ark in Service connection before using this media tool.')
}

export function availableAgentModels() {
  return [...AGENT_MODELS]
}

function assertReady() {
  if (!publicServiceStatus(readServiceSettings()).providers.ark.ok)
    throw serviceError()
}

function snapshots(provider: GenerationProvider, backendModelId: string, input: Record<string, unknown>) {
  if (provider === 'ark-image') {
    return {
      providerMetadata: { arkImage: { submissionState: 'not_started' } },
      requestBody: { arkImage: { model: backendModelId, input } },
    }
  }
  return {
    providerMetadata: { arkVideo: { submissionState: 'not_started' } },
    requestBody: { arkVideo: { model: backendModelId, input } },
  }
}

export function resolveAgentGenerationSpec(
  model: AiModelConfig,
  rawInput: Record<string, unknown>,
): AgentGenerationSpec {
  const resolved = resolveMediaGenerationBackend(model.id)
  const input = resolved.provider === 'ark-image'
    ? sanitizeArkImageInput(model.id, rawInput)
    : sanitizeArkVideoInput(model.id, rawInput)
  assertReady()
  return {
    modelId: model.id,
    modelName: model.name,
    category: model.category,
    task: model.task,
    input,
    provider: resolved.provider,
    backendModelId: resolved.backendModelId,
    protocolVersion: resolved.protocolVersion,
    ...snapshots(resolved.provider, resolved.backendModelId, input),
  }
}

function modelById(modelId: string) {
  const model = AGENT_MODELS.find(item => item.id === modelId)
  if (!model)
    throw new Error(`Unknown Agent model: ${modelId}`)
  return model
}

export function presetImageModelId(args: Pick<GenerateImageArgs, 'input_urls' | 'reference_images'>) {
  if (args.reference_images?.length || args.input_urls.length > 1)
    return 'seedream/5-pro-reference-to-image'
  if (args.input_urls.length)
    return 'seedream/5-pro-image-to-image'
  return 'seedream/5-pro-text-to-image'
}

export function preparePresetImage(args: GenerateImageArgs) {
  const modelId = presetImageModelId(args)
  const references = args.reference_images?.length ? args.reference_images : args.input_urls
  return resolveAgentGenerationSpec(modelById(modelId), {
    prompt: args.prompt,
    aspect_ratio: args.aspect_ratio,
    resolution: String(args.resolution).toUpperCase() === '2K' ? '2K' : '1K',
    ...(modelId === 'seedream/5-pro-reference-to-image'
      ? { reference_images: references }
      : references.length ? { input_urls: references } : {}),
  })
}

export function presetVideoModelId(args: ResolvedGenerateVideo) {
  const mode = args.reference_image_urls?.length || args.reference_video_urls?.length
    ? 'reference-to-video'
    : args.first_frame_url
      ? 'image-to-video'
      : 'text-to-video'
  return `bytedance/seedance-2-${mode}`
}

export function preparePresetVideo(args: ResolvedGenerateVideo) {
  const modelId = presetVideoModelId(args)
  const raw: Record<string, unknown> = {
    prompt: args.prompt,
    aspect_ratio: args.aspect_ratio,
    resolution: args.resolution,
    duration: args.duration,
    generate_audio: args.generate_audio,
  }
  if (args.first_frame_url)
    raw.first_frame_url = args.first_frame_url
  if (args.last_frame_url)
    raw.last_frame_url = args.last_frame_url
  if (args.reference_image_urls?.length)
    raw.reference_image_urls = args.reference_image_urls
  if (args.reference_video_urls?.length)
    raw.reference_video_urls = args.reference_video_urls
  return resolveAgentGenerationSpec(modelById(modelId), raw)
}
