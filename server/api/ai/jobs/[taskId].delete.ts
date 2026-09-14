import { GENERATION_ACTIVE_STATES, isGenerationActive } from '../../../../shared/types/generation'
import { removeSessionImages } from '../../../agent/session'
import { removeMediaBackend } from '../../../ai/media/registry'
import { GenerationJob } from '../../../models/generationJob'
import { findAgentSessionIdForImage } from '../../../utils/agentSessionRuntime'
import { generationProvider } from '../../../utils/generationJobs'
import { dispatchQueuedJobs } from '../../../utils/generationQueue'
import { connectDatabase } from '../../../utils/sqlite'

async function removeLinkedSessionImages(job: {
  taskId?: string
  originalRequest?: Record<string, unknown>
}) {
  const original = job.originalRequest && typeof job.originalRequest === 'object'
    ? job.originalRequest
    : {}
  const taskId = String(job.taskId || '').trim()
  const imageId = String(original.imageId || '').trim()
    || (taskId.startsWith('agent_') ? taskId.slice('agent_'.length) : '')
  let sessionId = String(original.sessionId || '').trim()
  if (!sessionId && imageId)
    sessionId = await findAgentSessionIdForImage(imageId)
  if (!sessionId || !imageId)
    return
  try {
    await removeSessionImages(sessionId, [imageId], {
      allowGenerating: true,
      includeDerived: true,
    })
  }
  catch (error) {
    console.warn('[generation delete session cleanup]', sessionId, imageId, error)
  }
}

export default defineEventHandler(async (event) => {
  const taskId = String(getRouterParam(event, 'taskId') || '').trim()
  if (!taskId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'taskId is required',
    })
  }
  await connectDatabase()
  const current = await GenerationJob.findOne({
    taskId,
    deleted: { $ne: true },
  })
  if (!current) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Generation job not found',
    })
  }

  if (generationProvider(current) === 'ark-video') {
    const providerTaskId = String(current.providerTaskId || '').trim()
    const providerQueued = current.state === 'queued' || current.state === 'waiting' || current.state === 'queuing'
    if (current.state === 'generating') {
      throw createError({
        statusCode: 409,
        statusMessage: 'Ark video tasks cannot be cancelled after generation starts',
      })
    }
    if (providerQueued && current.state !== 'queued' && !providerTaskId) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Ark video submission is still being confirmed; try again shortly',
      })
    }
    if (providerQueued && providerTaskId) {
      try {
        await removeMediaBackend(current)
      }
      catch (error) {
        throw createError({
          statusCode: Number((error as { statusCode?: unknown })?.statusCode || 502),
          statusMessage: error instanceof Error ? error.message : 'Could not cancel the Ark video task',
        })
      }
    }
    else if (!providerQueued && providerTaskId) {
      try {
        await removeMediaBackend(current)
      }
      catch (error) {
        console.warn('[ark video delete]', taskId, error)
      }
    }
    current.deleted = true
    current.deletedAt = new Date()
    await current.save()
    await removeLinkedSessionImages(current)
    await dispatchQueuedJobs()
    return { ok: true }
  }

  const job = await GenerationJob.findOneAndUpdate({
    taskId,
    deleted: { $ne: true },
    state: { $nin: [...GENERATION_ACTIVE_STATES] },
  }, {
    $set: {
      deleted: true,
      deletedAt: new Date(),
    },
  }, { new: true })
  if (!job) {
    const existing = await GenerationJob.findOne({
      taskId,
      deleted: { $ne: true },
    }).select('state').lean()
    if (existing && isGenerationActive(existing.state)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Cannot delete a generation that is still in progress',
      })
    }
    throw createError({
      statusCode: 404,
      statusMessage: 'Generation job not found',
    })
  }
  await removeLinkedSessionImages(job)
  await dispatchQueuedJobs()
  return { ok: true }
})
