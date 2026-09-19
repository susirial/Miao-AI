import type { ImageFamilyId, VideoFamilyId } from '../constants/modelCatalog'
import { canonicalizeAgnesImageModelId } from '../constants/aiModels'
import { DEFAULT_IMAGE_FAMILY, DEFAULT_VIDEO_FAMILY } from '../constants/modelCatalog'

export interface SelectableGeneratorModel {
  id: string
  name: string
  category: string
  task: string
}

export function mediaFamilyForModelId(modelId: string): ImageFamilyId | VideoFamilyId | null {
  if (modelId.startsWith('agnes/image-'))
    return 'agnes-image'
  if (modelId.startsWith('agnes/video-'))
    return 'agnes-video'
  if (modelId.startsWith('seedream/'))
    return 'ark-image'
  if (modelId.startsWith('bytedance/seedance-'))
    return 'ark-video'
  return null
}

export function preferredFamilyForTask(
  task: string,
  imageFamily: string = DEFAULT_IMAGE_FAMILY,
  videoFamily: string = DEFAULT_VIDEO_FAMILY,
) {
  return /video/i.test(task) ? videoFamily : imageFamily
}

function providerReadyForFamily(
  family: string | null,
  readyProviders?: { ark?: boolean, agnes?: boolean },
) {
  if (!family || !readyProviders)
    return true
  if (family.startsWith('agnes-'))
    return readyProviders.agnes !== false
  if (family.startsWith('ark-') || family.startsWith('seedream') || family.includes('seedance'))
    return readyProviders.ark !== false
  return true
}

export function resolveGeneratorModelId(options: {
  models: SelectableGeneratorModel[]
  explicitModelId?: string | null
  imageFamily?: string
  videoFamily?: string
  previousModelName?: string | null
  catalog?: SelectableGeneratorModel[]
  readyProviders?: { ark?: boolean, agnes?: boolean }
}): string {
  const models = options.models
  if (!models.length)
    return ''

  const catalog = options.catalog ?? models
  const explicitModelId = canonicalizeAgnesImageModelId(options.explicitModelId?.trim() || '')
  if (explicitModelId) {
    const exact = models.find(model => model.id === explicitModelId)
    if (exact)
      return exact.id

    const explicitModel = catalog.find(model => model.id === explicitModelId)
    const explicitName = explicitModel?.name || options.previousModelName || ''
    const sameName = explicitName ? models.find(model => model.name === explicitName) : undefined
    if (sameName)
      return sameName.id

    const explicitFamily = mediaFamilyForModelId(explicitModelId)
    const sameFamily = explicitFamily
      ? models.find(model => mediaFamilyForModelId(model.id) === explicitFamily)
      : undefined
    if (sameFamily)
      return sameFamily.id
  }

  const family = preferredFamilyForTask(models[0]!.task, options.imageFamily, options.videoFamily)
  const preferred = models.find(model => mediaFamilyForModelId(model.id) === family)
  if (preferred && providerReadyForFamily(family, options.readyProviders))
    return preferred.id

  const firstReady = models.find((model) => {
    const modelFamily = mediaFamilyForModelId(model.id)
    return providerReadyForFamily(modelFamily, options.readyProviders)
  })
  if (firstReady)
    return firstReady.id

  if (options.previousModelName) {
    const sameName = models.find(model => model.name === options.previousModelName)
    if (sameName)
      return sameName.id
  }

  return models[0]!.id
}
