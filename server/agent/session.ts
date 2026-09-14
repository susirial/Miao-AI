import type { StoredSessionSnapshot } from './sessionStore'
import type { AgentConfirmPolicy, AgentImage, AgentQuality, ChatMessage, ChoicePayload, ConfirmationPayload } from './types'
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isInternalAgentChatText, publicAgentChatText } from '~~/shared/utils/agentChatVisibility'
import { allocateAssetName } from '~~/shared/utils/assetName'
import { archiveAgentHistory } from '../utils/agentHistory'
import { localDataPath } from '../utils/dataPaths.mjs'
import { isProjectDeletionInFlight } from '../utils/projectDeletion'
import { stripLegacyAccounting, stripLegacyScope } from '../utils/sqlite'
import { canonicalMediaUrl, normalizeStoredMediaReferences } from '../utils/storedMediaUrl.mjs'
import { MAX_TRANSCRIPT_MESSAGES, SESSION_MEMORY_IDLE_MS } from './policy'
import { sessionMediaPrompt, SYSTEM_PROMPT } from './prompt'
import { parseAgentQuality } from './quality'
import { fetchStoredSession, fetchStoredSessionList, putStoredSession } from './sessionStore'
import { isSessionRemoved, markSessionsRemoved } from './sessionTombstones'
import { removeOrphanToolMessages } from './toolTranscript'

