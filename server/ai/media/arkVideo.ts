import type { ArkVideoContent } from './arkVideoInput'
import type { MediaBackend, MediaJobDocument } from './types'
import { readErrorMessage } from '~~/shared/utils/apiError'
import { generationProvider } from '../../utils/generationJobs'
import { mergeSourceUrls } from '../../utils/generationResults'
import { readServiceSettings } from '../../utils/serviceSettings'
import { ARK_VIDEO_MODEL_ID, isArkVideoModel } from './arkVideoInput'
import { assertArkRequestSize, materializeArkVideoContentWithAssets } from './materialize'

export const ARK_VIDEO_PROTOCOL_VERSION = 'ark-video-tasks-v1'
export const ARK_VIDEO_TASKS_ENDPOINT = 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks'

type ArkSubmissionState = 'not_started' | 'submitting' | 'submitted' | 'failed' | 'submission_unknown'

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function arkMetadata(job: MediaJobDocument) {
  return asRecord(asRecord(job.providerMetadata).arkVideo)
}

function submissionState(job: MediaJobDocument): ArkSubmissionState {
  const state = String(arkMetadata(job).submissionState || 'not_started')
  return ['not_started', 'submitting', 'submitted', 'failed', 'submission_unknown'].includes(state)
    ? state as ArkSubmissionState
    : 'not_started'
}

function setArkMetadata(job: MediaJobDocument, patch: Record<string, unknown>) {
  job.providerMetadata = {
    ...asRecord(job.providerMetadata),
    arkVideo: {
      ...arkMetadata(job),
      ...patch,
    },
  }
  job.markModified('providerMetadata')
}

function arkRequestSnapshot(job: MediaJobDocument) {
  return asRecord(asRecord(job.requestBody).arkVideo)
}

function arkKey() {
  const key = readServiceSettings().arkKey.trim()
  if (!key)
    throw Object.assign(new Error('Ark API key is not configured'), { statusCode: 500 })
  return key
}

function taskEndpoint(taskId: string) {
  const id = taskId.trim()
  if (!id)
    throw Object.assign(new Error('Ark video task id is missing'), { statusCode: 400 })
  return `${ARK_VIDEO_TASKS_ENDPOINT}/${encodeURIComponent(id)}`
}

function responseError(payload: unknown, fallback: string) {
  const record = asRecord(payload)
  return readErrorMessage(record.error || payload, fallback)
}

function httpResultUrl(value: unknown) {
  const source = typeof value === 'string' ? value.trim() : ''
  if (!source)
    return ''
  try {
    const url = new URL(source)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : ''
  }
  catch {
    return ''
  }
}

async function markSubmissionUnknown(job: MediaJobDocument, error: unknown) {
  const message = 'Ark submission status is unknown. This job was not retried to avoid duplicate charges.'
  job.state = 'fail'
  job.failCode = 'submission_unknown'
  job.failMsg = message
  job.lastSyncAt = new Date()
  setArkMetadata(job, {
    submissionState: 'submission_unknown',
    submissionError: readErrorMessage(error, 'Ark request did not return a definitive response'),
    failedAt: new Date().toISOString(),
  })
  await job.save()
}

async function failSubmission(job: MediaJobDocument, error: unknown, statusCode: number) {
  const message = readErrorMessage(error, `Ark video generation failed (${statusCode})`)
  job.state = 'fail'
  job.failCode = String((error as { failCode?: unknown })?.failCode || statusCode || 'provider_error')
  job.failMsg = message
  setArkMetadata(job, {
    submissionState: 'failed',
    submissionError: message,
    failedAt: new Date().toISOString(),
  })
  job.lastSyncAt = new Date()
  await job.save()
}

