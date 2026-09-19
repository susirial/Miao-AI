import type { IAgentChat, IAgentChatImage } from '../models/agentChat'
import { GENERATION_ACTIVE_STATES } from '../../shared/types/generation'
import { markProjectSessionsRemoved, removeProjectSessionFiles } from '../agent/session'
import { isSessionRemoved, markSessionsRemoved } from '../agent/sessionTombstones'
import { AgentChat } from '../models/agentChat'
import { AgentHistory } from '../models/agentHistory'
import { GenerationJob } from '../models/generationJob'
import { beginSessionDeletion, endSessionDeletion, isChatDeleted } from '../agent/sessionTombstones'
import { isAgentSessionId } from './agentChats'
import { waitForAgentHistoryArchives } from './agentHistory'
import { beginProjectWrite, endProjectWrite, isProjectDeletionInFlight } from './projectDeletion'
import { connectDatabase } from './sqlite'
import { canonicalMediaUrl, collectStoredMediaKeys, storedMediaKey } from './storedMediaUrl.mjs'

const BUSY_JOB_STATES = ['queued', ...GENERATION_ACTIVE_STATES]
const MAX_RETAINED_IMAGES = 2000
const MAX_KNOWN_SESSION_QUERY = 80

export interface RetainedCanvasImage {
  id: string
  url: string
  name?: string
  kind: string
  status: IAgentChatImage['status']
  prompt: string
  sourceUrl?: string
  sessionId?: string
}

function chatError(statusCode: number, statusMessage: string): never {
  throw Object.assign(new Error(statusMessage), { statusCode, statusMessage })
}

function clip(value: unknown, max: number) {
  return String(value || '').trim().slice(0, max)
}

function toRetainedImage(raw: unknown, sessionId = ''): RetainedCanvasImage | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return null
  const row = raw as Record<string, unknown>
  if ('content' in row && row.content && !row.url)
    return null
  const id = clip(row.id, 120)
  const url = canonicalMediaUrl(row.url).slice(0, 2000)
  if (!id || !url)
    return null
  if (typeof row.url === 'string' && (/\\/.test(row.url) || /^[A-Za-z]:[\\/]/.test(row.url) || row.url.startsWith('/Users/')))
    return null
  const status = row.status === 'generating' || row.status === 'fail' || row.status === 'success'
    ? row.status
    : 'success'
  return {
    id,
    url,
    name: clip(row.name, 100) || undefined,
    kind: clip(row.kind || 'still', 32) || 'still',
    status,
    prompt: clip(row.prompt, 4000),
    sourceUrl: canonicalMediaUrl(row.sourceUrl).slice(0, 2000) || undefined,
    ...(sessionId ? { sessionId } : {}),
  }
}

export function sanitizeRetainedImages(raw: unknown, sessionId = ''): RetainedCanvasImage[] {
  if (!Array.isArray(raw))
    return []
  const items: RetainedCanvasImage[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    const image = toRetainedImage(entry, sessionId)
    if (!image || seen.has(image.id))
      continue
    seen.add(image.id)
    items.push(image)
    if (items.length >= MAX_RETAINED_IMAGES)
      break
  }
  return items
}

function mergeRetainedImages(groups: Array<unknown[] | undefined>, sessionId = '') {
  const items: RetainedCanvasImage[] = []
  const seen = new Set<string>()
  for (const group of groups) {
    for (const image of sanitizeRetainedImages(group, sessionId)) {
      if (seen.has(image.id))
        continue
      seen.add(image.id)
      items.push(image)
    }
  }
  return items
}

function retainedMediaKeysFrom(values: unknown[]) {
  const keys = new Set<string>()
  collectStoredMediaKeys(values, keys)
  for (const value of values) {
    if (typeof value === 'string') {
      const key = storedMediaKey(`/media/${value}`) || storedMediaKey(value)
      if (key)
        keys.add(key)
    }
  }
  return [...keys]
}

async function loadLiveOrDiskSession(sessionId: string) {
  const { getSession } = await import('../agent/session')
  return getSession(sessionId) as {
    projectId?: string
    busy?: boolean
    images?: Array<{ id?: string, status?: string, url?: string }>
    messages?: unknown[]
  } | undefined
}

async function sessionOwnerProject(sessionId: string, chat?: IAgentChat | null) {
  if (chat?.projectId)
    return String(chat.projectId)
  const session = await loadLiveOrDiskSession(sessionId)
  return String(session?.projectId || '')
}

async function collectSessionMedia(sessionId: string, chat?: IAgentChat | null, incoming?: unknown) {
  const session = await loadLiveOrDiskSession(sessionId)
  const history = await AgentHistory.find({ sessionId })
  const runtimeImages = chat?.runtime && typeof chat.runtime === 'object'
    ? (chat.runtime as { images?: unknown[] }).images
    : []
  const retained = mergeRetainedImages([
    chat?.images,
    runtimeImages,
    history.flatMap(row => row.images || []),
    session && typeof session === 'object' && 'images' in session ? session.images as unknown[] : [],
    Array.isArray(incoming) ? incoming : [],
  ], sessionId)
  const retainedMediaKeys = retainedMediaKeysFrom([
    chat,
    chat?.runtime,
    history.map(row => row.toObject ? row.toObject() : row),
    session,
    retained.map(image => image.url),
    incoming,
  ])
  return { retained, retainedMediaKeys, session }
}

