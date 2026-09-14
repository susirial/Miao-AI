import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  assertValidToolTranscript,
  recoverableToolResultImages,
  removeOrphanToolMessages,
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
