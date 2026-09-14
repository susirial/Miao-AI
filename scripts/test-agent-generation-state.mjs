import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { isGenerationFailureRetryable, isNonRetryableGenerationFailure } from '../shared/types/generation.ts'
import { askUserPublicPrompt, wrapAssistantLoopText } from '../shared/utils/agentLoopText.ts'
import { AGENT_INTERRUPT_NOTE, AGENT_STOP_NOTE, AGENT_STOP_WITH_GENERATIONS_NOTE, agentStopNote, dropStaleStopNotesForPendingChoice, isAgentInterruptNote, isAgentStopNote } from '../shared/utils/agentStopNote.ts'
import { readErrorMessage } from '../shared/utils/apiError.ts'

test('stop notes only claim background generation when media is in flight', () => {
  assert.equal(agentStopNote(0), AGENT_STOP_NOTE)
  assert.equal(agentStopNote(2), AGENT_STOP_WITH_GENERATIONS_NOTE)
  assert.equal(isAgentStopNote(AGENT_STOP_NOTE), true)
  assert.equal(isAgentStopNote('Stopped for another reason.'), false)
  assert.equal(isAgentInterruptNote(AGENT_INTERRUPT_NOTE), true)
  assert.equal(isAgentStopNote(AGENT_INTERRUPT_NOTE), false)
})

test('abort without a user stop does not write Stopped', () => {
  const loop = readFileSync(new URL('../server/agent/loop.ts', import.meta.url), 'utf8')
  assert.match(loop, /function endLoopForAbort/)
  assert.match(loop, /AGENT_INTERRUPT_NOTE/)
  assert.match(loop, /if \(sessionWantsStop\(session\) \|\| isLoopAbort\(error\)\) \{\s*endLoopForAbort/)
  assert.doesNotMatch(loop, /if \(signal\?\.aborted\) \{\s*session\.stopRequested = true/)
  assert.doesNotMatch(loop, /if \(sessionWantsStop\(session\) \|\| llmSignal\.aborted\) \{\s*noteAgentStopped/)
})

test('ask_user turns keep a public sentence outside think tags', () => {
  assert.equal(askUserPublicPrompt([{
    name: 'ask_user',
    arguments: JSON.stringify({ prompt: '要不要按原参数重新提交？', questions: [{ id: 'q1', prompt: '继续？', options: [{ id: 'yes', label: '是' }] }] }),
  }]), '要不要按原参数重新提交？')
  assert.equal(wrapAssistantLoopText({
    reasoning: 'Plan the fight',
    text: '',
    hasToolCalls: true,
    askingUser: true,
    askUserPrompt: '要不要按原参数重新提交？',
  }), '<think>Plan the fight</think>要不要按原参数重新提交？')
  assert.equal(wrapAssistantLoopText({
    reasoning: 'Draft stills',
    text: 'Generate two mechs',
    hasToolCalls: true,
    askingUser: false,
  }), '<think>Draft stills\n\nGenerate two mechs</think>')
})

test('stop is not the primary action while a choice card is open', () => {
  const component = readFileSync(new URL('../app/components/agent-lab/AgentLabChat.vue', import.meta.url), 'utf8')
  assert.match(component, /canStop = computed\(\(\) => agentRunning\.value && !props\.confirmationOpen && !props\.choiceOpen\)/)
})

test('pending ask_user hydrate drops a leftover local stop note', () => {
  const local = [
    { id: 'u', role: 'user', content: 'Give me a prompt' },
    { id: 'a', role: 'assistant', content: '<think>Plan the fight</think>' },
    { id: 'stop', role: 'assistant', content: AGENT_STOP_NOTE },
  ]
  const kept = dropStaleStopNotesForPendingChoice(local)
  assert.deepEqual(kept.map(item => item.id), ['u', 'a'])
})

test('non-retryable failures still let the agent explain instead of stopping the loop', () => {
  const loop = readFileSync(new URL('../server/agent/loop.ts', import.meta.url), 'utf8')
  assert.match(loop, /session\.retryBlocked = await runConfirmedItems/)
  assert.match(loop, /else\s+await runAgentLoop\(session\.id, emit, signal\)/)
  assert.doesNotMatch(loop, /else if \(!session\.retryBlocked\)\s+await runAgentLoop/)
  assert.doesNotMatch(loop, /if \(session\.retryBlocked\)\s+return\s+true/)
})

test('submission_unknown is structurally blocked from automatic retry', () => {
  assert.equal(isGenerationFailureRetryable('submission_unknown'), false)
  assert.equal(isGenerationFailureRetryable('provider_error'), true)
  assert.equal(isNonRetryableGenerationFailure({ failCode: 'submission_unknown' }), true)
  assert.equal(isNonRetryableGenerationFailure({ failCode: 'provider_error' }), false)
  const source = readFileSync(new URL('../app/composables/useAgentLab.ts', import.meta.url), 'utf8')
  const start = source.indexOf('function isRetryableJobFail(')
  const end = source.indexOf('\nfunction isSessionLockError', start)
  const context = vm.createContext({ isNonRetryableGenerationFailure })
  vm.runInContext(ts.transpileModule(source.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, context)
  assert.equal(context.isRetryableJobFail({
    failCode: 'submission_unknown',
    error: 'Generation failed',
  }), false)
  assert.equal(context.isRetryableJobFail({
    failCode: 'provider_error',
    error: 'Temporary provider error',
  }), true)
})

test('fetch diagnostics prefer a concrete cause over a generic wrapper', () => {
  const error = Object.assign(new TypeError('fetch failed'), {
    cause: new Error('socket closed by upstream'),
  })
  assert.equal(readErrorMessage(error, 'Request failed'), 'socket closed by upstream')
  assert.equal(readErrorMessage(new TypeError('fetch failed'), 'Request failed'), 'Request failed')
})
