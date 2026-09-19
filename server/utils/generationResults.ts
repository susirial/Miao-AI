import type { GenerationJobPublic } from '../../shared/types/generation'
import type { IGenerationJob, IResultAsset } from '../models/generationJob'
import { canonicalMediaUrl, storedMediaKey } from './storedMediaUrl.mjs'

export function parseResultUrls(resultJson?: string) {
  if (!resultJson)
    return []

  try {
    const parsed = JSON.parse(resultJson) as Record<string, unknown>
    const lists = [parsed.resultUrls, parsed.result_urls, parsed.urls, parsed.originUrls]
    for (const list of lists) {
      if (!Array.isArray(list))
        continue
      const urls = list.map(canonicalMediaUrl).filter(Boolean)
      if (urls.length)
        return urls
    }
    for (const key of ['resultUrl', 'video_url', 'image_url', 'url']) {
      const value = parsed[key]
      const url = canonicalMediaUrl(value)
      if (url)
        return [url]
    }
    return []
  }
  catch {
    return []
  }
}

function toCompletedAt(job: IGenerationJob) {
  if (job.state !== 'success' && job.state !== 'fail')
    return ''

  if (typeof job.completeTime === 'number' && Number.isFinite(job.completeTime) && job.completeTime > 0) {
    const ms = job.completeTime < 1e12 ? job.completeTime * 1000 : job.completeTime
    const date = new Date(ms)
    if (!Number.isNaN(date.getTime()))
      return date.toISOString()
  }

  return job.updatedAt.toISOString()
}

function httpJobUrls(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map(canonicalMediaUrl)
      .filter(Boolean)
  }
  const url = canonicalMediaUrl(value)
  return url ? [url] : []
}

const GENERATION_INPUT_KEYS = [
  'reference_image_urls',
  'reference_images',
  'reference_video_urls',
  'first_frame_url',
  'last_frame_url',
  'input_urls',
  'image_urls',
  'video_urls',
  'audio_urls',
  'image_url',
  'start_image_url',
  'end_image_url',
] as const

export function generationInputUrlSet(input: Record<string, unknown> | undefined, extra: Array<string | undefined> = []) {
  const record = input && typeof input === 'object' ? input : {}
  return new Set([
    ...GENERATION_INPUT_KEYS.flatMap(key => httpJobUrls(record[key])),
    ...extra.flatMap(httpJobUrls),
  ])
}

export function excludeInputResultUrls(
  urls: Array<string | undefined> | undefined,
  input?: Record<string, unknown>,
  extra: Array<string | undefined> = [],
) {
  const inputs = generationInputUrlSet(input, extra)
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of urls || []) {
    const url = canonicalMediaUrl(raw)
    if (!url || inputs.has(url) || seen.has(url))
      continue
    seen.add(url)
    out.push(url)
  }
  return out
}

export function generationResultUrls(job: Pick<IGenerationJob, 'state' | 'resultUrls' | 'resultAssets' | 'sourceUrls' | 'input'>) {
  if (job.state === 'fail')
    return []
  if (job.resultUrls?.length)
    return excludeInputResultUrls(job.resultUrls, job.input)
  if (job.state !== 'success' && job.state !== 'archiving' && job.state !== 'moderating')
    return []
  const fromAssets = excludeInputResultUrls(
    (job.resultAssets || []).map(asset => asset.localUrl || asset.sourceUrl),
    job.input,
  )
  if (fromAssets.length)
    return fromAssets
  return excludeInputResultUrls(job.sourceUrls, job.input)
}

function publicResultUrls(job: IGenerationJob) {
  return generationResultUrls(job)
}

export function publicHttpsImageUrl(source: string) {
  const href = publicHttpImageUrl(source)
  return href.startsWith('https:') ? href : ''
}

export function publicHttpImageUrl(source: string) {
  const value = String(source || '').trim()
  if (!value || storedMediaKey(value) !== null)
    return ''
  let url: URL
  try {
    url = new URL(value)
  }
  catch {
    return ''
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const loopback = hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname === '::1'
    || /^127(?:\.|$)/.test(hostname)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || loopback)
    return ''
  return url.href
}

export function publicOriginUrlFromJob(
  job: Pick<IGenerationJob, 'state' | 'deleted' | 'category' | 'resultUrls' | 'resultAssets'>,
  source: string,
) {
  if (job.state !== 'success' || job.deleted || job.category === 'Video')
    return ''
  const local = canonicalMediaUrl(source)
  if (!local || storedMediaKey(local) === null)
    return ''
  if (!(job.resultUrls || []).map(canonicalMediaUrl).includes(local))
    return ''
  const asset = (job.resultAssets || []).find(item => canonicalMediaUrl(item.localUrl) === local)
  return asset ? publicHttpImageUrl(asset.sourceUrl) : ''
}

export function publicOriginUrlsFromJobs(
  jobs: Array<Pick<IGenerationJob, 'state' | 'deleted' | 'category' | 'resultUrls' | 'resultAssets'>>,
  sources: string[],
) {
  const resolved = new Map<string, string>()
  for (const source of sources) {
    const local = canonicalMediaUrl(source)
    if (!local || resolved.has(source))
      continue
    for (const current of jobs) {
      const origin = publicOriginUrlFromJob(current, local)
      if (!origin)
        continue
      resolved.set(source, origin)
      resolved.set(local, origin)
      break
    }
  }
  return resolved
}

export function toPublicJob(job: IGenerationJob): GenerationJobPublic {
  const prompt = typeof job.input?.prompt === 'string' ? job.input.prompt : ''
  return {
    taskId: job.taskId,
    projectId: job.projectId || '',
    model: job.model,
    category: job.category || '',
    task: job.task || '',
    prompt,
    input: job.input && typeof job.input === 'object' ? job.input : {},
    state: job.state,
    resultUrls: publicResultUrls(job),
    failCode: job.failCode || '',
    failMsg: job.failMsg || '',
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    completedAt: toCompletedAt(job),

  }
}

function emptyAsset(sourceUrl: string): IResultAsset {
  return {
    sourceUrl,
    localUrl: '',
    localKey: '',
    contentType: '',
    status: 'pending',
    error: '',
  }
}

export function mergeSourceUrls(job: IGenerationJob, urls: string[]) {
  job.sourceUrls = excludeInputResultUrls(urls, job.input)
  const existing = new Map((job.resultAssets || []).map(asset => [asset.sourceUrl, asset]))
  job.resultAssets = job.sourceUrls.map(sourceUrl => existing.get(sourceUrl) || emptyAsset(sourceUrl))
}
