import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { computed, nextTick, ref, watch } from 'vue'
import { compileScript, compileTemplate, parse } from 'vue/compiler-sfc'

function transpile(source, context = {}) {
  const state = { exports: {}, ...context }
  vm.runInNewContext(ts.transpile(source, {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  }), state)
  return state.exports
}

const sharedSource = readFileSync(new URL('../shared/utils/sketchToImage.ts', import.meta.url), 'utf8')
const shared = transpile(sharedSource)
const userRequest = transpile(readFileSync(new URL('../server/agent/userRequest.ts', import.meta.url), 'utf8'))
const briefSource = readFileSync(new URL('../server/agent/sketchBrief.ts', import.meta.url), 'utf8')
const brief = transpile(briefSource, {
  require: (specifier) => {
    if (specifier === '~~/shared/utils/sketchToImage')
      return shared
    if (specifier === './userRequest')
      return userRequest
    throw new Error(`Unexpected runtime import: ${specifier}`)
  },
})

function assistantCall(id, questions, name = 'ask_user') {
  return {
    role: 'assistant',
    tool_calls: [{
      id,
      type: 'function',
      function: { name, arguments: JSON.stringify({ questions }) },
    }],
  }
}

function toolResult(id, answer, extra = {}) {
  return {
    role: 'tool',
    tool_call_id: id,
    content: JSON.stringify({ ok: true, answers: [answer], ...extra }),
  }
}

const referenceQuestion = {
  id: 'sketch_references',
  prompt: 'Would you like to add references?',
  options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }],
}
const understandingQuestion = {
  id: 'sketch_understanding',
  prompt: 'A cabin sits on the left beside a lake. Is this understanding correct?',
  options: [{ id: 'correct', label: 'Correct' }, { id: 'adjust', label: 'Adjust', custom: true }],
}

test('shared contract names Seedream R2I and caps total inputs at ten', () => {
  assert.equal(shared.SKETCH_TO_IMAGE_GENERATION_TOOL, 'generate_image')
  assert.equal(shared.SKETCH_TO_IMAGE_MODEL, 'seedream/5-pro-reference-to-image')
  assert.equal(shared.SKETCH_MAX_INPUTS, 10)
  assert.match(shared.sketchPrompt('watercolor'), /image 1 as the saved sketch/)
  assert.match(shared.sketchPrompt('watercolor'), /watercolor/)
})

test('drawing coordinates stay aligned and clamp strokes leaving the board', () => {
  const point = shared.sketchPoint(170, 140, { left: 20, top: 40, width: 300, height: 200 })
  assert.equal(point.x, 600)
  assert.equal(point.y, 400)
  const outside = shared.sketchPoint(-10, 300, { left: 20, top: 40, width: 300, height: 200 })
  assert.equal(outside.x, 0)
  assert.equal(outside.y, 800)
})

test('brief enforces save, references, restatement and explicit confirmation order', () => {
  const request = {
    role: 'user',
    content: [
      { type: 'text', text: '/sketch-to-image watercolor' },
      { type: 'image_url', image_url: { url: 'https://example.com/sketch.png' } },
    ],
  }
  let messages = [request]
  assert.equal(brief.sketchBrief(messages).referencesDone, false)
  assert.doesNotThrow(() => brief.assertSketchQuestion(messages, [referenceQuestion]))
  assert.throws(() => brief.assertSketchQuestion(messages, [understandingQuestion]), /sketch_references/)

  messages = [
    ...messages,
    assistantCall('refs', [referenceQuestion]),
    toolResult('refs', {
      questionId: 'sketch_references',
      optionId: 'yes',
      referenceImages: [{ url: 'https://example.com/style.png', name: 'Style' }],
    }),
  ]
  const withReferences = brief.sketchBrief(messages)
  assert.deepEqual(Array.from(withReferences.inputUrls), [
    'https://example.com/sketch.png',
    'https://example.com/style.png',
  ])
  assert.doesNotThrow(() => brief.assertSketchQuestion(messages, [understandingQuestion]))

  messages = [
    ...messages,
    assistantCall('understanding', [understandingQuestion]),
    toolResult('understanding', {
      questionId: 'sketch_understanding',
      optionId: 'correct',
    }),
  ]
  const confirmed = brief.sketchBrief(messages)
  assert.equal(confirmed.understandingDone, true)
  assert.match(confirmed.confirmedUnderstanding, /cabin sits on the left/)
  assert.throws(() => brief.assertSketchQuestion(messages, [understandingQuestion]), /generate_image/)
})

test('reference validation reserves occupied slots and deduplicates URLs', () => {
  const eight = Array.from({ length: 8 }, (_, index) => ({
    url: `https://example.com/${index}.png`,
    name: `Reference ${index}`,
  }))
  assert.equal(brief.validateSketchReferences([...eight, eight[0]], 2).length, 8)
  assert.throws(
    () => brief.validateSketchReferences([...eight, { url: 'https://example.com/extra.png' }], 2),
    /1 and 8/,
  )
  assert.throws(() => brief.validateSketchReferences([{ url: 'file:///tmp/a.png' }], 1), /valid uploaded/)
})

