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

const localMediaMock = {
  isStoredMediaUrl: (url) => {
    try {
      const parsed = new URL(url, 'http://localhost:3001')
      return parsed.pathname.startsWith('/media/') && (
        url.startsWith('/media/')
        || ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
      )
    }
    catch {
      return false
    }
  },
  readStoredMedia: async (url, maxBytes, signal) => {
    signal?.throwIfAborted()
    assert.equal(maxBytes, 10 * 1024 * 1024)
    return url.includes('/media/')
      ? { bytes: Uint8Array.from([1, 2, 3]), mime: 'image/png' }
      : null
  },
}

function llmMocks(originUrls = new Map()) {
  return {
    '../../utils/localMedia': localMediaMock,
    '../../utils/publicMediaOrigin': {
      resolvePublicOriginUrls: async (sources) => {
        const resolved = new Map()
        for (const source of sources) {
          const origin = originUrls.get(source) || originUrls.get(source.replace(/^https?:\/\/localhost:3001/i, ''))
          if (origin)
            resolved.set(source, origin)
        }
        return resolved
      },
    },
  }
}

function loadAdapters(originUrls = new Map()) {
  return loadPath(resolve(root, 'server/ai/llm/adapters.ts'), llmMocks(originUrls))
}

const adapters = loadAdapters()

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
    ...llmMocks(),
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

  const agnes30 = registry.captureLlmSnapshot({
    ...settings,
    selectedTextModel: 'agnes/agnes-3.0-flash',
    agnesKey: 'agnes-key',
    agnesOk: true,
    agnesCheckedAt: '2026-09-19T00:00:00.000Z',
  })
  assert.equal(agnes30.provider, 'agnes')
  assert.equal(agnes30.catalogModelId, 'agnes/agnes-3.0-flash')
  assert.equal(agnes30.model, 'agnes-3.0-flash')

  const agnes25 = registry.captureLlmSnapshot({
    ...settings,
    selectedTextModel: 'agnes/agnes-2.5-flash',
    agnesKey: 'agnes-key',
    agnesOk: true,
    agnesCheckedAt: '2026-09-19T00:00:00.000Z',
  })
  assert.equal(agnes25.catalogModelId, 'agnes/agnes-2.5-flash')
  assert.equal(agnes25.model, 'agnes-2.5-flash')
})

test('agent secret gate follows selected official text readiness', () => {
  const fallback = snapshot('deepseek')
  const env = loadPath(resolve(root, 'server/agent/env.ts'), {
    '../ai/llm/registry': { captureLlmSnapshot: () => fallback },
  })
  assert.doesNotThrow(() => env.assertAgentSecrets({ ...fallback, apiKey: 'deepseek-key', textReady: true }))
  assert.throws(() => env.assertAgentSecrets({ ...fallback, apiKey: '', textReady: false }), /DeepSeek API key/)
  assert.throws(() => env.assertAgentSecrets({ ...fallback, apiKey: 'deepseek-key', textReady: false }), /Test the DeepSeek connection/)

  const agnes = snapshot('agnes')
  assert.throws(() => env.assertAgentSecrets({ ...agnes, apiKey: '', textReady: false }), /Agnes API key/)
  assert.throws(() => env.assertAgentSecrets({ ...agnes, apiKey: 'agnes-key', textReady: false }), /Test the Agnes connection/)
})

const messages = [
  { role: 'system', content: 'System', historyId: 'private-history' },
  { role: 'user', content: 'Hello', internal: true },
]
const tools = [{ type: 'function', function: { name: 'paint', parameters: { type: 'object' } } }]

