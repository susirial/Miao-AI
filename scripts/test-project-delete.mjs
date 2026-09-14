import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { register } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { after, test } from 'node:test'

register('./nuxt-alias-hook.mjs', import.meta.url)

const previousDataDir = process.env.MIAO_DATA_DIR
const root = await mkdtemp(join(tmpdir(), 'miao-project-delete-'))
process.env.MIAO_DATA_DIR = root

const { closeDatabase, configureDatabase } = await import('../server/utils/sqlite.ts')
configureDatabase(join(root, 'miao.sqlite'))

const { createSession, listSessions, persistNow, touch } = await import('../server/agent/session.ts')
const { AgentChat } = await import('../server/models/agentChat.ts')
const { AgentHistory } = await import('../server/models/agentHistory.ts')
const { CanvasLayout } = await import('../server/models/canvasLayout.ts')
const { GenerationJob } = await import('../server/models/generationJob.ts')
const { Project } = await import('../server/models/project.ts')
const { createProject, deleteProject, ensureDefaultProject } = await import('../server/utils/projects.ts')
const { archiveAgentHistory } = await import('../server/utils/agentHistory.ts')
const { upsertAgentRuntime } = await import('../server/utils/agentSessionRuntime.ts')
const { localDataPath } = await import('../server/utils/dataPaths.mjs')
const { mediaRoot, saveMediaFile, storedMediaFile } = await import('../server/utils/localMedia.ts')
const { assertProjectWritable, beginProjectWrite, endProjectWrite } = await import('../server/utils/projectDeletion.ts')
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

async function seedOwnedContent(projectId, options = {}) {
  const exclusiveUrl = options.exclusiveUrl || await saveMediaFile(`generator/results/${projectId}/shot.png`, new Uint8Array([1, 2, 3]), 'image/png')
  const sharedUrl = options.sharedUrl || '/media/generator/shared/keep.png'
  const sessionId = options.sessionId || crypto.randomUUID()
  await GenerationJob.create({
    projectId,
    taskId: `job_${projectId}`,
    state: options.state || 'success',
    resultUrls: [exclusiveUrl],
    sourceUrls: [sharedUrl],
    input: { prompt: `see ${exclusiveUrl}` },
    deleted: false,
  })
  await AgentChat.create({
    sessionId,
    projectId,
    messages: [{ role: 'user', content: exclusiveUrl }],
    images: [{ id: 'shot', url: exclusiveUrl, status: 'success', kind: 'still' }],
    runtime: { images: [{ url: exclusiveUrl }] },
  })
  await AgentHistory.create({
    sessionId,
    messageId: `history:${sessionId}`,
    message: { id: `history:${sessionId}`, role: 'assistant', content: exclusiveUrl },
    images: [{ id: 'shot', url: exclusiveUrl, status: 'success', kind: 'still' }],
  })
  await CanvasLayout.create({
    projectId,
    assetId: exclusiveUrl,
    x: 12,
    y: 8,
  })
  return { exclusiveUrl, sharedUrl, sessionId }
}

test('deleting a project purges local records and exclusive media without moving jobs', async () => {
  const destination = await ensureDefaultProject()
  const sharedUrl = await saveMediaFile('generator/shared/keep.png', new Uint8Array([9]), 'image/png')
  const other = await createProject({ name: 'Keep me' })
  await seedOwnedContent(String(other._id), { sharedUrl })
  const target = await createProject({ name: 'Remove me' })
  const targetId = String(target._id)
  const { exclusiveUrl, sessionId } = await seedOwnedContent(targetId, { sharedUrl })
  const session = createSession({ id: sessionId, projectId: targetId })
  session.images = [{ id: 'shot', url: exclusiveUrl, status: 'success', kind: 'still' }]
  touch(session)

  const kept = await deleteProject(targetId)
  assert.equal(String(kept._id), String(destination._id))
  assert.equal(await Project.findById(targetId), null)
  assert.equal(await GenerationJob.findOne({ projectId: targetId }), null)
  assert.equal(await GenerationJob.findOne({ projectId: String(destination._id), taskId: `job_${targetId}` }), null)
  assert.equal(await AgentChat.findOne({ sessionId }), null)
  assert.equal(await AgentHistory.findOne({ sessionId }), null)
  assert.equal(await CanvasLayout.findOne({ projectId: targetId }), null)
  assert.equal(existsSync(sessionPath(sessionId)), false)
  await assert.rejects(storedMediaFile(`generator/results/${targetId}/shot.png`))
  assert.equal((await storedMediaFile('generator/shared/keep.png')).size > 0, true)
  assert.ok(await Project.findById(other._id))
  assert.ok(await GenerationJob.findOne({ projectId: String(other._id) }))
})

