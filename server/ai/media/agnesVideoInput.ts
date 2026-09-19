import { isIP } from 'node:net'

export const AGNES_VIDEO_MODEL_ID = 'agnes-video-2.5-flash'
export const AGNES_VIDEO_LOGICAL_MODELS = [
  'agnes/video-2.5-flash-text-to-video',
  'agnes/video-2.5-flash-image-to-video',
  'agnes/video-2.5-flash-reference-to-video',
] as const

export const AGNES_VIDEO_ASPECT_RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] as const

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

function privateHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local'))
    return true
  if (isIP(host) === 4) {
    return /^(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|0\.)/.test(host)
  }
  if (isIP(host) === 6)
    return host === '::1' || /^f[cd]/i.test(host) || /^fe[89ab]/i.test(host)
  return false
}

function publicHttps(value: string, kind: string) {
  let url: URL
  try {
    url = new URL(value)
  }
  catch {
    badInput(`${kind} must use a public HTTPS URL`)
  }
  if (url.protocol !== 'https:' || url.username || url.password || privateHost(url.hostname))
    badInput(`${kind} must use a public HTTPS URL`)
  return url.href
}

function onePublicHttps(raw: Record<string, unknown>, keys: string[], kind: string) {
  const items = keys.flatMap(key => values(raw[key]))
  if (items.length > 1)
    badInput(`Agnes ${kind} supports at most one URL`)
  return items[0] ? publicHttps(items[0], kind) : ''
}

export function isAgnesVideoModel(model: string) {
  return (AGNES_VIDEO_LOGICAL_MODELS as readonly string[]).includes(model)
}

export function sanitizeAgnesVideoInput(model: string, raw: Record<string, unknown>) {
  if (!isAgnesVideoModel(model))
    badInput('This video model is not supported by Agnes')
  const prompt = stringValue(raw.prompt)
  if (!prompt)
    badInput('prompt is required')
  if (raw.generate_audio !== undefined)
    badInput('Agnes Video 2.5 Flash does not expose audio control')
  if (raw.video_urls !== undefined || raw.reference_video_urls !== undefined)
    badInput('Agnes Video 2.5 Flash does not support reference video')

  const requestedResolution = stringValue(raw.resolution)
  if (requestedResolution && requestedResolution.toLowerCase() !== '720p')
    badInput('Agnes Video 2.5 Flash supports only 720P')
  const duration = Number(raw.duration == null || raw.duration === '' ? 5 : raw.duration)
  if (!Number.isInteger(duration) || duration < 4 || duration > 12)
    badInput('Agnes Video 2.5 Flash duration must be an integer from 4 to 12 seconds')
  const aspectRatio = stringValue(raw.aspect_ratio ?? raw.ratio) || '16:9'
  if (!(AGNES_VIDEO_ASPECT_RATIOS as readonly string[]).includes(aspectRatio))
    badInput(`Agnes Video 2.5 Flash does not support aspect ratio ${aspectRatio}`)

  const base = {
    prompt,
    size: '720P' as const,
    seconds: String(duration),
    aspect_ratio: aspectRatio,
  }
  if (model.endsWith('-text-to-video'))
    return { ...base, mode: 'text' as const }

  if (model.endsWith('-image-to-video')) {
    const firstFrame = onePublicHttps(raw, ['first_frame_url', 'image_url'], 'first frame')
    const lastFrame = onePublicHttps(raw, ['last_frame_url', 'end_image_url'], 'last frame')
    if (!firstFrame && !lastFrame)
      badInput('Agnes image-to-video requires a public HTTPS first or last frame')
    return {
      ...base,
      mode: 'keyframe' as const,
      ...(firstFrame ? { first_frame: firstFrame } : {}),
      ...(lastFrame ? { last_frame: lastFrame } : {}),
    }
  }

  const images = values(raw.reference_image_urls ?? raw.image_urls).map(value => publicHttps(value, 'Reference image'))
  const audios = values(raw.reference_audio_urls ?? raw.audio_urls).map(value => publicHttps(value, 'Reference audio'))
  if (images.length > 5)
    badInput('Agnes Video 2.5 Flash supports at most 5 reference images')
  if (audios.length > 3)
    badInput('Agnes Video 2.5 Flash supports at most 3 reference audio files')
  if (!images.length && !audios.length)
    badInput('Agnes reference-to-video requires a public HTTPS image or audio URL')
  return {
    ...base,
    mode: 'reference' as const,
    ...(images.length ? { images } : {}),
    ...(audios.length ? { audios } : {}),
  }
}
