import type { GenerationJobPublic } from '../../shared/types/generation'
import type { IGenerationJob } from '../models/generationJob'
import type { StoredDocument } from './sqlite'
import { AGENT_CONCAT_MODEL, isConcatenatedPrompt, isConcatVideoMode } from '~~/shared/utils/agentConcat'
import { AGENT_MODELS } from '~~/shared/utils/agentModels'
import { ARK_IMAGE_MODEL_ID } from '../ai/media/arkImageInput'
import { ARK_VIDEO_MODEL_ID } from '../ai/media/arkVideoInput'
import { GenerationJob } from '../models/generationJob'
import { isJobDeleted } from './generationJobs'
import { excludeInputResultUrls, toPublicJob } from './generationResults'
import { assertProjectWritable, beginProjectWrite, endProjectWrite } from './projectDeletion'
import { resolveProject } from './projects'
import { connectDatabase, isSqliteUniqueConstraintError } from './sqlite'
import { canonicalMediaUrl } from './storedMediaUrl.mjs'

export interface AgentResultItem {
  modelId?: string
  modelInput?: Record<string, unknown>
  id: string
  kind?: string
  name?: string
  prompt?: string
  url: string
  sourceUrl?: string
  inputUrls?: string[]
  referenceVideoUrls?: string[]
  aspectRatio?: string
  resolution?: string
  duration?: number
  videoMode?: 'text' | 'image' | 'reference' | 'concat'
  videoFamily?: 'seedance-2'
}
function taskIdFor(id: string) {
  return `agent_${id}`.slice(0, 120)
}
export function agentResultTaskId(id: string) {
  return taskIdFor(id)
}
export function httpUrlList(values: Array<string | undefined> | undefined, cap = 32) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values || []) {
    const url = canonicalMediaUrl(value)
    if (!url || seen.has(url))
      continue
    seen.add(url)
    out.push(url)
    if (out.length >= cap)
      break
  }
  return out
}
function isConcatItem(item: AgentResultItem) {
  return isConcatVideoMode(item.videoMode) || isConcatenatedPrompt(item.prompt)
}
function modelFor(item: AgentResultItem) {
  const selected = AGENT_MODELS.find(model => model.id === item.modelId)
  if (selected) {
    return {
      provider: selected.category === 'Video' ? 'ark-video' as const : 'ark-image' as const,
      model: selected.id,
      category: selected.category,
      task: selected.task,
    }
  }
  if (item.kind === 'video' && isConcatItem(item)) {
    return {
      provider: 'local' as const,
      model: AGENT_CONCAT_MODEL,
      category: 'Video',
      // Concat may stitch mixed models — do not attribute a generative task.
      task: '',
    }
  }
  return {
    provider: 'local' as const,
    model: 'imported-media',
    category: item.kind === 'video' ? 'Video' : 'Image',
    task: '',
  }
}
function inputFor(item: AgentResultItem) {
  if (item.modelId && AGENT_MODELS.some(model => model.id === item.modelId) && item.modelInput)
    return item.modelInput
  const prompt = String(item.prompt || '').trim()
  const stills = httpUrlList(item.inputUrls?.length ? item.inputUrls : [item.sourceUrl])
  const videos = httpUrlList(item.referenceVideoUrls)
  if (item.kind === 'video' && isConcatItem(item)) {
    return {
      prompt,
      operation: 'concat',
      ...(videos.length ? { video_urls: videos } : {}),
    }
  }
  if (item.kind === 'video') {
    return {
      prompt,
      aspect_ratio: item.aspectRatio || '16:9',
      resolution: item.resolution || '480p',
      duration: item.duration || 5,
      ...(stills.length ? { input_urls: stills } : {}),
      ...(videos.length ? { video_urls: videos } : {}),
    }
  }
  return {
    prompt,
    aspect_ratio: item.aspectRatio || 'auto',
    resolution: item.resolution || '1K',
    ...(stills.length ? { input_urls: stills } : {}),
  }
}
function isQueueOwnedAgentJob(job: { originalRequest?: Record<string, unknown> }) {
  return job.originalRequest?.source === 'agent' && job.originalRequest?.holdSlot === false
}

