import { canonicalizeAgnesImageModelId } from '../../../shared/constants/aiModels'
import { sanitizeAgnesImageInput } from '../../ai/media/agnesImageInput'
import { sanitizeAgnesVideoInput } from '../../ai/media/agnesVideoInput'
import { sanitizeArkImageInput } from '../../ai/media/arkImageInput'
import { sanitizeArkVideoInput } from '../../ai/media/arkVideoInput'
import { resolveMediaGenerationBackend } from '../../ai/media/resolve'
import { GenerationJob } from '../../models/generationJob'
import { dispatchQueuedJobs, newLocalTaskId } from '../../utils/generationQueue'
import { toPublicJob } from '../../utils/generationResults'
import { materializeAgnesVideoSources } from '../../utils/publicMediaOrigin'
import { toPublicApiError } from '../../utils/httpError'
import { assertProjectWritable } from '../../utils/projectDeletion'
import { resolveProject } from '../../utils/projects'
import { publicServiceStatus, readServiceSettings } from '../../utils/serviceSettings'
import { connectDatabase } from '../../utils/sqlite'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    model?: string
    category?: string
    task?: string
    projectId?: string
    input?: Record<string, unknown>
  }>(event)
  const model = canonicalizeAgnesImageModelId(String(body?.model || '').trim())
  const rawInput = body?.input && typeof body.input === 'object' ? body.input : {}
  const settings = readServiceSettings()
  const selectedBackend = resolveMediaGenerationBackend(model)
  const status = publicServiceStatus(settings)
  const ready = selectedBackend.provider === 'agnes-image' || selectedBackend.provider === 'agnes-video'
    ? status.providers.agnes.ok
    : status.providers.ark.ok
  if (!ready) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Configure and test the selected media backend in Service connection before generating.',
      data: { code: 'MEDIA_PROVIDER_NOT_READY' },
    })
  }
  let input: Record<string, unknown>
  try {
    const videoInput = selectedBackend.provider === 'agnes-video'
      ? await materializeAgnesVideoSources(rawInput)
      : rawInput
    input = selectedBackend.provider === 'agnes-image'
      ? sanitizeAgnesImageInput(model, rawInput)
      : selectedBackend.provider === 'agnes-video'
        ? sanitizeAgnesVideoInput(model, videoInput)
        : selectedBackend.provider === 'ark-image'
          ? sanitizeArkImageInput(model, rawInput)
          : sanitizeArkVideoInput(model, rawInput)
  }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid generation input'
    const statusCode = Number((error as { statusCode?: number })?.statusCode || 400)
    const failCode = String((error as { failCode?: string })?.failCode || '').trim()
    throw createError({
      statusCode: statusCode >= 400 && statusCode < 500 ? statusCode : 400,
      statusMessage: message,
      data: failCode ? { code: failCode } : undefined,
    })
  }
  const resolved = resolveMediaGenerationBackend(model)
  await connectDatabase()
  const project = await resolveProject(body?.projectId)
  const requestBody = resolved.provider === 'ark-image'
    ? { arkImage: { model: resolved.backendModelId, input } }
    : resolved.provider === 'ark-video'
      ? { arkVideo: { model: resolved.backendModelId, input } }
      : resolved.provider === 'agnes-image'
        ? { agnesImage: { model: resolved.backendModelId, input } }
        : { agnesVideo: { model: resolved.backendModelId, input } }
  const providerMetadata = resolved.provider === 'ark-image'
    ? { arkImage: { submissionState: 'not_started' } }
    : resolved.provider === 'ark-video'
      ? { arkVideo: { submissionState: 'not_started' } }
      : resolved.provider === 'agnes-image'
        ? { agnesImage: { submissionState: 'not_started' } }
        : { agnesVideo: { submissionState: 'not_started' } }
  try {
    await assertProjectWritable(String(project._id))
    const job = await GenerationJob.create({
      projectId: String(project._id),
      provider: resolved.provider,
      model,
      backendModelId: resolved.backendModelId,
      protocolVersion: resolved.protocolVersion,
      providerMetadata,
      category: String(body?.category || ''),
      task: String(body?.task || ''),
      input,
      requestBody,
      originalRequest: body && typeof body === 'object' ? body : {},
      taskId: newLocalTaskId(),
      providerTaskId: '',
      state: 'queued',
      sourceUrls: [],
      resultUrls: [],
      resultAssets: [],
      resultJson: '',
      failCode: '',
      failMsg: '',

      archiveAttempts: 0,
      lastSyncAt: new Date(),
    })
    await dispatchQueuedJobs()
    const latest = await GenerationJob.findById(job._id)
    if (!latest) {
      throw createError({
        statusCode: 502,
        statusMessage: 'Generation failed',
      })
    }
    if (latest.state === 'fail' && !latest.providerTaskId) {
      latest.deleted = true
      latest.deletedAt = new Date()
      latest.hiddenFromUser = true
      await latest.save()
      throw createError({
        statusCode: 502,
        statusMessage: latest.failMsg || 'Generation failed',
      })
    }
    return toPublicJob(latest)
  }
  catch (error) {
    const statusCode = Number((error as {
      statusCode?: number
    })?.statusCode || 0)
    if (statusCode !== 402 && statusCode !== 422)
      console.error('[generate]', error)
    throw toPublicApiError(error, 'Generation failed')
  }
})
