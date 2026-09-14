let applicationUrl = 'http://localhost:3001'

function assertMediaKey(key) {
  if (
    !key
    || key.includes('\\')
    || /\p{Cc}/u.test(key)
    || key.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.'))
  ) {
    throw new Error('Invalid media path')
  }
}

export function configureMediaBase(url) {
  const base = new URL(url)
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash)
    throw new Error('Media base must be an HTTP(S) application URL')
  applicationUrl = base.href
}

export function storedMediaKey(source) {
  const value = String(source || '').trim()
  if (!value)
    return null
  try {
    const relative = value.startsWith('/media/') && !value.startsWith('//')
    const url = relative ? new URL(value, 'http://miao.local') : new URL(value)
    if (!relative) {
      const configuredOrigin = new URL(applicationUrl).origin
      const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
      const loopback = hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '127.0.0.1' || hostname === '::1'
      if (url.origin !== configuredOrigin && !loopback)
        return null
    }
    if (url.search || url.hash || !url.pathname.startsWith('/media/'))
      return null
    const key = decodeURIComponent(url.pathname.slice('/media/'.length))
    assertMediaKey(key)
    return key
  }
  catch {
    return null
  }
}

export function storedMediaUrl(key) {
  assertMediaKey(key)
  return `/media/${key.split('/').map(encodeURIComponent).join('/')}`
}

export function canonicalMediaUrl(value) {
  const source = String(value || '').trim()
  const key = storedMediaKey(source)
  if (key !== null)
    return storedMediaUrl(key)
  return /^https?:\/\//i.test(source) && !source.toLowerCase().startsWith('blob:') ? source : ''
}

export function normalizeStoredMediaReferences(value) {
  if (typeof value === 'string') {
    const key = storedMediaKey(value)
    return key === null ? value : storedMediaUrl(key)
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++)
      value[index] = normalizeStoredMediaReferences(value[index])
  }
  else if (value && typeof value === 'object') {
    for (const key of Object.keys(value))
      value[key] = normalizeStoredMediaReferences(value[key])
  }
  return value
}

function addStoredMediaKey(value, into) {
  const key = storedMediaKey(value)
  if (key)
    into.add(key)
}

export function collectStoredMediaKeys(value, into = new Set(), seen = new WeakSet()) {
  if (typeof value === 'string') {
    addStoredMediaKey(value, into)
    const embedded = value.match(/https?:\/\/[^\s"'\\]+\/media\/[^\s"'\\]+|\/media\/[^\s"'\\]+/gi) || []
    for (const match of embedded)
      addStoredMediaKey(match.replace(/[.,;:!?)]+$/, ''), into)
    return into
  }
  if (!value || typeof value !== 'object')
    return into
  if (value instanceof Date)
    return into
  if (seen.has(value))
    return into
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value)
      collectStoredMediaKeys(item, into, seen)
    return into
  }
  for (const item of Object.values(value)) {
    if (typeof item === 'function')
      continue
    collectStoredMediaKeys(item, into, seen)
  }
  return into
}
