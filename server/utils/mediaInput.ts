import { canonicalMediaUrl } from './storedMediaUrl.mjs'

export function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export function requireString(value: unknown, field: string) {
  const text = asString(value)
  if (!text) {
    throw createError({
      statusCode: 400,
      statusMessage: `${field} is required`,
    })
  }
  return text
}

export function asBoolean(value: unknown, fallback: boolean) {
  if (typeof value === 'boolean')
    return value
  return fallback
}

export function firstHttpUrl(value: unknown, field: string, required: boolean) {
  if (typeof value === 'string') {
    const url = canonicalMediaUrl(value)
    if (url) {
      return url
    }
    if (asString(value)) {
      throw createError({
        statusCode: 400,
        statusMessage: `${field} must be a local media path or public HTTP URL`,
      })
    }
  }

  if (Array.isArray(value)) {
    const values = value.map(item => asString(item)).filter(Boolean)
    const urls = values.map(canonicalMediaUrl)
    if (urls.length > 1) {
      throw createError({
        statusCode: 400,
        statusMessage: `${field} accepts one file`,
      })
    }
    if (urls[0]) {
      return urls[0]
    }
    if (values[0]) {
      throw createError({
        statusCode: 400,
        statusMessage: `${field} must be a local media path or public HTTP URL`,
      })
    }
  }

  if (required) {
    throw createError({
      statusCode: 400,
      statusMessage: `${field} is required`,
    })
  }

  return ''
}

export function sanitizeUrlList(value: unknown, field: string, maxItems: number) {
  if (value == null || value === '')
    return []

  if (!Array.isArray(value)) {
    throw createError({
      statusCode: 400,
      statusMessage: `${field} must be an array of URLs`,
    })
  }

  if (value.length > maxItems) {
    throw createError({
      statusCode: 400,
      statusMessage: `A maximum of ${maxItems} files is allowed for ${field}`,
    })
  }

  return value.map((item, index) => {
    const url = canonicalMediaUrl(item)
    if (!url) {
      throw createError({
        statusCode: 400,
        statusMessage: `${field}[${index}] must be a local media path or public HTTP URL`,
      })
    }
    return url
  })
}
