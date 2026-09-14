import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('..', import.meta.url))

function loadPath(path, mocks = {}, globals = {}, cache = new Map()) {
  if (cache.has(path))
    return cache.get(path).exports
  const module = { exports: {} }
  cache.set(path, module)
  const code = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const localRequire = (id) => {
    if (id in mocks)
      return mocks[id]
    if (id.startsWith('.')) {
      const candidate = resolve(dirname(path), id.endsWith('.ts') ? id : `${id}.ts`)
      if (existsSync(candidate))
        return loadPath(candidate, mocks, globals, cache)
    }
    return require(id)
  }
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: localRequire,
    AbortController,
    AbortSignal,
    Buffer,
    DOMException,
    ReadableStream,
    Request,
    Response,
    TextDecoder,
    TextEncoder,
    URL,
    fetch,
    setTimeout,
    clearTimeout,
    ...globals,
  })
  return module.exports
}

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

const adapters = loadPath(resolve(root, 'server/ai/llm/adapters.ts'), {
  '../../utils/localMedia': {
    readStoredMedia: async (url, maxBytes, signal) => {
      signal?.throwIfAborted()
      assert.equal(maxBytes, 10 * 1024 * 1024)
      return url.includes('/media/')
        ? { bytes: Uint8Array.from([1, 2, 3]), mime: 'image/png' }
        : null
    },
  },
})

function snapshot(provider, overrides = {}) {
  return {
    provider,
    catalogModelId: `${provider}/fixture`,
    model: `${provider}-model`,
    apiKey: `${provider}-secret`,
    textReady: true,
    capabilities: adapters.PROVIDER_CONFIGS[provider].capabilities,
    settingsRevision: 'fixture',
    ...overrides,
  }
}

test('registry snapshots provider, model, key, readiness, and async context', async () => {
  const registry = loadPath(resolve(root, 'server/ai/llm/registry.ts'), {
    '../../utils/serviceSettings': { readServiceSettings() { throw new Error('explicit fixture expected') } },
    '../../utils/localMedia': { readStoredMedia: async () => null },
  })
  const settings = {
    selectedTextModel: 'ark/seed-2.1-pro',
    arkKey: 'saved-key',
    arkOk: true,
    arkCheckedAt: '2026-09-11T00:00:00.000Z',
    deepSeekKey: '',
    deepSeekOk: false,
    deepSeekCheckedAt: '',
    zaiKey: '',
    zaiOk: false,
    zaiCheckedAt: '',
    revision: 'snapshot-revision',
  }
  const captured = registry.captureLlmSnapshot(settings)
  settings.arkKey = 'changed-later'
  assert.equal(captured.provider, 'ark')
  assert.equal(captured.model, 'doubao-seed-2-1-pro-260628')
  assert.equal(captured.apiKey, 'saved-key')
  assert.equal(captured.textReady, true)
  await registry.withLlmSnapshot(captured, async () => {
    await Promise.resolve()
    assert.equal(registry.activeLlmSnapshot(), captured)
  })
})

test('agent secret gate follows selected official text readiness', () => {
  const fallback = snapshot('deepseek')
  const env = loadPath(resolve(root, 'server/agent/env.ts'), {
    '../ai/llm/registry': { captureLlmSnapshot: () => fallback },
  })
  assert.doesNotThrow(() => env.assertAgentSecrets({ ...fallback, apiKey: 'deepseek-key', textReady: true }))
  assert.throws(() => env.assertAgentSecrets({ ...fallback, apiKey: '', textReady: false }), /DeepSeek API key/)
  assert.throws(() => env.assertAgentSecrets({ ...fallback, apiKey: 'deepseek-key', textReady: false }), /Test the DeepSeek connection/)
})

const messages = [
  { role: 'system', content: 'System', historyId: 'private-history' },
  { role: 'user', content: 'Hello', internal: true },
]
const tools = [{ type: 'function', function: { name: 'paint', parameters: { type: 'object' } } }]

test('three official providers build isolated protocol bodies', async () => {
  const ark = await adapters.buildProviderRequest(snapshot('ark'), 'stream', {
    messages,
    tools,
    requiredTool: 'paint',
    onDelta() {},
  })
  const arkBody = JSON.parse(ark.init.body)
  assert.equal(ark.url, 'https://ark.cn-beijing.volces.com/api/v3/chat/completions')
  assert.equal(ark.init.headers['HTTP-Referer'], undefined)
  assert.deepEqual(plain(arkBody.tool_choice), { type: 'function', function: { name: 'paint' } })
  assert.equal(arkBody.parallel_tool_calls, false)
  assert.ok(!('reasoning' in arkBody))
  assert.ok(!('thinking' in arkBody))

  const deepSeek = await adapters.buildProviderRequest(snapshot('deepseek'), 'stream', {
    messages,
    tools,
    onDelta() {},
  })
  const deepSeekBody = JSON.parse(deepSeek.init.body)
  assert.equal(deepSeek.url, 'https://api.deepseek.com/chat/completions')
  assert.equal(deepSeekBody.tool_choice, 'auto')
  assert.ok(!('parallel_tool_calls' in deepSeekBody))
  assert.ok(!('reasoning' in deepSeekBody))
  assert.ok(!('thinking' in deepSeekBody))

  const zai = await adapters.buildProviderRequest(snapshot('zai'), 'stream', {
    messages,
    tools,
    onDelta() {},
  })
  const zaiBody = JSON.parse(zai.init.body)
  assert.equal(zai.url, 'https://api.z.ai/api/paas/v4/chat/completions')
  assert.deepEqual(plain(zaiBody.thinking), { type: 'enabled' })
  assert.equal(zaiBody.reasoning_effort, 'high')
  assert.ok(!('reasoning' in zaiBody))

  const zaiComplete = await adapters.buildProviderRequest(snapshot('zai'), 'complete', {
    messages,
    maxTokens: 8,
  })
  assert.equal(JSON.parse(zaiComplete.init.body).reasoning_effort, 'low')
})

