import type { MediaBackend, MediaJobDocument } from './types'
import { Buffer } from 'node:buffer'
import { readErrorMessage } from '~~/shared/utils/apiError'
import { generationProvider } from '../../utils/generationJobs'
import { downloadExportMedia } from '../../utils/mediaExport'
import { readServiceSettings } from '../../utils/serviceSettings'
import { AGNES_IMAGE_MODEL_ID, isAgnesImageBackendModel, isAgnesImageModel, mapAgnesImageSizeFields } from './agnesImageInput'
import { ARK_IMAGE_MAX_BYTES, ARK_IMAGE_MAX_REQUEST_BYTES } from './arkImageInput'
import { assertArkRequestSize, materializeArkImageResults, materializeArkImageSources } from './materialize'

export const AGNES_IMAGE_PROTOCOL_VERSION = 'agnes-images-sync-v1'
export const AGNES_IMAGE_ENDPOINT = 'https://apihub.agnes-ai.com/v1/images/generations'
export const AGNES_IMAGE_WAIT_MS = 6 * 60 * 1000

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function metadata(job: MediaJobDocument) {
  return asRecord(asRecord(job.providerMetadata).agnesImage)
}

function setMetadata(job: MediaJobDocument, patch: Record<string, unknown>) {
  job.providerMetadata = {
    ...asRecord(job.providerMetadata),
    agnesImage: { ...metadata(job), ...patch },
  }
  job.markModified('providerMetadata')
}

function requestSnapshot(job: MediaJobDocument) {
  return asRecord(asRecord(job.requestBody).agnesImage)
}

function apiKey() {
  const key = readServiceSettings().agnesKey.trim()
  if (!key)
    throw Object.assign(new Error('Agnes API key is not configured'), { statusCode: 500 })
  return key
}

function imageMime(value: unknown) {
  const mime = String(value || '').split(';')[0]!.trim().toLowerCase()
  if (mime.startsWith('image/') && mime !== 'image/svg+xml')
    return mime
  return ''
}

function sniffImageMime(bytes: Buffer) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF)
    return 'image/jpeg'
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP')
    return 'image/webp'
  return 'image/jpeg'
}

export async function inlineAgnesRemoteImages(images: string[], signal?: AbortSignal) {
  const inlined: string[] = []
  let localBytes = 0
  for (const image of images) {
    signal?.throwIfAborted()
    const source = String(image || '').trim()
    if (!source)
      throw Object.assign(new Error('Reference image must be a URL or image data URL'), { statusCode: 400 })
    if (source.startsWith('data:')) {
      inlined.push(source)
      continue
    }
    try {
      const downloaded = await downloadExportMedia(source, ARK_IMAGE_MAX_BYTES, signal)
      const mime = imageMime(downloaded.mime) || sniffImageMime(Buffer.from(downloaded.bytes))
      if (!downloaded.bytes.length || downloaded.bytes.byteLength > ARK_IMAGE_MAX_BYTES)
        throw new Error('Each reference image must be 30MB or smaller')
      localBytes += downloaded.bytes.byteLength
      inlined.push(`data:${mime};base64,${Buffer.from(downloaded.bytes).toString('base64')}`)
    }
    catch (error) {
      if (signal?.aborted)
        throw error
      throw Object.assign(new Error('Could not load a reference image for Agnes. Use a local stored image or a reachable public URL.'), {
        statusCode: 400,
        cause: error,
      })
    }
  }
  if (localBytes > ARK_IMAGE_MAX_REQUEST_BYTES)
    throw Object.assign(new Error('Reference images exceed the 64MB request limit'), { statusCode: 400 })
  return inlined
}

function responseError(payload: unknown, fallback: string) {
  const record = asRecord(payload)
  return readErrorMessage(record.error || record.detail || payload, fallback)
}

async function markSubmissionUnknown(job: MediaJobDocument, error: unknown) {
  const message = 'Agnes image submission status is unknown. This job was not retried to avoid duplicate generation.'
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

export async function buildAgnesImagePayload(job: MediaJobDocument, signal?: AbortSignal) {
  if (!isAgnesImageModel(job.model))
    throw Object.assign(new Error('This image model is not supported by Agnes'), { statusCode: 400 })
  const request = requestSnapshot(job)
  const input = Object.keys(asRecord(request.input)).length ? asRecord(request.input) : asRecord(job.input)
  const model = String(job.backendModelId || request.model || '').trim()
  if (!isAgnesImageBackendModel(model))
    throw Object.assign(new Error('Invalid Agnes image model snapshot'), { statusCode: 400 })
  const images = await inlineAgnesRemoteImages(await materializeArkImageSources(input.input_urls, signal), signal)
  const { size, ratio } = mapAgnesImageSizeFields(input)
  const payload: Record<string, unknown> = {
    model: AGNES_IMAGE_MODEL_ID,
    prompt: String(input.prompt || '').trim(),
    size,
    ratio,
    extra_body: {
      ...(images.length ? { image: images } : {}),
      response_format: 'url',
    },
  }
  assertArkRequestSize(payload)
  return payload
}

export const agnesImageBackend: MediaBackend = {
  provider: 'agnes-image',
  protocolVersion: AGNES_IMAGE_PROTOCOL_VERSION,
  async start(job) {
    if (generationProvider(job) !== 'agnes-image')
      throw new Error('Agnes image backend received a non-Agnes job')
    if (String(metadata(job).submissionState || 'not_started') !== 'not_started') {
      await markSubmissionUnknown(job, new Error('An earlier Agnes submission did not finish locally'))
      throw Object.assign(new Error(job.failMsg), { failCode: 'submission_unknown' })
    }

    const payload = await buildAgnesImagePayload(job)
    setMetadata(job, {
      endpoint: AGNES_IMAGE_ENDPOINT,
      submissionState: 'submitting',
      submittingAt: new Date().toISOString(),
    })
    job.lastSyncAt = new Date()
    await job.save()

    let response: Response
    try {
      response = await fetch(AGNES_IMAGE_ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(AGNES_IMAGE_WAIT_MS),
      })
    }
    catch (error) {
      await markSubmissionUnknown(job, error)
      throw Object.assign(new Error(job.failMsg), { failCode: 'submission_unknown', cause: error })
    }

    let body: Record<string, unknown>
    try {
      body = JSON.parse(await response.text()) as Record<string, unknown>
    }
    catch (error) {
      if (response.ok) {
        await markSubmissionUnknown(job, error)
        throw Object.assign(new Error(job.failMsg), { failCode: 'submission_unknown', cause: error })
      }
      throw Object.assign(new Error(`Agnes image generation failed (${response.status})`), { statusCode: response.status })
    }
    if (!response.ok || body.error) {
      throw Object.assign(new Error(responseError(body, `Agnes image generation failed (${response.status})`)), {
        statusCode: response.status || 502,
        failCode: response.ok ? 'provider_error' : String(response.status),
      })
    }

    const materialized = await materializeArkImageResults(job.taskId, body.data)
    if (!materialized.urls.length)
      throw Object.assign(new Error(materialized.errors[0] || 'Agnes returned no image result'), { failCode: 'provider_error' })
    setMetadata(job, {
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
    if (generationProvider(job) !== 'agnes-image')
      throw new Error('Agnes image backend received a non-Agnes job')
    return job
  },
}