test('submitted generation must be preset generate_image resolved as Seedream R2I', () => {
  const messages = [
    { role: 'user', content: '/sketch-to-image' },
    assistantCall('generation', [], 'generate_image'),
  ]
  assert.equal(brief.sketchGenerationSubmitted(messages, [{
    id: 'generation',
    modelId: shared.SKETCH_TO_IMAGE_MODEL,
    status: 'success',
  }]), true)
  assert.equal(brief.sketchGenerationSubmitted(messages, [{
    id: 'generation',
    modelId: 'seedream/5-pro-image-to-image',
    status: 'success',
  }]), false)
})

function canvasHarness() {
  const drawing = ref([])
  const props = { disabled: false, copy: {} }
  const commands = []
  const context = new Proxy({}, {
    set(target, key, value) {
      commands.push([key, value])
      target[key] = value
      return true
    },
    get(target, key) {
      return target[key] || ((...args) => commands.push([key, ...args]))
    },
  })
  let capture
  let exported
  const surface = {
    getBoundingClientRect: () => ({ left: 20, top: 40, width: 300, height: 200 }),
    setPointerCapture: id => capture = id,
    hasPointerCapture: id => capture === id,
    releasePointerCapture: () => capture = undefined,
  }
  const state = {
    exports: {},
    ...shared,
    computed,
    nextTick,
    ref,
    watch,
    File,
    Blob,
    defineModel: () => drawing,
    defineProps: () => props,
    withDefaults: value => value,
    defineEmits: () => () => {},
    defineExpose: () => {},
    useTemplateRef: name => ({ value: name === 'surface' ? surface : { focus() {} } }),
    useI18n: () => ({ t: key => key }),
    document: {
      createElement: () => {
        const canvas = {
          getContext: () => context,
          toBlob: (callback) => {
            exported = canvas
            callback(new Blob(['png'], { type: 'image/png' }))
          },
        }
        return canvas
      },
    },
  }
  const descriptor = parse(readFileSync(new URL('../app/components/tools/SketchCanvas.vue', import.meta.url), 'utf8')).descriptor
  const component = descriptor.scriptSetup.content.replace(/^import .*\n/gm, '')
  vm.runInNewContext(ts.transpile(`${component}
Object.assign(exports, { start, move, finish, undo, redo, clear, setMode, textDraft, exportFile });`, {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  }), state)
  return { ...state.exports, drawing, commands, exported: () => exported }
}

test('canvas drawing is undoable and PNG export includes pending Unicode text', async () => {
  const harness = canvasHarness()
  const event = {
    pointerId: 1,
    button: 0,
    clientX: 20,
    clientY: 40,
    preventDefault() {},
  }
  harness.start(event)
  harness.move({ ...event, clientX: 170, clientY: 140 })
  harness.finish({ ...event, clientX: 170, clientY: 140, type: 'pointerup' })
  assert.equal(harness.drawing.value.length, 1)
  harness.undo()
  assert.equal(harness.drawing.value.length, 0)
  harness.redo()
  assert.equal(harness.drawing.value.length, 1)

  harness.setMode('text')
  harness.start({ ...event, clientX: 95, clientY: 90 })
  harness.textDraft.value = '湖边小屋'
  const file = await harness.exportFile()
  assert.equal(file.name, 'sketch.png')
  assert.equal(file.type, 'image/png')
  assert.equal(harness.exported().width, 1200)
  assert.equal(harness.exported().height, 800)
  assert.ok(harness.commands.some(command => command[0] === 'fillText' && command[1] === '湖边小屋'))
})

test('new Vue files compile and the workflow skill specifies reference_images routing', () => {
  for (const relative of [
    '../app/components/tools/SketchCanvas.vue',
    '../app/components/agent-lab/AgentLabSketchChoice.vue',
  ]) {
    const filename = new URL(relative, import.meta.url)
    const descriptor = parse(readFileSync(filename, 'utf8'), { filename: filename.pathname }).descriptor
    assert.ok(descriptor.scriptSetup)
    assert.doesNotThrow(() => compileScript(descriptor, { id: relative }))
    const result = compileTemplate({
      id: relative,
      filename: filename.pathname,
      source: descriptor.template.content,
    })
    assert.deepEqual(result.errors, [])
  }

  const skill = readFileSync(new URL('../server/agent/skills/sketch-to-image.md', import.meta.url), 'utf8')
  assert.match(skill, /saved sketch is image 1/)
  assert.match(skill, /combined must not exceed 10 images/)
  assert.match(skill, /`generate_image`/)
  assert.match(skill, /`reference_images`/)
  assert.match(skill, /automatically select Seedream Reference to Image/)
})

test('new files contain no legacy provider or model names', () => {
  const files = [
    '../shared/utils/sketchToImage.ts',
    '../app/components/tools/SketchCanvas.vue',
    '../app/components/agent-lab/AgentLabSketchChoice.vue',
    '../server/agent/sketchBrief.ts',
    '../server/agent/skills/sketch-to-image.md',
    '../scripts/test-sketch-to-image.mjs',
  ]
  const forbidden = new RegExp(['g', 'pt', '|f', 'lare', '|w', 'avespeed'].join(''), 'i')
  for (const relative of files)
    assert.doesNotMatch(readFileSync(new URL(relative, import.meta.url), 'utf8'), forbidden)
})
