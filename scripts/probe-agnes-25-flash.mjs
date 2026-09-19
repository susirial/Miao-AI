import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const root = fileURLToPath(new URL('..', import.meta.url))
const outputDir = resolve(root, 'scripts/fixtures/agnes-25-flash')
const endpoint = 'https://apihub.agnes-ai.com/v1/chat/completions'
const model = 'agnes-2.5-flash'
const require = createRequire(import.meta.url)

function loadPath(path, mocks = {}, cache = new Map()) {
  if (cache.has(path))
    return cache.get(path).exports
  const module = { exports: {} }
  cache.set(path, module)
  const code = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const localRequire = (id) => {
    if (id in mocks)
      return mocks[id]
    if (id.startsWith('.')) {
      const candidate = resolve(dirname(path), id.endsWith('.ts') ? id : `${id}.ts`)
      if (existsSync(candidate))
        return loadPath(candidate, mocks, cache)
    }
    return require(id)
  }
  vm.runInNewContext(code, { module, exports: module.exports, require: localRequire })
  return module.exports
}

const dataRoot = resolve(process.env.MIAO_DATA_DIR?.trim() || '.data')
const database = new DatabaseSync(resolve(dataRoot, 'miao.sqlite'))
const { readServiceSettings } = loadPath(resolve(root, 'server/utils/serviceSettings.ts'), {
  './sqlite': { connectDatabase: () => database },
})
const { agnesKey } = readServiceSettings()

if (!agnesKey)
  throw new Error('Configure an Agnes API key in Service Connection before probing.')

function sanitize(text) {
  return text
    .replaceAll(agnesKey, '[REDACTED]')
    .replace(/("(?:id|request_id|tool_call_id)"\s*:\s*")[^"]+(")/gi, '$1[ID]$2')
    .replace(/("created"\s*:\s*)\d+/g, '$1"[CREATED]"')
}

async function request(name, body, filename) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${agnesKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, ...body }),
  })
  const text = await response.text()
  const sanitized = sanitize(text)
  await writeFile(resolve(outputDir, filename), filename.endsWith('.json')
    ? `${JSON.stringify(JSON.parse(sanitized), null, 2)}\n`
    : sanitized)
  return {
    name,
    status: response.status,
    contentType: response.headers.get('content-type') || '',
    body,
    text: sanitized,
  }
}

function parseJson(probe) {
  try {
    const payload = JSON.parse(probe.text)
    return {
      content: payload.choices?.[0]?.message?.content ?? '',
      finishReason: payload.choices?.[0]?.finish_reason ?? null,
      error: payload.error ?? null,
    }
  }
  catch {
    return { content: '', finishReason: null, error: 'invalid JSON' }
  }
}

function parseSse(probe) {
  const deltaKeys = new Set()
  const reasoningFields = new Set()
  let content = ''
  let finishReason = null
  const toolNames = new Set()
  for (const line of probe.text.split(/\r?\n/)) {
    if (!line.startsWith('data: '))
      continue
    const data = line.slice(6).trim()
    if (!data || data === '[DONE]')
      continue
    try {
      const payload = JSON.parse(data)
      const choice = payload.choices?.[0]
      const delta = choice?.delta || {}
      for (const key of Object.keys(delta))
        deltaKeys.add(key)
      for (const key of ['reasoning', 'reasoning_content', 'thinking', 'thinking_content']) {
        if (typeof delta[key] === 'string' && delta[key]) {
          reasoningFields.add(key)
        }
      }
      if (typeof delta.content === 'string')
        content += delta.content
      for (const call of delta.tool_calls || []) {
        if (call?.function?.name)
          toolNames.add(call.function.name)
      }
      finishReason = choice?.finish_reason ?? finishReason
    }
    catch {
      // Preserve malformed events in the fixture; the report only summarizes valid JSON events.
    }
  }
  return {
    deltaKeys: [...deltaKeys].sort(),
    reasoningFields: [...reasoningFields].sort(),
    content,
    finishReason,
    toolNames: [...toolNames].sort(),
    taggedThinking: /<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/i.test(content),
  }
}

await mkdir(outputDir, { recursive: true })

