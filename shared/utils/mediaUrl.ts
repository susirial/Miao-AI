export function isHttpMediaUrl(value: unknown): value is string {
  return typeof value === 'string'
    && /^https?:\/\//i.test(value.trim())
    && !value.trim().toLowerCase().startsWith('blob:')
}

export function isLocalMediaUrl(value: unknown): value is string {
  if (typeof value !== 'string')
    return false
  const source = value.trim()
  if (!source.startsWith('/media/') || source.startsWith('//'))
    return false
  try {
    const url = new URL(source, 'http://miao.local')
    return url.origin === 'http://miao.local'
      && url.pathname.startsWith('/media/')
      && !url.search
      && !url.hash
  }
  catch {
    return false
  }
}

export function isMediaUrl(value: unknown): value is string {
  return isLocalMediaUrl(value) || isHttpMediaUrl(value)
}
export function isMediaVideoUrl(url: string) {
  return /\.(?:mp4|mov|webm|m4v)(?:\?|$)/i.test(url)
}

export function isMediaAudioUrl(url: string) {
  return /\.(?:mp3|wav|m4a|aac|ogg)(?:\?|$)/i.test(url)
}

export function isMediaImageUrl(url: string) {
  return /\.(?:jpe?g|png|webp|gif|bmp|tiff?)(?:\?|$)/i.test(url)
}

export function pickProjectCoverUrl(urls: string[] | undefined) {
  const list = (urls || []).filter(url => typeof url === 'string' && url)
  return list.find(url => isMediaImageUrl(url)) || list[0] || ''
}
