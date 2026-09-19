import type { ChatMessage, UserContentPart } from '../../agent/types'
import { Buffer } from 'node:buffer'
import { isStoredMediaUrl, readStoredMedia } from '../../utils/localMedia'

const MAX_INLINE_MEDIA_BYTES = 10 * 1024 * 1024

export type ImageMaterialization = 'data-url' | 'remote-url' | 'reject'

const AGNES_PUBLIC_IMAGE_ERROR = 'Agnes requires a public HTTP(S) URL for images. Choose Seed or DeepSeek for local images.'
const AGNES_OMITTED_VISION_TEXT = 'Attached stills are listed in the text. Agnes did not load them as vision input.'

function publicImageUrl(source: string) {
  if (isStoredMediaUrl(source))
    throw new Error(AGNES_PUBLIC_IMAGE_ERROR)
  let url: URL
  try {
    url = new URL(source)
  }
  catch {
    throw new Error(AGNES_PUBLIC_IMAGE_ERROR)
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const loopback = hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname === '::1'
    || /^127(?:\.|$)/.test(hostname)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || loopback)
    throw new Error(AGNES_PUBLIC_IMAGE_ERROR)
  return url.href
}

export function isUnreliableAgnesVisionUrl(source: string) {
  if (isStoredMediaUrl(source))
    return true
  let url: URL
  try {
    url = new URL(source)
  }
  catch {
    return false
  }
  if (/X-Tos-/i.test(url.search) || /X-Tos-/i.test(url.hash))
    return true
  const host = url.hostname.toLowerCase()
  return host.includes('tos-') || host.includes('.tos.') || host.endsWith('.volces.com')
}

async function materializeImageUrl(
  url: string,
  mode: ImageMaterialization,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted()
  if (mode === 'reject')
    throw new Error('Z.ai GLM 5.3 does not support image_url messages. Choose Ark or DeepSeek for vision input.')
  if (url.startsWith('data:'))
    return url
  const local = await readStoredMedia(url, MAX_INLINE_MEDIA_BYTES, signal)
  if (local)
    return `data:${local.mime || 'application/octet-stream'};base64,${Buffer.from(local.bytes).toString('base64')}`
  if (/^https?:\/\//i.test(url))
    return url
  throw new Error('LLM image_url must be an HTTP(S), data, or local stored-media URL.')
}

function materializeRemoteUrlParts(content: UserContentPart[]) {
  const next: UserContentPart[] = []
  for (const part of content) {
    if (part.type !== 'image_url') {
      next.push(part)
      continue
    }
    if (isUnreliableAgnesVisionUrl(part.image_url.url))
      continue
    next.push({
      ...part,
      image_url: {
        ...part.image_url,
        url: publicImageUrl(part.image_url.url),
      },
    })
  }
  if (!next.length)
    next.push({ type: 'text', text: AGNES_OMITTED_VISION_TEXT })
  return next
}

export async function materializeMessages(
  messages: ChatMessage[],
  mode: ImageMaterialization,
  signal?: AbortSignal,
): Promise<ChatMessage[]> {
  return Promise.all(messages.map(async ({ historyId: _historyId, internal: _internal, ...message }) => {
    if (!Array.isArray(message.content))
      return message
    if (mode === 'remote-url')
      return { ...message, content: materializeRemoteUrlParts(message.content) }
    const content = await Promise.all(message.content.map(async (part) => {
      if (part.type !== 'image_url')
        return part
      return {
        ...part,
        image_url: {
          ...part.image_url,
          url: await materializeImageUrl(part.image_url.url, mode, signal),
        },
      }
    }))
    return { ...message, content }
  }))
}
