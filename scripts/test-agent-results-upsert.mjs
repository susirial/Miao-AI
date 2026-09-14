import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'
import { isJobDeleted } from '../server/utils/generationJobs.ts'
import { closeDatabase, configureDatabase, defineCollection, isSqliteUniqueConstraintError } from '../server/utils/sqlite.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const models = [
  { id: 'seedream/5-pro-image-to-image', name: 'Seedream', category: 'Image', task: 'Image to Image' },
]
const canonicalMediaUrl = value => typeof value === 'string' && (/^https?:\/\//i.test(value) || value.startsWith('/media/')) ? value : ''

function uniqueError() {
  const error = new Error('UNIQUE constraint failed: index \'generation_jobs_unique_1\'')
  error.code = 'ERR_SQLITE_ERROR'
  error.errcode = 2067
  return error
}

function createError(input) {
  return Object.assign(new Error(input.statusMessage || input.message || 'Error'), input)
}

function load(file, mocks = {}) {
  const code = ts.transpileModule(readFileSync(resolve(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} }
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    createError,
    require: id => id in mocks ? mocks[id] : undefined,
  })
  return module.exports
}

function jobsCollection() {
  return defineCollection('generation_jobs', () => ({
    projectId: '',
    provider: 'local',
    backendModelId: '',
    protocolVersion: 'local-v1',
    providerMetadata: {},
    category: '',
    task: '',
    providerTaskId: '',
    state: 'queued',
    sourceUrls: [],
    resultUrls: [],
    resultAssets: [],
    resultJson: '',
    failCode: '',
    failMsg: '',
    archiveAttempts: 0,
    hiddenFromUser: false,
    deleted: false,
  }), [{ fields: ['taskId'] }])
}

function wrapJobs(Jobs, extra = {}) {
  return {
    findOne: async filter => extra.findOne ? extra.findOne(filter, Jobs) : Jobs.findOne(filter),
    create: async data => extra.create ? extra.create(data, Jobs) : Jobs.create(data),
    countDocuments: async filter => Jobs.countDocuments(filter),
  }
}

function loadAgentJobs(Jobs, extra = {}) {
  return load('server/utils/agentJobs.ts', {
    '~~/shared/utils/agentConcat': {
      AGENT_CONCAT_MODEL: 'concat',
      isConcatenatedPrompt: () => false,
      isConcatVideoMode: () => false,
    },
    '~~/shared/utils/agentModels': { AGENT_MODELS: models },
    '../ai/media/arkImageInput': { ARK_IMAGE_MODEL_ID: 'ark-image-backend' },
    '../ai/media/arkVideoInput': { ARK_VIDEO_MODEL_ID: 'ark-video-backend' },
    '../models/generationJob': { GenerationJob: wrapJobs(Jobs, extra) },
    './generationJobs': { isJobDeleted },
    './storedMediaUrl.mjs': { canonicalMediaUrl },
    './generationResults': {
      toPublicJob: job => ({
        taskId: job.taskId,
        projectId: job.projectId,
        model: job.model,
        state: job.state,
        resultUrls: job.resultUrls,
        provider: job.provider,
        backendModelId: job.backendModelId,
      }),
      excludeInputResultUrls: (urls, _input, extra = []) => {
        const blocked = new Set(extra.filter(Boolean))
        return (urls || []).filter(url => url && !blocked.has(url))
      },
    },
    './projectDeletion': {
      assertProjectWritable: async () => {},
      beginProjectWrite: async id => id,
      endProjectWrite: () => {},
    },
    './projects': { resolveProject: async id => ({ _id: id || 'project-1' }) },
    './sqlite': {
      connectDatabase: () => {},
      isSqliteUniqueConstraintError,
    },
  })
}

