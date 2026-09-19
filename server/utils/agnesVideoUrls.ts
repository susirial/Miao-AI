import { publicHttpsImageUrl } from './generationResults'
import { canonicalMediaUrl } from './storedMediaUrl.mjs'

export const AGNES_PUBLIC_IMAGE_REQUIRED = 'AGNES_PUBLIC_IMAGE_REQUIRED'

export function agnesPublicImageRequiredError(kind: string) {
  const message = `${kind} needs a public HTTPS URL for Agnes Video 2.5 Flash. Use a generated still that still has a public origin, Seedance, or text-to-video.`
  return Object.assign(new Error(message), {
    failCode: AGNES_PUBLIC_IMAGE_REQUIRED,
    statusCode: 400,
    statusMessage: message,
  })
}

export function applyAgnesHttpsOrigins(
  sources: string[],
  origins: Map<string, string>,
  kind: string,
) {
  return sources.map((source) => {
    const origin = origins.get(source) || origins.get(canonicalMediaUrl(source)) || ''
    const href = publicHttpsImageUrl(origin) || publicHttpsImageUrl(source)
    if (!href)
      throw agnesPublicImageRequiredError(kind)
    return href
  })
}

const AGNES_VIDEO_URL_GROUPS = [
  { keys: ['first_frame_url', 'image_url'], kind: 'first frame' },
  { keys: ['last_frame_url', 'end_image_url'], kind: 'last frame' },
  { keys: ['reference_image_urls', 'image_urls'], kind: 'Reference image' },
  { keys: ['reference_audio_urls', 'audio_urls'], kind: 'Reference audio' },
] as const

function fieldValues(value: unknown) {
  const list = Array.isArray(value) ? value : value == null || value === '' ? [] : [value]
  return list.map(item => String(item || '').trim()).filter(Boolean)
}

export function collectAgnesVideoUrlFields(raw: Record<string, unknown>) {
  const fields: Array<{ key: string, values: string[], kind: string, array: boolean }> = []
  for (const group of AGNES_VIDEO_URL_GROUPS) {
    for (const key of group.keys) {
      if (raw[key] === undefined)
        continue
      const values = fieldValues(raw[key])
      if (values.length)
        fields.push({ key, values, kind: group.kind, array: Array.isArray(raw[key]) })
    }
  }
  return fields
}

export function replaceAgnesVideoUrlFields(
  raw: Record<string, unknown>,
  origins: Map<string, string>,
) {
  const next = { ...raw }
  for (const field of collectAgnesVideoUrlFields(raw)) {
    const remapped = applyAgnesHttpsOrigins(field.values, origins, field.kind)
    next[field.key] = field.array ? remapped : remapped[0]
  }
  return next
}
