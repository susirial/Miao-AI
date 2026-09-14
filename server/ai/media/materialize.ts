import type { ArkVideoContent } from './arkVideoInput'
import { Buffer } from 'node:buffer'
import { BlockList, isIP } from 'node:net'
import { isStoredMediaUrl, readStoredMedia, saveMediaFile } from '../../utils/localMedia'
import { materializeArkAsset } from './arkAssets'
import { ARK_IMAGE_MAX_BYTES, ARK_IMAGE_MAX_REQUEST_BYTES } from './arkImageInput'

const DATA_IMAGE = /^data:([^;,]+);base64,([a-z0-9+/=\s]+)$/i
const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
  'image/tiff': 'tiff',
}
const blockedAddresses = new BlockList()
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16], ['192.0.0.0', 24], ['198.18.0.0', 15], ['224.0.0.0', 3]] as const)
  blockedAddresses.addSubnet(address, prefix, 'ipv4')
const globalV6Addresses = new BlockList()
globalV6Addresses.addSubnet('2000::', 3, 'ipv6')
blockedAddresses.addSubnet('2001::', 23, 'ipv6')
blockedAddresses.addSubnet('2002::', 16, 'ipv6')

function badInput(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 400 })
}

function isPrivateHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local'))
    return true
  const family = isIP(host)
  if (family === 4)
    return blockedAddresses.check(host, 'ipv4')
  if (family === 6)
    return !globalV6Addresses.check(host, 'ipv6') || blockedAddresses.check(host, 'ipv6')
  return false
}

function arkRemoteAssetUrl(source: string, kind: 'image' | 'video' | 'audio') {
  let url: URL
  try {
    url = new URL(source)
  }
  catch {
    badInput(`Reference ${kind} must use HTTP(S),${kind === 'image' ? ' image data, or' : ' or'} local stored media`)
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:')
    || url.username
    || url.password
    || isPrivateHostname(url.hostname)
  ) {
    badInput(`Reference ${kind} must use a public HTTP(S) URL or resolvable local stored media`)
  }
  return source
}

function imageMime(value: unknown) {
  const mime = String(value || '').split(';')[0]!.trim().toLowerCase()
  if (!mime.startsWith('image/') || mime === 'image/svg+xml')
    badInput('Reference media must use a supported image MIME type')
  return mime
}

function decodeImageDataUrl(source: string) {
  const match = source.match(DATA_IMAGE)
  if (!match)
    badInput('Invalid image data URL')
  const mime = imageMime(match[1])
  const encoded = match[2]!.replace(/\s/g, '')
  if (!encoded || encoded.length % 4 === 1)
    badInput('Invalid base64 image data')
  const bytes = Buffer.from(encoded, 'base64')
  if (!bytes.length || bytes.byteLength > ARK_IMAGE_MAX_BYTES)
    badInput('Each reference image must be 30MB or smaller')
  return {
    bytes,
    dataUrl: `data:${mime};base64,${bytes.toString('base64')}`,
    mime,
  }
}