function loadAgentSlots(Jobs, extra = {}) {
  const jobsApi = loadAgentJobs(Jobs, extra)
  return load('server/utils/agentSlots.ts', {
    '~~/shared/utils/agentModels': { AGENT_MODELS: models },
    '../../shared/types/generation': {
      GENERATION_ACTIVE_STATES: ['waiting', 'queuing', 'generating', 'moderating', 'archiving'],
    },
    '../models/generationJob': { GenerationJob: wrapJobs(Jobs, extra) },
    './agentJobs': {
      agentResultTaskId: jobsApi.agentResultTaskId,
      httpUrlList: jobsApi.httpUrlList,
    },
    './generationJobs': { isJobDeleted },
    './storedMediaUrl.mjs': { canonicalMediaUrl },
    './agentSessionRuntime': { syncAgentRuntimeFromJob: async () => {} },
    './generationConcurrency': { generationConcurrency: async () => 1 },
    './generationQueue': {
      countActiveGenerationJobs: async () => 0,
      dispatchQueuedJobs: async () => {},
    },
    './projectDeletion': {
      assertProjectWritable: async () => {},
      beginProjectWrite: async id => id,
      endProjectWrite: () => {},
    },
    './projects': { resolveProject: async id => ({ _id: id || 'project-1' }) },
    './sqlite': {
      connectDatabase: () => {},
      isSqliteUniqueConstraintError,
    },
  })
}

function loadHttpError() {
  return load('server/utils/httpError.ts', {
    'h3': {
      createError,
      isError: error => Boolean(error && typeof error === 'object' && 'statusCode' in error),
    },
    '~~/shared/utils/apiError': {
      isGenericErrorMessage: () => false,
      readErrorMessage: (error, fallback) => error instanceof Error ? error.message : fallback,
    },
  })
}

async function withDb(run) {
  const dir = mkdtempSync(join(tmpdir(), 'miao-agent-results-'))
  configureDatabase(join(dir, 'test.sqlite'))
  try {
    await run(jobsCollection())
  }
  finally {
    closeDatabase()
    rmSync(dir, { recursive: true, force: true })
  }
}

const sampleItem = {
  id: 'img-1',
  url: 'https://cdn.example/a.png',
  prompt: 'first',
  modelId: 'seedream/5-pro-image-to-image',
}

test('isSqliteUniqueConstraintError recognizes 2067 and UNIQUE text only', () => {
  assert.equal(isSqliteUniqueConstraintError(uniqueError()), true)
  assert.equal(isSqliteUniqueConstraintError(new Error('UNIQUE constraint failed: index \'generation_jobs_unique_1\'')), true)
  const other = new Error('constraint failed')
  other.code = 'ERR_SQLITE_ERROR'
  other.errcode = 19
  assert.equal(isSqliteUniqueConstraintError(other), false)
  assert.equal(isSqliteUniqueConstraintError(new Error('JSON check failed')), false)
})

test('persist skips a result URL that is only an input reference', async () => {
  await withDb(async (Jobs) => {
    const { recordAgentResults } = loadAgentJobs(Jobs)
    const result = await recordAgentResults('project-a', [{
      id: 'call_battle_1',
      url: 'https://cdn.example/ref-olive.png',
      prompt: 'battle',
      name: '双机甲对决_1',
      sourceUrl: 'https://cdn.example/ref-white.png',
      inputUrls: ['https://cdn.example/ref-white.png', 'https://cdn.example/ref-olive.png'],
    }])
    assert.deepEqual([...result.importedIds], ['call_battle_1'])
    assert.equal(result.jobs.length, 0)
    assert.equal(await Jobs.countDocuments({}), 0)
  })
})

test('acquireAgentSlot does not prefill sourceUrls with reference images', async () => {
  await withDb(async (Jobs) => {
    const { acquireAgentSlot } = loadAgentSlots(Jobs)
    const { agentResultTaskId } = loadAgentJobs(Jobs)
    await acquireAgentSlot({
      sessionId: 'session-1',
      callId: 'call-refs',
      projectId: 'project-a',
      modelId: 'seedream/5-pro-image-to-image',
      provider: 'ark-image',
      backendModelId: 'ark-image-backend',
      protocolVersion: 'ark-images-sync-v1',
      requestBody: { model: 'ark-image-backend' },
      inputUrls: ['/media/generator/results/white/0.jpg', '/media/generator/results/olive/0.jpg'],
    })
    const stored = await Jobs.findOne({ taskId: agentResultTaskId('call-refs') })
    assert.deepEqual(stored.sourceUrls, [])
    assert.deepEqual(stored.input.input_urls, ['/media/generator/results/white/0.jpg', '/media/generator/results/olive/0.jpg'])
  })
})

