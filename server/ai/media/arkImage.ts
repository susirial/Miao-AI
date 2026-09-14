import type { MediaBackend, MediaJobDocument } from './types'
import { Agent } from 'undici'
import { readErrorMessage } from '~~/shared/utils/apiError'
import { generationProvider } from '../../utils/generationJobs'
import { readServiceSettings } from '../../utils/serviceSettings'
import { ARK_IMAGE_MODEL_ID, arkImageSize, isArkImageModel } from './arkImageInput'
import { assertArkRequestSize, materializeArkImageResults, materializeArkImageSources } from './materialize'

export const ARK_IMAGE_PROTOCOL_VERSION = 'ark-images-sync-v1'
export const ARK_IMAGE_ENDPOINT = 'https://ark.cn-beijing.volces.com/api/v3/images/generations'
export const ARK_IMAGE_WAIT_MS = 10 * 60 * 1000

let imageDispatcher: Agent | undefined
export function arkImageFetchDispatcher() {
  imageDispatcher ||= new Agent({
    headersTimeout: ARK_IMAGE_WAIT_MS,
    bodyTimeout: ARK_IMAGE_WAIT_MS,
    connectTimeout: 30_000,
  })
  return imageDispatcher
}

type ArkSubmissionState = 'not_started' | 'submitting' | 'completed' | 'submission_unknown'

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function arkMetadata(job: MediaJobDocument) {
  return asRecord(asRecord(job.providerMetadata).arkImage)
}

function submissionState(job: MediaJobDocument): ArkSubmissionState {
  const state = String(arkMetadata(job).submissionState || 'not_started')
  return ['not_started', 'submitting', 'completed', 'submission_unknown'].includes(state)
    ? state as ArkSubmissionState
    : 'not_started'
}

function setArkMetadata(job: MediaJobDocument, patch: Record<string, unknown>) {
  job.providerMetadata = {
    ...asRecord(job.providerMetadata),
    arkImage: {
      ...arkMetadata(job),
      ...patch,
    },
  }
  job.markModified('providerMetadata')
}

function arkRequestSnapshot(job: MediaJobDocument) {
  return asRecord(asRecord(job.requestBody).arkImage)
}

function arkKey() {
  const key = readServiceSettings().arkKey.trim()
  if (!key)
    throw Object.assign(new Error('Ark API key is not configured'), { statusCode: 500 })
  return key
}

export async function buildArkImagePayload(job: MediaJobDocument, signal?: AbortSignal) {
  if (!isArkImageModel(job.model))
    throw Object.assign(new Error('This image model is not supported by Ark'), { statusCode: 400 })
  const request = arkRequestSnapshot(job)
  const input = Object.keys(asRecord(request.input)).length ? asRecord(request.input) : asRecord(job.input)
  const model = String(job.backendModelId || request.model || '').trim()
  if (model !== ARK_IMAGE_MODEL_ID)
    throw Object.assign(new Error('Invalid Ark image model snapshot'), { statusCode: 400 })
  const images = await materializeArkImageSources(input.input_urls, signal)
  const payload: Record<string, unknown> = {
    model,
    prompt: String(input.prompt || '').trim(),
    size: arkImageSize(input),
    response_format: input.response_format === 'b64_json' ? 'b64_json' : 'url',
    watermark: input.watermark === true,
  }
  if (images.length)
    payload.image = images.length === 1 ? images[0] : images
  assertArkRequestSize(payload)
  return payload
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

function responseError(payload: unknown, fallback: string) {
  const record = asRecord(payload)
  return readErrorMessage(record.error || payload, fallback)
}

async function readArkResponse(response: Response, job: MediaJobDocument) {
  let text: string
  try {
    text = await response.text()
  }
  catch (error) {
    await markSubmissionUnknown(job, error)
    throw Object.assign(new Error(job.failMsg), { failCode: 'submission_unknown', cause: error })
  }
  let payload: Record<string, unknown>
  try {
    payload = text ? JSON.parse(text) as Record<string, unknown> : {}
  }
  catch {
    throw Object.assign(new Error('Ark returned an invalid JSON response'), {
      statusCode: response.status || 502,
      failCode: 'invalid_provider_response',
    })
  }
  if (!response.ok || payload.error) {
    throw Object.assign(new Error(responseError(payload, `Ark image generation failed (${response.status})`)), {
      statusCode: response.status || 502,
      failCode: response.ok ? 'provider_error' : String(response.status),
    })
  }
  return payload
}

export const arkImageBackend: MediaBackend = {
  provider: 'ark-image',
  protocolVersion: ARK_IMAGE_PROTOCOL_VERSION,
  async start(job) {
    if (generationProvider(job) !== 'ark-image')
      throw new Error('Ark image backend received a non-Ark job')
    if (submissionState(job) !== 'not_started') {
      await markSubmissionUnknown(job, new Error('An earlier Ark submission did not finish locally'))
      throw Object.assign(new Error(job.failMsg), { failCode: 'submission_unknown' })
    }

    const payload = await buildArkImagePayload(job)
    const key = arkKey()
    setArkMetadata(job, {
      endpoint: ARK_IMAGE_ENDPOINT,
      submissionState: 'submitting',
      submittingAt: new Date().toISOString(),
    })
    job.lastSyncAt = new Date()
    await job.save()

    let response: Response
    try {
      response = await fetch(ARK_IMAGE_ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(ARK_IMAGE_WAIT_MS),
        dispatcher: arkImageFetchDispatcher(),
      } as RequestInit)
    }
    catch (error) {
      await markSubmissionUnknown(job, error)
      throw Object.assign(new Error(job.failMsg), { failCode: 'submission_unknown', cause: error })
    }

    const body = await readArkResponse(response, job)
    const materialized = await materializeArkImageResults(job.taskId, body.data)
    if (!materialized.urls.length) {
      throw Object.assign(new Error(materialized.errors[0] || 'Ark returned no image result'), {
        failCode: 'provider_error',
      })
    }
    setArkMetadata(job, {
      submissionState: 'completed',
      completedAt: new Date().toISOString(),
      partialErrors: materialized.errors,
    })
    return {
      status: 'completed',
      providerTaskId: '',
      providerMetadata: asRecord(job.providerMetadata),
      resultUrls: materialized.urls,
      resultJson: JSON.stringify({
        resultUrls: materialized.urls,
        results: materialized.results,
        errors: materialized.errors,
      }),
    }
  },
  async sync(job) {
    if (generationProvider(job) !== 'ark-image')
      throw new Error('Ark image backend received a non-Ark job')
    return job
  },
}