export async function materializeArkImageSources(sources: unknown, signal?: AbortSignal) {
  const values = Array.isArray(sources) ? sources : sources == null || sources === '' ? [] : [sources]
  const images: string[] = []
  let localBytes = 0
  for (const value of values) {
    signal?.throwIfAborted()
    const source = typeof value === 'string' ? value.trim() : ''
    if (!source)
      badInput('Reference image must be a URL or image data URL')
    if (source.startsWith('data:')) {
      const decoded = decodeImageDataUrl(source)
      localBytes += decoded.bytes.byteLength
      images.push(decoded.dataUrl)
      continue
    }

    const stored = await readStoredMedia(source, ARK_IMAGE_MAX_BYTES, signal)
    if (stored) {
      const mime = imageMime(stored.mime)
      if (!stored.bytes.length || stored.bytes.byteLength > ARK_IMAGE_MAX_BYTES)
        badInput('Each reference image must be 30MB or smaller')
      localBytes += stored.bytes.byteLength
      images.push(`data:${mime};base64,${Buffer.from(stored.bytes).toString('base64')}`)
      continue
    }

    let url: URL
    try {
      url = new URL(source)
    }
    catch {
      badInput('Reference image must use HTTP(S), image data, or local stored media')
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
      badInput('Reference image must use HTTP(S), image data, or local stored media')
    images.push(arkRemoteAssetUrl(source, 'image'))
  }
  if (localBytes > ARK_IMAGE_MAX_REQUEST_BYTES)
    badInput('Reference images exceed the 64MB request limit')
  return images
}

export async function materializeArkVideoContentWithAssets(content: ArkVideoContent[], signal?: AbortSignal) {
  const result: ArkVideoContent[] = []
  const assets: { kind: 'video' | 'audio', objectKey: string, sourceHash: string }[] = []
  let detectedVideoDuration = 0
  for (const item of content) {
    signal?.throwIfAborted()
    if (item.type === 'text') {
      result.push(item)
      continue
    }
    if (item.type === 'image_url') {
      const [url] = await materializeArkImageSources(item.image_url.url, signal)
      result.push({ ...item, image_url: { url: url! } })
      continue
    }
    if (item.type === 'video_url') {
      const source = item.video_url.url.trim()
      if (source.startsWith('data:'))
        badInput('Data URL reference video is not supported by Seedance. Use local stored media or an external HTTPS URL.')
      if (isStoredMediaUrl(source)) {
        const asset = await materializeArkAsset(source, 'video', signal)
        detectedVideoDuration += asset.durationSeconds || 0
        assets.push({ kind: 'video', objectKey: asset.objectKey, sourceHash: asset.sourceHash })
        result.push({ ...item, video_url: { url: asset.url } })
      }
      else {
        result.push({ ...item, video_url: { url: arkRemoteAssetUrl(source, 'video') } })
      }
      continue
    }
    const source = item.audio_url.url.trim()
    if (source.startsWith('data:'))
      badInput('Data URL reference audio is not supported by Seedance. Use local stored media or an external HTTPS URL.')
    if (isStoredMediaUrl(source)) {
      const asset = await materializeArkAsset(source, 'audio', signal)
      assets.push({ kind: 'audio', objectKey: asset.objectKey, sourceHash: asset.sourceHash })
      result.push({ ...item, audio_url: { url: asset.url } })
    }
    else {
      result.push({ ...item, audio_url: { url: arkRemoteAssetUrl(source, 'audio') } })
    }
  }
  if (detectedVideoDuration > 15)
    badInput('Local reference videos must be 15 seconds or shorter in total.')
  return { content: result, assets }
}

export async function materializeArkVideoContent(content: ArkVideoContent[], signal?: AbortSignal) {
  return (await materializeArkVideoContentWithAssets(content, signal)).content
}

export function assertArkRequestSize(payload: Record<string, unknown>) {
  if (Buffer.byteLength(JSON.stringify(payload)) > ARK_IMAGE_MAX_REQUEST_BYTES)
    badInput('Ark image request exceeds the 64MB request limit')
}

function sniffImage(bytes: Buffer) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return { mime: 'image/png', extension: 'png' }
  if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF)
    return { mime: 'image/jpeg', extension: 'jpg' }
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP')
    return { mime: 'image/webp', extension: 'webp' }
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii')))
    return { mime: 'image/gif', extension: 'gif' }
  return { mime: 'image/jpeg', extension: 'jpg' }
}

function resultError(value: unknown): string {
  if (typeof value === 'string')
    return value.trim()
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return ''
  const record = value as Record<string, unknown>
  return resultError(record.message) || resultError(record.msg) || resultError(record.error) || resultError(record.detail)
}

export async function materializeArkImageResults(taskId: string, data: unknown) {
  if (!Array.isArray(data))
    throw Object.assign(new Error('Ark returned an invalid image response'), { failCode: 'invalid_provider_response' })
  const urls: string[] = []
  const errors: string[] = []
  const results: Record<string, unknown>[] = []
  for (const [index, value] of data.entries()) {
    const item = value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {}
    const itemError = resultError(item.error)
    if (itemError) {
      errors.push(itemError)
      results.push({ error: itemError })
      continue
    }
    const url = typeof item.url === 'string' ? item.url.trim() : ''
    if (url) {
      let parsed: URL
      try {
        parsed = new URL(url)
      }
      catch {
        errors.push('Ark returned an invalid image URL')
        results.push({ error: 'invalid image URL' })
        continue
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        errors.push('Ark returned an invalid image URL')
        results.push({ error: 'invalid image URL' })
        continue
      }
      urls.push(parsed.href)
      results.push({ url: parsed.href, ...(typeof item.size === 'string' ? { size: item.size } : {}) })
      continue
    }
    const encoded = typeof item.b64_json === 'string' ? item.b64_json.replace(/\s/g, '') : ''
    if (!encoded) {
      errors.push('Ark returned an empty image result')
      results.push({ error: 'empty image result' })
      continue
    }
    const bytes = Buffer.from(encoded, 'base64')
    if (!bytes.length || bytes.byteLength > ARK_IMAGE_MAX_BYTES) {
      errors.push('Ark returned invalid or oversized base64 image data')
      results.push({ error: 'invalid base64 image data' })
      continue
    }
    const detected = sniffImage(bytes)
    const declaredMime = typeof item.mime_type === 'string' ? item.mime_type.toLowerCase() : ''
    const mime = declaredMime.startsWith('image/') && declaredMime !== 'image/svg+xml' ? declaredMime : detected.mime
    const extension = EXTENSION_BY_MIME[mime] || detected.extension
    const localUrl = await saveMediaFile(`generator/results/${taskId}/${index}.${extension}`, bytes, mime)
    urls.push(localUrl)
    results.push({ url: localUrl, archived: true, ...(typeof item.size === 'string' ? { size: item.size } : {}) })
  }
  return { urls, errors, results }
}