test('four official providers build isolated protocol bodies', async () => {
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

  const agnes = await adapters.buildProviderRequest(snapshot('agnes'), 'stream', {
    messages,
    tools,
    onDelta() {},
  })
  const agnesBody = JSON.parse(agnes.init.body)
  assert.equal(agnes.url, 'https://apihub.agnes-ai.com/v1/chat/completions')
  assert.equal(agnes.init.headers.Authorization, 'Bearer agnes-secret')
  assert.equal(agnesBody.model, 'agnes-model')
  assert.equal(agnesBody.tool_choice, 'auto')
  assert.deepEqual(plain(agnesBody.chat_template_kwargs), { enable_thinking: true })
  assert.ok(!('max_tokens' in agnesBody))
  assert.ok(!('thinking' in agnesBody))
  assert.ok(!('budget_tokens' in agnesBody))
  assert.ok(!('parallel_tool_calls' in agnesBody))

  const agnesComplete = await adapters.buildProviderRequest(snapshot('agnes'), 'complete', {
    messages,
    maxTokens: 8,
  })
  const agnesCompleteBody = JSON.parse(agnesComplete.init.body)
  assert.equal(agnesCompleteBody.max_tokens, 8)
  assert.deepEqual(plain(agnesCompleteBody.chat_template_kwargs), { enable_thinking: false })

  const agnes30 = await adapters.buildProviderRequest(snapshot('agnes', {
    catalogModelId: 'agnes/agnes-3.0-flash',
    model: 'agnes-3.0-flash',
  }), 'stream', {
    messages,
    tools,
    onDelta() {},
  })
  const agnes30Body = JSON.parse(agnes30.init.body)
  assert.equal(agnes30.url, 'https://apihub.agnes-ai.com/v1/chat/completions')
  assert.equal(agnes30Body.model, 'agnes-3.0-flash')
  assert.deepEqual(plain(agnes30Body.chat_template_kwargs), { enable_thinking: true })
  assert.ok(!('max_tokens' in agnes30Body))
  assert.ok(!('thinking' in agnes30Body))
  assert.ok(!('budget_tokens' in agnes30Body))
})

test('a required tool never ships alongside Z.ai thinking, and withheld tools drop the tool block', async () => {
  const forced = await adapters.buildProviderRequest(snapshot('zai'), 'stream', {
    messages,
    tools,
    requiredTool: 'paint',
    onDelta() {},
  })
  const forcedBody = JSON.parse(forced.init.body)
  assert.deepEqual(plain(forcedBody.tool_choice), { type: 'function', function: { name: 'paint' } })
  assert.deepEqual(plain(forcedBody.thinking), { type: 'disabled' })

  const agnesForced = await adapters.buildProviderRequest(snapshot('agnes'), 'stream', {
    messages,
    tools,
    requiredTool: 'paint',
    onDelta() {},
  })
  const agnesForcedBody = JSON.parse(agnesForced.init.body)
  assert.deepEqual(plain(agnesForcedBody.tool_choice), { type: 'function', function: { name: 'paint' } })
  assert.deepEqual(plain(agnesForcedBody.chat_template_kwargs), { enable_thinking: true })

  for (const provider of ['ark', 'deepseek', 'zai', 'agnes']) {
    const disabled = await adapters.buildProviderRequest(snapshot(provider), 'stream', {
      messages,
      tools,
      disableTools: true,
      onDelta() {},
    })
    const disabledBody = JSON.parse(disabled.init.body)
    assert.ok(!('tools' in disabledBody), `${provider} must not send tools`)
    assert.ok(!('tool_choice' in disabledBody), `${provider} must not force a tool choice`)
    assert.ok(!('parallel_tool_calls' in disabledBody))
  }

  const stillThinking = await adapters.buildProviderRequest(snapshot('zai'), 'stream', {
    messages,
    tools,
    disableTools: true,
    onDelta() {},
  })
  assert.deepEqual(plain(JSON.parse(stillThinking.init.body).thinking), { type: 'enabled' })

  const missingForced = await adapters.buildProviderRequest(snapshot('agnes'), 'stream', {
    messages,
    tools,
    requiredTool: 'generate_image',
    onDelta() {},
  })
  const missingBody = JSON.parse(missingForced.init.body)
  assert.equal(missingBody.tool_choice, 'auto')
  assert.deepEqual(plain(missingBody.tools).map(tool => tool.function.name), ['paint'])
})

