import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { register } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { after, test } from 'node:test'

register('./nuxt-alias-hook.mjs', import.meta.url)

const previousDataDir = process.env.MIAO_DATA_DIR
const root = await mkdtemp(join(tmpdir(), 'miao-agent-chat-delete-'))
process.env.MIAO_DATA_DIR = root

const { closeDatabase, configureDatabase } = await import('../server/utils/sqlite.ts')
configureDatabase(join(root, 'miao.sqlite'))

const { createSession, persistNow, touch } = await import('../server/agent/session.ts')
const { isSessionRemoved } = await import('../server/agent/sessionTombstones.ts')
const { AgentChat } = await import('../server/models/agentChat.ts')
const { AgentHistory } = await import('../server/models/agentHistory.ts')
const { GenerationJob } = await import('../server/models/generationJob.ts')
const { createProject } = await import('../server/utils/projects.ts')
const { archiveAgentHistory, readAgentHistory } = await import('../server/utils/agentHistory.ts')
const { getAgentChat, listAgentChats, upsertAgentChat } = await import('../server/utils/agentChats.ts')
const { getAgentRuntime, upsertAgentRuntime } = await import('../server/utils/agentSessionRuntime.ts')
const {
  deleteAgentConversation,
  listRemovedSessionIds,
  listRetainedCanvasImages,
  loadPersistentSessionTombstones,
  removeRetainedCanvasImages,
} = await import('../server/utils/agentChatDeletion.ts')
const { localDataPath } = await import('../server/utils/dataPaths.mjs')
const { saveMediaFile } = await import('../server/utils/localMedia.ts')
const { configureMediaBase } = await import('../server/utils/storedMediaUrl.mjs')

configureMediaBase('http://localhost:3001')

after(async () => {
  closeDatabase()
  if (previousDataDir === undefined)
    delete process.env.MIAO_DATA_DIR
  else
    process.env.MIAO_DATA_DIR = previousDataDir
  await rm(root, { recursive: true, force: true })
})

function sessionPath(id) {
  return join(localDataPath('agent-sessions'), `${id}.json`)
}

function statusOf(error) {
  return Number(error?.statusCode || 0)
}

async function seedChat(projectId, options = {}) {
  const sessionId = options.sessionId || crypto.randomUUID()
  const url = options.url || await saveMediaFile(`generator/results/${projectId}/${sessionId}.png`, new Uint8Array([1, 2, 3]), 'image/png')
  await AgentChat.create({
    sessionId,
    projectId,
    title: 'Keep talking',
    preview: 'hello',
    messages: [{ id: 'u1', role: 'user', content: 'hello', imageIds: [], confirmationState: '', confirmationReason: '' }],
    images: [{ id: 'shot', url, status: 'success', kind: 'still', prompt: 'a still', sourceUrl: '', error: '' }],
    runtime: {
      title: 'Keep talking',
      messages: [{ role: 'user', content: 'hello' }],
      images: [{ id: 'shot', url, status: 'success' }],
    },
    messageCount: 1,
    userTurnCount: 1,
  })
  await AgentHistory.create({
    sessionId,
    messageId: `history:${sessionId}`,
    message: { id: `history:${sessionId}`, role: 'user', content: 'hello' },
    images: [{ id: 'shot', url, status: 'success', kind: 'still' }],
  })
  const session = createSession({ id: sessionId, projectId })
  session.title = 'Keep talking'
  session.images = [{ id: 'shot', url, status: 'success', kind: 'still', prompt: 'a still' }]
  session.messages.push({ role: 'user', content: 'hello' })
  touch(session)
  persistNow(session)
  return { sessionId, url }
}

test('delete conversation keeps canvas images and rejects later writes', async () => {
  const project = await createProject({ name: 'Delete chat' })
  const projectId = String(project._id)
  const { sessionId, url } = await seedChat(projectId)

  const result = await deleteAgentConversation({ sessionId, projectId })
  assert.equal(result.ok, true)
  assert.equal(result.sessionId, sessionId)
  assert.equal(result.retainedCanvasImages[0]?.url, url)
  assert.equal(isSessionRemoved(sessionId), true)
  assert.equal(existsSync(sessionPath(sessionId)), false)

  const tombstone = await AgentChat.findOne({ sessionId })
  assert.ok(tombstone?.deletedAt)
  assert.ok(tombstone.deletionCompletedAt)
  assert.deepEqual(tombstone.messages, [])
  assert.equal(tombstone.preview, '')
  assert.equal(tombstone.runtime, null)
  assert.equal(tombstone.title, '')
  assert.equal(tombstone.images[0]?.url, url)
  assert.ok((tombstone.retainedMediaKeys || []).length > 0)
  assert.equal(await AgentHistory.findOne({ sessionId }), null)
  assert.equal(await getAgentChat(sessionId), null)
  assert.equal((await listAgentChats(projectId)).some(chat => chat.sessionId === sessionId), false)
  assert.equal(await getAgentRuntime(sessionId), null)

  assert.equal(await upsertAgentChat({
    sessionId,
    projectId,
    messages: [{ role: 'user', content: 'revive me' }],
    images: [{ id: 'shot', url }],
  }), null)
  assert.equal(await upsertAgentRuntime({
    sessionId,
    projectId,
    messages: [{ role: 'user', content: 'revive runtime' }],
    images: [{ id: 'shot', url }],
  }), null)
  const again = await AgentChat.findOne({ sessionId })
  assert.deepEqual(again?.messages, [])
  assert.equal(again?.runtime, null)

  await archiveAgentHistory(sessionId, [{ id: 'history:late', role: 'user', content: 'late' }], [])
  assert.equal(await AgentHistory.findOne({ sessionId }), null)
  const history = await readAgentHistory(sessionId, {})
  assert.deepEqual(history.messages, [])

  const listed = await listRetainedCanvasImages(projectId)
  assert.equal(listed.some(image => image.id === 'shot' && image.url === url), true)
  assert.deepEqual(await listRemovedSessionIds([sessionId, crypto.randomUUID()]), [sessionId])

  const repeat = await deleteAgentConversation({ sessionId, projectId })
  assert.equal(repeat.ok, true)
  assert.equal(repeat.retainedCanvasImages[0]?.id, 'shot')
})

