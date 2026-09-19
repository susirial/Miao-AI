import type { GenerationProjectPublic } from '../../shared/types/project'
import type { IProject } from '../models/project'
import { GENERATION_ACTIVE_STATES } from '../../shared/types/generation'
import { DEFAULT_PROJECT_NAME, nextProjectTitle, PROJECT_DESCRIPTION_MAX, PROJECT_NAME_MAX } from '../../shared/types/project'
import { pickProjectCoverUrl } from '../../shared/utils/mediaUrl'
import { hasBusyProjectSessions, listProjectSessionRecords, listSessionRecordsExcept, markProjectSessionsRemoved, removeProjectSessionFiles } from '../agent/session'
import { AgentChat } from '../models/agentChat'
import { AgentHistory } from '../models/agentHistory'
import { CanvasLayout } from '../models/canvasLayout'
import { GenerationJob } from '../models/generationJob'
import { Project } from '../models/project'
import { waitForAgentHistoryArchives } from './agentHistory'
import { dispatchQueuedJobs } from './generationQueue'
import { removeStoredMedia } from './localMedia'
import { assertProjectWritable, beginProjectDeletion, beginProjectWrite, endProjectDeletion, endProjectWrite } from './projectDeletion'
import { isDocumentId } from './sqlite'
import { mergeRetainedMediaKeys } from './agentChatDeletion'
import { collectStoredMediaKeys } from './storedMediaUrl.mjs'

const PROJECT_BUSY_STATES = ['queued', ...GENERATION_ACTIVE_STATES] as const

function projectError(statusCode: number, statusMessage: string): never {
  const factory = (globalThis as { createError?: (input: { statusCode: number, statusMessage: string }) => Error }).createError
  if (typeof factory === 'function')
    throw factory({ statusCode, statusMessage })
  throw Object.assign(new Error(statusMessage), { statusCode, statusMessage })
}

function snapshotRecord(value: { toObject?: () => unknown } | unknown) {
  if (value && typeof value === 'object' && typeof (value as { toObject?: unknown }).toObject === 'function')
    return (value as { toObject: () => unknown }).toObject()
  return value
}

