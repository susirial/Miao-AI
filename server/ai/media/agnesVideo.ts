import type { MediaBackend, MediaJobDocument } from './types'
import { readErrorMessage } from '~~/shared/utils/apiError'
import { generationProvider } from '../../utils/generationJobs'
import { mergeSourceUrls } from '../../utils/generationResults'
import { readServiceSettings } from '../../utils/serviceSettings'
import { AGNES_VIDEO_MODEL_ID, isAgnesVideoModel } from './agnesVideoInput'

export const AGNES_VIDEO_PROTOCOL_VERSION = 'agnes-video-tasks-v1'
export const AGNES_VIDEO_CREATE_ENDPOINT = 'https://apihub.agnes-ai.com/v1/videos'
export const AGNES_VIDEO_QUERY_ENDPOINT = 'https://apihub.agnes-ai.com/agnesapi'
export const AGNES_VIDEO_MAX_POLL_MS = 15 * 60 * 1000

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function metadata(job: MediaJobDocument) {
  return asRecord(asRecord(job.providerMetadata).agnesVideo)
}

function setMetadata(job: MediaJobDocument, patch: Record<string, unknown>) {
  job.providerMetadata = {
    ...asRecord(job.providerMetadata),
    agnesVideo: { ...metadata(job), ...patch },
  }
  job.markModified('providerMetadata')
}

function requestSnapshot(job: MediaJobDocument) {
  return asRecord(asRecord(job.requestBody).agnesVideo)
}

function apiKey() {
  const key = readServiceSettings().agnesKey.trim()
  if (!key)
    throw Object.assign(new Error('Agnes API key is not configured'), { statusCode: 500 })
  return key
}

function providerMessage(payload: unknown, fallback: string) {
  const record = asRecord(payload)
  const detail = typeof record.detail === 'string' ? record.detail.trim() : ''
  return detail || readErrorMessage(record.error || payload, fallback)
}

function queryEndpoint(videoId: string) {
  const id = videoId.trim()
  if (!id)
    throw Object.assign(new Error('Agnes video id is missing'), { statusCode: 400 })
  const url = new URL(AGNES_VIDEO_QUERY_ENDPOINT)
  url.searchParams.set('video_id', id)
  url.searchParams.set('model_name', AGNES_VIDEO_MODEL_ID)
  return url.href
}

function httpUrl(value: unknown) {
  const source = typeof value === 'string' ? value.trim() : ''
  try {
    const url = new URL(source)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : ''
  }
  catch {
    return ''
  }
}

export function agnesCompletedVideoUrl(body: Record<string, unknown>) {
  const metadata = asRecord(body.metadata)
  return httpUrl(body.url)
    || httpUrl(metadata.url)
    || httpUrl(body.video_url)
    || httpUrl(asRecord(body.video).url)
}

async function readBody(response: Response) {
  const text = await response.text()
  return text ? JSON.parse(text) as Record<string, unknown> : {}
}

async function markSubmissionUnknown(job: MediaJobDocument, error: unknown) {
  const message = 'Agnes video submission status is unknown. This job was not retried to avoid duplicate generation.'
  job.state = 'fail'
  job.failCode = 'submission_unknown'
  job.failMsg = message
  job.lastSyncAt = new Date()
  setMetadata(job, {
    submissionState: 'submission_unknown',
    submissionError: readErrorMessage(error, 'Agnes request did not return a definitive response'),
    failedAt: new Date().toISOString(),
  })
  await job.save()
}

async function fail(job: MediaJobDocument, code: string, message: string, providerStatus = '') {
  job.state = 'fail'
  job.failCode = code
  job.failMsg = message
  job.completeTime = Date.now()
  job.lastSyncAt = new Date()
  setMetadata(job, {
    providerStatus,
    failedAt: new Date().toISOString(),
    lastSyncError: message,
  })
  await job.save()
  return job
}

async function transient(job: MediaJobDocument, message: string, statusCode = 0) {
  job.lastSyncAt = new Date()
  setMetadata(job, {
    lastSyncError: message,
    lastSyncErrorAt: new Date().toISOString(),
    ...(statusCode ? { lastSyncStatusCode: statusCode } : {}),
  })
  await job.save()
  return job
}

export function buildAgnesVideoPayload(job: MediaJobDocument) {
  if (!isAgnesVideoModel(job.model))
    throw Object.assign(new Error('This video model is not supported by Agnes'), { statusCode: 400 })
  const request = requestSnapshot(job)
  const input = Object.keys(asRecord(request.input)).length ? asRecord(request.input) : asRecord(job.input)
  const model = String(job.backendModelId || request.model || '').trim()
  if (model !== AGNES_VIDEO_MODEL_ID)
    throw Object.assign(new Error('Invalid Agnes video model snapshot'), { statusCode: 400 })
  return { model, ...input }
}

