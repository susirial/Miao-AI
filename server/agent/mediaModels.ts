import type { AiModelConfig } from '~~/shared/types/aiModel'
import type { GenerationProvider } from '~~/shared/types/generation'
import type { GenerateImageArgs, ResolvedGenerateVideo } from './types'
import { canonicalizeAgnesImageModelId } from '~~/shared/constants/aiModels'
import { AGENT_MODELS } from '~~/shared/utils/agentModels'
import { AGNES_IMAGE_MAX_REFERENCES, sanitizeAgnesImageInput } from '../ai/media/agnesImageInput'
import { sanitizeAgnesVideoInput } from '../ai/media/agnesVideoInput'
import { sanitizeArkImageInput } from '../ai/media/arkImageInput'
import { sanitizeArkVideoInput } from '../ai/media/arkVideoInput'
import { resolveMediaGenerationBackend } from '../ai/media/resolve'
import { materializeAgnesVideoSources } from '../utils/publicMediaOrigin'
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

export interface AgentMediaCapabilities {
  arkOk: boolean
  agnesOk: boolean
  presetImage: 'ark' | 'agnes' | 'unavailable'
  presetVideo: 'ark' | 'agnes' | 'unavailable'
  fingerprint: string
}

function serviceError() {
  return Object.assign(
    new Error('Configure and test the selected media provider in Service connection before using this media tool.'),
    { failCode: 'MEDIA_PROVIDER_NOT_READY' },
  )
}

export function availableAgentModels() {
  return [...AGENT_MODELS]
}

function preferredPreset(
  family: 'ark' | 'agnes',
  preferredOk: boolean,
  otherOk: boolean,
): 'ark' | 'agnes' | 'unavailable' {
  if (preferredOk)
    return family
  if (otherOk)
    return family === 'ark' ? 'agnes' : 'ark'
  return 'unavailable'
}

export function captureMediaCapabilities(overrides?: {
  imageFamily?: string
  videoFamily?: string
}): AgentMediaCapabilities {
  const settings = readServiceSettings()
  const status = publicServiceStatus(settings)
  const arkOk = status.providers.ark.ok
  const agnesOk = status.providers.agnes.ok
  const selectedImageFamily = overrides?.imageFamily === 'agnes-image' || overrides?.imageFamily === 'ark-image'
    ? overrides.imageFamily
    : status.selectedImageFamily === 'agnes-image' || settings.selectedImageFamily === 'agnes-image'
      ? 'agnes-image'
      : 'ark-image'
  const selectedVideoFamily = overrides?.videoFamily === 'agnes-video' || overrides?.videoFamily === 'ark-video'
    ? overrides.videoFamily
    : status.selectedVideoFamily === 'agnes-video' || settings.selectedVideoFamily === 'agnes-video'
      ? 'agnes-video'
      : 'ark-video'
  const imageFamily = selectedImageFamily === 'agnes-image' ? 'agnes' : 'ark'
  const videoFamily = selectedVideoFamily === 'agnes-video' ? 'agnes' : 'ark'
  return {
    arkOk,
    agnesOk,
    presetImage: preferredPreset(imageFamily, imageFamily === 'agnes' ? agnesOk : arkOk, imageFamily === 'agnes' ? arkOk : agnesOk),
    presetVideo: preferredPreset(videoFamily, videoFamily === 'agnes' ? agnesOk : arkOk, videoFamily === 'agnes' ? arkOk : agnesOk),
    fingerprint: `ark:${arkOk}|agnes:${agnesOk}|img:${selectedImageFamily}|vid:${selectedVideoFamily}`,
  }
}

function assertReady(provider: GenerationProvider, caps: AgentMediaCapabilities) {
  const ready = provider === 'agnes-image' || provider === 'agnes-video' ? caps.agnesOk : caps.arkOk
  if (!ready)
    throw serviceError()
}

function snapshots(provider: GenerationProvider, backendModelId: string, input: Record<string, unknown>) {
  if (provider === 'ark-image') {
    return {
      providerMetadata: { arkImage: { submissionState: 'not_started' } },
      requestBody: { arkImage: { model: backendModelId, input } },
    }
  }
  if (provider === 'ark-video') {
    return {
      providerMetadata: { arkVideo: { submissionState: 'not_started' } },
      requestBody: { arkVideo: { model: backendModelId, input } },
    }
  }
  if (provider === 'agnes-image') {
    return {
      providerMetadata: { agnesImage: { submissionState: 'not_started' } },
      requestBody: { agnesImage: { model: backendModelId, input } },
    }
  }
  return {
    providerMetadata: { agnesVideo: { submissionState: 'not_started' } },
    requestBody: { agnesVideo: { model: backendModelId, input } },
  }
}