export function isProjectId(id: string) {
  return isDocumentId(id)
}
function toIso(value?: Date) {
  return value ? value.toISOString() : ''
}
export interface ProjectStats {
  countById: Map<string, number>
  assetCountById: Map<string, number>
  coverById: Map<string, string>
  activeById: Map<string, number>
}
export function toPublicProject(project: IProject & {
  _id: string
}, extras?: {
  jobCount?: number
  assetCount?: number
  coverUrl?: string
  activeJobCount?: number
}): GenerationProjectPublic {
  return {
    id: String(project._id),
    name: project.name,
    description: project.description || '',
    isDefault: Boolean(project.isDefault),
    deleting: Boolean(project.deletingAt),
    jobCount: extras?.jobCount || 0,
    assetCount: extras?.assetCount || 0,
    activeJobCount: extras?.activeJobCount || 0,
    coverUrl: extras?.coverUrl || '',
    createdAt: toIso(project.createdAt),
    updatedAt: toIso(project.updatedAt),
  }
}
export function toPublicProjectWithStats(project: IProject & {
  _id: string
}, stats: ProjectStats): GenerationProjectPublic {
  const id = String(project._id)
  return toPublicProject(project, {
    jobCount: stats.countById.get(id) || 0,
    assetCount: stats.assetCountById.get(id) || 0,
    coverUrl: stats.coverById.get(id) || '',
    activeJobCount: stats.activeById.get(id) || 0,
  })
}
function foldUnassignedCounts(countById: Map<string, number>, defaultId: string) {
  let unassignedCount = 0
  for (const [id, count] of [...countById.entries()]) {
    if (id && id !== 'null' && id !== 'undefined')
      continue
    unassignedCount += count
    countById.delete(id)
  }
  if (unassignedCount)
    countById.set(defaultId, (countById.get(defaultId) || 0) + unassignedCount)
}
function unassignedJobFilter() {
  return {
    $or: [
      { projectId: { $exists: false } },
      { projectId: '' },
      { projectId: null },
    ],
  }
}
async function backfillUnassignedJobs(projectId: string) {
  await GenerationJob.updateMany(unassignedJobFilter(), { $set: { projectId } })
}
function scheduleBackfill(projectId: string) {
  void backfillUnassignedJobs(projectId).catch((error) => {
    console.error('[projects] Failed to backfill unassigned jobs', error)
  })
}
export async function ensureDefaultProject() {
  const existing = await Project.findOne({ isDefault: true })
  if (existing) {
    if (existing.deletingAt)
      projectError(409, 'This project is being deleted')
    scheduleBackfill(String(existing._id))
    return existing
  }
  try {
    const created = await Project.create({
      name: DEFAULT_PROJECT_NAME,
      description: '',
      isDefault: true,
    })
    scheduleBackfill(String(created._id))
    return created
  }
  catch (error) {
    const raced = await Project.findOne({ isDefault: true })
    if (!raced) {
      console.error('[projects] Could not create the default project', error)
      projectError(500, 'Could not create the default project')
    }
    scheduleBackfill(String(raced._id))
    return raced
  }
}
export async function resolveProject(projectId?: string) {
  const id = String(projectId || '').trim()
  if (id) {
    if (!isProjectId(id)) {
      projectError(400, 'Invalid project')
    }
    const project = await Project.findOne({ _id: id })
    if (!project) {
      projectError(404, 'Project not found')
    }
    if (project.deletingAt)
      projectError(409, 'This project is being deleted')
    return project
  }
  return ensureDefaultProject()
}
export async function moveJobToProject(taskId: string, projectId: string) {
  const id = String(taskId || '').trim()
  if (!id) {
    projectError(400, 'taskId is required')
  }
  const destination = await resolveProject(projectId)
  const destinationId = String(destination._id)
  const current = await GenerationJob.findOne({
    taskId: id,
    deleted: { $ne: true },
  })
  if (!current)
    projectError(404, 'Generation job not found')
  const writeIds: string[] = []
  try {
    for (const ownerId of [...new Set([String(current.projectId || ''), destinationId])].filter(Boolean).sort())
      writeIds.push(await beginProjectWrite(ownerId))
    const job = await GenerationJob.findOneAndUpdate({
      _id: current._id,
      deleted: { $ne: true },
    }, {
      $set: { projectId: destinationId },
      $inc: { __v: 1 },
    }, { new: true })
    if (!job)
      projectError(404, 'Generation job not found')
    return job
  }
  finally {
    for (const ownerId of writeIds.reverse())
      endProjectWrite(ownerId)
  }
}
export function sanitizeProjectFields(input: {
  name?: string
  description?: string
}, existingNames: string[]) {
  const name = String(input.name || '').trim().slice(0, PROJECT_NAME_MAX) || nextProjectTitle(existingNames)
  const description = String(input.description || '').trim().slice(0, PROJECT_DESCRIPTION_MAX)
  return { name, description }
}
export async function createProject(input: {
  name?: string
  description?: string
}) {
  const existing = await Project.find({}).select('name')
  const fields = sanitizeProjectFields(input, existing.map(project => project.name))
  return Project.create({
    name: fields.name,
    description: fields.description,
    isDefault: false,
  })
}
export async function updateProject(projectId: string, input: {
  name?: string
  description?: string
}) {
  const project = await resolveProject(projectId)
  if (project.isDefault) {
    projectError(400, 'The default project cannot be edited')
  }
  const name = String(input.name || '').trim().slice(0, PROJECT_NAME_MAX)
  if (!name) {
    projectError(400, 'Title is required')
  }
  project.name = name
  project.description = String(input.description || '').trim().slice(0, PROJECT_DESCRIPTION_MAX)
  await assertProjectWritable(projectId)
  await project.save()
  return project
}
export async function deleteProject(projectId: string) {
  const id = String(projectId || '').trim()
  if (!isProjectId(id))
    projectError(404, 'Project not found')
  beginProjectDeletion(id)
  try {
    const project = await Project.findById(id)
    if (!project)
      projectError(404, 'Project not found')

    if (!project.deletingAt) {
      const busyJob = await GenerationJob.exists({
        projectId: id,
        deleted: { $ne: true },
        state: { $in: [...PROJECT_BUSY_STATES] },
      })
      if (busyJob || hasBusyProjectSessions(id))
        projectError(409, 'Stop generations and agent work in this project before deleting it')
    }

    const [jobs, chats, layouts] = await Promise.all([
      GenerationJob.find({ projectId: id }),
      AgentChat.find({ projectId: id }),
      CanvasLayout.find({ projectId: id }),
    ])
    const sessionRecords = listProjectSessionRecords(id)
    const sessionIds = [...new Set([
      ...(project.deletionSessionIds || []),
      ...chats.map(chat => String(chat.sessionId || '').trim()),
      ...sessionRecords.map(record => record.sessionId),
    ].filter(Boolean))]
    const history = sessionIds.length
      ? await AgentHistory.find({ sessionId: { $in: sessionIds } })
      : []
    const projectKeys = collectStoredMediaKeys([
      jobs.map(snapshotRecord),
      chats.map(snapshotRecord),
      history.map(snapshotRecord),
      layouts.map(snapshotRecord),
      sessionRecords.map(record => record.payload),
    ], new Set(project.deletionMediaKeys || []))
    mergeRetainedMediaKeys(chats, projectKeys)

    project.deletingAt = project.deletingAt || new Date()
    project.deletionSessionIds = sessionIds
    project.deletionMediaKeys = [...projectKeys]
    await project.save()

    markProjectSessionsRemoved(sessionIds)
    await waitForAgentHistoryArchives(sessionIds)

    if (sessionIds.length)
      await AgentHistory.deleteMany({ sessionId: { $in: sessionIds } })
    await CanvasLayout.deleteMany({ projectId: id })
    await AgentChat.deleteMany({ projectId: id })
    await GenerationJob.deleteMany({ projectId: id })

    const remainingChats = await AgentChat.find({})
    const otherKeys = collectStoredMediaKeys([
      (await GenerationJob.find({})).map(snapshotRecord),
      remainingChats.map(snapshotRecord),
      (await AgentHistory.find({})).map(snapshotRecord),
      (await CanvasLayout.find({})).map(snapshotRecord),
      listSessionRecordsExcept(sessionIds),
    ])
    mergeRetainedMediaKeys(remainingChats, otherKeys)
    for (const key of projectKeys) {
      if (!otherKeys.has(key))
        await removeStoredMedia(key)
    }
    removeProjectSessionFiles(sessionIds)
    await project.deleteOne()
    void dispatchQueuedJobs()
    return await Project.findOne({ isDefault: true })
      || await Project.findOne({}).sort({ updatedAt: -1, createdAt: -1 })
  }
  finally {
    endProjectDeletion(id)
  }
}
export async function migrateDefaultProjects() {
  const existing = await Project.findOne({ isDefault: true })
  if (existing && !existing.deletingAt)
    scheduleBackfill(String(existing._id))
}
export async function projectStats(): Promise<ProjectStats> {
  const match = {
    deleted: { $ne: true },
    hiddenFromUser: { $ne: true },
  }
  const defaultProject = await Project.findOne({ isDefault: true }).select('_id')
  const defaultId = defaultProject ? String(defaultProject._id) : ''
  const uploadMatch = { 'images.kind': 'upload', 'images.status': 'success', 'images.url': { $type: 'string', $ne: '' } }
  const [counts, covers, actives, assets] = await Promise.all([
    GenerationJob.aggregate<{
      _id: string
      count: number
    }>([
      { $match: match },
      { $group: { _id: '$projectId', count: { $sum: 1 } } },
    ]),
    GenerationJob.aggregate<{
      _id: string
      resultUrls: string[]
    }>([
      { $match: { ...match, 'state': 'success', 'resultUrls.0': { $exists: true } } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$projectId', resultUrls: { $first: '$resultUrls' } } },
    ]),
    GenerationJob.aggregate<{
      _id: string
      count: number
    }>([
      { $match: { ...match, state: { $in: [...GENERATION_ACTIVE_STATES] } } },
      { $group: { _id: '$projectId', count: { $sum: 1 } } },
    ]),
    GenerationJob.aggregate<{
      _id: string
      count: number
    }>([
      { $match: { ...match, state: 'success' } },
      { $unwind: '$resultUrls' },
      { $match: { resultUrls: { $type: 'string', $ne: '' } } },
      { $project: { projectId: 1, url: '$resultUrls' } },
      { $unionWith: {
        coll: AgentChat.collection.name,
        pipeline: [
          { $match: {} },
          { $unwind: '$images' },
          { $match: uploadMatch },
          { $project: { projectId: 1, url: '$images.url' } },
        ],
      } },
      // Older uploads may have left the bounded chat snapshot.
      { $unionWith: {
        coll: AgentHistory.collection.name,
        pipeline: [
          { $match: {} },
          { $unwind: '$images' },
          { $match: uploadMatch },
          { $lookup: {
            from: AgentChat.collection.name,
            localField: 'sessionId',
            foreignField: 'sessionId',
            pipeline: [{ $match: {} }, { $project: { projectId: 1 } }],
            as: 'chat',
          } },
          { $unwind: '$chat' },
          { $project: { projectId: '$chat.projectId', url: '$images.url' } },
        ],
      } },
      { $set: { projectId: { $cond: [{ $in: [{ $ifNull: ['$projectId', ''] }, ['', 'null', 'undefined']] }, defaultId, '$projectId'] } } },
      // A file referenced in multiple chats or also present as a result counts once.
      { $group: { _id: { projectId: '$projectId', url: '$url' } } },
      { $group: { _id: '$_id.projectId', count: { $sum: 1 } } },
    ]),
  ])
  const countById = new Map(counts.map(row => [String(row._id || ''), row.count]))
  const coverById = new Map(covers.map(row => [String(row._id || ''), pickProjectCoverUrl(row.resultUrls)]))
  const activeById = new Map(actives.map(row => [String(row._id || ''), row.count]))
  const assetCountById = new Map(assets.map(row => [String(row._id || ''), row.count]))
  if (defaultProject) {
    const defaultId = String(defaultProject._id)
    foldUnassignedCounts(countById, defaultId)
    foldUnassignedCounts(activeById, defaultId)
    if (!coverById.get(defaultId)) {
      const fallback = coverById.get('') || coverById.get('null') || ''
      if (fallback)
        coverById.set(defaultId, fallback)
    }
  }
  return { countById, assetCountById, coverById, activeById }
}