test('provider failures reach chat as readable text instead of a JSON envelope', () => {
  const sse = loadPath(resolve(root, 'server/ai/llm/sse.ts'))
  assert.equal(
    sse.providerFailureMessage('{"error":{"message":"Thinking mode does not support this tool_choice","code":"invalid_request_error"}}', 'Z.ai', 400),
    'Z.ai: Thinking mode does not support this tool_choice',
  )
  assert.equal(sse.providerFailureMessage('{"error":"quota exceeded"}', 'Ark', 429), 'Ark: quota exceeded')
  assert.equal(sse.providerFailureMessage('{"detail":{}}', 'Ark', 500), 'Ark: {"detail":{}}')
  assert.equal(sse.providerFailureMessage('  ', 'DeepSeek', 502), 'DeepSeek request failed (502).')
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

test('Agnes preserves public images and rejects local or non-public URLs before fetch', async () => {
  const publicImage = await adapters.buildProviderRequest(snapshot('agnes'), 'complete', {
    messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://cdn.example/image.png' } }] }],
  })
  assert.equal(JSON.parse(publicImage.init.body).messages[0].content[0].image_url.url, 'https://cdn.example/image.png')

  const mixed = await adapters.buildProviderRequest(snapshot('agnes'), 'complete', {
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'Edit the coat.' },
        { type: 'image_url', image_url: { url: '/media/local.png' } },
        { type: 'image_url', image_url: { url: 'https://cdn.example/keep.png' } },
      ],
    }],
  })
  assert.deepEqual(JSON.parse(mixed.init.body).messages[0].content, [
    { type: 'text', text: 'Edit the coat.' },
    { type: 'image_url', image_url: { url: 'https://cdn.example/keep.png' } },
  ])

  const rejected = [
    'https://localhost/image.png',
    'http://127.8.9.10/image.png',
    'http://[::1]/image.png',
    'https://preview.localhost/image.png',
    'https://user:pass@cdn.example/image.png',
    'data:image/png;base64,AQID',
    'blob:https://app.example/id',
    'file:///tmp/image.png',
    'relative/image.png',
  ]
  for (const url of rejected) {
    await assert.rejects(
      adapters.buildProviderRequest(snapshot('agnes'), 'complete', {
        messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url } }] }],
      }),
      (error) => {
        assert.match(error.message, /Agnes/)
        assert.match(error.message, /Seed|DeepSeek/)
        assert.match(error.message, /public HTTP\(S\) URL/)
        assert.ok(!error.message.includes('/tmp/image.png'))
        return true
      },
    )
  }
})

test('Agnes omits local stills and signed TOS URLs instead of asking its cluster to download them', async () => {
  const local = '/media/generator/results/job_1/0.png'
  const remapped = loadAdapters(new Map([
    [local, 'https://bucket.tos-cn-beijing.volces.com/out.png?X-Tos-Date=20260101&X-Tos-Expires=3600'],
  ]))
  const omittedLocal = await remapped.buildProviderRequest(snapshot('agnes'), 'complete', {
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'Inspect this still.' },
        { type: 'image_url', image_url: { url: local } },
      ],
    }],
  })
  assert.deepEqual(JSON.parse(omittedLocal.init.body).messages[0].content, [
    { type: 'text', text: 'Inspect this still.' },
  ])

  const tos = 'https://bucket.tos-cn-beijing.volces.com/still.png?X-Tos-Date=20260101&X-Tos-Expires=3600'
  const omittedTos = await adapters.buildProviderRequest(snapshot('agnes'), 'complete', {
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'Use the listed URL.' },
        { type: 'image_url', image_url: { url: tos } },
      ],
    }],
  })
  assert.deepEqual(JSON.parse(omittedTos.init.body).messages[0].content, [
    { type: 'text', text: 'Use the listed URL.' },
  ])

  for (const provider of ['ark', 'deepseek']) {
    const inlined = await remapped.buildProviderRequest(snapshot(provider), 'complete', {
      messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: local } }] }],
    })
    assert.equal(JSON.parse(inlined.init.body).messages[0].content[0].image_url.url, 'data:image/png;base64,AQID')
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

test('recorded Agnes SSE fixtures keep reasoning separate and assemble the forced tool', async () => {
  const thinkingDeltas = []
  await sse.consumeChatCompletionSse({
    response: new Response(readFileSync(resolve(root, 'scripts/fixtures/agnes-25-flash/stream-thinking.sse'))),
    providerName: 'Agnes',
    onDelta: delta => thinkingDeltas.push(plain(delta)),
  })
  assert.ok(thinkingDeltas.some(delta => delta.reasoning))
  assert.equal(thinkingDeltas.map(delta => delta.content || '').join('').trim(), 'READY')

  const toolDeltas = []
  await sse.consumeChatCompletionSse({
    response: new Response(readFileSync(resolve(root, 'scripts/fixtures/agnes-25-flash/stream-forced-tool.txt'))),
    providerName: 'Agnes',
    onDelta: delta => toolDeltas.push(plain(delta)),
  })
  const parts = toolDeltas.flatMap(delta => delta.toolCalls || [])
  const llm = loadPath(resolve(root, 'server/agent/llm.ts'), {
    '../ai/llm/registry': { completeText() {}, streamChat() {} },
  })
  const calls = llm.assembleToolCalls(parts)
  assert.equal(calls[0].function.name, 'get_probe_value')
  assert.deepEqual(JSON.parse(calls[0].function.arguments), { value: 'probe' })
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