test('the same canvas item updates one job instead of inserting another', async () => {
  await withDb(async (Jobs) => {
    const { recordAgentResults, agentResultTaskId } = loadAgentJobs(Jobs)
    const first = await recordAgentResults('project-a', [sampleItem])
    const second = await recordAgentResults('project-b', [{ ...sampleItem, url: 'https://cdn.example/b.png', prompt: 'second' }])
    assert.equal(await Jobs.countDocuments({}), 1)
    const stored = await Jobs.findOne({ taskId: agentResultTaskId('img-1') })
    assert.equal(stored.projectId, 'project-b')
    assert.deepEqual(stored.resultUrls, ['https://cdn.example/b.png'])
    assert.equal(first.jobs.length, 1)
    assert.equal(second.jobs.length, 1)
    assert.deepEqual([...second.importedIds], ['img-1'])
  })
})

test('soft-deleted jobs stay deleted and are acknowledged without a public job', async () => {
  await withDb(async (Jobs) => {
    const { recordAgentResults, agentResultTaskId } = loadAgentJobs(Jobs)
    await recordAgentResults('project-a', [sampleItem])
    const stored = await Jobs.findOne({ taskId: agentResultTaskId('img-1') })
    stored.deleted = true
    stored.deletedAt = new Date()
    await stored.save()
    const again = await recordAgentResults('project-a', [{ ...sampleItem, url: 'https://cdn.example/c.png' }])
    assert.deepEqual([...again.importedIds], ['img-1'])
    assert.equal(again.jobs.length, 0)
    assert.equal(await Jobs.countDocuments({}), 1)
    const tombstone = await Jobs.findOne({ taskId: agentResultTaskId('img-1') })
    assert.equal(tombstone.deleted, true)
    assert.deepEqual(tombstone.resultUrls, ['https://cdn.example/a.png'])
  })
})

test('queue-owned agent jobs keep their backend snapshot on reimport', async () => {
  await withDb(async (Jobs) => {
    const { recordAgentResults, agentResultTaskId } = loadAgentJobs(Jobs)
    await Jobs.create({
      projectId: 'project-a',
      provider: 'ark-image',
      model: 'seedream/5-pro-image-to-image',
      backendModelId: 'keep-me',
      protocolVersion: 'ark-images-sync-v1',
      providerMetadata: { ark: true },
      category: 'Image',
      task: 'Image to Image',
      input: { prompt: 'queued' },
      requestBody: { model: 'keep-me' },
      originalRequest: { source: 'agent', holdSlot: false, imageId: 'img-1' },
      taskId: agentResultTaskId('img-1'),
      state: 'success',
      resultUrls: ['https://cdn.example/queued.png'],
    })
    const result = await recordAgentResults('project-b', [sampleItem])
    const stored = await Jobs.findOne({ taskId: agentResultTaskId('img-1') })
    assert.equal(stored.projectId, 'project-b')
    assert.equal(stored.provider, 'ark-image')
    assert.equal(stored.backendModelId, 'keep-me')
    assert.deepEqual(stored.resultUrls, ['https://cdn.example/queued.png'])
    assert.equal(result.jobs.length, 1)
  })
})