test('official vision providers inline local media and preserve remote URLs', async () => {
  for (const provider of ['ark', 'deepseek']) {
    const local = await adapters.buildProviderRequest(snapshot(provider), 'complete', {
      messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'http://localhost:3001/media/local.png' } }] }],
    })
    assert.equal(JSON.parse(local.init.body).messages[0].content[0].image_url.url, 'data:image/png;base64,AQID')
    const remote = await adapters.buildProviderRequest(snapshot(provider), 'complete', {
      messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://cdn.example/image.png' } }] }],
    })
    assert.equal(JSON.parse(remote.init.body).messages[0].content[0].image_url.url, 'https://cdn.example/image.png')
  }
})

test('GLM rejects image_url before any request is sent', async () => {
  await assert.rejects(
    adapters.buildProviderRequest(snapshot('zai'), 'complete', {
      messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://cdn.example/image.png' } }] }],
    }),
    /does not support image_url/,
  )
})

const sse = loadPath(resolve(root, 'server/ai/llm/sse.ts'))

function fragmentedResponse(source, cuts) {
  const bytes = new TextEncoder().encode(source)
  let offset = 0
  return new Response(new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close()
        return
      }
      const size = cuts.shift() || bytes.length
      controller.enqueue(bytes.slice(offset, offset + size))
      offset += size
    },
  }))
}

test('SSE normalizes reasoning and fragmented tool arguments', async () => {
  const source = [
    'data: {"choices":[{"delta":{"reasoning_content":"plan "},"finish_reason":null}]}',
    'data: {"choices":[{"delta":{"reasoning":"more","tool_calls":[{"index":0,"id":"call-1","function":{"name":"paint","arguments":"{\\"prompt\\":"}}]},"finish_reason":null}]}',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"lime\\"}"}}]},"finish_reason":"tool_calls"}]}',
    'data: [DONE]',
    '',
  ].join('\n\n')
  const deltas = []
  await sse.consumeChatCompletionSse({
    response: fragmentedResponse(source, [1, 2, 5, 3, 17, 4, 9]),
    providerName: 'Fixture',
    onDelta: delta => deltas.push(plain(delta)),
  })
  assert.equal(deltas[0].reasoning, 'plan ')
  assert.equal(deltas[1].reasoning, 'more')
  const parts = deltas.flatMap(delta => delta.toolCalls || [])
  assert.equal(parts.map(part => part.arguments || '').join(''), '{"prompt":"lime"}')

  const llm = loadPath(resolve(root, 'server/agent/llm.ts'), {
    '../ai/llm/registry': { completeText() {}, streamChat() {} },
  })
  const calls = llm.assembleToolCalls(parts)
  assert.equal(calls[0].id, 'call-1')
  assert.equal(calls[0].function.name, 'paint')
  assert.equal(calls[0].function.arguments, '{"prompt":"lime"}')
})

test('SSE reports provider errors, non-2xx, empty streams, and aborts', async () => {
  await assert.rejects(sse.consumeChatCompletionSse({
    response: new Response('denied', { status: 401 }),
    providerName: 'Fixture',
    onDelta() {},
  }), /denied/)
  await assert.rejects(sse.consumeChatCompletionSse({
    response: new Response('data: {"error":{"message":"provider exploded"}}\n\n'),
    providerName: 'Fixture',
    onDelta() {},
  }), /provider exploded/)
  await assert.rejects(sse.consumeChatCompletionSse({
    response: new Response(null),
    providerName: 'Fixture',
    onDelta() {},
  }), /empty stream/)

  let cancelled = false
  const controller = new AbortController()
  const pending = sse.consumeChatCompletionSse({
    response: new Response(new ReadableStream({
      cancel() {
        cancelled = true
      },
    })),
    providerName: 'Fixture',
    signal: controller.signal,
    onDelta() {},
  })
  controller.abort()
  await assert.rejects(pending, error => error?.name === 'AbortError')
  assert.equal(cancelled, true)
})
