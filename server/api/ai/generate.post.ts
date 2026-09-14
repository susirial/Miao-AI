import { sanitizeArkImageInput } from '../../ai/media/arkImageInput'
import { sanitizeArkVideoInput } from '../../ai/media/arkVideoInput'
import { resolveMediaGenerationBackend } from '../../ai/media/resolve'
import { GenerationJob } from '../../models/generationJob'
import { dispatchQueuedJobs, newLocalTaskId } from '../../utils/generationQueue'
import { toPublicJob } from '../../utils/generationResults'
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
  const model = String(body?.model || '').trim()
  const rawInput = body?.input && typeof body.input === 'object' ? body.input : {}
  const settings = readServiceSettings()
  const selectedBackend = resolveMediaGenerationBackend(model)
  const status = publicServiceStatus(settings)
  const ready = selectedBackend.provider === 'ark-image'
    ? status.imageReady
    : status.videoReady
  if (!ready) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Configure and test the selected media backend in Service connection before generating.',
      data: { code: 'MEDIA_PROVIDER_NOT_READY' },
    })
  }
  const input = selectedBackend.provider === 'ark-image'
    ? sanitizeArkImageInput(model, rawInput)
    : sanitizeArkVideoInput(model, rawInput)
  const resolved = resolveMediaGenerationBackend(model)
  await connectDatabase()
  const project = await resolveProject(body?.projectId)
  const requestBody = resolved.provider === 'ark-image'
    ? { arkImage: { model: resolved.backendModelId, input } }
    : resolved.provider === 'ark-video'
      ? { arkVideo: { model: resolved.backendModelId, input } }
      : { model: resolved.backendModelId, input }
  const providerMetadata = resolved.provider === 'ark-image'
    ? { arkImage: { submissionState: 'not_started' } }
    : resolved.provider === 'ark-video'
      ? { arkVideo: { submissionState: 'not_started' } }
      : {}
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