test('deleting the default project purges its content and does not recreate it', async () => {
  const destination = await ensureDefaultProject()
  const originalId = String(destination._id)
  const sharedUrl = await saveMediaFile('generator/shared/default-keep.png', new Uint8Array([8]), 'image/png')
  const other = await createProject({ name: 'Keep after default' })
  await seedOwnedContent(String(other._id), { sharedUrl })
  const { exclusiveUrl, sessionId } = await seedOwnedContent(originalId, { sharedUrl })
  const session = createSession({ id: sessionId, projectId: originalId })
  session.images = [{ id: 'shot', url: exclusiveUrl, status: 'success', kind: 'still' }]
  touch(session)

  const next = await deleteProject(originalId)
  assert.equal(String(next?._id), String(other._id))
  assert.equal(next?.isDefault, false)
  assert.equal(await Project.findOne({ isDefault: true }), null)
  assert.equal(await Project.findById(originalId), null)
  assert.equal(await GenerationJob.findOne({ projectId: originalId }), null)
  assert.equal(await AgentChat.findOne({ sessionId }), null)
  assert.equal(await AgentHistory.findOne({ sessionId }), null)
  assert.equal(await CanvasLayout.findOne({ projectId: originalId }), null)
  assert.equal(existsSync(sessionPath(sessionId)), false)
  await assert.rejects(storedMediaFile(`generator/results/${originalId}/shot.png`))
  assert.equal((await storedMediaFile('generator/shared/default-keep.png')).size > 0, true)
  assert.ok(await Project.findById(other._id))
  assert.ok(await GenerationJob.findOne({ projectId: String(other._id) }))
})

test('deleting the last default project leaves no projects', async () => {
  for (const leftover of await Project.find({}))
    await deleteProject(String(leftover._id))
  const destination = await ensureDefaultProject()
  const originalId = String(destination._id)
  const next = await deleteProject(originalId)
  assert.equal(next, null)
  assert.equal(await Project.findById(originalId), null)
  assert.equal(await Project.findOne({ isDefault: true }), null)
  assert.equal(await Project.countDocuments({}), 0)
})

test('queued, generating, archiving or busy agent sessions block deletion', async () => {
  for (const state of ['queued', 'generating', 'archiving']) {
    const project = await createProject({ name: `Busy ${state}` })
    const id = String(project._id)
    await GenerationJob.create({ projectId: id, taskId: `busy_${state}_${id}`, state, deleted: false })
    await assert.rejects(() => deleteProject(id), /Stop generations and agent work/)
    assert.ok(await Project.findById(id))
    assert.ok(await GenerationJob.findOne({ projectId: id }))
  }
  const project = await createProject({ name: 'Busy agent' })
  const id = String(project._id)
  const session = createSession({ projectId: id })
  session.busy = true
  await assert.rejects(() => deleteProject(id), /Stop generations and agent work/)
  assert.ok(await Project.findById(id))
  session.busy = false
})

test('an active project writer blocks deletion before cleanup starts', async () => {
  const project = await createProject({ name: 'Writing' })
  const id = String(project._id)
  const lease = await beginProjectWrite(id)
  try {
    await assert.rejects(() => deleteProject(id), /currently being updated/)
    assert.equal((await Project.findById(id))?.deletingAt, undefined)
  }
  finally {
    endProjectWrite(lease)
  }
  await deleteProject(id)
})