export async function resolveAgentGenerationSpec(
  model: AiModelConfig,
  rawInput: Record<string, unknown>,
  caps = captureMediaCapabilities(),
): Promise<AgentGenerationSpec> {
  const resolved = resolveMediaGenerationBackend(model.id)
  const materialized = resolved.provider === 'agnes-video'
    ? await materializeAgnesVideoSources(rawInput)
    : rawInput
  const input = resolved.provider === 'agnes-image'
    ? sanitizeAgnesImageInput(model.id, materialized)
    : resolved.provider === 'agnes-video'
      ? sanitizeAgnesVideoInput(model.id, materialized)
      : resolved.provider === 'ark-image'
        ? sanitizeArkImageInput(model.id, materialized)
        : sanitizeArkVideoInput(model.id, materialized)
  assertReady(resolved.provider, caps)
  return {
    modelId: canonicalizeAgnesImageModelId(model.id),
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
  const model = AGENT_MODELS.find(item => item.id === canonicalizeAgnesImageModelId(modelId))
  if (!model)
    throw new Error(`Unknown Agent model: ${modelId}`)
  return model
}

export function presetImageModelId(
  args: Pick<GenerateImageArgs, 'input_urls' | 'reference_images'>,
  caps = captureMediaCapabilities(),
) {
  if (args.reference_images?.length || args.input_urls.length > 1) {
    return caps.presetImage === 'agnes'
      ? 'agnes/image-2.5-flash-reference-to-image'
      : 'seedream/5-pro-reference-to-image'
  }
  if (args.input_urls.length) {
    return caps.presetImage === 'agnes'
      ? 'agnes/image-2.5-flash-image-to-image'
      : 'seedream/5-pro-image-to-image'
  }
  return caps.presetImage === 'agnes'
    ? 'agnes/image-2.5-flash-text-to-image'
    : 'seedream/5-pro-text-to-image'
}

function agnesImageRequest(args: GenerateImageArgs) {
  const size = ['1K', '2K', '3K', '4K'].includes(args.resolution) ? args.resolution : '1K'
  const ratio = args.aspect_ratio === 'auto' ? '1:1' : args.aspect_ratio
  if (!['1:1', '3:4', '4:3', '16:9', '9:16', '2:3', '3:2', '21:9'].includes(ratio))
    throw new Error(`Agnes Image 2.5 Flash has no verified ratio for ${args.aspect_ratio}`)
  return { size, ratio }
}

export async function preparePresetImage(args: GenerateImageArgs, caps = captureMediaCapabilities()) {
  if (caps.presetImage === 'unavailable')
    throw serviceError()
  const modelId = presetImageModelId(args, caps)
  const references = (args.reference_images?.length ? args.reference_images : args.input_urls)
    .slice(0, caps.presetImage === 'agnes' ? AGNES_IMAGE_MAX_REFERENCES : undefined)
  const raw = caps.presetImage === 'agnes'
    ? {
        prompt: args.prompt,
        ...agnesImageRequest(args),
        ...(references.length ? { input_urls: references } : {}),
      }
    : {
        prompt: args.prompt,
        aspect_ratio: args.aspect_ratio,
        resolution: String(args.resolution).toUpperCase() === '2K' ? '2K' : '1K',
        ...(modelId === 'seedream/5-pro-reference-to-image'
          ? { reference_images: references }
          : references.length ? { input_urls: references } : {}),
      }
  return resolveAgentGenerationSpec(modelById(modelId), raw, caps)
}

export function presetVideoModelId(args: ResolvedGenerateVideo, caps = captureMediaCapabilities()) {
  const mode = args.reference_image_urls?.length || args.reference_video_urls?.length
    ? 'reference-to-video'
    : args.first_frame_url || args.last_frame_url
      ? 'image-to-video'
      : 'text-to-video'
  return caps.presetVideo === 'agnes'
    ? `agnes/video-2.5-flash-${mode}`
    : `bytedance/seedance-2-${mode}`
}

export async function preparePresetVideo(args: ResolvedGenerateVideo, caps = captureMediaCapabilities()) {
  if (caps.presetVideo === 'unavailable')
    throw serviceError()
  const modelId = presetVideoModelId(args, caps)
  const raw: Record<string, unknown> = {
    prompt: args.prompt,
    aspect_ratio: args.aspect_ratio,
    resolution: args.resolution,
    duration: args.duration,
  }
  if (args.generate_audio !== undefined)
    raw.generate_audio = args.generate_audio
  if (args.first_frame_url)
    raw.first_frame_url = args.first_frame_url
  if (args.last_frame_url)
    raw.last_frame_url = args.last_frame_url
  if (args.reference_image_urls?.length)
    raw.reference_image_urls = args.reference_image_urls
  if (args.reference_video_urls?.length)
    raw.reference_video_urls = args.reference_video_urls
  return resolveAgentGenerationSpec(modelById(modelId), raw, caps)
}
