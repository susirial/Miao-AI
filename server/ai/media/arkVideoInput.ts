import {
  isSeedance2AspectRatio,
  isSeedance2Duration,
  isSeedance2Model,
  isSeedance2Resolution,
} from '../../../shared/utils/seedance2'

export const ARK_VIDEO_MODEL_ID = 'doubao-seedance-2-0-260128'
export const ARK_VIDEO_LOGICAL_MODELS = [
  'bytedance/seedance-2-text-to-video',
  'bytedance/seedance-2-image-to-video',
  'bytedance/seedance-2-reference-to-video',
] as const

export type ArkVideoContent = {
  type: 'text'
  text: string
} | {
  type: 'image_url'
  image_url: { url: string }
  role: 'first_frame' | 'last_frame' | 'reference_image'
} | {
  type: 'video_url'
  video_url: { url: string }
  role: 'reference_video'
} | {
  type: 'audio_url'
  audio_url: { url: string }
  role: 'reference_audio'
}

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

function uniqueValues(raw: Record<string, unknown>, keys: string[]) {
  return Array.from(new Set(keys.flatMap(key => values(raw[key]))))
}

/**
 * Merge alias keys while keeping repeats that occur inside a single key.
 * Seedance resolves a reference by its position among same-type assets, so the
 * prompt says "image 2" about whatever is passed second. Collapsing a repeat
 * would renumber every later reference and rebind the roles the prompt wrote.
 */
function positionalValues(raw: Record<string, unknown>, keys: string[]) {
  const merged: string[] = []
  for (const key of keys) {
    const list = values(raw[key])
    if (!list.length)
      continue
    merged.push(...(merged.length ? list.filter(url => !merged.includes(url)) : list))
  }
  return merged
}

function booleanValue(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

function normalizedRatio(value: unknown) {
  const ratio = stringValue(value).toLowerCase() || 'adaptive'
  const normalized = ratio === 'auto' ? 'adaptive' : ratio
  if (!isSeedance2AspectRatio(normalized))
    badInput('Seedance 2 supports only 16:9, 9:16, 1:1, 4:3, 3:4, 21:9, or adaptive ratio')
  return normalized
}

function normalizedResolution(value: unknown) {
  const resolution = stringValue(value).toLowerCase() || '720p'
  if (!isSeedance2Resolution(resolution))
    badInput('Seedance 2 supports only 480p, 720p, 1080p, or 4k resolution')
  return resolution
}

function normalizedDuration(value: unknown) {
  const duration = Number(value == null || value === '' ? 5 : value)
  if (!Number.isInteger(duration) || !isSeedance2Duration(duration))
    badInput('Seedance 2 duration must be an integer from 4 to 15 seconds')
  return duration
}

function imageContent(url: string, role: 'first_frame' | 'last_frame' | 'reference_image'): ArkVideoContent {
  return { type: 'image_url', image_url: { url }, role }
}

function assertNoAssets(model: string, groups: Record<string, string[]>) {
  const supplied = Object.values(groups).some(group => group.length)
  if (supplied)
    badInput(`${model} does not accept reference media`)
}

export function isArkVideoModel(model: string) {
  return isSeedance2Model(model) && (ARK_VIDEO_LOGICAL_MODELS as readonly string[]).includes(model)
}

export function sanitizeArkVideoInput(model: string, raw: Record<string, unknown>) {
  if (!isArkVideoModel(model))
    badInput('This video model is not supported by Ark')

  const prompt = stringValue(raw.prompt)
  if (!prompt)
    badInput('prompt is required')

  const firstFrames = uniqueValues(raw, ['first_frame_url', 'image_url', 'start_image_url', 'input_urls'])
  const lastFrames = uniqueValues(raw, ['last_frame_url', 'end_image_url'])
  const referenceImages = positionalValues(raw, ['reference_image_urls', 'image_urls'])
  const referenceVideos = positionalValues(raw, ['reference_video_urls', 'video_urls'])
  const referenceAudio = positionalValues(raw, ['reference_audio_urls', 'audio_urls'])
  const groups = { firstFrames, lastFrames, referenceImages, referenceVideos, referenceAudio }
  const content: ArkVideoContent[] = [{ type: 'text', text: prompt }]

  if (model.endsWith('-text-to-video')) {
    assertNoAssets(model, groups)
  }
  else if (model.endsWith('-image-to-video')) {
    if (referenceImages.length || referenceVideos.length || referenceAudio.length)
      badInput('First-frame and reference modes are mutually exclusive')
    if (firstFrames.length !== 1)
      badInput('Seedance 2 image-to-video requires exactly one first frame')
    if (lastFrames.length > 1)
      badInput('Seedance 2 image-to-video supports at most one last frame')
    content.push(imageContent(firstFrames[0]!, 'first_frame'))
    if (lastFrames[0])
      content.push(imageContent(lastFrames[0], 'last_frame'))
  }
  else {
    if (firstFrames.length || lastFrames.length)
      badInput('First-frame and reference modes are mutually exclusive')
    if (referenceImages.length > 9)
      badInput('Seedance 2 supports at most 9 reference images')
    if (referenceVideos.length > 3)
      badInput('Seedance 2 supports at most 3 reference videos')
    if (referenceAudio.length > 3)
      badInput('Seedance 2 supports at most 3 reference audio files')
    if (referenceImages.length + referenceVideos.length + referenceAudio.length > 12)
      badInput('Seedance 2 supports at most 12 reference files in total')
    if (!referenceImages.length && !referenceVideos.length)
      badInput('Reference-to-video requires at least one reference image or video')
    content.push(...referenceImages.map(url => imageContent(url, 'reference_image')))
    content.push(...referenceVideos.map(url => ({
      type: 'video_url' as const,
      video_url: { url },
      role: 'reference_video' as const,
    })))
    content.push(...referenceAudio.map(url => ({
      type: 'audio_url' as const,
      audio_url: { url },
      role: 'reference_audio' as const,
    })))
  }

  return {
    content,
    ratio: normalizedRatio(raw.ratio ?? raw.aspect_ratio),
    resolution: normalizedResolution(raw.resolution),
    duration: normalizedDuration(raw.duration),
    generate_audio: booleanValue(raw.generate_audio, true),
    watermark: booleanValue(raw.watermark, false),
    return_last_frame: booleanValue(raw.return_last_frame, false),
  }
}
