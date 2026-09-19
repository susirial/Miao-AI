import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  assertValidToolTranscript,
  recoverableToolResultImages,
  removeOrphanToolMessages,
  runJobsThenAppendToolResults,
  trailingUnansweredToolCallIds,
} from '../server/agent/toolTranscript.ts'

function call(id, name = 'generate_image') {
  return {
    id,
    type: 'function',
    function: { name, arguments: '{}' },
  }
}

function image(id, kind = 'still', status = 'success') {
  return {
    id,
    kind,
    status,
    prompt: '',
    aspectRatio: 'auto',
    resolution: '',
    url: status === 'success' ? `https://example.com/${id}.png` : '',
    error: status === 'fail' ? 'failed' : '',
  }
}

test('orphan repair drops uploaded-image results and keeps a valid tool block', () => {
  const validAssistant = { role: 'assistant', content: null, tool_calls: [call('generation')] }
  const validTool = { role: 'tool', tool_call_id: 'generation', content: '{"ok":true}' }
  const messages = [
    { role: 'system', content: 'System' },
    { role: 'assistant', content: 'Here is the prompt.' },
    { role: 'tool', tool_call_id: 'upload-uuid', content: '{"ok":true}' },
    validAssistant,
    validTool,
    { role: 'tool', tool_call_id: 'generation', content: '{"duplicate":true}' },
    { role: 'user', content: 'Continue' },
  ]

  const repaired = removeOrphanToolMessages(messages)
  assert.equal(repaired.removed, 2)
  assert.deepEqual(repaired.messages, [
    messages[0],
    messages[1],
    validAssistant,
    validTool,
    messages[6],
  ])
  assert.doesNotThrow(() => assertValidToolTranscript(repaired.messages))
})

test('recovery considers only exact primary images for the trailing open calls', () => {
  const messages = [
    { role: 'system', content: 'System' },
    { role: 'user', content: 'Generate two images' },
    { role: 'assistant', content: null, tool_calls: [call('first'), call('second')] },
    { role: 'tool', tool_call_id: 'first', content: '{"ok":true}' },
  ]
  assert.deepEqual(trailingUnansweredToolCallIds(messages), ['second'])

  const recoverable = recoverableToolResultImages(messages, [
    image('upload-uuid', 'upload'),
    image('second_1'),
    image('second', 'upload'),
    image('second', 'still', 'generating'),
  ])
  assert.deepEqual(recoverable, [])

  const completed = image('second')
  assert.deepEqual(
    recoverableToolResultImages(messages, [image('second_1'), completed]),
    [{ toolCallId: 'second', image: completed }],
  )
})

test('recovery never appends an old result after a later conversational turn', () => {
  const messages = [
    { role: 'assistant', content: null, tool_calls: [call('old')] },
    { role: 'user', content: 'Do something else' },
    { role: 'assistant', content: 'Done.' },
  ]
  assert.deepEqual(trailingUnansweredToolCallIds(messages), [])
  assert.deepEqual(recoverableToolResultImages(messages, [image('old')]), [])
})

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

test('parallel model jobs inspect only after every tool result is written', async () => {
  const ids = ['call_a', 'call_b', 'call_c', 'call_d', 'call_e', 'call_f']
  const delays = [70, 10, 40, 5, 55, 25]
  const finishOrder = []
  const messages = [
    { role: 'assistant', content: null, tool_calls: ids.map(id => call(id, 'model_agnes_image_2_5_flash_text_to_image')) },
  ]
  const jobs = ids.map(toolCallId => ({ toolCallId }))
  const results = await runJobsThenAppendToolResults(
    jobs,
    async (job) => {
      await wait(delays[ids.indexOf(job.toolCallId)])
      finishOrder.push(job.toolCallId)
      return JSON.stringify({ ok: true, urls: [`https://example.com/${job.toolCallId}.png`] })
    },
    (toolCallId, result) => {
      messages.push({ role: 'tool', tool_call_id: toolCallId, content: result })
    },
  )
  messages.push({
    role: 'user',
    internal: true,
    content: 'Inspect these generated stills from the last tool results.',
  })

  assert.notDeepEqual(finishOrder, ids)
  assert.deepEqual(messages.filter(message => message.role === 'tool').map(message => message.tool_call_id), ids)
  assert.equal(messages.filter(message => message.role === 'user').length, 1)
  assert.equal(results.length, 6)
  const inspectAt = messages.findIndex(message => message.role === 'user')
  const lastToolAt = messages.map(message => message.role).lastIndexOf('tool')
  assert.ok(lastToolAt < inspectAt)
  assert.doesNotThrow(() => assertValidToolTranscript(messages))

  const loop = readFileSync(new URL('../server/agent/loop.ts', import.meta.url), 'utf8')
  assert.match(loop, /runJobsThenAppendToolResults/)
  assert.doesNotMatch(loop, /models\.map\(async \(job\) => \{[\s\S]*inspectGeneratedStills\(sessionId, successfulUrls\(\[result\]\)\)/)
})

test('inspecting after the first parallel result breaks the tool transcript', async () => {
  const ids = ['call_a', 'call_b', 'call_c']
  const messages = [
    { role: 'assistant', content: null, tool_calls: ids.map(id => call(id)) },
  ]
  messages.push({ role: 'tool', tool_call_id: 'call_b', content: '{"ok":true}' })
  messages.push({ role: 'user', internal: true, content: 'Inspect these generated stills from the last tool results.' })
  messages.push({ role: 'tool', tool_call_id: 'call_a', content: '{"ok":true}' })
  const repaired = removeOrphanToolMessages(messages)
  assert.equal(repaired.removed, 1)
  assert.throws(
    () => assertValidToolTranscript(repaired.messages),
    /missing result for call_a, call_c before message 2/,
  )
})

test('outbound validation rejects orphan, interrupted, and duplicate tool results', () => {
  assert.throws(
    () => assertValidToolTranscript([{ role: 'tool', tool_call_id: 'orphan', content: '{}' }]),
    /orphan tool result/,
  )
  assert.throws(
    () => assertValidToolTranscript([
      { role: 'assistant', content: null, tool_calls: [call('open')] },
      { role: 'user', content: 'Interrupt' },
    ]),
    /missing result for open/,
  )
  assert.throws(
    () => assertValidToolTranscript([
      { role: 'assistant', content: null, tool_calls: [call('same'), call('same')] },
    ]),
    /duplicate tool call id/,
  )
  assert.throws(
    () => assertValidToolTranscript([
      { role: 'assistant', content: null, tool_calls: [call('once')] },
      { role: 'tool', tool_call_id: 'once', content: '{}' },
      { role: 'tool', tool_call_id: 'once', content: '{}' },
    ]),
    /orphan tool result/,
  )
})