test('an unreadable session record aborts deletion before media or database cleanup', async () => {
  const project = await createProject({ name: 'Fail closed' })
  const id = String(project._id)
  const corruptSessionId = randomUUID()
  await mkdir(localDataPath('agent-sessions'), { recursive: true })
  await writeFile(sessionPath(corruptSessionId), '{not json')
  try {
    await assert.rejects(() => deleteProject(id), /JSON/)
    assert.equal((await Project.findById(id))?.deletingAt, undefined)
  }
  finally {
    await rm(sessionPath(corruptSessionId), { force: true })
  }
  await deleteProject(id)
})

test('media or database failures keep the project so deletion can be retried', async () => {
  const sharedUrl = '/media/generator/shared/keep.png'
  const target = await createProject({ name: 'Retry me' })
  const targetId = String(target._id)
  const { exclusiveUrl, sessionId } = await seedOwnedContent(targetId, { sharedUrl })
  const exclusiveKey = `generator/results/${targetId}/shot.png`
  await mkdir(localDataPath('agent-sessions'), { recursive: true })
  await writeFile(sessionPath(sessionId), JSON.stringify({ id: sessionId, projectId: targetId, messages: [] }))
  await rm(join(mediaRoot(), exclusiveKey), { force: true })
  await mkdir(join(mediaRoot(), exclusiveKey), { recursive: true })
  await writeFile(join(mediaRoot(), exclusiveKey, 'blocked'), 'no')
  await assert.rejects(() => deleteProject(targetId))
  const pendingCleanup = await Project.findById(targetId)
  assert.ok(pendingCleanup?.deletingAt)
  assert.ok(pendingCleanup?.deletionMediaKeys.includes(exclusiveKey))
  await assert.rejects(() => assertProjectWritable(targetId), /being deleted/)
  assert.equal(await GenerationJob.findOne({ projectId: targetId }), null)
  assert.equal(existsSync(sessionPath(sessionId)), true)

  await rm(join(mediaRoot(), exclusiveKey), { recursive: true, force: true })
  await saveMediaFile(exclusiveKey, new Uint8Array([4]), 'image/png')

  const original = AgentHistory.deleteMany.bind(AgentHistory)
  AgentHistory.deleteMany = async () => {
    throw new Error('history delete failed')
  }
  try {
    await assert.rejects(() => deleteProject(targetId), /history delete failed/)
    assert.ok((await Project.findById(targetId))?.deletingAt)
    assert.equal((await storedMediaFile(exclusiveKey)).size > 0, true)
  }
  finally {
    AgentHistory.deleteMany = original
  }

  await deleteProject(targetId)
  assert.equal(await Project.findById(targetId), null)
  assert.equal(await AgentChat.findOne({ sessionId }), null)
  assert.equal(existsSync(sessionPath(sessionId)), false)
  await assert.rejects(storedMediaFile(exclusiveKey))
  assert.equal(exclusiveUrl.endsWith('shot.png'), true)
})

test('a queued session persist cannot resurrect a deleted project', async () => {
  const target = await createProject({ name: 'Persist race' })
  const targetId = String(target._id)
  const session = createSession({ projectId: targetId })
  session.images = [{ id: 'shot', url: '/media/generator/results/persist.png', status: 'success', kind: 'still' }]
  touch(session)
  await deleteProject(targetId)
  persistNow(session)
  await archiveAgentHistory(session.id, [{
    id: `history:${session.id}`,
    role: 'assistant',
    content: 'should stay deleted',
  }], [])
  await upsertAgentRuntime({
    sessionId: session.id,
    projectId: targetId,
    messages: [],
    images: [],
    updatedAt: Date.now(),
  })
  await new Promise(resolve => setTimeout(resolve, 400))
  assert.equal(await Project.findById(targetId), null)
  assert.equal(await AgentChat.findOne({ sessionId: session.id }), null)
  assert.equal(await AgentHistory.findOne({ sessionId: session.id }), null)
  assert.deepEqual(await listSessions(targetId), [])
  assert.equal(existsSync(sessionPath(session.id)), false)
})
