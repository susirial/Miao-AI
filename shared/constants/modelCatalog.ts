import type { ServiceCapability, TextModelCatalogEntry, TextProviderId } from '../types/provider'

export const DEFAULT_TEXT_MODEL_ID = 'ark/seed-2.1-pro'

export const IMAGE_FAMILY_IDS = ['ark-image', 'agnes-image'] as const
export const VIDEO_FAMILY_IDS = ['ark-video', 'agnes-video'] as const

export type ImageFamilyId = typeof IMAGE_FAMILY_IDS[number]
export type VideoFamilyId = typeof VIDEO_FAMILY_IDS[number]
export type MediaFamilyId = ImageFamilyId | VideoFamilyId

export const DEFAULT_IMAGE_FAMILY: ImageFamilyId = 'ark-image'
export const DEFAULT_VIDEO_FAMILY: VideoFamilyId = 'ark-video'

export interface MediaFamilyCatalogEntry {
  id: MediaFamilyId
  name: string
  provider: Extract<TextProviderId, 'ark' | 'agnes'>
  capability: Extract<ServiceCapability, 'image' | 'video'>
}

export const MEDIA_FAMILY_CATALOG: readonly MediaFamilyCatalogEntry[] = [
  { id: 'ark-image', name: 'Seedream 5.0 Pro', provider: 'ark', capability: 'image' },
  { id: 'agnes-image', name: 'Agnes Image 2.5 Flash', provider: 'agnes', capability: 'image' },
  { id: 'ark-video', name: 'Seedance 2.0', provider: 'ark', capability: 'video' },
  { id: 'agnes-video', name: 'Agnes Video 2.5 Flash', provider: 'agnes', capability: 'video' },
] as const

export function isImageFamilyId(value: unknown): value is ImageFamilyId {
  return typeof value === 'string' && (IMAGE_FAMILY_IDS as readonly string[]).includes(value)
}

export function isVideoFamilyId(value: unknown): value is VideoFamilyId {
  return typeof value === 'string' && (VIDEO_FAMILY_IDS as readonly string[]).includes(value)
}

export function getMediaFamily(familyId: string) {
  return MEDIA_FAMILY_CATALOG.find(family => family.id === familyId)
}

export function imageFamilyCatalog() {
  return MEDIA_FAMILY_CATALOG.filter(family => family.capability === 'image')
}

export function videoFamilyCatalog() {
  return MEDIA_FAMILY_CATALOG.filter(family => family.capability === 'video')
}

export const TEXT_MODEL_CATALOG: readonly TextModelCatalogEntry[] = [
  {
    id: DEFAULT_TEXT_MODEL_ID,
    name: 'Seed 2.1 Pro',
    provider: 'ark',
    upstreamModelId: 'doubao-seed-2-1-pro-260628',
    capabilities: { vision: true, tools: true, reasoning: true },
    description: 'Vision, tools, and reasoning',
  },
  {
    id: 'ark/seed-2.1-turbo',
    name: 'Seed 2.1 Turbo',
    provider: 'ark',
    upstreamModelId: 'doubao-seed-2-1-turbo-260628',
    capabilities: { vision: true, tools: true, reasoning: true },
    description: 'Faster vision model',
  },
  {
    id: 'deepseek/deepseek-v4.1-flash',
    name: 'DeepSeek V4.1 Flash',
    provider: 'deepseek',
    upstreamModelId: 'deepseek-flash',
    capabilities: { vision: true, tools: true, reasoning: true },
    description: 'DeepSeek official · Vision and tools',
  },
  {
    id: 'zai/glm-5.3',
    name: 'GLM 5.3',
    provider: 'zai',
    upstreamModelId: 'glm-5.3',
    capabilities: { vision: false, tools: true, reasoning: true },
    description: 'Z.ai official · Text only, reasoning always on',
  },
  {
    id: 'agnes/agnes-2.5-flash',
    name: 'Agnes 2.5 Flash',
    provider: 'agnes',
    upstreamModelId: 'agnes-2.5-flash',
    capabilities: { vision: true, tools: true, reasoning: true },
    description: 'Agnes official · Public image URLs, tools, and reasoning',
  },
  {
    id: 'agnes/agnes-3.0-flash',
    name: 'Agnes 3.0 Flash',
    provider: 'agnes',
    upstreamModelId: 'agnes-3.0-flash',
    capabilities: { vision: true, tools: true, reasoning: true },
    description: 'Agnes official · Public image URLs, tools, and reasoning',
  },
] as const

export const DEFAULT_AGNES_TEXT_MODEL_ID = 'agnes/agnes-3.0-flash'

export function getTextModel(modelId: string) {
  return TEXT_MODEL_CATALOG.find(model => model.id === modelId)
}