function importedSnapshot(item: AgentResultItem, url: string) {
  const meta = modelFor(item)
  const input = { ...inputFor(item), asset_name: String(item.name || '').trim().slice(0, 100) }
  const backendModelId = meta.provider === 'ark-image'
    ? ARK_IMAGE_MODEL_ID
    : meta.provider === 'ark-video'
      ? ARK_VIDEO_MODEL_ID
      : meta.model
  const protocolVersion = meta.provider === 'ark-image'
    ? 'ark-images-sync-v1'
    : meta.provider === 'ark-video'
      ? 'ark-video-tasks-v1'
      : 'local-v1'
  const providerMetadata = meta.provider === 'local' ? { local: { operation: 'concat' } } : {}
  const requestBody = meta.provider === 'local'
    ? { local: { model: backendModelId, input } }
    : { model: backendModelId, input }
  const refs = httpUrlList([
    ...(item.inputUrls || []),
    ...(item.referenceVideoUrls || []),
    item.sourceUrl,
    url,
  ])
  return { meta, input, backendModelId, protocolVersion, providerMetadata, requestBody, refs }
}

async function applyExistingAgentResult(
  existing: StoredDocument<IGenerationJob>,
  projectId: string,
  item: AgentResultItem,
  url: string,
) {
  if (isJobDeleted(existing))
    return { job: null }
  const writeIds: string[] = []
  try {
    for (const ownerId of [...new Set([String(existing.projectId || ''), projectId])].filter(Boolean).sort())
      writeIds.push(await beginProjectWrite(ownerId))

    if (isQueueOwnedAgentJob(existing)) {
      existing.projectId = projectId
      await existing.save()
      return { job: toPublicJob(existing) }
    }

    const snapshot = importedSnapshot(item, url)
    const now = new Date()
    existing.projectId = projectId
    existing.provider = snapshot.meta.provider
    existing.set('model', snapshot.meta.model)
    existing.backendModelId = snapshot.backendModelId
    existing.protocolVersion = snapshot.protocolVersion
    existing.providerMetadata = snapshot.providerMetadata
    existing.category = snapshot.meta.category
    existing.task = snapshot.meta.task
    existing.state = 'success'
    existing.resultUrls = [url]
    existing.sourceUrls = snapshot.refs
    existing.failCode = ''
    existing.failMsg = ''
    existing.input = snapshot.input
    existing.requestBody = snapshot.requestBody
    existing.completeTime = now.getTime()
    existing.lastSyncAt = now
    await existing.save()
    return { job: toPublicJob(existing) }
  }
  finally {
    for (const ownerId of writeIds.reverse())
      endProjectWrite(ownerId)
  }
}

export async function recordAgentResults(projectId: string, items: AgentResultItem[]) {
  await connectDatabase()
  const project = await resolveProject(projectId)
  const ownerProjectId = String(project._id)
  const jobs: GenerationJobPublic[] = []
  const importedIds: string[] = []
  for (const item of items.slice(0, 8)) {
    const id = String(item.id || '').trim()
    const url = canonicalMediaUrl(item.url)
    if (!id || !url)
      continue
    if (item.kind === 'upload')
      continue
    if (!excludeInputResultUrls([url], undefined, [...(item.inputUrls || []), item.sourceUrl]).length) {
      importedIds.push(id)
      continue
    }
    const taskId = taskIdFor(id)
    const existing = await GenerationJob.findOne({ taskId })
    if (existing) {
      const result = await applyExistingAgentResult(existing, ownerProjectId, item, url)
      importedIds.push(id)
      if (result.job)
        jobs.push(result.job)
      continue
    }
    const snapshot = importedSnapshot(item, url)
    const now = new Date()
    try {
      await assertProjectWritable(ownerProjectId)
      const job = await GenerationJob.create({
        projectId: ownerProjectId,
        provider: snapshot.meta.provider,
        model: snapshot.meta.model,
        backendModelId: snapshot.backendModelId,
        protocolVersion: snapshot.protocolVersion,
        providerMetadata: snapshot.providerMetadata,
        category: snapshot.meta.category,
        task: snapshot.meta.task,
        input: snapshot.input,
        requestBody: snapshot.requestBody,
        originalRequest: { source: 'agent', imageId: id, ...(isConcatItem(item) ? { operation: 'concat' } : {}) },
        taskId,
        providerTaskId: '',
        state: 'success',
        sourceUrls: snapshot.refs,
        resultUrls: [url],
        resultAssets: [],
        resultJson: '',
        failCode: '',
        failMsg: '',

        archiveAttempts: 0,
        completeTime: now.getTime(),
        lastSyncAt: now,
      })
      jobs.push(toPublicJob(job))
      importedIds.push(id)
    }
    catch (error) {
      if (!isSqliteUniqueConstraintError(error))
        throw error
      const winner = await GenerationJob.findOne({ taskId })
      if (!winner)
        throw error
      const result = await applyExistingAgentResult(winner, ownerProjectId, item, url)
      importedIds.push(id)
      if (result.job)
        jobs.push(result.job)
    }
  }
  return { jobs, importedIds }
}
