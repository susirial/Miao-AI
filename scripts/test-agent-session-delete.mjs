import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const source = ts.createSourceFile(
  'session.ts',
  readFileSync(new URL('../server/agent/session.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
)

function extract(name) {
  const node = source.statements.find(statement =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === name,
  )
  assert.ok(node, `${name} must exist`)
  return ts.transpile(node.getText(source), { target: ts.ScriptTarget.ES2022 }).replace(/^export\s+/, '')
}

test('session image deletion blocks active work and atomically replaces persisted images', async () => {
  const stored = []
  const disk = []
  const session = {
    id: 'session',
    projectId: 'project',
    title: 'Agent',
    quality: 'hobby',
    confirmPolicy: 'always',
    messages: [],
    images: [
      { id: 'shot', status: 'generating' },
      { id: 'shot_1', status: 'fail' },
      { id: 'keep', status: 'success' },
    ],
    pendingConfirmation: null,
    pendingChoice: null,
    updatedAt: 1,
  }
  const state = {
    loadSession: async () => session,
    refreshSessionPrompt: () => {},
    sessions: new Map(),
    persistDisk: value => disk.push(structuredClone(value)),
    putStoredSession: async value => stored.push(structuredClone(value)),
  }
  vm.createContext(state)
  vm.runInContext(extract('removeSessionImages'), state)

  const blocked = await state.removeSessionImages('session', ['shot'], { includeDerived: true })
  assert.equal(blocked.blocked, true)
  assert.deepEqual(session.images.map(image => image.id), ['shot', 'shot_1', 'keep'])
  assert.equal(stored.length, 0)

  const removed = await state.removeSessionImages('session', ['shot'], {
    allowGenerating: true,
    includeDerived: true,
  })
  assert.equal(JSON.stringify(removed.removedIds), JSON.stringify(['shot', 'shot_1']))
  assert.deepEqual(session.images.map(image => image.id), ['keep'])
  assert.equal(disk.length, 1)
  assert.equal(stored.length, 1)
  assert.equal(stored[0].replaceImages, true)
  assert.deepEqual(stored[0].images.map(image => image.id), ['keep'])
})

test('failed job delete removes the linked runtime image even without sessionId', async () => {
  const removed = []
  const job = {
    taskId: 'agent_shot',
    originalRequest: { imageId: 'shot' },
    state: 'fail',
    deleted: false,
    save: async () => {},
  }
  const file = readFileSync(new URL('../server/api/ai/jobs/[taskId].delete.ts', import.meta.url), 'utf8')
  const js = ts.transpileModule(file, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} }
  vm.runInNewContext(js, {
    module,
    exports: module.exports,
    console,
    defineEventHandler: fn => fn,
    getRouterParam: () => 'agent_shot',
    createError: value => Object.assign(new Error(value.statusMessage), value),
    require: (id) => {
      if (id.includes('models/generationJob')) {
        return {
          GenerationJob: {
            findOne: async () => job,
            findOneAndUpdate: async () => job,
          },
        }
      }
      if (id.includes('generationJobs'))
        return { generationProvider: () => 'ark-image' }
      if (id.includes('generationQueue'))
        return { dispatchQueuedJobs: async () => {} }
      if (id.includes('shared/types/generation')) {
        return {
          GENERATION_ACTIVE_STATES: ['waiting', 'queuing', 'generating', 'moderating', 'archiving'],
          isGenerationActive: () => false,
        }
      }
      if (id.includes('agent/session')) {
        return {
          removeSessionImages: async (sessionId, ids) => {
            removed.push({ sessionId, ids })
            return { removedIds: ids, blocked: false }
          },
        }
      }
      if (id.includes('agentSessionRuntime'))
        return { findAgentSessionIdForImage: async () => 'session-from-runtime' }
      if (id.includes('registry'))
        return { removeMediaBackend: async () => {} }
      if (id.includes('sqlite'))
        return { connectDatabase: async () => {} }
      return {}
    },
  })
  await module.exports.default({})
  assert.equal(JSON.stringify(removed), JSON.stringify([{ sessionId: 'session-from-runtime', ids: ['shot'] }]))
})
