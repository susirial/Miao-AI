import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { after, test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { saveMediaFile, storedMediaFile } from '../server/utils/localMedia.ts'
import { configureMediaBase, storedMediaKey } from '../server/utils/storedMediaUrl.mjs'

const require = createRequire(import.meta.url)
function load(path, overrides = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const context = vm.createContext({
    exports: {},
    process,
    URL,
    setTimeout,
    clearTimeout,
    require: id => overrides[id] || require(id),
  })
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context)
  return context.exports
}

const { revealCommand, revealLocalMedia, RevealLocalMediaError } = load('../server/utils/revealLocalMedia.ts', {
  './localMedia': { storedMediaFile },
  './storedMediaUrl.mjs': { storedMediaKey },
})

const cwd = process.cwd()
const dir = await mkdtemp(join(tmpdir(), 'polox-reveal-'))
process.chdir(dir)
configureMediaBase('http://localhost:3001')
after(async () => {
  process.chdir(cwd)
  configureMediaBase('http://localhost:3001')
  await rm(dir, { recursive: true, force: true })
})

function fakeSpawn(calls, options = {}) {
  return (command, args) => {
    calls.push({ command, args })
    const child = new EventEmitter()
    child.kill = () => {}
    queueMicrotask(() => {
      if (options.error)
        child.emit('error', options.error)
      else
        child.emit('close', options.code ?? 0)
    })
    return child
  }
}

test('reveal commands never use a shell and select the file on macOS and Windows', () => {
  const file = '/tmp/miao/media/generator/local/result.png'
  const darwin = revealCommand('darwin', file)
  const windows = revealCommand('win32', file)
  const linux = revealCommand('linux', file)
  assert.equal(darwin.command, 'open')
  assert.deepEqual([...darwin.args], ['-R', file])
  assert.equal(windows.command, 'explorer')
  assert.deepEqual([...windows.args], [`/select,${file}`])
  assert.equal(linux.command, 'xdg-open')
  assert.deepEqual([...linux.args], [dirname(file)])
})

test('local media URLs spawn the platform reveal command without returning a path', async () => {
  const url = await saveMediaFile('generator/local/result.png', new Uint8Array([1, 2, 3]), 'image/png')
  const calls = []
  await revealLocalMedia(url, { platform: 'darwin', spawn: fakeSpawn(calls) })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].command, 'open')
  assert.equal(calls[0].args[0], '-R')
  assert.match(calls[0].args[1], /generator\/local\/result\.png$/)
})

test('path traversal and remote URLs cannot open a folder', async () => {
  const calls = []
  const spawn = fakeSpawn(calls)
  for (const url of ['/media/../secret', '/media/%2e%2e/secret', 'https://provider.example.com/result.png', 'file:///etc/passwd', '']) {
    await assert.rejects(revealLocalMedia(url, { spawn }), RevealLocalMediaError)
  }
  assert.equal(calls.length, 0)
})

test('missing local files fail before spawning', async () => {
  const calls = []
  await assert.rejects(
    revealLocalMedia('/media/generator/local/missing.png', { spawn: fakeSpawn(calls) }),
    error => error instanceof RevealLocalMediaError && error.statusCode === 404,
  )
  assert.equal(calls.length, 0)
})

test('Windows explorer non-zero exit is treated as success', async () => {
  const url = await saveMediaFile('generator/local/win.png', new Uint8Array([9]), 'image/png')
  const calls = []
  await revealLocalMedia(url, { platform: 'win32', spawn: fakeSpawn(calls, { code: 1 }) })
  assert.equal(calls[0].command, 'explorer')
  assert.match(calls[0].args[0], /^\/select,/)
})
