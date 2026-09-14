export const ARK_IMAGE_MODEL_ID = 'doubao-seedream-5-0-pro-260628'
export const ARK_IMAGE_LOGICAL_MODELS = [
  'seedream/5-pro-text-to-image',
  'seedream/5-pro-image-to-image',
  'seedream/5-pro-reference-to-image',
] as const

export const ARK_IMAGE_MAX_BYTES = 30 * 1024 * 1024
export const ARK_IMAGE_MAX_REQUEST_BYTES = 64 * 1024 * 1024
export const ARK_IMAGE_MAX_REFERENCES = 10

const MIN_OUTPUT_PIXELS = 921_600
const MAX_OUTPUT_PIXELS = 4_194_304
const RATIO_BY_IMAGE_SIZE: Record<string, string> = {
  square: '1:1',
  square_hd: '1:1',
  portrait_4_3: '3:4',
  portrait_16_9: '9:16',
  landscape_4_3: '4:3',
  landscape_16_9: '16:9',
}

function badInput(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 400 })
}

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function positionalImages(input: Record<string, unknown>, keys: string[]) {
  const images: string[] = []
  for (const key of keys) {
    const value = input[key]
    const values = Array.isArray(value) ? value : value == null || value === '' ? [] : [value]
    for (const item of values) {
      const source = stringValue(item)
      if (source)
        images.push(source)
    }
  }
  return images
}

function imageList(input: Record<string, unknown>) {
  const references = positionalImages(input, ['reference_images', 'reference_image_urls'])
  if (references.length)
    return references
  return positionalImages(input, ['input_urls', 'image_urls', 'image_input', 'image', 'image_url'])
}

function normalizeResolution(value: unknown) {
  const resolution = stringValue(value).toUpperCase()
  if (!resolution)
    return ''
  if (resolution !== '1K' && resolution !== '2K')
    badInput('Seedream 5 Pro only supports 1K or 2K output')
  return resolution
}

function exactSize(width: unknown, height: unknown) {
  const w = Number(width)
  const h = Number(height)
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0)
    badInput('Image size must contain positive integer width and height')
  const pixels = w * h
  const ratio = w / h
  if (pixels < MIN_OUTPUT_PIXELS || pixels > MAX_OUTPUT_PIXELS || ratio < 1 / 16 || ratio > 16)
    badInput('Seedream 5 Pro image size is outside the supported range')
  return `${w}x${h}`
}

function ratioSize(ratioValue: unknown, resolution: string) {
  const ratio = stringValue(ratioValue).toLowerCase()
  if (!ratio || ratio === 'auto' || ratio === 'adaptive')
    return resolution
  const match = ratio.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/)
  if (!match)
    badInput('Invalid image aspect ratio')
  const widthRatio = Number(match[1])
  const heightRatio = Number(match[2])
  const ratioNumber = widthRatio / heightRatio
  if (!Number.isFinite(ratioNumber) || ratioNumber < 1 / 16 || ratioNumber > 16)
    badInput('Image aspect ratio is outside the supported range')
  const targetPixels = resolution === '1K' ? 1024 ** 2 : 2048 ** 2
  const width = Math.max(16, Math.floor(Math.sqrt(targetPixels * ratioNumber) / 16) * 16)
  const height = Math.max(16, Math.floor(Math.sqrt(targetPixels / ratioNumber) / 16) * 16)
  return exactSize(width, height)
}

export function isArkImageModel(model: string) {
  return (ARK_IMAGE_LOGICAL_MODELS as readonly string[]).includes(model)
}

export function arkImageSize(input: Record<string, unknown>) {
  const directSize = stringValue(input.size)
  if (directSize) {
    const match = directSize.match(/^(\d+)x(\d+)$/i)
    if (match)
      return exactSize(match[1], match[2])
    return ratioSize(input.aspect_ratio, normalizeResolution(directSize))
  }

  const configured = input.image_size
  const configuredObject = asRecord(configured)
  if (configuredObject)
    return exactSize(configuredObject.width, configuredObject.height)

  const configuredString = stringValue(configured)
  if (/^auto_[12]k$/i.test(configuredString))
    return ratioSize(input.aspect_ratio, configuredString.slice(-2).toUpperCase())
  if (RATIO_BY_IMAGE_SIZE[configuredString])
    return ratioSize(RATIO_BY_IMAGE_SIZE[configuredString], normalizeResolution(input.resolution) || '2K')
  if (configuredString && !/^auto$/i.test(configuredString))
    badInput('Invalid Seedream image size')

  const resolution = normalizeResolution(input.resolution)
    || (stringValue(input.quality).toLowerCase() === 'basic' ? '1K' : '2K')
  return ratioSize(input.aspect_ratio, resolution)
}

export function sanitizeArkImageInput(model: string, raw: Record<string, unknown>) {
  if (!isArkImageModel(model))
    badInput('This image model is not supported by Ark')
  const prompt = stringValue(raw.prompt)
  if (!prompt)
    badInput('prompt is required')

  const references = imageList(raw)
  const imageToImage = model === 'seedream/5-pro-image-to-image'
  const referenceToImage = model === 'seedream/5-pro-reference-to-image'
  if (imageToImage && references.length === 0)
    badInput('A source image is required')
  if (imageToImage && references.length > 1)
    badInput('Image-to-image edits one source image. Use reference-to-image for multiple references')
  if (referenceToImage && references.length === 0)
    badInput('At least one reference image is required')
  if (!imageToImage && !referenceToImage && references.length > 0)
    badInput('Reference images require the Seedream image-to-image or reference-to-image model')
  if (references.length > ARK_IMAGE_MAX_REFERENCES)
    badInput(`Seedream 5 Pro supports at most ${ARK_IMAGE_MAX_REFERENCES} reference images`)

  const responseFormat = stringValue(raw.response_format) || 'url'
  if (responseFormat !== 'url' && responseFormat !== 'b64_json')
    badInput('response_format must be url or b64_json')

  const input: Record<string, unknown> = {
    prompt,
    response_format: responseFormat,
    watermark: raw.watermark === true,
  }
  if (references.length)
    input.input_urls = references
  for (const key of ['size', 'image_size', 'aspect_ratio', 'resolution', 'quality']) {
    if (raw[key] !== undefined && raw[key] !== '')
      input[key] = raw[key]
  }
  arkImageSize(input)
  return input
}
