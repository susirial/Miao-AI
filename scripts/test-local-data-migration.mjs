import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { closeDatabase, configureDatabase, connectDatabase, defineCollection, stripLegacyAccounting, stripLegacyScope } from '../server/utils/sqlite.ts'

test('existing data becomes one local installation without losing projects or conversation history', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'polox-local-migration-'))
  const path = join(dir, 'old.sqlite')
  configureDatabase(path)
  const old = new DatabaseSync(path)
  for (const name of ['projects', 'agent_chats', 'canvas_layouts'])
    old.exec(`CREATE TABLE ${name} (id TEXT PRIMARY KEY, body TEXT NOT NULL)`)
  old.exec('CREATE UNIQUE INDEX projects_unique_0 ON projects (json_extract(body, \'$.workspaceId\'), json_extract(body, \'$.isDefault\')) WHERE json_extract(body, \'$.isDefault\') = 1')
  old.exec('CREATE UNIQUE INDEX canvas_layouts_unique_0 ON canvas_layouts (json_extract(body, \'$.workspaceId\'), json_extract(body, \'$.projectId\'), json_extract(body, \'$.assetId\'))')
  for (const id of ['first', 'second']) {
    old.prepare('INSERT INTO projects VALUES (?, ?)').run(id, JSON.stringify({ _id: id, workspaceId: id, isDefault: true, name: id }))
    old.prepare('INSERT INTO agent_chats VALUES (?, ?)').run(id, JSON.stringify({ _id: id, sessionId: id, workspaceId: id, projectId: id, creditsCharged: 12, messages: [{ role: 'user', content: id }], runtime: { ownerWorkspaceId: id, messages: [{ role: 'user', content: id }] } }))
    old.prepare('INSERT INTO canvas_layouts VALUES (?, ?)').run(id, JSON.stringify({ _id: id, workspaceId: id, projectId: id, assetId: 'image', x: 42 }))
  }
  old.close()
  try {
    const Projects = defineCollection('projects', () => ({}), [{ fields: ['isDefault'], where: 'json_extract(body, \'$.isDefault\') = 1' }])
    const Chats = defineCollection('agent_chats', () => ({}))
    const Canvas = defineCollection('canvas_layouts', () => ({}), [{ fields: ['projectId', 'assetId'] }])
    assert.equal(await Projects.countDocuments({}), 2)
    assert.equal(await Projects.countDocuments({ isDefault: true }), 1)
    await assert.rejects(Projects.create({ isDefault: true }), /UNIQUE/)
    for (const id of ['first', 'second']) {
      const chat = await Chats.findById(id)
      assert.equal(chat.workspaceId, undefined)
      assert.equal(chat.creditsCharged, undefined)
      assert.equal(chat.runtime.ownerWorkspaceId, undefined)
      assert.equal(chat.messages[0].role, 'user')
      assert.equal(chat.messages[0].content, id)
      assert.equal((await Canvas.findOne({ projectId: id })).x, 42)
    }
    closeDatabase()
    assert.equal(await Projects.countDocuments({}), 2)
    assert.equal(Number(connectDatabase().prepare('PRAGMA user_version').get().user_version), 4)
    assert.deepEqual(stripLegacyScope({ ownerWorkspaceId: 'old', userId: 'old', messages: [{ role: 'user', content: 'hello' }] }), { messages: [{ role: 'user', content: 'hello' }] })
  }
  finally {
    closeDatabase()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('obsolete accounting metadata is removed without changing prompts or generation settings', () => {
  const record = { creditsCharged: 12, input: { prompt: 'a credit card on a desk', duration: 10 }, runtime: { pendingConfirmation: { credits: 4, params: { resolution: '720p' } } }, messages: [{ confirmationCredits: 4, content: 'Keep this message' }] }
  assert.deepEqual(stripLegacyAccounting(record), { input: { prompt: 'a credit card on a desk', duration: 10 }, runtime: { pendingConfirmation: { params: { resolution: '720p' } } }, messages: [{ content: 'Keep this message' }] })
})

test('provider removal migration scrubs settings and deletes only fal or providerless generation jobs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'polox-provider-migration-'))
  const path = join(dir, 'old.sqlite')
  configureDatabase(path)
  const old = new DatabaseSync(path)
  old.exec(`
    CREATE TABLE local_service_settings (id INTEGER PRIMARY KEY CHECK (id = 1), body TEXT NOT NULL);
    CREATE TABLE generation_jobs (id TEXT PRIMARY KEY, body TEXT NOT NULL);
    PRAGMA user_version = 2;
  `)
  old.prepare('INSERT INTO local_service_settings VALUES (1, ?)').run(JSON.stringify({
    version: 2,
    selectedTextModel: 'openrouter/legacy',
    openRouterKey: 'or-secret',
    openRouterModel: 'owner/model',
    openRouterOk: true,
    falKey: 'fal-secret',
    falOk: true,
    imageBackend: 'fal',
    videoBackend: 'fal',
    arkKey: 'ark-secret',
  }))
  const rows = [
    ['fal', { provider: 'fal', prompt: 'delete fal' }],
    ['missing', { prompt: 'delete providerless' }],
    ['blank', { provider: ' ', prompt: 'delete blank' }],
    ['image', { provider: 'ark-image', prompt: 'keep image' }],
    ['video', { provider: 'ark-video', prompt: 'keep video' }],
    ['local', { provider: 'local', prompt: 'keep local' }],
  ]
  for (const [id, body] of rows)
    old.prepare('INSERT INTO generation_jobs VALUES (?, ?)').run(id, JSON.stringify({ _id: id, ...body }))
  old.close()

  try {
    const db = connectDatabase()
    const settings = JSON.parse(String(db.prepare('SELECT body FROM local_service_settings WHERE id = 1').get().body))
    assert.equal(settings.version, 3)
    assert.equal(settings.selectedTextModel, 'ark/seed-2.1-pro')
    assert.equal(settings.arkKey, 'ark-secret')
    for (const field of ['openRouterKey', 'openRouterModel', 'openRouterOk', 'falKey', 'falOk', 'imageBackend', 'videoBackend'])
      assert.equal(field in settings, false)
    assert.deepEqual(db.prepare('SELECT id FROM generation_jobs ORDER BY id').all().map(row => row.id), ['image', 'local', 'video'])
    assert.equal(Number(db.prepare('PRAGMA user_version').get().user_version), 4)
  }
  finally {
    closeDatabase()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('legacy loopback media URLs become port-independent paths without changing provider URLs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'polox-media-url-migration-'))
  const path = join(dir, 'old.sqlite')
  configureDatabase(path)
  const old = new DatabaseSync(path)
  old.exec(`
    CREATE TABLE generation_jobs (id TEXT PRIMARY KEY, body TEXT NOT NULL);
    CREATE TABLE agent_chats (id TEXT PRIMARY KEY, body TEXT NOT NULL);
    PRAGMA user_version = 3;
  `)
  old.prepare('INSERT INTO generation_jobs VALUES (?, ?)').run('job', JSON.stringify({
    _id: 'job',
    resultUrls: [
      'http://localhost:3001/media/generator/results/job/0.png',
      'https://provider.example.com/result.png',
    ],
    input: {
      first_frame_url: 'http://127.0.0.1:54321/media/generator/uploads/frame.png',
    },
  }))
  old.prepare('INSERT INTO agent_chats VALUES (?, ?)').run('chat', JSON.stringify({
    _id: 'chat',
    images: [{
      url: 'http://[::1]:3001/media/agent-lab/session/image.png',
      sourceUrl: 'https://provider.example.com/source.png',
    }],
  }))
  old.close()

  try {
    const db = connectDatabase()
    const job = JSON.parse(String(db.prepare('SELECT body FROM generation_jobs WHERE id = ?').get('job').body))
    const chat = JSON.parse(String(db.prepare('SELECT body FROM agent_chats WHERE id = ?').get('chat').body))
    assert.deepEqual(job.resultUrls, [
      '/media/generator/results/job/0.png',
      'https://provider.example.com/result.png',
    ])
    assert.equal(job.input.first_frame_url, '/media/generator/uploads/frame.png')
    assert.equal(chat.images[0].url, '/media/agent-lab/session/image.png')
    assert.equal(chat.images[0].sourceUrl, 'https://provider.example.com/source.png')
    assert.equal(Number(db.prepare('PRAGMA user_version').get().user_version), 4)
  }
  finally {
    closeDatabase()
    rmSync(dir, { recursive: true, force: true })
  }
})
