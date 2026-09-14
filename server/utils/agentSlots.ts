import type { GenerationProvider } from '../../shared/types/generation'
import type { IGenerationJob } from '../models/generationJob'
import type { StoredDocument } from './sqlite'
import { AGENT_MODELS } from '~~/shared/utils/agentModels'
import { GENERATION_ACTIVE_STATES } from '../../shared/types/generation'
import { GenerationJob } from '../models/generationJob'
import { agentResultTaskId, httpUrlList } from './agentJobs'
import { syncAgentRuntimeFromJob } from './agentSessionRuntime'
import { generationConcurrency } from './generationConcurrency'
import { isJobDeleted } from './generationJobs'
import { countActiveGenerationJobs, dispatchQueuedJobs } from './generationQueue'
import { assertProjectWritable } from './projectDeletion'
import { resolveProject } from './projects'
import { connectDatabase, isSqliteUniqueConstraintError } from './sqlite'
import { canonicalMediaUrl } from './storedMediaUrl.mjs'

async function saveAgentJob(job: StoredDocument<IGenerationJob>) {
  await job.save()
  return job
}
function queueMessage(limit: number, active: number) {
  if (limit <= 1) {
    return active >= 1
      ? 'This workspace supports 1 concurrent generation. This job is waiting in queue and will start automatically.'
      : 'This workspace supports 1 concurrent generation.'
  }
  return active >= limit
    ? `This workspace supports ${limit} concurrent generations. This job is waiting in queue and will start automatically.`
    : `This workspace supports ${limit} concurrent generations.`
}
async function slotSnapshot(callId: string) {
  const taskId = agentResultTaskId(callId)
  const job = await GenerationJob.findOne({ taskId, deleted: { $ne: true } })
  const [limit, active] = await Promise.all([
    generationConcurrency(),
    countActiveGenerationJobs(),
  ])
  const state = String(job?.state || 'fail')
  const queued = state === 'queued'
  return {
    callId,
    state,
    queued,
    limit,
    active,
    message: job?.failMsg || queueMessage(limit, active),
  }
}
export async function acquireAgentSlot(input: {
  sessionId: string
  callId: string
  projectId?: string
  modelId?: string
  modelInput?: Record<string, unknown>
  requestModel?: string
  kind?: string
  prompt?: string
  aspectRatio?: string
  resolution?: string
  duration?: number
  sourceUrl?: string
  inputUrls?: string[]
  referenceVideoUrls?: string[]
  videoMode?: string
  videoFamily?: string
  provider?: GenerationProvider
  backendModelId?: string
  protocolVersion?: string
  providerMetadata?: Record<string, unknown>
  requestBody?: Record<string, unknown>
  category?: string
  task?: string
}) {
  await connectDatabase()
  const callId = String(input.callId || '').trim()
  if (!callId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'callId is required',
    })
  }
  const project = await resolveProject(input.projectId)
  const taskId = agentResultTaskId(callId)
  const kind = String(input.kind || 'still')
  const sourceUrl = String(input.sourceUrl || '').trim()
  const stills = httpUrlList(input.inputUrls?.length ? input.inputUrls : [sourceUrl])
  const videos = httpUrlList(input.referenceVideoUrls)
  const videoMode = String(input.videoMode || '')
  const registered = input.modelId ? AGENT_MODELS.find(model => model.id === input.modelId) : undefined
  if (input.modelId && !registered)
    throw new Error('Unknown Agent model')
  if (!registered || !input.provider || !input.backendModelId || !input.protocolVersion || !input.requestBody)
    throw new Error('Generation backend snapshot is required')
  const meta = {
    model: registered.id,
    category: input.category || registered.category,
    task: input.task ?? registered.task,
    provider: input.provider,
  }
  const prompt = String(input.prompt || '').trim()
  let inputPayload: Record<string, unknown> = {
    prompt,
    aspect_ratio: input.aspectRatio || '',
    resolution: input.resolution || '',
  }
  if (input.duration)
    inputPayload.duration = input.duration
  if (kind === 'video' && videoMode === 'reference') {
    if (stills.length)
      inputPayload.reference_image_urls = stills
    if (videos.length)
      inputPayload.reference_video_urls = videos
  }
  else if (kind === 'video' && videoMode === 'image' && stills[0]) {
    inputPayload.first_frame_url = stills[0]
    if (stills[1])
      inputPayload.last_frame_url = stills[1]
  }
  else if (stills.length) {
    inputPayload.input_urls = stills
  }
  if (registered && input.modelInput)
    inputPayload = input.modelInput
  const backendModelId = input.backendModelId
  const protocolVersion = input.protocolVersion
  const providerMetadata = input.providerMetadata || {}
  const requestBody = input.requestBody
  const existing = await GenerationJob.findOne({ taskId })
  if (existing) {
    if (isJobDeleted(existing)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Generation job was deleted',
      })
    }
  }
  else {
    try {
      await assertProjectWritable(String(project._id))
      await GenerationJob.create({
        projectId: String(project._id),
        provider: meta.provider,
        model: meta.model,
        backendModelId,
        protocolVersion,
        providerMetadata,
        category: meta.category,
        task: meta.task,
        input: inputPayload,
        requestBody,
        originalRequest: {
          source: 'agent',
          holdSlot: false,
          imageId: callId,
          sessionId: input.sessionId,
          modelId: meta.model,
        },
        taskId,
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
    }
    catch (error) {
      if (!isSqliteUniqueConstraintError(error))
        throw error
      const winner = await GenerationJob.findOne({ taskId })
      if (!winner)
        throw error
      if (isJobDeleted(winner)) {
        throw createError({
          statusCode: 409,
          statusMessage: 'Generation job was deleted',
        })
      }
    }
  }
  await dispatchQueuedJobs()
  return slotSnapshot(callId)
}
export async function readAgentSlot(callId: string) {
  await connectDatabase()
  await dispatchQueuedJobs()
  return slotSnapshot(callId)
}
export async function completeAgentSlot(input: {
  callId: string
  url?: string
  error?: string
}) {
  await connectDatabase()
  const callId = String(input.callId || '').trim()
  if (!callId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'callId is required',
    })
  }
  const taskId = agentResultTaskId(callId)
  const job = await GenerationJob.findOne({ taskId, deleted: { $ne: true } })
  if (job) {
    const settled = job.state === 'success' || job.state === 'moderating' || job.state === 'archiving'
    if (!settled) {
      const url = canonicalMediaUrl(input.url)
      const error = String(input.error || '').trim()
      const now = new Date()
      const keepOpen = Boolean(job.providerTaskId) && isKeepAliveSlotError(error)
      if (url && !error) {
        job.state = 'success'
        job.resultUrls = [url]
        if (!job.sourceUrls.includes(url))
          job.sourceUrls = [...job.sourceUrls, url]
        job.failCode = ''
        job.failMsg = ''
        job.completeTime = now.getTime()
        job.lastSyncAt = now
        await saveAgentJob(job)
      }
      else if (!keepOpen) {
        job.state = 'fail'
        job.failMsg = error || 'Generation cancelled'
        job.completeTime = now.getTime()
        job.lastSyncAt = now
        await saveAgentJob(job)
      }
    }
    void syncAgentRuntimeFromJob(job)
  }
  await dispatchQueuedJobs()
  const active = await GenerationJob.countDocuments({
    deleted: { $ne: true },
    state: { $in: [...GENERATION_ACTIVE_STATES] },
  })
  const limit = await generationConcurrency()
  return {
    callId,
    state: job?.state || 'fail',
    queued: false,
    limit,
    active,
    message: job?.state === 'fail' ? String(job.failMsg || '') : '',
  }
}
export async function bindAgentSlot(input: {
  callId: string
  providerTaskId?: string
}) {
  await connectDatabase()
  const callId = String(input.callId || '').trim()
  const providerTaskId = String(input.providerTaskId || '').trim()
  if (!callId || !providerTaskId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'callId and providerTaskId are required',
    })
  }
  const taskId = agentResultTaskId(callId)
  const job = await GenerationJob.findOne({ taskId, deleted: { $ne: true } })
  if (job && !job.providerTaskId) {
    job.providerTaskId = providerTaskId
    job.lastSyncAt = new Date()
    if (job.state === 'queued' || job.state === 'waiting' || job.state === 'queuing')
      job.state = 'generating'
    try {
      await saveAgentJob(job)
    }
    catch (error) {
      console.error('[agent slot bind]', callId, error)
    }
  }
  return slotSnapshot(callId)
}
function isKeepAliveSlotError(error: string) {
  return /aborted|timed out|timeout|no result urls/i.test(error)
}