const probes = []
probes.push(await request('nonstream-basic', {
  messages: [{ role: 'user', content: 'Reply with exactly OK.' }],
  max_tokens: 8,
  stream: false,
}, 'nonstream-basic.json'))
probes.push(await request('nonstream-thinking-disabled', {
  messages: [{ role: 'user', content: 'Explain tool use in one short sentence.' }],
  max_tokens: 32,
  stream: false,
  chat_template_kwargs: { enable_thinking: false },
}, 'nonstream-thinking-disabled.json'))
probes.push(await request('stream-thinking', {
  messages: [{ role: 'user', content: 'Think briefly, then answer with exactly READY.' }],
  stream: true,
  chat_template_kwargs: { enable_thinking: true },
}, 'stream-thinking.sse'))
probes.push(await request('stream-forced-tool', {
  messages: [{ role: 'user', content: 'Call get_probe_value with value "probe". Do not answer directly.' }],
  stream: true,
  chat_template_kwargs: { enable_thinking: true },
  tools: [{
    type: 'function',
    function: {
      name: 'get_probe_value',
      description: 'Return a fixed probe value.',
      parameters: {
        type: 'object',
        properties: { value: { type: 'string' } },
        required: ['value'],
      },
    },
  }],
  tool_choice: { type: 'function', function: { name: 'get_probe_value' } },
}, 'stream-forced-tool.txt'))

const basic = parseJson(probes[0])
const disabled = parseJson(probes[1])
const thinking = parseSse(probes[2])
const forced = parseSse(probes[3])
const explicitFalseWorks = probes[1].status >= 200 && probes[1].status < 300 && Boolean(disabled.content)
const thinkingSeparates = probes[2].status >= 200
  && Boolean(thinking.content)
  && (thinking.reasoningFields.length > 0 || thinking.taggedThinking)
const forcedToolWorks = probes[3].status >= 200
  && forced.toolNames.includes('get_probe_value')

const report = `# Agnes 2.5 Flash Protocol Probe

- Date: ${new Date().toISOString().slice(0, 10)}
- Model: \`${model}\`
- Endpoint: \`${endpoint}\`
- Key source: local SQLite service settings (value never logged)

## Observations

| Request | HTTP | Content-Type | Finish reason | Content present | Reasoning fields | Tool calls |
| --- | ---: | --- | --- | --- | --- | --- |
| Non-stream basic | ${probes[0].status} | ${probes[0].contentType} | ${basic.finishReason ?? ''} | ${Boolean(basic.content)} | n/a | n/a |
| Non-stream Thinking false | ${probes[1].status} | ${probes[1].contentType} | ${disabled.finishReason ?? ''} | ${Boolean(disabled.content)} | n/a | n/a |
| Stream Thinking true | ${probes[2].status} | ${probes[2].contentType} | ${thinking.finishReason ?? ''} | ${Boolean(thinking.content)} | ${thinking.reasoningFields.join(', ') || 'none'} | ${thinking.toolNames.join(', ') || 'none'} |
| Stream Thinking + forced tool | ${probes[3].status} | ${probes[3].contentType} | ${forced.finishReason ?? ''} | ${Boolean(forced.content)} | ${forced.reasoningFields.join(', ') || 'none'} | ${forced.toolNames.join(', ') || 'none'} |

Observed stream delta keys:

- Thinking stream: ${thinking.deltaKeys.join(', ') || 'none'}
- Forced-tool stream: ${forced.deltaKeys.join(', ') || 'none'}

## Frozen Decisions

- Complete and connection-test Thinking: ${explicitFalseWorks ? 'send `chat_template_kwargs.enable_thinking: false`' : 'omit the extension field; the explicit false request was not usable'}.
- Ordinary stream Thinking: ${thinkingSeparates ? 'enable; reasoning and final content are separable' : 'disable; the response did not prove reliable separation'}.
- Required-tool stream Thinking: ${forcedToolWorks ? 'enable; the forced tool returned a valid tool call' : 'disable; the forced-tool combination was not proven safe'}.
- SSE parser aliases: ${thinking.reasoningFields.length ? thinking.reasoningFields.map(field => `\`delta.${field}\``).join(', ') : 'no new independent reasoning field observed'}.

The fixtures contain sanitized response bodies only. Authorization headers, API keys, dynamic IDs, timestamps, and user project data are not stored.
`

await writeFile(resolve(outputDir, 'probe-report.md'), report)
database.close()
console.log('Agnes protocol probe completed. Review scripts/fixtures/agnes-25-flash/probe-report.md.')
