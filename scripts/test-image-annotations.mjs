import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import vm from 'node:vm'
import sharp from 'sharp'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')

function load(relative, mocks = {}, globals = {}) {
  const cache = new Map()
  function moduleAt(file) {
    if (cache.has(file))
      return cache.get(file)
    const module = { exports: {} }
    cache.set(file, module.exports)
    const code = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: {
        esModuleInterop: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText
    vm.runInNewContext(code, {
      module,
      exports: module.exports,
      AbortSignal,
      Buffer,
      Error,
      Response,
      URL,
      console,
      crypto,
      setTimeout,
      structuredClone,
      ...globals,
      require: (id) => {
        if (id in mocks)
          return mocks[id]
        if (id.startsWith('.') || id.startsWith('~~/')) {
          const target = id.startsWith('~~/')
            ? resolve(root, id.slice(3))
            : resolve(dirname(file), id)
          if (target.endsWith('.mjs'))
            throw new Error(`Missing mock for ${id}`)
          return moduleAt(target.match(/\.[cm]?[jt]s$/) ? target : `${target}.ts`)
        }
        return require(id)
      },
    }, { filename: file })
    return module.exports
  }
  return moduleAt(resolve(root, relative))
}

const annotations = load('shared/utils/imageAnnotations.ts')
const choices = load('shared/utils/agentChoices.ts')
const sourceUrl = '/media/projects/source.png'
const edit = {
  imageUrl: sourceUrl,
  points: [
    { x: 250, y: 750, text: 'Make the coat red' },
    { x: 900, y: 50, text: 'Remove the sign' },
  ],
}

function declaration(file, name) {
  const source = readFileSync(resolve(root, file), 'utf8')
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
  assert.ok(fn, `${name} must exist`)
  return fn.getText(ast)
}

const choiceContext = vm.createContext({ ...annotations, ...choices })
for (const [file, name] of [['server/agent/router.ts', 'parseChoiceBody'], ['server/agent/loop.ts', 'formatChoiceResult']]) {
  vm.runInContext(ts.transpileModule(declaration(file, name), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, choiceContext)
}
const payload = {
  id: 'card',
  prompt: 'Choose an edit method',
  questions: [{
    id: 'image_edit_method',
    prompt: 'How should the image be edited?',
    options: [{ id: 'annotate', label: 'Annotate' }, { id: 'describe', label: 'Describe' }],
  }],
}

test('choice parser strips a forged guide URL and preserves validated points', () => {
  const body = choiceContext.parseChoiceBody({
    choiceId: 'card',
    action: 'submit',
    answers: [{
      questionId: 'image_edit_method',
      optionId: 'annotate',
      annotationEdit: { ...edit, annotatedImageUrl: 'https://attacker.example/guide.png' },
    }],
  })
  const result = JSON.parse(choiceContext.formatChoiceResult(payload, body, [sourceUrl]))
  assert.deepEqual(result.answers[0].annotationEdit, edit)
})

test('annotation validation rejects invalid source, point count, coordinates, and text', () => {
  for (const invalid of [
    { ...edit, imageUrl: '/media/other/source.png' },
    { ...edit, points: [] },
    { ...edit, points: Array.from({ length: 17 }, () => edit.points[0]) },
    { ...edit, points: [{ x: -1, y: 2, text: 'x' }] },
    { ...edit, points: [{ x: 1001, y: 2, text: 'x' }] },
    { ...edit, points: [{ x: 1.5, y: 2, text: 'x' }] },
    { ...edit, points: [{ x: 1, y: 2, text: ' ' }] },
    { ...edit, points: [{ x: 1, y: 2, text: 'x'.repeat(1001) }] },
  ]) {
    assert.throws(() => annotations.validateImageAnnotationEdit(invalid, [sourceUrl]))
  }
})

test('annotation references accept project media and reject malformed local paths', () => {
  const valid = {
    ...edit,
    points: [{ ...edit.points[0], references: [{ name: 'dog.png', url: '/media/projects/dog.png' }] }],
  }
  assert.equal(annotations.validateImageAnnotationEdit(valid, [sourceUrl]).points[0].references[0].url, '/media/projects/dog.png')
  for (const url of ['/media/../secret.png', '/media/%2e%2e/secret.png', 'file:///secret.png'])
    assert.throws(() => annotations.validateImageAnnotationEdit({ ...valid, points: [{ ...valid.points[0], references: [{ name: 'bad', url }] }] }, [sourceUrl]))
})

test('project reference validation is project-scoped and rejects cross-project images', async () => {
  const dog = '/media/projects/dog.png'
  const scopes = []
  const query = rows => ({
    find(filter) {
      scopes.push(filter)
      return { select: () => ({ lean: async () => rows }) }
    },
  })
  const resolver = load('server/agent/annotationReferences.ts', {
    '../models/agentChat': { AgentChat: query([]) },
    '../models/generationJob': { GenerationJob: query([{ resultUrls: [dog] }]) },
    '../utils/sqlite': { connectDatabase: async () => {} },
    '../utils/storedMediaUrl.mjs': { canonicalMediaUrl: value => typeof value === 'string' && (/^https?:\/\//.test(value) || value.startsWith('/media/')) ? value : '' },
  })
  const session = { projectId: 'project-a', images: [] }
  await resolver.validateProjectImageReferences([dog], session)
  assert.ok(scopes.every(filter => filter.projectId === 'project-a'))
  await assert.rejects(
    resolver.validateProjectImageReferences(['/media/projects/foreign.png'], session),
    /no longer available/,
  )
  await assert.rejects(
    resolver.validateProjectImageReferences([dog], { images: [] }),
    /belong to this project/,
  )
})

test('renderer reads local media directly and produces a numbered PNG guide', async () => {
  const original = await sharp({
    create: { width: 800, height: 600, channels: 3, background: '#fff' },
  }).png().toBuffer()
  let uploaded
  let localReads = 0
  const renderer = load('server/agent/imageAnnotations.ts', {
    '../utils/localMedia': {
      readStoredMedia: async (url) => {
        localReads++
        assert.equal(url, sourceUrl)
        return { bytes: original, mime: 'image/png' }
      },
    },
    '../utils/mediaExport': {
      downloadExportMedia: async () => {
        throw new Error('remote downloader must not run for /media')
      },
    },
    './upload': {
      uploadAgentImage: async (sessionId, file) => {
        assert.equal(sessionId, 'session')
        uploaded = file
        return '/media/agent-lab/session/guide.png'
      },
    },
  })
  assert.equal(await renderer.renderAnnotationImage(edit, 'session'), '/media/agent-lab/session/guide.png')
  assert.equal(localReads, 1)
  assert.equal(uploaded.mime, 'image/png')
  assert.deepEqual(await sharp(uploaded.bytes).metadata().then(({ width, height }) => [width, height]), [800, 600])
  assert.notDeepEqual(uploaded.bytes, original)
})

test('render failures leave pendingChoice retryable', async () => {
  const pending = { payload, items: [{ toolCallId: 'ask', tool: 'ask_user', argsJson: '{}' }] }
  const session = {
    id: 'session',
    images: [{ id: 'source', url: sourceUrl, status: 'success', kind: 'upload' }],
    messages: [],
    busy: false,
    stopRequested: false,
    pendingChoice: pending,
  }
  const context = vm.createContext({
    requireLoadedSession: async () => session,
    emitSessionCatchUp: () => {},
    choiceAlreadyAnswered: () => false,
    touch: () => {},
    formatChoiceResult: choiceContext.formatChoiceResult,
    sessionStillUrls: ({ images }) => images.filter(image => image.status === 'success' && image.kind !== 'video' && image.url).map(image => image.url),
    validateAnnotationReferences: async () => {},
    renderAnnotationImage: async () => { throw new Error('guide failed') },
    modelPreferenceFromChoice: () => null,
    refreshSessionPrompt: () => {},
    appendToolResult: () => assert.fail('tool result must not be written'),
    sessionWantsStop: () => false,
    runAgentLoop: () => assert.fail('loop must not continue'),
    noteAgentStopped: () => {},
  })
  vm.runInContext(ts.transpileModule(declaration('server/agent/loop.ts', 'handleChoice').replace('export ', ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, context)
  await assert.rejects(
    context.handleChoice('session', {
      choiceId: 'card',
      action: 'submit',
      answers: [{ questionId: 'image_edit_method', optionId: 'annotate', annotationEdit: edit }],
    }, () => {}),
    /guide failed/,
  )
  assert.equal(session.pendingChoice, pending)
  assert.equal(session.busy, false)
})

const brief = load('server/agent/annotationBrief.ts')
const methodQuestion = {
  id: 'image_edit_method',
  prompt: 'How should the image be edited?',
  recommendedId: 'annotate',
  options: [{ id: 'annotate', label: 'Annotate' }, { id: 'describe', label: 'Describe' }],
}
function annotationTurn(...followUps) {
  return [
    { role: 'user', content: [{ type: 'text', text: '/image-annotation-edit' }, { type: 'image_url', image_url: { url: sourceUrl } }] },
    ...followUps,
  ]
}
function askCall(questions, id = 'ask-1') {
  return { role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name: 'ask_user', arguments: JSON.stringify({ questions }) } }] }
}
function askResult(payloadJson, id = 'ask-1') {
  return { role: 'tool', tool_call_id: id, content: JSON.stringify(payloadJson) }
}

test('the explicit annotation command gates the turn on the image_edit_method card', () => {
  const messages = annotationTurn()
  const state = brief.annotationBrief(messages)
  assert.deepEqual(Array.from(state.sourceUrls), [sourceUrl])
  assert.equal(state.methodAnswered, false)
  assert.equal(state.confirmed, false)

  assert.doesNotThrow(() => brief.assertAnnotationQuestion(messages, [methodQuestion]))
  for (const wrong of [
    [{ ...methodQuestion, recommendedId: 'describe' }],
    [{ ...methodQuestion, options: [{ id: 'describe', label: 'Describe' }] }],
    [methodQuestion, { id: 'style', prompt: 'Which style?', options: [{ id: 'clean', label: 'Clean' }] }],
    [{ id: 'style', prompt: 'Which style?', options: [{ id: 'clean', label: 'Clean' }] }],
  ]) {
    assert.throws(() => brief.assertAnnotationQuestion(messages, wrong), /image_edit_method|annotate/)
  }
})

test('annotation gate stays off without the command, and without any source still', () => {
  assert.equal(brief.annotationBrief([{ role: 'user', content: 'Edit this photo' }]), null)
  assert.doesNotThrow(() => brief.assertAnnotationQuestion([{ role: 'user', content: 'Edit this photo' }], []))

  const commandOnly = [{ role: 'user', content: '/image-annotation-edit' }]
  assert.equal(brief.annotationBrief(commandOnly).sourceUrls.length, 0)
  // No still to annotate: the agent must ask for an upload in chat instead of a card.
  assert.doesNotThrow(() => brief.assertAnnotationQuestion(commandOnly, []))
  assert.deepEqual(Array.from(brief.annotationBrief(commandOnly, [sourceUrl]).sourceUrls), [sourceUrl])
})

test('a saved annotation forces generation once and never a second card', () => {
  const saved = annotationTurn(
    askCall([methodQuestion]),
    askResult({
      ok: true,
      answers: [{
        questionId: 'image_edit_method',
        optionId: 'annotate',
        annotationEdit: { ...edit, annotatedImageUrl: '/media/agent-lab/session/guide.png' },
      }],
    }),
  )
  const state = brief.annotationBrief(saved)
  assert.equal(state.confirmed, true)
  assert.equal(state.generationSubmitted, false)
  assert.throws(() => brief.assertAnnotationQuestion(saved, [methodQuestion]), /generate_image/)

  const generated = [...saved, { role: 'assistant', content: null, tool_calls: [{ id: 'gen', type: 'function', function: { name: 'generate_image', arguments: '{}' } }] }]
  assert.equal(brief.annotationBrief(generated).generationSubmitted, true)
})

test('answering or skipping the method card releases the gate', () => {
  for (const result of [
    { ok: true, skipped: true, message: 'User skipped.' },
    { ok: true, answers: [{ questionId: 'image_edit_method', optionId: 'describe', label: 'Describe' }] },
  ]) {
    const messages = annotationTurn(askCall([methodQuestion]), askResult(result))
    const state = brief.annotationBrief(messages)
    assert.equal(state.methodAnswered, true)
    assert.equal(state.confirmed, false)
    assert.doesNotThrow(() => brief.assertAnnotationQuestion(messages, [{ id: 'result_fix_decision', prompt: 'Fix it?', options: [{ id: 'fix', label: 'Fix' }] }]))
  }

  const failed = annotationTurn(askCall([methodQuestion]), askResult({ ok: false, error: 'Could not load the source image.' }))
  assert.equal(brief.annotationBrief(failed).methodAnswered, false)
  assert.throws(() => brief.assertAnnotationQuestion(failed, [{ id: 'style', prompt: 'Which style?', options: [] }]), /image_edit_method/)
})

test('forced annotation ask_user args open the editor checkpoint', () => {
  const args = brief.annotationAskUserArgs('zh')
  assert.equal(args.questions.length, 1)
  assert.equal(args.questions[0].id, 'image_edit_method')
  assert.equal(args.questions[0].recommendedId, 'annotate')
  assert.ok(args.questions[0].options.some(option => option.id === 'annotate'))
  assert.doesNotThrow(() => brief.assertAnnotationQuestion(annotationTurn(), args.questions))
})

test('next Seedream image call orders source, guide, and globally deduplicated references', async () => {
  const guide = '/media/agent-lab/session/guide.png'
  const dog = '/media/projects/dog.png'
  const tree = '/media/projects/tree.png'
  const confirmed = {
    ...edit,
    annotatedImageUrl: guide,
    points: [
      { ...edit.points[0], references: [{ name: 'dog', url: dog }] },
      { ...edit.points[1], references: [{ name: 'dog again', url: dog }, { name: 'tree', url: tree }] },
    ],
  }
  const registry = load('shared/utils/agentModels.ts')
  const models = load('server/agent/models.ts', {
    './imageAnnotations': {
      confirmedAnnotationEdit: () => confirmed,
      annotationReferenceImages: (_edit, additional = []) => [...new Set([sourceUrl, guide, dog, tree, ...additional])].slice(0, 10),
    },
    './mediaModels': {
      availableAgentModels: () => registry.AGENT_MODELS,
      resolveAgentGenerationSpec: (model, input) => ({
        modelId: model.id,
        input,
        backendModelId: 'doubao-seedream-5-0-pro-260628',
        provider: 'ark-image',
        protocolVersion: 'ark-images-sync-v1',
        providerMetadata: {},
        requestBody: {},
      }),
    },
    './queuedGeneration': {},
    '../utils/storedMediaUrl.mjs': {
      canonicalMediaUrl: value => typeof value === 'string' && (/^https?:\/\//.test(value) || value.startsWith('/media/')) ? value : '',
    },
  })
  const session = { images: [], messages: [] }
  const args = await models.prepareModelGeneration(
    registry.agentModelToolName('seedream/5-pro-image-to-image'),
    JSON.stringify({ prompt: 'Follow annotation points', input_urls: [tree, dog, sourceUrl] }),
    session,
  )
  assert.equal(args.modelId, 'seedream/5-pro-reference-to-image')
  assert.deepEqual(Array.from(args.input.input_urls), [sourceUrl, guide, dog, tree])
  assert.equal(args.input.prompt, 'Follow annotation points')
  assert.ok(args.input.input_urls.length <= 10)
})
