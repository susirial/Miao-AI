import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { parse } from 'vue/compiler-sfc'

const file = readFileSync(new URL('../app/pages/projects/[id].vue', import.meta.url), 'utf8')
const source = ts.createSourceFile('page.ts', parse(file).descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true)
const canvasFile = readFileSync(new URL('../app/components/agent-lab/InfiniteCanvas.vue', import.meta.url), 'utf8')
const canvasSource = ts.createSourceFile('canvas.ts', parse(canvasFile).descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true)
function extract(name) {
  const node = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name)
  return ts.transpile(node.getText(source), { target: ts.ScriptTarget.ES2022 })
}
function extractCanvas(name) {
  const node = canvasSource.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name)
  return ts.transpile(node.getText(canvasSource), { target: ts.ScriptTarget.ES2022 })
}

test('terminal orphan images receive stable delete targets while active images stay protected', () => {
  const state = {}
  vm.createContext(state)
  vm.runInContext(extractCanvas('deleteTarget') + extractCanvas('canDeleteAsset'), state)
  const orphan = { taskId: 'agent_failed-image', imageId: 'failed-image', state: 'fail' }
  assert.equal(state.canDeleteAsset(orphan), true)
  assert.equal(JSON.stringify(state.deleteTarget(orphan)), JSON.stringify({
    taskId: 'agent_failed-image',
    imageId: 'failed-image',
  }))
  assert.equal(state.canDeleteAsset({ ...orphan, state: 'generating' }), false)
  assert.equal(state.canDeleteAsset({ taskId: 'job', state: 'fail' }), true)
  assert.match(canvasFile, /taskId: persistedId, imageId: item\.id/)
  assert.match(canvasFile, /asset\.state === 'fail' && canDeleteAsset\(asset\)/)
})

test('job 404 still clears matching session images', async () => {
  class FetchError extends Error {
    constructor(statusCode) {
      super('not found')
      this.statusCode = statusCode
    }
  }
  const removed = []
  const calls = []
  const state = {
    FetchError,
    agentSessionId: { value: '11111111-1111-4111-8111-111111111111' },
    items: { value: [] },
    images: { value: [{ id: 'shot', url: '' }] },
    total: { value: 1 },
    removeCanvasImages: async ids => removed.push(...ids),
    removeCanvasResult: async (taskId) => { removed.push(`result:${taskId}`) },
    $fetch: async (url, options) => {
      calls.push([url, options.method])
      if (String(url).includes('/api/ai/jobs/')) {
        const error = new FetchError(404)
        throw error
      }
    },
  }
  vm.createContext(state)
  vm.runInContext(extract('imageIdsForTarget') + extract('deleteCanvasResult'), state)
  await state.deleteCanvasResult({ taskId: 'agent_shot', imageId: 'shot' })
  assert.ok(calls.some(([url, method]) => method === 'DELETE' && String(url).includes('/api/ai/jobs/')))
  assert.deepEqual(removed, ['shot'])
})

test('bulk deletion deduplicates stable targets and retains only failures for retry', async () => {
  const deleted = []
  const state = {
    bulkAction: { value: null },
    bulkTaskIds: { value: [] },
    bulkDeleteTargets: { value: [] },
    bulkPending: { value: false },
    toast: { error: () => {} },
    loadJobs: async () => {},
    loadProjects: async () => {},
    deleteCanvasResult: async (target) => {
      deleted.push(target.taskId || `image:${target.imageId}`)
      if (target.imageId === 'orphan')
        throw new Error('network')
    },
  }
  vm.createContext(state)
  vm.runInContext(extract('deleteTargetKey') + extract('requestBulkDelete') + extract('confirmBulk'), state)
  state.requestBulkDelete([{ taskId: 'a' }, { imageId: 'orphan' }, { taskId: 'a' }])
  assert.deepEqual(deleted, [])
  await state.confirmBulk()
  assert.deepEqual(deleted, ['a', 'image:orphan'])
  assert.equal(JSON.stringify(state.bulkDeleteTargets.value), JSON.stringify([{ imageId: 'orphan' }]))
  assert.equal(state.bulkAction.value, 'delete')
  assert.equal(state.bulkPending.value, false)
  state.deleteCanvasResult = async target => deleted.push(`retry:${target.imageId}`)
  await state.confirmBulk()
  assert.equal(state.bulkAction.value, null)
  assert.deepEqual(deleted, ['a', 'image:orphan', 'retry:orphan'])
})
