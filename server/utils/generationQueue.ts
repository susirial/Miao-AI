import type { IGenerationJob } from '../models/generationJob'
import type { StoredDocument } from './sqlite'
import { readErrorMessage } from '~~/shared/utils/apiError'
import { GENERATION_ACTIVE_STATES } from '../../shared/types/generation'
import { startMediaBackend } from '../ai/media/registry'
import { GenerationJob } from '../models/generationJob'
import { generationConcurrency } from './generationConcurrency'
import { isProviderStarted } from './generationJobs'
import { mergeSourceUrls } from './generationResults'
import { isStoredMediaUrl } from './localMedia'

type GenerationJobDocument = StoredDocument<IGenerationJob>
let dispatching: Promise<void> | undefined
let dispatchAgain = false
const starting = new Map<string, Promise<void>>()
function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
export function newLocalTaskId() {
  return `job_${crypto.randomUUID()}`
}
export async function countActiveGenerationJobs() {
  return GenerationJob.countDocuments({
    deleted: { $ne: true },
    state: { $in: [...GENERATION_ACTIVE_STATES] },
  })
}
async function failUnstartedJob(job: GenerationJobDocument, error: unknown) {
  const message = readErrorMessage(error, 'Generation failed')
  const failCode = String((error as { failCode?: unknown })?.failCode || '').trim()
  if (job.state !== 'fail')
    job.state = 'fail'
  if (!job.failCode && failCode)
    job.failCode = failCode
  if (!job.failMsg)
    job.failMsg = message
  await job.save()
  return job
}
async function startProviderTask(job: GenerationJobDocument) {
  const original = asRecord(job.originalRequest)
  if (original?.source === 'agent' && original?.holdSlot === true) {
    if (job.state === 'queued' || job.state === 'waiting' || job.state === 'queuing') {
      job.state = 'generating'
      job.lastSyncAt = new Date()
      await job.save()
    }
    return job
  }
  if (isProviderStarted(job))
    return job
  const requestBody = asRecord(job.requestBody) || {}
  const started = await startMediaBackend(job)
  if (!started)
    return job

  if (started.status === 'pending' && !String(started.providerTaskId || '').trim())
    throw new Error('Generation backend did not return a task id')
  job.providerTaskId = String(started.providerTaskId || '').trim()
  job.providerMetadata = {
    ...(asRecord(job.providerMetadata) || {}),
    ...(asRecord(started.providerMetadata) || {}),
  }
  job.requestBody = {
    ...requestBody,
    ...(asRecord(started.requestBodyPatch) || {}),
  }
  if (started.resultJson !== undefined)
    job.resultJson = started.resultJson
  if (started.resultUrls?.length) {
    mergeSourceUrls(job, started.resultUrls)
    for (const asset of job.resultAssets) {
      if (!isStoredMediaUrl(asset.sourceUrl))
        continue
      asset.localUrl = asset.sourceUrl
      asset.localKey = ''
      asset.status = 'uploaded'
    }
    job.markModified('resultAssets')
    job.resultUrls = job.resultAssets
      .filter(asset => asset.status === 'uploaded' && asset.localUrl)
      .map(asset => asset.localUrl)
    job.state = job.resultAssets.every(asset => asset.status === 'uploaded') ? 'success' : 'archiving'
  }
  else {
    job.state = started.status === 'completed' ? 'success' : 'waiting'
  }
  job.lastSyncAt = new Date()
  await job.save()
  return job
}
function launchProviderStart(job: GenerationJobDocument) {
  if (starting.has(job.taskId))
    return
  const worker = Promise.resolve()
    .then(async () => {
      await startProviderTask(job)
    })
    .catch(async (error) => {
      console.error('[generation queue start]', job.taskId, error)
      await failUnstartedJob(job, error)
    })
    .finally(() => {
      starting.delete(job.taskId)
      void dispatchQueuedJobs()
    })
  starting.set(job.taskId, worker)
}
export function isGenerationStartInFlight(taskId: string) {
  return starting.has(taskId)
}
async function dispatchOnce() {
  const limit = await generationConcurrency()
  for (let i = 0; i < limit + 2; i++) {
    const active = await countActiveGenerationJobs()
    if (active >= limit)
      return
    const claimed = await GenerationJob.findOneAndUpdate({
      deleted: { $ne: true },
      state: 'queued',
    }, {
      $set: {
        state: 'waiting',
        lastSyncAt: new Date(),
      },
    }, {
      sort: { createdAt: 1 },
      new: true,
    })
    if (!claimed)
      return
    const activeAfter = await countActiveGenerationJobs()
    if (activeAfter > limit) {
      if (!isProviderStarted(claimed)) {
        claimed.state = 'queued'
        await claimed.save()
      }
      return
    }
    launchProviderStart(claimed)
  }
}
export function dispatchQueuedJobs(): Promise<void> {
  dispatchAgain = true
  if (dispatching)
    return dispatching
  dispatching = (async () => {
    try {
      do {
        dispatchAgain = false
        await dispatchOnce()
      } while (dispatchAgain)
    }
    catch (error) {
      console.error('[generation queue]', error)
    }
    finally {
      dispatching = undefined
    }
  })()
  return dispatching
}

export async function startPendingProviderJob(job: GenerationJobDocument) {
  if (job.state === 'queued') {
    await dispatchQueuedJobs()
    return (await GenerationJob.findById(job._id)) || job
  }
  if ((job.state === 'waiting' || job.state === 'queuing' || job.state === 'generating') && !isProviderStarted(job)) {
    launchProviderStart(job)
    return (await GenerationJob.findById(job._id)) || job
  }
  return job
}
