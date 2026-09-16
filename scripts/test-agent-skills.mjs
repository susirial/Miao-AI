import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizeComposerSelection } from '../shared/utils/agentComposerSelection.ts'
import { findComposerCommand, PUBLIC_AGENT_SKILLS, readSkillCommands, searchAgentSkills, stripSkillCommands } from '../shared/utils/agentSkills.ts'

assert.deepEqual(PUBLIC_AGENT_SKILLS.map(skill => skill.id), [
  'image-annotation-edit',
  'sketch-to-image',
  'app-store-graphics',
  'long-form-video',
])
assert.equal(searchAgentSkills('annotate')[0]?.id, 'image-annotation-edit')
assert.equal(searchAgentSkills('标注')[0]?.id, 'image-annotation-edit')
assert.equal(searchAgentSkills('long video')[0]?.id, 'long-form-video')
assert.equal(searchAgentSkills('分镜')[0]?.id, 'long-form-video')
assert.equal(searchAgentSkills('app store iphone')[0]?.id, 'app-store-graphics')
assert.equal(searchAgentSkills('product hunt').length, 0)

for (const text of ['https://miao.ai', 'Visit https://miao.ai/gallery', '/long-form-video https://miao.ai', '/long-form-video '])
  assert.equal(findComposerCommand(text, text.length), null, text)
assert.deepEqual(findComposerCommand('/sketch', 7), { start: 0, end: 7, query: 'sketch', trigger: '/' })
assert.equal(findComposerCommand('Use @image', 10)?.trigger, '@')

const selected = '/app-store-graphics https://example.com'
assert.equal(readSkillCommands(selected)[0]?.id, 'app-store-graphics')
assert.equal(stripSkillCommands(selected), 'https://example.com')
assert.equal(readSkillCommands('https://example.com/app-store-graphics').length, 0)
assert.equal(stripSkillCommands('/unknown https://example.com'), '/unknown https://example.com')
assert.equal(normalizeComposerSelection('/sketch-to-image /long-form-video Make a film'), '/long-form-video Make a film')
assert.equal(normalizeComposerSelection('@[Seedream](model:seedream-5) /app-store-graphics Design these'), '/app-store-graphics Design these')

const appStore = readFileSync(new URL('../server/agent/skills/app-store-graphics.md', import.meta.url), 'utf8')
assert.match(appStore, /seedream\/5-pro-reference-to-image/)
assert.match(appStore, /reference_images.*exact order/is)
assert.match(appStore, /Automatic (?:approval )?must not bypass/)
assert.doesNotMatch(appStore, /model_gpt|model_wavespeed|background:/i)

const longForm = readFileSync(new URL('../server/agent/skills/long-form-video.md', import.meta.url), 'utf8')
for (const gate of ['total film duration', 'storyboard', 'character reference'])
  assert.match(longForm, new RegExp(gate, 'i'))
assert.match(longForm, /Automatic generation confirmation does not skip/i)
console.log('Public skills, slash parsing, and URL preservation passed.')