test('busy jobs block delete even when the live session is idle', async () => {
  const project = await createProject({ name: 'Busy job' })
  const projectId = String(project._id)
  const { sessionId } = await seedChat(projectId)
  await GenerationJob.create({
    projectId,
    taskId: `job_${sessionId}`,
    state: 'queued',
    deleted: false,
    originalRequest: { sessionId, source: 'agent' },
  })
  await assert.rejects(() => deleteAgentConversation({ sessionId, projectId }), error => statusOf(error) === 409)
  assert.ok(!(await AgentChat.findOne({ sessionId }))?.deletedAt)
  assert.ok(await AgentHistory.findOne({ sessionId }))
})

test('another session being busy does not block an idle conversation', async () => {
  const project = await createProject({ name: 'Sibling busy' })
  const projectId = String(project._id)
  const idle = await seedChat(projectId)
  const busy = await seedChat(projectId)
  await GenerationJob.create({
    projectId,
    taskId: `job_${busy.sessionId}`,
    state: 'generating',
    deleted: false,
    originalRequest: { sessionId: busy.sessionId, source: 'agent' },
  })
  const result = await deleteAgentConversation({ sessionId: idle.sessionId, projectId })
  assert.equal(result.ok, true)
  assert.ok((await AgentChat.findOne({ sessionId: busy.sessionId }))?.messages?.length)
})

test('unknown, cross-project, and session-only chats have explicit outcomes', async () => {
  const project = await createProject({ name: 'Owner' })
  const other = await createProject({ name: 'Other' })
  const projectId = String(project._id)
  const { sessionId } = await seedChat(projectId)
  await assert.rejects(() => deleteAgentConversation({ sessionId: crypto.randomUUID(), projectId }), error => statusOf(error) === 404)
  await assert.rejects(() => deleteAgentConversation({ sessionId: 'not-a-session', projectId }), error => statusOf(error) === 400)
  await assert.rejects(() => deleteAgentConversation({ sessionId, projectId: String(other._id) }), error => statusOf(error) === 409)

  const orphanId = crypto.randomUUID()
  const orphan = createSession({ id: orphanId, projectId })
  orphan.images = [{ id: 'only', url: 'https://example.com/still.png', status: 'success', kind: 'still' }]
  touch(orphan)
  persistNow(orphan)
  const orphaned = await deleteAgentConversation({ sessionId: orphanId, projectId })
  assert.equal(orphaned.ok, true)
  assert.equal(orphaned.retainedCanvasImages[0]?.id, 'only')
  assert.ok((await AgentChat.findOne({ sessionId: orphanId }))?.deletedAt)
})

test('retained images survive the chat snapshot cap and canvas delete only hides them', async () => {
  const project = await createProject({ name: 'Many stills' })
  const projectId = String(project._id)
  const sessionId = crypto.randomUUID()
  const images = []
  for (let index = 0; index < 72; index++) {
    const url = await saveMediaFile(`generator/results/${projectId}/still-${index}.png`, new Uint8Array([index]), 'image/png')
    images.push({ id: `shot-${index}`, url, status: 'success', kind: 'still', prompt: '', sourceUrl: '', error: '' })
  }
  await AgentChat.create({
    sessionId,
    projectId,
    messages: [{ id: 'u1', role: 'user', content: 'many', imageIds: [], confirmationState: '', confirmationReason: '' }],
    images,
    runtime: { images },
  })
  const result = await deleteAgentConversation({ sessionId, projectId })
  assert.equal(result.retainedCanvasImages.length, 72)
  const tombstone = await AgentChat.findOne({ sessionId })
  assert.equal(tombstone?.images.length, 72)
  assert.ok((tombstone?.retainedMediaKeys || []).length >= 72)

  const removed = await removeRetainedCanvasImages(projectId, ['shot-0', 'shot-1'])
  assert.deepEqual(removed.removedIds.sort(), ['shot-0', 'shot-1'])
  const after = await listRetainedCanvasImages(projectId)
  assert.equal(after.some(image => image.id === 'shot-0'), false)
  assert.equal(after.length, 70)
  assert.ok((await AgentChat.findOne({ sessionId }))?.retainedMediaKeys?.length >= 72)
})

test('boot reloads tombstones so a deleted session cannot be reopened', async () => {
  const project = await createProject({ name: 'Boot tombstone' })
  const projectId = String(project._id)
  const { sessionId } = await seedChat(projectId)
  await deleteAgentConversation({ sessionId, projectId })
  const { clearSessionTombstones } = await import('../server/agent/sessionTombstones.ts')
  clearSessionTombstones()
  assert.equal(isSessionRemoved(sessionId), false)
  await loadPersistentSessionTombstones()
  assert.equal(isSessionRemoved(sessionId), true)
  assert.throws(() => createSession({ id: sessionId, projectId }), error => statusOf(error) === 409 || /deleted/i.test(String(error)))
})