async function hasBusyWork(sessionId: string, session?: { busy?: boolean, images?: Array<{ status?: string }> } | null, chat?: IAgentChat | null) {
  if (session?.busy)
    return true
  const images = [
    ...(session?.images || []),
    ...(chat?.images || []),
    ...(((chat?.runtime && typeof chat.runtime === 'object' ? (chat.runtime as { images?: Array<{ status?: string }> }).images : []) || [])),
  ]
  if (images.some(image => image?.status === 'generating'))
    return true
  const imageIds = images.map(image => String(image && 'id' in image ? image.id : '').trim()).filter(Boolean)
  const taskIds = imageIds.map(id => `agent_${id}`.slice(0, 120))
  return Boolean(await GenerationJob.exists({
    deleted: { $ne: true },
    state: { $in: [...BUSY_JOB_STATES] },
    $or: [
      { 'originalRequest.sessionId': sessionId },
      ...(imageIds.length ? [{ 'originalRequest.imageId': { $in: imageIds } }, { taskId: { $in: taskIds } }] : []),
    ],
  }))
}

function publicRetained(images: RetainedCanvasImage[], sessionId: string): RetainedCanvasImage[] {
  return images.filter(image => image.url).map(image => ({
    id: image.id,
    url: image.url,
    name: image.name,
    kind: image.kind,
    status: image.status,
    prompt: image.prompt,
    sourceUrl: image.sourceUrl,
    sessionId,
  }))
}

async function persistTombstone(input: {
  sessionId: string
  projectId: string
  retained: RetainedCanvasImage[]
  retainedMediaKeys: string[]
  existing?: IAgentChat | null
}) {
  const now = new Date()
  const images = input.retained.map(({ sessionId: _sessionId, ...image }) => image)
  const update = {
    projectId: input.projectId,
    deletedAt: input.existing?.deletedAt || now,
    images,
    retainedMediaKeys: input.retainedMediaKeys,
    messages: [],
    preview: '',
    runtime: null,
    title: '',
    messageCount: 0,
    userTurnCount: 0,
    assistantTurnCount: 0,
    lastEventAt: now,
  }
  const saved = await AgentChat.findOneAndUpdate({ sessionId: input.sessionId }, {
    $set: update,
    $setOnInsert: { sessionId: input.sessionId },
  }, { upsert: true, returnDocument: 'after' })
  if (!saved)
    chatError(500, 'Could not save the conversation tombstone')
  markSessionsRemoved([input.sessionId])
  return saved
}

async function finishCleanup(sessionId: string, chat: IAgentChat) {
  markProjectSessionsRemoved([sessionId])
  await waitForAgentHistoryArchives([sessionId])
  await AgentHistory.deleteMany({ sessionId })
  removeProjectSessionFiles([sessionId])
  if (!chat.deletionCompletedAt) {
    const now = new Date()
    chat.deletionCompletedAt = now
    await AgentChat.updateOne({ sessionId }, { $set: { deletionCompletedAt: now } })
  }
  markSessionsRemoved([sessionId])
}

export async function loadPersistentSessionTombstones() {
  await connectDatabase()
  const docs = await AgentChat.find({
    deletedAt: { $exists: true, $ne: null },
  }).select('sessionId deletionCompletedAt')
  markSessionsRemoved(docs.map(doc => String(doc.sessionId || '')).filter(Boolean))
  return docs
}

export async function finishIncompleteChatDeletions() {
  const docs = await loadPersistentSessionTombstones()
  for (const doc of docs) {
    if (doc.deletionCompletedAt)
      continue
    const full = await AgentChat.findOne({ sessionId: doc.sessionId })
    if (!full || !isChatDeleted(full))
      continue
    try {
      await finishCleanup(String(full.sessionId), full)
    }
    catch (error) {
      console.error('[agent chat cleanup]', full.sessionId, error)
    }
  }
}