test('a unique create race falls back to the winner instead of throwing', async () => {
  await withDb(async (Jobs) => {
    const { recordAgentResults, agentResultTaskId } = loadAgentJobs(Jobs)
    await recordAgentResults('project-a', [sampleItem])
    let missed = true
    const raced = loadAgentJobs(Jobs, {
      async findOne(filter, Real) {
        if (missed) {
          missed = false
          return null
        }
        return Real.findOne(filter)
      },
      async create() {
        throw uniqueError()
      },
    })
    const result = await raced.recordAgentResults('project-b', [{ ...sampleItem, url: 'https://cdn.example/race.png' }])
    assert.equal(await Jobs.countDocuments({}), 1)
    const stored = await Jobs.findOne({ taskId: agentResultTaskId('img-1') })
    assert.equal(stored.projectId, 'project-b')
    assert.deepEqual(stored.resultUrls, ['https://cdn.example/race.png'])
    assert.equal(result.jobs.length, 1)
  })
})

test('non-unique create errors are not treated as an upsert', async () => {
  await withDb(async (Jobs) => {
    const { recordAgentResults } = loadAgentJobs(Jobs, {
      async findOne() {
        return null
      },
      async create() {
        throw new Error('disk I/O error')
      },
    })
    await assert.rejects(() => recordAgentResults('project-a', [sampleItem]), /disk I\/O error/)
    assert.equal(await Jobs.countDocuments({}), 0)
  })
})

test('acquiring a deleted slot fails closed without restoring the job', async () => {
  await withDb(async (Jobs) => {
    const { agentResultTaskId } = loadAgentJobs(Jobs)
    await Jobs.create({
      taskId: agentResultTaskId('call-1'),
      projectId: 'project-a',
      deleted: true,
      deletedAt: new Date(),
      state: 'success',
      resultUrls: ['https://cdn.example/old.png'],
    })
    const { acquireAgentSlot } = loadAgentSlots(Jobs)
    await assert.rejects(() => acquireAgentSlot({
      sessionId: 'session-1',
      callId: 'call-1',
      projectId: 'project-a',
      modelId: 'seedream/5-pro-image-to-image',
      provider: 'ark-image',
      backendModelId: 'ark-image-backend',
      protocolVersion: 'ark-images-sync-v1',
      requestBody: { model: 'ark-image-backend' },
    }), /Generation job was deleted/)
    assert.equal(await Jobs.countDocuments({}), 1)
    const stored = await Jobs.findOne({ taskId: agentResultTaskId('call-1') })
    assert.equal(stored.deleted, true)
    assert.equal(stored.state, 'success')
  })
})

test('acquireAgentSlot unique races reuse the winner record', async () => {
  await withDb(async (Jobs) => {
    const { agentResultTaskId } = loadAgentJobs(Jobs)
    await Jobs.create({
      taskId: agentResultTaskId('call-2'),
      projectId: 'project-a',
      state: 'queued',
      originalRequest: { source: 'agent', holdSlot: false },
    })
    let missed = true
    const { acquireAgentSlot } = loadAgentSlots(Jobs, {
      async findOne(filter, Real) {
        if (missed) {
          missed = false
          return null
        }
        return Real.findOne(filter)
      },
      async create() {
        throw uniqueError()
      },
    })
    const slot = await acquireAgentSlot({
      sessionId: 'session-1',
      callId: 'call-2',
      projectId: 'project-a',
      modelId: 'seedream/5-pro-image-to-image',
      provider: 'ark-image',
      backendModelId: 'ark-image-backend',
      protocolVersion: 'ark-images-sync-v1',
      requestBody: { model: 'ark-image-backend' },
    })
    assert.equal(slot.state, 'queued')
    assert.equal(await Jobs.countDocuments({}), 1)
  })
})

test('toPublicApiError hides UNIQUE constraint text from clients', () => {
  const { toPublicApiError } = loadHttpError()
  const error = Object.assign(uniqueError(), { statusCode: 500 })
  const publicError = toPublicApiError(error, 'Could not save canvas results')
  assert.equal(publicError.statusMessage, 'Could not save canvas results')
  assert.equal(publicError.statusCode, 502)
  assert.doesNotMatch(String(publicError.message), /UNIQUE constraint failed/)
})
