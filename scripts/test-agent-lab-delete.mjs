import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parse } from 'vue/compiler-sfc'
import {
  applyRemovedSessionIds,
  applySuccessfulAgentDelete,
  canDeleteAgent,
  isEmptyDeletableAgent,
  mergeRetainedCanvasImages,
  nextAgentAfterDelete,
} from '../app/utils/agentLabDelete.ts'
import { collectProjectCanvasImages } from '../app/utils/canvasImageDelete.ts'

test('empty agents keep drafts, attachments, and pending cards', () => {
  assert.equal(isEmptyDeletableAgent({ id: 'a' }), true)
  assert.equal(isEmptyDeletableAgent({ id: 'a', title: 'New agent' }), true)
  assert.equal(isEmptyDeletableAgent({ id: 'a', draft: 'hello' }), false)
  assert.equal(isEmptyDeletableAgent({ id: 'a', attachments: [{ id: 'f' }] }), false)
  assert.equal(isEmptyDeletableAgent({ id: 'a', confirmation: { reason: 'x' } }), false)
  assert.equal(isEmptyDeletableAgent({ id: 'a', sessionId: 's' }), false)
})

test('the last blank agent cannot be deleted and busy agents stay locked', () => {
  const blank = { id: 'blank' }
  assert.equal(canDeleteAgent([blank], 'blank'), false)
  const used = { id: 'used', sessionId: 's1', updatedAt: 2 }
  assert.equal(canDeleteAgent([used], 'used'), true)
  assert.equal(canDeleteAgent([used, blank], 'used'), true)
  assert.equal(canDeleteAgent([{ id: 'busy', sessionId: 's', status: 'thinking' }], 'busy'), false)
  assert.equal(canDeleteAgent([used], 'used', { deletingId: 'used' }), false)
})

test('deleting the current agent picks the newest remaining one', () => {
  const agents = [
    { id: 'old', sessionId: 'a', updatedAt: 1 },
    { id: 'current', sessionId: 'b', updatedAt: 3 },
    { id: 'recent', sessionId: 'c', updatedAt: 2 },
  ]
  assert.equal(nextAgentAfterDelete(agents, 'current')?.id, 'recent')
  assert.equal(nextAgentAfterDelete(agents, 'missing')?.id, 'current')
})

test('removed session ids drop agents without treating list absence as deletion', () => {
  const agents = [
    { id: 'keep', sessionId: 's1' },
    { id: 'gone', sessionId: 's2' },
  ]
  const next = applyRemovedSessionIds(agents, ['s2'], 'gone')
  assert.deepEqual(next.agents.map(agent => agent.id), ['keep'])
  assert.equal(next.nextActiveId, 'keep')
  assert.equal(applyRemovedSessionIds(agents, [], 'gone').agents.length, 2)
})

test('removed session ids pick the next live agent, not another tombstone', () => {
  const agents = [
    { id: 'keep', sessionId: 's1', updatedAt: 1 },
    { id: 'gone', sessionId: 's2', updatedAt: 3 },
    { id: 'also-gone', sessionId: 's3', updatedAt: 2 },
  ]
  const next = applyRemovedSessionIds(agents, ['s2', 's3'], 'gone')
  assert.deepEqual(next.agents.map(agent => agent.id), ['keep'])
  assert.equal(next.nextActiveId, 'keep')
})

test('successful delete switches the current agent before dropping the old row', () => {
  const agents = [
    { id: 'old', sessionId: 'a', updatedAt: 1 },
    { id: 'current', sessionId: 'b', updatedAt: 3 },
    { id: 'recent', sessionId: 'c', updatedAt: 2 },
  ]
  const next = applySuccessfulAgentDelete(agents, 'current', 'current', () => ({ id: 'empty' }))
  assert.equal(next.switchActive, true)
  assert.equal(next.fallback.id, 'recent')
  assert.deepEqual(next.agents.map(agent => agent.id), ['old', 'recent'])
  assert.equal(applySuccessfulAgentDelete(agents, 'old', 'current', () => ({ id: 'empty' })).switchActive, false)
  const last = applySuccessfulAgentDelete([{ id: 'only', sessionId: 's' }], 'only', 'only', () => ({ id: 'empty' }))
  assert.deepEqual(last.agents.map(agent => agent.id), ['empty'])
})

test('retained stills stay in the canvas union after the agent is gone', () => {
  const retained = [{ id: 'shot', url: 'https://example.com/a.png' }]
  const images = collectProjectCanvasImages([], [], new Set(), retained)
  assert.deepEqual(images, retained)
  assert.deepEqual(mergeRetainedCanvasImages(retained, [{ id: 'shot', url: 'https://example.com/b.png' }]), [{
    id: 'shot',
    url: 'https://example.com/b.png',
  }])
})

test('conversation delete dialog has its own copy and the menu keeps delete off radio items', () => {
  const dialog = readFileSync(new URL('../app/components/agent-lab/AgentLabDeleteDialog.vue', import.meta.url), 'utf8')
  assert.match(dialog, /chat\.deleteTitle/)
  assert.match(dialog, /chat\.deleteDescription/)
  assert.doesNotMatch(dialog, /Delete this result/)
  const chat = readFileSync(new URL('../app/components/agent-lab/AgentLabChat.vue', import.meta.url), 'utf8')
  assert.match(chat, /deleteAgent/)
  assert.match(chat, /Trash2/)
  assert.match(chat, /agentMenuOpen/)
  assert.doesNotMatch(parse(chat).descriptor.scriptSetup.content, /DropdownMenuRadioItem[\s\S]*deleteAgent/)
  const pages = [
    readFileSync(new URL('../app/pages/projects/[id].vue', import.meta.url), 'utf8'),
    readFileSync(new URL('../app/components/home/HomeAgentComposer.vue', import.meta.url), 'utf8'),
  ]
  for (const page of pages)
    assert.match(page, /@delete-agent="deleteAgent"/)
  const zh = readFileSync(new URL('../i18n/locales/zh-CN.json', import.meta.url), 'utf8')
  const en = readFileSync(new URL('../i18n/locales/en.json', import.meta.url), 'utf8')
  for (const key of ['deleteAgent', 'deleteTitle', 'deleteDescription', 'deleteBusy', 'deletePending', 'deleteFailed', 'deleteUnknown']) {
    assert.match(zh, new RegExp(`"${key}"`))
    assert.match(en, new RegExp(`"${key}"`))
  }
})