export async function deleteAgentConversation(input: {
  sessionId: string
  projectId?: string
  retainImages?: unknown
}) {
  const sessionId = String(input.sessionId || '').trim()
  const requestedProjectId = String(input.projectId || '').trim()
  if (!isAgentSessionId(sessionId))
    chatError(400, 'Invalid session')
  if (isProjectDeletionInFlight(requestedProjectId))
    chatError(409, 'This project is being deleted')

  await connectDatabase()
  const existing = await AgentChat.findOne({ sessionId })
  const ownerProjectId = await sessionOwnerProject(sessionId, existing)
  if (requestedProjectId && ownerProjectId && requestedProjectId !== ownerProjectId)
    chatError(409, 'Chat belongs to another project')
  if (isChatDeleted(existing) && existing?.deletionCompletedAt) {
    if (requestedProjectId && existing.projectId && existing.projectId !== requestedProjectId)
      chatError(409, 'Chat belongs to another project')
    return {
      ok: true as const,
      sessionId,
      retainedCanvasImages: publicRetained(sanitizeRetainedImages(existing.images, sessionId), sessionId),
    }
  }

  if (Array.isArray(input.retainImages)) {
    const submitted = input.retainImages.length
    const valid = sanitizeRetainedImages(input.retainImages, sessionId)
    if (valid.length !== submitted)
      chatError(400, 'Retained media is invalid')
  }

  const session = await loadLiveOrDiskSession(sessionId)
  if (!existing && !session && !isChatDeleted(existing))
    chatError(404, 'Agent chat not found')

  beginSessionDeletion(sessionId)
  const projectId = ownerProjectId || requestedProjectId
  const writeProjectId = projectId ? await beginProjectWrite(projectId, { allowMissing: !projectId }) : ''
  try {
    if (isChatDeleted(existing) && !existing?.deletionCompletedAt && existing) {
      await finishCleanup(sessionId, existing)
      return {
        ok: true as const,
        sessionId,
        retainedCanvasImages: publicRetained(sanitizeRetainedImages(existing.images, sessionId), sessionId),
      }
    }

    if (await hasBusyWork(sessionId, session, existing))
      chatError(409, 'Stop generations and agent work in this conversation before deleting it')

    await waitForAgentHistoryArchives([sessionId])
    const collected = await collectSessionMedia(sessionId, existing, input.retainImages)
    const saved = await persistTombstone({
      sessionId,
      projectId,
      retained: collected.retained,
      retainedMediaKeys: collected.retainedMediaKeys,
      existing,
    })
    await finishCleanup(sessionId, saved)
    return {
      ok: true as const,
      sessionId,
      retainedCanvasImages: publicRetained(collected.retained, sessionId),
    }
  }
  finally {
    endProjectWrite(writeProjectId)
    endSessionDeletion(sessionId)
  }
}

export async function listRetainedCanvasImages(projectId: string) {
  const scoped = String(projectId || '').trim()
  if (!scoped)
    return []
  await connectDatabase()
  const docs = await AgentChat.find({
    projectId: scoped,
    deletedAt: { $exists: true, $ne: null },
  })
  const images: RetainedCanvasImage[] = []
  for (const doc of docs)
    images.push(...publicRetained(sanitizeRetainedImages(doc.images, doc.sessionId), doc.sessionId))
  return images
}

export async function listRemovedSessionIds(knownSessionIds: Iterable<string>) {
  const ids = [...new Set([...knownSessionIds].map(id => String(id || '').trim()).filter(isAgentSessionId))]
  if (!ids.length)
    return []
  await connectDatabase()
  const found = new Set<string>()
  for (let index = 0; index < ids.length; index += MAX_KNOWN_SESSION_QUERY) {
    const batch = ids.slice(index, index + MAX_KNOWN_SESSION_QUERY)
    const docs = await AgentChat.find({
      sessionId: { $in: batch },
      deletedAt: { $exists: true, $ne: null },
    }).select('sessionId')
    for (const doc of docs)
      found.add(String(doc.sessionId))
    for (const id of batch) {
      if (isSessionRemoved(id))
        found.add(id)
    }
  }
  return [...found]
}

export async function removeRetainedCanvasImages(projectId: string, imageIds: Iterable<string>) {
  const scoped = String(projectId || '').trim()
  const ids = [...new Set([...imageIds].map(id => String(id || '').trim()).filter(Boolean))]
  if (!scoped)
    chatError(404, 'Project not found')
  if (!ids.length)
    return { ok: true as const, removedIds: [] as string[] }
  await connectDatabase()
  const writeProjectId = await beginProjectWrite(scoped)
  try {
    const docs = await AgentChat.find({
      projectId: scoped,
      deletedAt: { $exists: true, $ne: null },
    })
    const removed = new Set<string>()
    for (const doc of docs) {
      const next = (doc.images || []).filter((image) => {
        if (!ids.includes(image.id))
          return true
        removed.add(image.id)
        return false
      })
      if (next.length === (doc.images || []).length)
        continue
      doc.images = next
      await AgentChat.updateOne({ sessionId: doc.sessionId }, { $set: { images: next } })
    }
    return { ok: true as const, removedIds: [...removed] }
  }
  finally {
    endProjectWrite(writeProjectId)
  }
}

export function mergeRetainedMediaKeys(chats: Array<{ retainedMediaKeys?: string[] }>, into: Set<string>) {
  for (const chat of chats) {
    for (const key of chat.retainedMediaKeys || []) {
      const value = String(key || '').trim()
      if (value)
        into.add(value)
    }
  }
  return into
}
