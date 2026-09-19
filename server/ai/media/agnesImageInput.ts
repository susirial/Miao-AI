import {
  AGNES_IMAGE_LEGACY_MODEL_IDS,
  AGNES_IMAGE_MODEL_IDS,
  AGNES_IMAGE_RATIOS,
  AGNES_IMAGE_SIZE_TIERS,
  canonicalizeAgnesImageModelId,
} from '~~/shared/constants/aiModels'

export const AGNES_IMAGE_MODEL_ID = 'agnes-image-2.5-flash'
export const AGNES_IMAGE_LEGACY_MODEL_ID = 'agnes-image-2.0-flash'
export const AGNES_IMAGE_LOGICAL_MODELS = AGNES_IMAGE_MODEL_IDS
export const AGNES_IMAGE_SIZES = AGNES_IMAGE_SIZE_TIERS
export const AGNES_IMAGE_MAX_REFERENCES = 4

const LEGACY_PIXEL_TO_TIER = {
  '1024x1024': { size: '1K', ratio: '1:1' },
  '1024x768': { size: '1K', ratio: '4:3' },
  '768x1024': { size: '1K', ratio: '3:4' },
  '1536x1024': { size: '1K', ratio: '3:2' },
  '2048x2048': { size: '2K', ratio: '1:1' },
} as const

function badInput(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 400, statusMessage: message })
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function values(value: unknown) {
  const list = Array.isArray(value) ? value : value == null || value === '' ? [] : [value]
  return list.map(stringValue).filter(Boolean)
}

export function isAgnesImageModel(model: string) {
  return (AGNES_IMAGE_MODEL_IDS as readonly string[]).includes(model)
    || (AGNES_IMAGE_LEGACY_MODEL_IDS as readonly string[]).includes(model)
}

export function isAgnesImageBackendModel(model: string) {
  return model === AGNES_IMAGE_MODEL_ID || model === AGNES_IMAGE_LEGACY_MODEL_ID
}

export function mapAgnesImageSizeFields(raw: Record<string, unknown>) {
  const requestedSize = stringValue(raw.size)
  const requestedRatio = stringValue(raw.ratio || raw.aspect_ratio)
  const legacy = LEGACY_PIXEL_TO_TIER[requestedSize as keyof typeof LEGACY_PIXEL_TO_TIER]
  if (legacy) {
    return {
      size: legacy.size,
      ratio: (AGNES_IMAGE_RATIOS as readonly string[]).includes(requestedRatio) ? requestedRatio : legacy.ratio,
    }
  }
  const size = requestedSize || '1K'
  if (!(AGNES_IMAGE_SIZE_TIERS as readonly string[]).includes(size))
    badInput(`Agnes Image 2.5 Flash size must be one of ${AGNES_IMAGE_SIZE_TIERS.join(', ')}`)
  const ratio = requestedRatio || '1:1'
  if (!(AGNES_IMAGE_RATIOS as readonly string[]).includes(ratio))
    badInput(`Agnes Image 2.5 Flash ratio must be one of ${AGNES_IMAGE_RATIOS.join(', ')}`)
  return { size, ratio }
}

export function sanitizeAgnesImageInput(model: string, raw: Record<string, unknown>) {
  if (!isAgnesImageModel(model))
    badInput('This image model is not supported by Agnes')
  const prompt = stringValue(raw.prompt)
  if (!prompt)
    badInput('prompt is required')
  const { size, ratio } = mapAgnesImageSizeFields(raw)
  const canonicalModel = canonicalizeAgnesImageModelId(model)
  const sources = values(raw.input_urls ?? raw.image_urls ?? raw.image)
  const imageToImage = canonicalModel.endsWith('-image-to-image')
  const referenceToImage = canonicalModel.endsWith('-reference-to-image')
  if (imageToImage && sources.length !== 1)
    badInput('Agnes image-to-image requires exactly one source image')
  if (referenceToImage && sources.length === 0)
    badInput('Agnes reference-to-image requires at least one source image')
  if (!imageToImage && !referenceToImage && sources.length)
    badInput('Agnes text-to-image does not accept source images')
  if (sources.length > AGNES_IMAGE_MAX_REFERENCES)
    badInput(`Agnes reference-to-image supports at most ${AGNES_IMAGE_MAX_REFERENCES} images`)

  return {
    prompt,
    size,
    ratio,
    ...(sources.length ? { input_urls: sources } : {}),
  }
}