export async function buildArkVideoPayload(job: MediaJobDocument, signal?: AbortSignal) {
  if (!isArkVideoModel(job.model))
    throw Object.assign(new Error('This video model is not supported by Ark'), { statusCode: 400 })
  const request = arkRequestSnapshot(job)
  const input = Object.keys(asRecord(request.input)).length ? asRecord(request.input) : asRecord(job.input)
  const model = String(job.backendModelId || request.model || '').trim()
  if (model !== ARK_VIDEO_MODEL_ID)
    throw Object.assign(new Error('Invalid Ark video model snapshot'), { statusCode: 400 })
  if (!Array.isArray(input.content))
    throw Object.assign(new Error('Invalid Ark video content snapshot'), { statusCode: 400 })

  const materialized = await materializeArkVideoContentWithAssets(input.content as ArkVideoContent[], signal)
  setArkMetadata(job, {
    referenceAssets: materialized.assets,
  })
  const payload: Record<string, unknown> = {
    model,
    content: materialized.content,
    ratio: input.ratio,
    resolution: input.resolution,
    duration: input.duration,
    generate_audio: input.generate_audio === true,
    watermark: input.watermark === true,
    return_last_frame: input.return_last_frame === true,
  }
  assertArkRequestSize(payload)
  return payload
}

async function recordTransientSyncError(job: MediaJobDocument, error: unknown, statusCode = 0) {
  job.lastSyncAt = new Date()
  setArkMetadata(job, {
    lastSyncError: readErrorMessage(error, statusCode ? `Ark task query failed (${statusCode})` : 'Ark task query failed'),
    lastSyncErrorAt: new Date().toISOString(),
    ...(statusCode ? { lastSyncStatusCode: statusCode } : {}),
  })
  await job.save()
  return job
}

async function failSync(job: MediaJobDocument, code: string, message: string, providerStatus = '') {
  job.state = 'fail'
  job.failCode = code
  job.failMsg = message
  job.completeTime = Date.now()
  job.lastSyncAt = new Date()
  setArkMetadata(job, {
    providerStatus,
    failedAt: new Date().toISOString(),
    lastSyncError: message,
  })
  await job.save()
  return job
}

async function readResponseBody(response: Response) {
  const text = await response.text()
  if (!text)
    return {}
  return JSON.parse(text) as Record<string, unknown>
}

