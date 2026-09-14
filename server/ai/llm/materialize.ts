import type { ChatMessage } from '../../agent/types'
import { Buffer } from 'node:buffer'
import { readStoredMedia } from '../../utils/localMedia'

const MAX_INLINE_MEDIA_BYTES = 10 * 1024 * 1024

export type ImageMaterialization = 'data-url' | 'reject'

async function materializeImageUrl(url: string, mode: ImageMaterialization, signal?: AbortSignal) {
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

export async function materializeMessages(
  messages: ChatMessage[],
  mode: ImageMaterialization,
  signal?: AbortSignal,
): Promise<ChatMessage[]> {
  return Promise.all(messages.map(async ({ historyId: _historyId, internal: _internal, ...message }) => {
    if (!Array.isArray(message.content))
      return message
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
