import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('..', import.meta.url))

function load(file, mocks) {
  const code = ts.transpileModule(readFileSync(resolve(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} }
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: id => id in mocks ? mocks[id] : require(id),
  })
  return module.exports
}

function harness() {
  const calls = []
  const backend = provider => ({
    provider,
    protocolVersion: `${provider}-v1`,
    async start(job) { calls.push(['start', provider, job.provider]); return { status: 'pending', providerTaskId: `${provider}-task`, providerMetadata: {} } },
    async sync(job) { calls.push(['sync', provider, job.provider]); return job },
    async remove(job) { calls.push(['remove', provider, job.provider]) },
  })
  const registry = load('server/ai/media/registry.ts', {
    '../../utils/generationJobs': {
      generationProvider: job => ['ark-image', 'ark-video', 'local'].includes(job.provider) ? job.provider : undefined,
    },
    './arkImage': { arkImageBackend: backend('ark-image') },
    './arkVideo': { arkVideoBackend: backend('ark-video') },
  })
  return { registry, calls }
}

function job(provider) {
  return {
    provider,
    state: 'generating',
    failCode: '',
    failMsg: '',
    async save() { this.saved = true },
  }
}

test('registry routes image and video jobs only to Ark adapters', async () => {
  const { registry, calls } = harness()
  assert.equal((await registry.startMediaBackend(job('ark-image'))).providerTaskId, 'ark-image-task')
  await registry.syncMediaBackend(job('ark-video'))
  await registry.removeMediaBackend(job('ark-video'))
  assert.deepEqual(calls, [
    ['start', 'ark-image', 'ark-image'],
    ['sync', 'ark-video', 'ark-video'],
    ['remove', 'ark-video', 'ark-video'],
  ])
  assert.deepEqual(Object.keys(registry.MEDIA_BACKENDS).sort(), ['ark-image', 'ark-video', 'local'])
})

test('unknown or providerless jobs fail closed instead of selecting a backend', async () => {
  const { registry, calls } = harness()
  for (const provider of ['unknown', '', undefined]) {
    const value = job(provider)
    assert.equal(await registry.startMediaBackend(value), null)
    assert.equal(value.state, 'fail')
    assert.equal(value.failCode, 'backend_unavailable')
    assert.equal(value.saved, true)
  }
  assert.deepEqual(calls, [])
})
