import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { generationConcurrency } from '../server/utils/generationConcurrency.ts'
import { closeDatabase, configureDatabase, defineCollection } from '../server/utils/sqlite.ts'

test('concurrent dispatch uses one local queue and one global generation limit', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'polox-local-queue-'))
  configureDatabase(join(dir, 'queue.sqlite'))
  try {
    const GenerationJob = defineCollection('generation_jobs', () => ({
      state: 'queued',
      deleted: false,
      providerTaskId: '',
    }), [{ fields: ['taskId'] }])
    for (let i = 0; i < 12; i++)
      await GenerationJob.create({ taskId: `agent_${i}`, originalRequest: { source: 'agent', holdSlot: true } })
    const source = readFileSync(new URL('../server/utils/generationQueue.ts', import.meta.url), 'utf8').replace(/^import .*\n/gm, '')
    const context = vm.createContext({
      exports: {},
      console,
      GenerationJob,
      generationConcurrency,
      GENERATION_ACTIVE_STATES: ['waiting', 'queuing', 'generating'],
      readErrorMessage: error => error.message,
      isProviderStarted: () => false,
      startMediaBackend: () => { throw new Error('Test must not call the provider') },
    })
    vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context)
    await Promise.all(Array.from({ length: 12 }, () => context.exports.dispatchQueuedJobs()))
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(await GenerationJob.countDocuments({ state: 'generating' }), 10)
    assert.equal(await GenerationJob.countDocuments({ state: 'queued' }), 2)
    await GenerationJob.updateOne({ taskId: 'agent_0' }, { $set: { state: 'success' } })
    await context.exports.dispatchQueuedJobs()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(await GenerationJob.countDocuments({ state: 'generating' }), 10)
    assert.equal(await GenerationJob.countDocuments({ state: 'queued' }), 1)
  }
  finally {
    closeDatabase()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('separate queue module instances atomically claim one provider start', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'polox-provider-start-'))
  configureDatabase(join(dir, 'queue.sqlite'))
  try {
    const GenerationJob = defineCollection('generation_jobs', () => ({
      state: 'waiting',
      deleted: false,
      providerTaskId: '',
      providerMetadata: {},
      requestBody: {},
      originalRequest: {},
      resultAssets: [],
      sourceUrls: [],
      resultUrls: [],
      failCode: '',
      failMsg: '',
    }), [{ fields: ['taskId'] }])
    await GenerationJob.create({ taskId: 'agent_hmr_race' })

    let starts = 0
    let release
    const pending = new Promise((resolve) => { release = resolve })
    function loadQueueInstance() {
      const source = readFileSync(new URL('../server/utils/generationQueue.ts', import.meta.url), 'utf8').replace(/^import .*\n/gm, '')
      const context = vm.createContext({
        exports: {},
        console,
        GenerationJob,
        generationConcurrency: async () => 1,
        GENERATION_ACTIVE_STATES: ['waiting', 'queuing', 'generating'],
        readErrorMessage: error => error.message,
        isProviderStarted: job => Boolean(job.providerTaskId),
        startMediaBackend: async () => {
          starts++
          return pending
        },
        mergeSourceUrls: () => {},
        isStoredMediaUrl: () => false,
      })
      vm.runInContext(ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText, context)
      return context.exports
    }

    const firstQueue = loadQueueInstance()
    const secondQueue = loadQueueInstance()
    const [firstSnapshot, secondSnapshot] = await Promise.all([
      GenerationJob.findOne({ taskId: 'agent_hmr_race' }),
      GenerationJob.findOne({ taskId: 'agent_hmr_race' }),
    ])
    assert.ok(firstSnapshot)
    assert.ok(secondSnapshot)

    await Promise.all([
      firstQueue.startPendingProviderJob(firstSnapshot),
      secondQueue.startPendingProviderJob(secondSnapshot),
    ])
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(starts, 1)
    assert.equal((await GenerationJob.findOne({ taskId: 'agent_hmr_race' })).state, 'generating')

    release({ status: 'completed', providerTaskId: '', providerMetadata: {}, resultUrls: [] })
    for (let i = 0; i < 10; i++) {
      if ((await GenerationJob.findOne({ taskId: 'agent_hmr_race' })).state === 'success')
        break
      await new Promise(resolve => setImmediate(resolve))
    }
    assert.equal((await GenerationJob.findOne({ taskId: 'agent_hmr_race' })).state, 'success')
  }
  finally {
    closeDatabase()
    rmSync(dir, { recursive: true, force: true })
  }
})