export const agnesVideoBackend: MediaBackend = {
  provider: 'agnes-video',
  protocolVersion: AGNES_VIDEO_PROTOCOL_VERSION,
  async start(job) {
    if (generationProvider(job) !== 'agnes-video')
      throw new Error('Agnes video backend received a non-Agnes job')
    if (String(metadata(job).submissionState || 'not_started') !== 'not_started') {
      await markSubmissionUnknown(job, new Error('An earlier Agnes submission did not finish locally'))
      throw Object.assign(new Error(job.failMsg), { failCode: 'submission_unknown' })
    }
    const payload = buildAgnesVideoPayload(job)
    setMetadata(job, {
      endpoint: AGNES_VIDEO_CREATE_ENDPOINT,
      submissionState: 'submitting',
      submittingAt: new Date().toISOString(),
    })
    job.lastSyncAt = new Date()
    await job.save()

    let response: Response
    try {
      response = await fetch(AGNES_VIDEO_CREATE_ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(180_000),
      })
    }
    catch (error) {
      await markSubmissionUnknown(job, error)
      throw Object.assign(new Error(job.failMsg), { failCode: 'submission_unknown', cause: error })
    }

    let body: Record<string, unknown>
    try {
      body = await readBody(response)
    }
    catch (error) {
      if (response.ok) {
        await markSubmissionUnknown(job, error)
        throw Object.assign(new Error(job.failMsg), { failCode: 'submission_unknown', cause: error })
      }
      throw Object.assign(new Error(`Agnes video generation failed (${response.status})`), { statusCode: response.status })
    }
    if (!response.ok || body.error) {
      const statusCode = response.status || 502
      throw Object.assign(new Error(providerMessage(body, `Agnes video generation failed (${statusCode})`)), {
        statusCode,
        failCode: response.ok ? 'provider_error' : String(statusCode),
      })
    }
    const videoId = String(body.video_id || '').trim()
    if (!videoId) {
      await markSubmissionUnknown(job, new Error('Agnes returned no video_id'))
      throw Object.assign(new Error(job.failMsg), { failCode: 'submission_unknown' })
    }
    job.providerTaskId = videoId
    setMetadata(job, {
      submissionState: 'submitted',
      submittedAt: new Date().toISOString(),
      providerStatus: String(body.status || 'queued').toLowerCase(),
    })
    job.lastSyncAt = new Date()
    await job.save()
    return {
      status: 'pending',
      providerTaskId: videoId,
      providerMetadata: asRecord(job.providerMetadata),
    }
  },
  async sync(job) {
    if (generationProvider(job) !== 'agnes-video')
      throw new Error('Agnes video backend received a non-Agnes job')
    const videoId = String(job.providerTaskId || '').trim()
    if (!videoId)
      return job
    const submittedAt = Date.parse(String(metadata(job).submittedAt || ''))
    if (Number.isFinite(submittedAt) && Date.now() - submittedAt >= AGNES_VIDEO_MAX_POLL_MS) {
      return fail(
        job,
        'timeout',
        'Agnes video generation did not finish within 15 minutes',
        String(metadata(job).providerStatus || ''),
      )
    }

    let response: Response
    try {
      response = await fetch(queryEndpoint(videoId), {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey()}` },
        signal: AbortSignal.timeout(30_000),
      })
    }
    catch (error) {
      return transient(job, readErrorMessage(error, 'Agnes task query failed'))
    }

    let body: Record<string, unknown>
    try {
      body = await readBody(response)
    }
    catch (error) {
      if (response.status === 429 || response.status >= 500 || response.ok)
        return transient(job, readErrorMessage(error, 'Agnes task query returned invalid JSON'), response.status)
      return fail(job, String(response.status), `Agnes task query failed (${response.status})`)
    }
    if (!response.ok) {
      const message = providerMessage(body, `Agnes task query failed (${response.status})`)
      if (response.status === 429 || response.status >= 500)
        return transient(job, message, response.status)
      return fail(job, String(response.status), message)
    }

    const status = String(body.status || '').trim().toLowerCase()
    job.lastSyncAt = new Date()
    setMetadata(job, {
      providerStatus: status,
      lastSyncedAt: new Date().toISOString(),
      lastSyncError: '',
    })
    if (status === 'queued') {
      job.state = 'queuing'
      await job.save()
      return job
    }
    if (status === 'in_progress') {
      job.state = 'generating'
      await job.save()
      return job
    }
    if (status === 'failed') {
      const error = asRecord(body.error)
      return fail(job, String(error.code || 'provider_error'), providerMessage(error, 'Agnes video generation failed'), status)
    }
    if (status !== 'completed')
      return transient(job, `Agnes returned unknown task status: ${status || 'empty'}`)

    const videoUrl = agnesCompletedVideoUrl(body)
    if (!videoUrl)
      return fail(job, 'invalid_provider_response', 'Agnes returned no valid video URL', status)
    mergeSourceUrls(job, [videoUrl])
    job.resultJson = JSON.stringify({ resultUrls: [videoUrl], video_url: videoUrl })
    job.failCode = ''
    job.failMsg = ''
    job.state = 'archiving'
    job.completeTime = Date.now()
    await job.save()
    return job
  },
}
