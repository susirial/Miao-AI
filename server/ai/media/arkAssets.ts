import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promisify } from 'node:util'
import TosClient from '@volcengine/tos-sdk'
import { isStoredMediaUrl, readStoredMedia, storedMediaFile } from '../../utils/localMedia'
import { normalizeTosBucket, normalizeTosPrefix, readServiceSettings, TOS_ENDPOINT, TOS_REGION } from '../../utils/serviceSettings'
import { storedMediaKey } from '../../utils/storedMediaUrl.mjs'

export type ArkAssetKind = 'video' | 'audio'

export interface MaterializedArkAsset {
  url: string
  objectKey: string
  sourceHash: string
  durationSeconds?: number
}

interface CachedAsset extends MaterializedArkAsset {
  expiresAt: number
}

const VIDEO_MAX_BYTES = 200 * 1024 * 1024
const AUDIO_MAX_BYTES = 15 * 1024 * 1024
const SIGNED_URL_TTL_SECONDS = 60 * 60
const SIGNED_URL_REFRESH_WINDOW_MS = 5 * 60 * 1000
const execFileAsync = promisify(execFile)
const cache = new Map<string, CachedAsset>()
const inFlight = new Map<string, Promise<MaterializedArkAsset>>()

const EXTENSION_BY_MIME: Record<ArkAssetKind, Record<string, string>> = {
  video: {
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
    'video/x-matroska': 'mkv',
  },
  audio: {
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/aac': 'aac',
    'audio/ogg': 'ogg',
    'audio/mp4': 'm4a',
    'audio/flac': 'flac',
    'audio/x-flac': 'flac',
  },
}

function badInput(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 400, statusMessage: message })
}

async function probeVideoDuration(path: string | undefined, signal?: AbortSignal) {
  if (!path)
    return undefined
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      path,
    ], {
      encoding: 'utf8',
      timeout: 15_000,
      signal,
      maxBuffer: 64 * 1024,
    })
    const duration = Number(String(stdout).trim())
    return Number.isFinite(duration) && duration > 0 ? duration : undefined
  }
  catch (error) {
    if (signal?.aborted)
      throw error
    // ffprobe is optional for uploads. Size and MIME checks still run when it is unavailable
    // or cannot understand a valid provider-supported container.
    return undefined
  }
}

function readTosConfiguration() {
  const settings = readServiceSettings()
  if (!settings.tosAccessKeyId || !settings.tosSecretAccessKey || !settings.tosBucket)
    badInput('TOS reference media storage is not configured. Add TOS credentials and a cn-beijing bucket in Service connection.')
  let bucket: string
  let prefix: string
  try {
    bucket = normalizeTosBucket(settings.tosBucket)
    prefix = normalizeTosPrefix(settings.tosPrefix)
  }
  catch {
    badInput('TOS bucket or object prefix is invalid. Update Reference media storage in Service connection.')
  }
  return {
    accessKeyId: settings.tosAccessKeyId,
    accessKeySecret: settings.tosSecretAccessKey,
    bucket,
    prefix,
  }
}

function createClient(config: ReturnType<typeof readTosConfiguration>) {
  return new TosClient({
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
    bucket: config.bucket,
    region: TOS_REGION,
    endpoint: TOS_ENDPOINT,
    requestTimeout: 180_000,
    connectionTimeout: 15_000,
  })
}

function signedGetUrl(client: TosClient, bucket: string, key: string) {
  const signed = client.getPreSignedUrl({
    bucket,
    key,
    method: 'GET',
    expires: SIGNED_URL_TTL_SECONDS,
  })
  let url: URL
  try {
    url = new URL(signed)
  }
  catch {
    throw new Error('TOS did not return a valid presigned URL')
  }
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('TOS presigned URL must use HTTPS')
  return url.href
}

export async function materializeArkAsset(source: string, kind: ArkAssetKind, signal?: AbortSignal): Promise<MaterializedArkAsset> {
  const value = source.trim()
  if (value.startsWith('data:'))
    badInput(`Data URL reference ${kind} is not supported by Seedance. Use local stored media or an external HTTPS URL.`)
  if (!isStoredMediaUrl(value))
    badInput(`Reference ${kind} is not resolvable local stored media.`)

  const config = readTosConfiguration()
  const maxBytes = kind === 'video' ? VIDEO_MAX_BYTES : AUDIO_MAX_BYTES
  let stored: Awaited<ReturnType<typeof readStoredMedia>>
  try {
    stored = await readStoredMedia(value, maxBytes, signal)
  }
  catch {
    badInput(`Local reference ${kind} must be non-empty and ${kind === 'video' ? '200MB' : '15MB'} or smaller.`)
  }
  if (!stored)
    badInput(`Reference ${kind} is not resolvable local stored media.`)

  const mime = stored.mime.toLowerCase()
  const extension = EXTENSION_BY_MIME[kind][mime]
  if (!extension)
    badInput(`Local reference ${kind} has an unsupported MIME type.`)
  if (!stored.bytes.length || stored.bytes.byteLength > maxBytes)
    badInput(`Local reference ${kind} must be non-empty and ${kind === 'video' ? '200MB' : '15MB'} or smaller.`)

  const localKey = storedMediaKey(value)
  const localFile = localKey ? await storedMediaFile(localKey) : undefined
  const durationSeconds = kind === 'video' ? await probeVideoDuration(localFile?.path, signal) : undefined
  if (durationSeconds !== undefined && (durationSeconds < 2 || durationSeconds > 15))
    badInput('Each local reference video must be between 2 and 15 seconds.')

  const bytes = Buffer.from(stored.bytes)
  const sourceHash = createHash('sha256').update(bytes).digest('hex')
  const objectKey = `${config.prefix ? `${config.prefix}/` : ''}ark-assets/${kind}/${sourceHash}.${extension}`
  const cacheKey = `${config.bucket}\0${config.prefix}\0${kind}\0${sourceHash}`
  const now = Date.now()
  const cached = cache.get(cacheKey)
  if (cached && cached.expiresAt - now > SIGNED_URL_REFRESH_WINDOW_MS) {
    return {
      url: cached.url,
      objectKey: cached.objectKey,
      sourceHash: cached.sourceHash,
      ...(cached.durationSeconds === undefined ? {} : { durationSeconds: cached.durationSeconds }),
    }
  }

  const pending = inFlight.get(cacheKey)
  if (pending)
    return pending

  const operation = (async () => {
    signal?.throwIfAborted()
    const client = createClient(config)
    if (!cached) {
      await client.putObject({
        bucket: config.bucket,
        key: objectKey,
        body: bytes,
        contentLength: bytes.byteLength,
        contentType: mime,
        contentSHA256: sourceHash,
      })
    }
    signal?.throwIfAborted()
    const url = signedGetUrl(client, config.bucket, objectKey)
    const result: CachedAsset = {
      url,
      objectKey,
      sourceHash,
      expiresAt: Date.now() + SIGNED_URL_TTL_SECONDS * 1000,
      ...(durationSeconds === undefined ? {} : { durationSeconds }),
    }
    cache.set(cacheKey, result)
    return {
      url: result.url,
      objectKey: result.objectKey,
      sourceHash: result.sourceHash,
      ...(result.durationSeconds === undefined ? {} : { durationSeconds: result.durationSeconds }),
    }
  })()
  inFlight.set(cacheKey, operation)
  try {
    return await operation
  }
  finally {
    if (inFlight.get(cacheKey) === operation)
      inFlight.delete(cacheKey)
  }
}