export const arkVideoBackend: MediaBackend = {
  provider: 'ark-video',
  protocolVersion: ARK_VIDEO_PROTOCOL_VERSION,
  async start(job) {
    if (generationProvider(job) !== 'ark-video')
      throw new Error('Ark video backend received a non-Ark job')
    if (submissionState(job) !== 'not_started') {
      await markSubmissionUnknown(job, new Error('An earlier Ark submission did not finish locally'))
      throw Object.assign(new Error(job.failMsg), { failCode: 'submission_unknown' })
    }

    const payload = await buildArkVideoPayload(job)
    const key = arkKey()
    setArkMetadata(job, {
      endpoint: ARK_VIDEO_TASKS_ENDPOINT,
      submissionState: 'submitting',
      submittingAt: new Date().toISOString(),
    })
    job.lastSyncAt = new Date()
    await job.save()

    let response: Response
    try {
      response = await fetch(ARK_VIDEO_TASKS_ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
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
      body = await readResponseBody(response)
    }
    catch (error) {
      if (response.ok) {
        await markSubmissionUnknown(job, error)
        throw Object.assign(new Error(job.failMsg), { failCode: 'submission_unknown', cause: error })
      }
      const providerError = Object.assign(new Error(`Ark video generation failed (${response.status})`), {
        statusCode: response.status,
        failCode: String(response.status),
      })
      await failSubmission(job, providerError, response.status)
      throw providerError
    }

    if (!response.ok || body.error) {
      const statusCode = response.status || 502
      const providerError = Object.assign(new Error(responseError(body, `Ark video generation failed (${statusCode})`)), {
        statusCode,
        failCode: response.ok ? 'provider_error' : String(statusCode),
      })
      await failSubmission(job, providerError, statusCode)
      throw providerError
    }

    const providerTaskId = String(body.id || '').trim()
    if (!providerTaskId) {
      await markSubmissionUnknown(job, new Error('Ark returned no task id'))
      throw Object.assign(new Error(job.failMsg), { failCode: 'submission_unknown' })
    }
    job.providerTaskId = providerTaskId
    setArkMetadata(job, {
      submissionState: 'submitted',
      submittedAt: new Date().toISOString(),
      providerStatus: String(body.status || 'queued').toLowerCase(),
    })
    job.lastSyncAt = new Date()
    await job.save()
    return {
      status: 'pending',
      providerTaskId,
      providerMetadata: asRecord(job.providerMetadata),
    }
  },
  async sync(job) {
    if (generationProvider(job) !== 'ark-video')
      throw new Error('Ark video backend received a non-Ark job')
    if (!String(job.providerTaskId || '').trim())
      return job

    let response: Response
    try {
      response = await fetch(taskEndpoint(job.providerTaskId), {
        method: 'GET',
        headers: { Authorization: `Bearer ${arkKey()}` },
        signal: AbortSignal.timeout(30_000),
      })
    }
    catch (error) {
      return recordTransientSyncError(job, error)
    }

    let body: Record<string, unknown> = {}
    try {
      body = await readResponseBody(response)
    }
    catch (error) {
      if (response.status === 429 || response.status >= 500 || response.ok)
        return recordTransientSyncError(job, error, response.status)
      return failSync(job, String(response.status), `Ark task query failed (${response.status})`)
    }

    if (!response.ok) {
      const message = responseError(body, `Ark task query failed (${response.status})`)
      if (response.status === 429 || response.status >= 500)
        return recordTransientSyncError(job, new Error(message), response.status)
      return failSync(job, String(response.status), message)
    }

    const status = String(body.status || '').trim().toLowerCase()
    job.lastSyncAt = new Date()
    setArkMetadata(job, {
      providerStatus: status,
      lastSyncedAt: new Date().toISOString(),
      lastSyncError: '',
    })
    if (status === 'queued') {
      job.state = 'queuing'
      await job.save()
      return job
    }
    if (status === 'running') {
      job.state = 'generating'
      await job.save()
      return job
    }
    if (status === 'failed' || status === 'cancelled' || status === 'canceled' || status === 'expired') {
      const fallback = status === 'cancelled' || status === 'canceled'
        ? 'Ark video generation was cancelled'
        : status === 'expired'
          ? 'Ark video generation expired'
          : 'Ark video generation failed'
      const error = asRecord(body.error)
      const code = String(error.code || status)
      return failSync(job, code, responseError(error, fallback), status)
    }
    if (status !== 'succeeded')
      return recordTransientSyncError(job, new Error(`Ark returned unknown task status: ${status || 'empty'}`))

    const content = asRecord(body.content)
    const videoUrl = httpResultUrl(content.video_url)
    const lastFrameUrl = httpResultUrl(content.last_frame_url)
    if (!videoUrl)
      return failSync(job, 'invalid_provider_response', 'Ark returned no valid video URL', status)
    if (content.last_frame_url && !lastFrameUrl)
      return failSync(job, 'invalid_provider_response', 'Ark returned an invalid last-frame URL', status)

    const urls = [videoUrl, ...(lastFrameUrl ? [lastFrameUrl] : [])]
    mergeSourceUrls(job, urls)
    job.resultJson = JSON.stringify({
      resultUrls: urls,
      video_url: videoUrl,
      ...(lastFrameUrl ? { last_frame_url: lastFrameUrl } : {}),
    })
    job.failCode = ''
    job.failMsg = ''
    job.state = 'archiving'
    job.completeTime = Date.now()
    await job.save()
    return job
  },
  async remove(job) {
    if (generationProvider(job) !== 'ark-video')
      throw new Error('Ark video backend received a non-Ark job')
    const providerTaskId = String(job.providerTaskId || '').trim()
    if (!providerTaskId)
      return
    let response: Response
    try {
      response = await fetch(taskEndpoint(providerTaskId), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${arkKey()}` },
        signal: AbortSignal.timeout(30_000),
      })
    }
    catch (error) {
      throw Object.assign(new Error(readErrorMessage(error, 'Could not delete the Ark video task')), { statusCode: 502 })
    }
    if (response.ok || response.status === 404)
      return
    let body: Record<string, unknown> = {}
    try {
      body = await readResponseBody(response)
    }
    catch {
      // The HTTP status is still definitive for DELETE.
    }
    const message = responseError(body, `Could not delete the Ark video task (${response.status})`)
    const cancellationConflict = response.status === 409
      || (response.status === 400 && /running|only\s+queued|cannot\s+(?:be\s+)?cancel|取消/i.test(message))
    throw Object.assign(new Error(message), {
      statusCode: cancellationConflict ? 409 : response.status >= 500 || response.status === 429 ? 502 : response.status,
    })
  },
}