export interface PendingToolItem {
  toolCallId: string
  tool: string
  argsJson: string
}
export interface AgentSession {
  id: string
  messages: ChatMessage[]
  images: AgentImage[]
  pendingConfirmation: null | {
    payload: ConfirmationPayload
    items: PendingToolItem[]
  }
  pendingChoice: null | {
    payload: ChoicePayload
    items: PendingToolItem[]
  }
  busy: boolean
  /** Soft-stop: halt the agent loop, but do not cancel in-flight generations. */
  stopRequested?: boolean
  /** Prevent autonomous continuation after a submission with an unknown outcome. */
  retryBlocked?: boolean
  llmAbort?: AbortController
  title?: string
  projectId?: string
  bffUrl?: string
  quality: AgentQuality
  confirmPolicy: AgentConfirmPolicy
  updatedAt: number
}
const sessions = new Map<string, AgentSession>()
const hydratedRepairs = new Set<string>()
function sessionDir() {
  return localDataPath('agent-sessions')
}
function isSessionId(id: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
}
const sessionFile = (id: string) => join(sessionDir(), `${id}.json`)
function persistDisk(session: AgentSession) {
  if (!canPersistSession(session))
    return
  mkdirSync(sessionDir(), { recursive: true })
  const payload: AgentSession = {
    ...session,
    busy: false,
    stopRequested: Boolean(session.stopRequested),
    bffUrl: undefined,
  }
  delete payload.llmAbort
  writeFileSync(sessionFile(session.id), `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}
function persistDatabase(session: AgentSession) {
  if (!canPersistSession(session))
    return
  void putStoredSession({
    id: session.id,
    projectId: session.projectId,
    title: session.title,
    quality: session.quality,
    confirmPolicy: session.confirmPolicy,
    messages: session.messages,
    images: session.images,
    pendingConfirmation: session.pendingConfirmation,
    pendingChoice: session.pendingChoice,
    updatedAt: session.updatedAt,
    bffUrl: session.bffUrl,
  })
}
function canPersistSession(session: AgentSession) {
  return !isSessionRemoved(session.id)
    && !isProjectDeletionInFlight(session.projectId)
    && sessions.get(session.id) === session
}
function persistHydratedRepair(session: AgentSession) {
  if (!hydratedRepairs.delete(session.id))
    return
  persistDisk(session)
  persistDatabase(session)
}
function persist(session: AgentSession) {
  if (!canPersistSession(session))
    return
  const repaired = removeOrphanToolMessages(session.messages)
  if (repaired.removed)
    session.messages = repaired.messages
  dropStalePending(session)
  archiveTranscript(session)
  persistDisk(session)
  persistDatabase(session)
}
let persistTimer: ReturnType<typeof setTimeout> | undefined
const persistIds = new Set<string>()
function schedulePersist(session: AgentSession) {
  persistIds.add(session.id)
  if (persistTimer)
    clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = undefined
    for (const id of persistIds) {
      const current = sessions.get(id)
      if (current)
        persist(current)
    }
    persistIds.clear()
  }, 250)
}
function archiveTranscript(session: AgentSession) {
  const messages = visibleTranscript(session.messages, session.images, false)
  // Capture public values before the bounded model context is trimmed.
  void archiveAgentHistory(session.id, messages, session.images.map(image => ({ ...image, kind: image.kind || 'still' })))
    .catch(error => console.error('[agent history archive]', session.id, error))
}
function trimTranscript(messages: ChatMessage[]) {
  const system = messages[0]?.role === 'system' ? [messages[0]] : []
  const rest = system.length ? messages.slice(1) : messages.slice()
  while (rest.length > MAX_TRANSCRIPT_MESSAGES) {
    rest.shift()
    while (rest.length && rest[0]?.role !== 'user')
      rest.shift()
  }
  return [...system, ...rest]
}
export function confirmationAlreadyStarted(session: AgentSession, items?: PendingToolItem[] | null) {
  const pendingItems = items || session.pendingConfirmation?.items || []
  return pendingItems.some((item) => {
    if (session.images.some(entry => entry.id === item.toolCallId))
      return true
    return session.messages.some(message => message.role === 'tool' && message.tool_call_id === item.toolCallId)
  })
}
export function choiceAlreadyAnswered(session: AgentSession, items?: PendingToolItem[] | null) {
  const pendingItems = items || session.pendingChoice?.items || []
  if (!pendingItems.length)
    return false
  return pendingItems.every(item => session.messages.some(message => message.role === 'tool' && message.tool_call_id === item.toolCallId))
}
function dropStalePending(session: AgentSession) {
  let changed = false
  if (session.pendingConfirmation && confirmationAlreadyStarted(session)) {
    session.pendingConfirmation = null
    changed = true
  }
  if (session.pendingChoice && choiceAlreadyAnswered(session)) {
    session.pendingChoice = null
    changed = true
  }
  return changed
}
function restoreHistoryIds(session: AgentSession) {
  // Older snapshots predate historyId. Re-reading an unchanged snapshot must
  // produce the same identities, including distinct repeated user messages.
  session.messages.forEach((message, index) => {
    if (message.historyId || (message.role !== 'user' && message.role !== 'assistant'))
      return
    const key = JSON.stringify([session.id, session.updatedAt, index, message.role, message.content, message.tool_calls])
    message.historyId = `history:legacy:${createHash('sha256').update(key).digest('hex').slice(0, 48)}`
  })
}
function hydrateLoaded(loaded: AgentSession): AgentSession {
  restoreHistoryIds(loaded)
  const repaired = removeOrphanToolMessages(loaded.messages)
  if (repaired.removed)
    loaded.messages = repaired.messages
  loaded.busy = false
  loaded.llmAbort = undefined
  loaded.stopRequested = Boolean(loaded.stopRequested)
  loaded.retryBlocked = Boolean(loaded.retryBlocked)
  loaded.images = Array.isArray(loaded.images) ? loaded.images : []
  loaded.pendingConfirmation = loaded.pendingConfirmation || null
  loaded.pendingChoice = loaded.pendingChoice || null
  loaded.quality = parseAgentQuality(loaded.quality)
  loaded.confirmPolicy = loaded.confirmPolicy === 'auto' || loaded.confirmPolicy === 'when_needed'
    ? loaded.confirmPolicy
    : 'always'
  loaded.updatedAt = Number(loaded.updatedAt) || Date.now()
  archiveTranscript(loaded)
  loaded.messages = trimTranscript(loaded.messages)
  if (loaded.messages[0]?.role === 'system')
    loaded.messages[0] = { role: 'system', content: sessionMediaPrompt(loaded.images, loaded.confirmPolicy) }
  else
    loaded.messages.unshift({ role: 'system', content: sessionMediaPrompt(loaded.images, loaded.confirmPolicy) })
  if (dropStalePending(loaded) || repaired.removed)
    hydratedRepairs.add(loaded.id)
  return loaded
}
function loadFromDisk(id: string): AgentSession | undefined {
  if (!isSessionId(id))
    return undefined
  try {
    const raw = JSON.parse(readFileSync(sessionFile(id), 'utf8'))
    const before = JSON.stringify(raw)
    const loaded = normalizeStoredMediaReferences(stripLegacyAccounting(stripLegacyScope(raw))) as AgentSession
    if (JSON.stringify(loaded) !== before)
      writeFileSync(sessionFile(id), JSON.stringify(loaded, null, 2), 'utf8')
    if (!loaded?.id || !Array.isArray(loaded.messages))
      return undefined
    const hydrated = hydrateLoaded(loaded)
    if (JSON.stringify(hydrated) !== before)
      writeFileSync(sessionFile(id), `${JSON.stringify(hydrated, null, 2)}\n`, 'utf8')
    return hydrated
  }
  catch {
    return undefined
  }
}
export function adoptStoredSnapshot(snapshot: StoredSessionSnapshot, bffUrl?: string): AgentSession {
  const live = sessions.get(snapshot.id)
  if (live) {
    if (!live.busy) {
      const byRemote = new Map(snapshot.images.map(item => [item.id, item]))
      live.images = live.images.map((item) => {
        const remote = byRemote.get(item.id)
        if (remote && (remote.status === 'success' || remote.status === 'fail') && item.status === 'generating')
          return remote
        return item
      })
      for (const remote of snapshot.images) {
        if (!live.images.some(item => item.id === remote.id))
          live.images.unshift(remote)
      }
      if (bffUrl)
        live.bffUrl = bffUrl
    }
    return live
  }
  const session = sessionFromStorage(snapshot)
  if (bffUrl)
    session.bffUrl = bffUrl
  sessions.set(session.id, session)
  persistDisk(session)
  persistHydratedRepair(session)
  return session
}
function sessionFromStorage(snapshot: StoredSessionSnapshot): AgentSession {
  return hydrateLoaded({
    id: snapshot.id,
    messages: snapshot.messages,
    images: snapshot.images,
    pendingConfirmation: snapshot.pendingConfirmation,
    pendingChoice: snapshot.pendingChoice,
    busy: false,
    title: snapshot.title || '',
    projectId: snapshot.projectId || '',
    quality: snapshot.quality,
    confirmPolicy: snapshot.confirmPolicy,
    updatedAt: snapshot.updatedAt,
  })
}
function pruneMemory() {
  const cutoff = Date.now() - SESSION_MEMORY_IDLE_MS
  for (const [id, session] of sessions) {
    if (session.busy)
      continue
    if (session.images.some(item => item.status === 'generating'))
      continue
    if (session.updatedAt < cutoff)
      sessions.delete(id)
  }
}
export function getSession(id: string) {
  pruneMemory()
  if (isSessionRemoved(id))
    return undefined
  const live = sessions.get(id)
  if (live) {
    const repaired = removeOrphanToolMessages(live.messages)
    if (repaired.removed) {
      live.messages = repaired.messages
      touch(live)
    }
    return live
  }
  const loaded = loadFromDisk(id)
  if (!loaded)
    return undefined
  sessions.set(loaded.id, loaded)
  persistHydratedRepair(loaded)
  return loaded
}
function isThinSession(session: AgentSession) {
  return !session.messages.some(message => message.role === 'user'
    || message.role === 'tool'
    || Boolean(message.tool_calls?.length))
}
export async function loadSession(id: string, bffUrl?: string) {
  if (isSessionRemoved(id))
    return undefined
  const local = getSession(id)
  if (local && !isThinSession(local)) {
    if (bffUrl)
      local.bffUrl = bffUrl
    return local
  }
  const remote = await fetchStoredSession(id, bffUrl || local?.bffUrl)
  if (isSessionRemoved(id))
    return undefined
  if (local && remote && Number(local.updatedAt) >= Number(remote.updatedAt)) {
    if (bffUrl)
      local.bffUrl = bffUrl
    return local
  }
  if (remote) {
    const session = sessionFromStorage(remote)
    session.busy = Boolean(local?.busy)
    session.bffUrl = bffUrl || local?.bffUrl
    sessions.set(session.id, session)
    persistDisk(session)
    persistHydratedRepair(session)
    return session
  }
  if (local) {
    if (bffUrl)
      local.bffUrl = bffUrl
    return local
  }
  return undefined
}
export async function listSessions(projectId = '', bffUrl?: string) {
  pruneMemory()
  const scoped = String(projectId || '').trim()
  const found = new Map<string, AgentSession>()
  function take(session: AgentSession) {
    if (isSessionRemoved(session.id))
      return
    if (scoped && String(session.projectId || '') !== scoped)
      return
    found.set(session.id, session)
  }
  for (const session of sessions.values())
    take(session)
  try {
    mkdirSync(sessionDir(), { recursive: true })
    for (const file of readdirSync(sessionDir())) {
      if (!file.endsWith('.json'))
        continue
      const id = file.slice(0, -5)
      if (found.has(id) || sessions.has(id))
        continue
      const loaded = loadFromDisk(id)
      if (!loaded)
        continue
      sessions.set(loaded.id, loaded)
      persistHydratedRepair(loaded)
      take(loaded)
    }
  }
  catch {
    // Workspace dir may be empty.
  }
  const remote = await fetchStoredSessionList(scoped, bffUrl)
  for (const snapshot of remote) {
    if (isSessionRemoved(snapshot.id))
      continue
    const live = found.get(snapshot.id) || sessions.get(snapshot.id)
    if (live && (live.busy || !isThinSession(live)))
      continue
    const session = sessionFromStorage(snapshot)
    if (bffUrl)
      session.bffUrl = bffUrl
    sessions.set(session.id, session)
    persistDisk(session)
    persistHydratedRepair(session)
    take(session)
  }
  return [...found.values()].sort((a, b) => b.updatedAt - a.updatedAt)
}
export function createSession(options?: {
  id?: string
  projectId?: string
  bffUrl?: string
}) {
  pruneMemory()
  if (isProjectDeletionInFlight(options?.projectId))
    throw Object.assign(new Error('This project is being deleted'), { statusCode: 409 })
  const requested = String(options?.id || '').trim()
  const id = requested && isSessionId(requested) && !getSession(requested)
    ? requested
    : crypto.randomUUID()
  const session: AgentSession = {
    id,
    messages: [{ role: 'system', content: SYSTEM_PROMPT }],
    images: [],
    pendingConfirmation: null,
    pendingChoice: null,
    busy: false,
    stopRequested: false,
    retryBlocked: false,
    title: '',
    projectId: options?.projectId || '',
    bffUrl: options?.bffUrl || '',
    quality: 'hobby',
    confirmPolicy: 'always',
    updatedAt: Date.now(),
  }
  sessions.set(session.id, session)
  persist(session)
  return session
}
export async function resolveChatSession(sessionId: string | undefined, projectId?: string, bffUrl?: string) {
  const id = String(sessionId || '').trim()
  if (id) {
    const stored = await loadSession(id, bffUrl)
    if (stored) {
      if (projectId)
        stored.projectId = projectId
      if (bffUrl)
        stored.bffUrl = bffUrl
      return stored
    }
    if (!getSession(id) && isSessionId(id))
      return createSession({ id, projectId, bffUrl })
    throw new Error('Session not found')
  }
  return createSession({ projectId, bffUrl })
}
export async function requireLoadedSession(id: string, bffUrl?: string) {
  const session = await loadSession(id, bffUrl)
  if (!session)
    throw new Error('Session not found')
  return session
}
export function requireSession(id: string) {
  const session = getSession(id)
  if (!session)
    throw new Error('Session not found')
  return session
}
export function persistNow(session: AgentSession) {
  if (isSessionRemoved(session.id) || isProjectDeletionInFlight(session.projectId))
    return
  sessions.set(session.id, session)
  persist(session)
}
export async function removeSessionImages(
  sessionId: string,
  imageIds: string[],
  options?: { allowGenerating?: boolean, includeDerived?: boolean },
) {
  const session = await loadSession(sessionId)
  const roots = [...new Set(imageIds.map(id => String(id || '').trim()).filter(Boolean))]
  if (!session || !roots.length)
    return { removedIds: [] as string[], blocked: false }
  const matches = (image: AgentImage) => roots.some(root =>
    image.id === root || (options?.includeDerived && image.id.startsWith(`${root}_`)),
  )
  const matched = session.images.filter(matches)
  if (!options?.allowGenerating && matched.some(image => image.status === 'generating'))
    return { removedIds: [] as string[], blocked: true }
  const removedIds = matched.map(image => image.id)
  if (!removedIds.length)
    return { removedIds, blocked: false }
  session.images = session.images.filter(image => !matches(image))
  refreshSessionPrompt(session)
  session.updatedAt = Math.max(Date.now(), session.updatedAt + 1)
  sessions.set(session.id, session)
  persistDisk(session)
  await putStoredSession({
    id: session.id,
    projectId: session.projectId,
    title: session.title,
    quality: session.quality,
    confirmPolicy: session.confirmPolicy,
    messages: session.messages,
    images: session.images,
    replaceImages: true,
    pendingConfirmation: session.pendingConfirmation,
    pendingChoice: session.pendingChoice,
    updatedAt: session.updatedAt,
    bffUrl: session.bffUrl,
  })
  return { removedIds, blocked: false }
}
function sessionBelongsToProject(session: { projectId?: string }, projectId: string) {
  return String(session.projectId || '') === projectId
}
function readDiskSession(id: string) {
  if (!isSessionId(id))
    throw new Error(`Invalid agent session file: ${id}`)
  const raw = JSON.parse(readFileSync(sessionFile(id), 'utf8')) as AgentSession
  if (!raw?.id)
    throw new Error(`Invalid agent session payload: ${id}`)
  return raw
}
export function hasBusyProjectSessions(projectId: string) {
  const id = String(projectId || '').trim()
  if (!id)
    return false
  for (const session of sessions.values()) {
    if (sessionBelongsToProject(session, id) && session.busy)
      return true
  }
  return false
}
export function listProjectSessionRecords(projectId: string) {
  const id = String(projectId || '').trim()
  const found = new Map<string, unknown>()
  if (!id)
    return []
  for (const session of sessions.values()) {
    if (sessionBelongsToProject(session, id))
      found.set(session.id, session)
  }
  mkdirSync(sessionDir(), { recursive: true })
  for (const file of readdirSync(sessionDir())) {
    if (!file.endsWith('.json'))
      continue
    const sessionId = file.slice(0, -5)
    if (found.has(sessionId))
      continue
    const loaded = readDiskSession(sessionId)
    if (sessionBelongsToProject(loaded, id))
      found.set(sessionId, loaded)
  }
  return [...found.entries()].map(([sessionId, payload]) => ({ sessionId, payload }))
}
export function listSessionRecordsExcept(sessionIds: Iterable<string>) {
  const excluded = new Set([...sessionIds].map(id => String(id || '').trim()).filter(Boolean))
  const found = new Map<string, unknown>()
  for (const session of sessions.values()) {
    if (!excluded.has(session.id))
      found.set(session.id, session)
  }
  mkdirSync(sessionDir(), { recursive: true })
  for (const file of readdirSync(sessionDir())) {
    if (!file.endsWith('.json'))
      continue
    const sessionId = file.slice(0, -5)
    if (excluded.has(sessionId) || found.has(sessionId))
      continue
    found.set(sessionId, readDiskSession(sessionId))
  }
  return [...found.values()]
}
export function markProjectSessionsRemoved(sessionIds: string[]) {
  const ids = [...new Set(sessionIds.map(id => String(id || '').trim()).filter(Boolean))]
  markSessionsRemoved(ids)
  for (const id of ids)
    persistIds.delete(id)
  for (const id of ids) {
    const live = sessions.get(id)
    live?.llmAbort?.abort()
    sessions.delete(id)
  }
}
export function removeProjectSessionFiles(sessionIds: string[]) {
  const ids = [...new Set(sessionIds.map(id => String(id || '').trim()).filter(Boolean))]
  for (const id of ids) {
    try {
      unlinkSync(sessionFile(id))
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw error
    }
  }
}
export function bootSessions() {
  pruneMemory()
  try {
    mkdirSync(sessionDir(), { recursive: true })
    for (const file of readdirSync(sessionDir())) {
      if (!file.endsWith('.json'))
        continue
      const id = file.slice(0, -5)
      if (sessions.has(id) || isSessionRemoved(id))
        continue
      const loaded = loadFromDisk(id)
      if (loaded) {
        sessions.set(loaded.id, loaded)
        persistHydratedRepair(loaded)
      }
    }
  }
  catch {
    // Workspace dir may be empty.
  }
  return [...sessions.values()]
}
export function touch(session: AgentSession) {
  if (isSessionRemoved(session.id) || isProjectDeletionInFlight(session.projectId))
    return
  session.updatedAt = Date.now()
  if (session.messages.length > MAX_TRANSCRIPT_MESSAGES)
    archiveTranscript(session)
  session.messages = trimTranscript(session.messages)
  sessions.set(session.id, session)
  schedulePersist(session)
}
export function refreshSessionPrompt(session: AgentSession) {
  const content = sessionMediaPrompt(session.images, session.confirmPolicy || 'always')
  if (session.messages[0]?.role === 'system')
    session.messages[0] = { role: 'system', content }
  else
    session.messages.unshift({ role: 'system', content })
}
export function upsertImage(session: AgentSession, image: AgentImage) {
  image.name = allocateAssetName(image, session.images)
  const index = session.images.findIndex(item => item.id === image.id)
  if (index >= 0)
    session.images[index] = image
  else
    session.images.unshift(image)
  touch(session)
}
function flattenContent(content: AgentSession['messages'][number]['content']) {
  if (typeof content === 'string')
    return content.trim()
  if (!Array.isArray(content))
    return ''
  return content
    .map(part => part.type === 'text' ? part.text : '')
    .filter(Boolean)
    .join('\n')
    .trim()
}
export function visibleTranscript(messages: AgentSession['messages'], images: AgentImage[] = [], recentOnly = true) {
  const items: Array<{
    id: string
    role: 'user' | 'assistant'
    content: string
    imageIds?: string[]
  }> = []
  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'assistant')
      continue
    if (message.internal)
      continue
    const raw = flattenContent(message.content)
    const attachmentUrls = message.role === 'user' && Array.isArray(message.content)
      ? message.content.filter(part => part.type === 'image_url').map(part => part.image_url.url)
      : []
        // Generation assets use the tool-call id. URL mentions may refer to older
        // work and must never be used to infer ownership of a new output.
    const outputIds = message.role === 'assistant'
      ? (message.tool_calls || []).flatMap(call => images.filter(image => image.kind !== 'upload' && (image.id === call.id || (image.id.startsWith(`${call.id}_`) && /^\d+$/.test(image.id.slice(call.id.length + 1))))).map(image => image.id))
      : []
    const imageIds = [...new Set([...outputIds, ...attachmentUrls.flatMap((url) => {
      const image = images.find(item => item.url === url)
      return image ? [image.id] : []
    })])]
    if (isInternalAgentChatText(raw) && !imageIds.length)
      continue
    const content = message.role === 'user'
      ? publicAgentChatText(raw)
      : message.tool_calls?.length && raw && !/^<think(?:ing)?>/i.test(raw.trim())
        ? `<think>${raw}</think>`
        : raw
    if (!content && !imageIds.length)
      continue
    message.historyId ||= `history:${crypto.randomUUID()}`
    items.push({ id: message.historyId, role: message.role, content, ...(imageIds.length ? { imageIds } : {}) })
  }
  return recentOnly ? items.slice(-80) : items
}
function httpUrlsFromArgs(argsJson: string) {
  try {
    const parsed = JSON.parse(argsJson) as Record<string, unknown>
    const list: unknown[] = [
      ...(Array.isArray(parsed.input_urls) ? parsed.input_urls : []),
      parsed.first_frame_url,
      parsed.last_frame_url,
      parsed.first_frame,
      parsed.last_frame,
      parsed.image_url,
      ...(Array.isArray(parsed.reference_image_urls) ? parsed.reference_image_urls : []),
      ...(Array.isArray(parsed.reference_images) ? parsed.reference_images : []),
      ...(Array.isArray(parsed.reference_video_urls) ? parsed.reference_video_urls : []),
      ...(Array.isArray(parsed.reference_videos) ? parsed.reference_videos : []),
    ]
    const seen = new Set<string>()
    const out: string[] = []
    for (const item of list) {
      if (typeof item !== 'string')
        continue
      const url = canonicalMediaUrl(item)
      if (!url || seen.has(url))
        continue
      seen.add(url)
      out.push(url)
    }
    return out
  }
  catch {
    return []
  }
}
function publicPending(pending: AgentSession['pendingConfirmation']): ConfirmationPayload | null {
  if (!pending)
    return null
  const inputUrls = pending.payload.inputUrls?.length
    ? pending.payload.inputUrls
    : httpUrlsFromArgs(pending.items[0]?.argsJson || '')
  const payload: ConfirmationPayload = {
    ...pending.payload,
    ...(inputUrls.length ? { inputUrls } : {}),
  }
  if (payload.kind === 'image') {
    payload.modelName = payload.modelName || 'Image model'
    payload.task = payload.task || (inputUrls.length > 1 ? 'Reference to Image' : inputUrls.length ? 'Image to Image' : 'Text to Image')
  }
  return payload
}
export function publicSession(session: AgentSession) {
  if (dropStalePending(session))
    persist(session)
  return {
    sessionId: session.id,
    title: session.title || '',
    images: session.images,
    messages: visibleTranscript(session.messages, session.images),
    pendingConfirmation: publicPending(session.pendingConfirmation),
    pendingChoice: session.pendingChoice?.payload || null,
    busy: Boolean(session.busy),
    updatedAt: session.updatedAt,
  }
}
