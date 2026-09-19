import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../app/composables/useServiceConnection.ts', import.meta.url), 'utf8')
function harness(fetch) {
  const open = { value: false }; const module = { exports: {} }
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { module, exports: module.exports, useState: () => open, $fetch: fetch })
  return { open, api: module.exports.useServiceConnection() }
}
for (const kind of ['disconnected', 'unavailable', 'connected']) {
  test(`send gate: ${kind}`, async () => {
    let calls = 0
    const h = harness(async (url) => {
      assert.equal(url, '/api/settings/services'); calls++; if (kind === 'unavailable')
        throw new Error('offline'); return { connected: kind === 'connected' }
    })
    assert.equal(await h.api.ensureConnected(), kind === 'connected')
    assert.equal(h.open.value, kind !== 'connected')
    assert.equal(calls, 1)
  })
}
for (const scenario of [
  { name: 'Agnes image uses Agnes readiness', model: 'agnes/image-2.5-flash-text-to-image', providers: { ark: { ok: false }, agnes: { ok: true } }, allowed: true },
  { name: 'Agnes video rejects Ark-only readiness', model: 'agnes/video-2.5-flash-text-to-video', providers: { ark: { ok: true }, agnes: { ok: false } }, allowed: false },
  { name: 'Seedream image uses Ark readiness', model: 'seedream/5-pro-text-to-image', providers: { ark: { ok: true }, agnes: { ok: false } }, allowed: true },
  { name: 'Seedance video rejects Agnes-only readiness', model: 'bytedance/seedance-2-text-to-video', providers: { ark: { ok: false }, agnes: { ok: true } }, allowed: false },
  { name: 'unknown media model is not allowed', model: 'unknown/media-model', providers: { ark: { ok: true }, agnes: { ok: true } }, allowed: false },
]) {
  test(`media model gate: ${scenario.name}`, async () => {
    const h = harness(async () => ({ connected: true, imageReady: true, videoReady: true, providers: scenario.providers }))
    assert.equal(await h.api.ensureMediaModel(scenario.model), scenario.allowed)
    assert.equal(h.open.value, !scenario.allowed)
  })
}
test('blocked send never reaches the lab or clears its draft', async () => {
  const source = readFileSync(new URL('../app/composables/useAgentLab.ts', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('lab.ts', source, ts.ScriptTarget.Latest, true)
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'useAgentLab')
  let sends = 0; const lab = { draft: { value: 'Keep my message' }, sendMessage: () => { sends++; lab.draft.value = ''; return true } }
  let allowed = false
  const module = { exports: {} }
  vm.runInNewContext(ts.transpileModule(fn.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    module,
    exports: module.exports,
    useServiceConnection: () => ({ ensureConnected: async () => allowed }),
    useI18n: () => ({ locale: { value: 'zh' } }),
    uiLocale: { value: '' },
    watchEffect: fn => fn(),
    toValue: v => v,
    agentLabCacheKey: () => '',
    agentLabs: new Map(),
    effectScope: () => ({ run: fn => fn() }),
    createAgentLab: () => lab,
    shallowRef: value => ({ value }),
    watch: () => {},
    onMounted: () => {},
    onUnmounted: () => {},
    isRef: v => !!v && typeof v === 'object' && 'value' in v,
    computed: v => v,
  })
  const publicLab = module.exports.useAgentLab()
  assert.equal(await publicLab.sendMessage({ newAgent: true }), false)
  assert.equal(sends, 0)
  assert.equal(lab.draft.value, 'Keep my message')
  allowed = true
  assert.equal(await publicLab.sendMessage(), true)
  assert.equal(sends, 1)
})
