import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const CHILD_FLAG = '--miao-electron-risk-child'
const PROBE_BYTES = Uint8Array.from({ length: 16 }, (_, index) => index)
const PROVIDER_ENDPOINT = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SERVER_ENTRY = resolve(ROOT, '.output/server/index.mjs')

function logResult(name, detail) {
  console.log(`[electron-risk] PASS ${name}: ${detail}`)
}

function timeoutAfter(ms, message) {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    timer.unref?.()
  })
}

async function choosePort() {
  const server = createServer()
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  assert(address && typeof address === 'object', 'Could not allocate a loopback port')
  await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()))
  return address.port
}

async function waitForHttp(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok)
        return response
      lastError = new Error(`${url} returned ${response.status}`)
    }
    catch (error) {
      lastError = error
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 100))
  }
  throw new Error(`Nitro did not become ready: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

function waitForChildMessage(child, type, timeoutMs = 20_000) {
  return Promise.race([
    new Promise((resolveMessage, reject) => {
      let cleanup = () => {}
      const onMessage = (message) => {
        if (message?.type !== type)
          return
        cleanup()
        resolveMessage(message)
      }
      const onExit = (code) => {
        cleanup()
        reject(new Error(`Utility process exited before ${type} (code ${code})`))
      }
      cleanup = () => {
        child.off('message', onMessage)
        child.off('exit', onExit)
      }
      child.on('message', onMessage)
      child.on('exit', onExit)
    }),
    timeoutAfter(timeoutMs, `Timed out waiting for utility-process message: ${type}`),
  ])
}

async function stopChild(child) {
  if (!child.pid)
    return
  const exited = new Promise(resolveExit => child.once('exit', (code, signal) => resolveExit({ code, signal })))
  process.kill(child.pid, 'SIGTERM')
  try {
    return await Promise.race([exited, timeoutAfter(5_000, 'Utility process did not stop after SIGTERM')])
  }
  catch {
    child.kill()
    return Promise.race([exited, timeoutAfter(5_000, 'Utility process could not be terminated')])
  }
}

function providerResponse(init) {
  let request = {}
  try {
    request = JSON.parse(String(init?.body || '{}'))
  }
  catch {
    // The application validates request payloads; malformed input should fail below.
  }
  if (request.stream === true) {
    const body = [
      'data: {"choices":[{"delta":{"content":"ELECTRON_SSE_OK"},"finish_reason":null}]}',
      '',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
      '',
      'data: [DONE]',
      '',
      '',
    ].join('\n')
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    })
  }
  return Response.json({
    choices: [{ message: { content: 'Electron risk probe' } }],
  })
}

async function prepareUtilityProcess(config) {
  process.chdir(config.workDir)
  const dataDir = join(config.workDir, 'user-data')
  process.env.MIAO_DATA_DIR = dataDir
  process.env.HOST = '127.0.0.1'
  process.env.NITRO_HOST = '127.0.0.1'
  process.env.PORT = String(config.port)
  process.env.NITRO_PORT = String(config.port)
  process.env.NODE_ENV = 'production'

  const [{ DatabaseSync }, { default: sharp }] = await Promise.all([
    import('node:sqlite'),
    import('sharp'),
  ])

  const mediaPath = join(dataDir, 'media/risk/range.bin')
  await mkdir(dirname(mediaPath), { recursive: true })
  await writeFile(mediaPath, PROBE_BYTES)

  const databasePath = join(dataDir, 'miao.sqlite')
  const database = new DatabaseSync(databasePath)
  database.exec('CREATE TABLE risk_probe (value TEXT NOT NULL)')
  database.prepare('INSERT INTO risk_probe(value) VALUES (?)').run('sqlite-ok')
  assert.equal(database.prepare('SELECT value FROM risk_probe').get().value, 'sqlite-ok')

  const checkedAt = new Date().toISOString()
  database.exec('CREATE TABLE local_service_settings (id INTEGER PRIMARY KEY CHECK (id = 1), body TEXT NOT NULL)')
  database.prepare('INSERT INTO local_service_settings(id, body) VALUES(1, ?)').run(JSON.stringify({
    version: 3,
    selectedTextModel: 'ark/seed-2.1-pro',
    arkKey: 'electron-risk-probe',
    revision: 'electron-risk-probe',
    arkOk: true,
    arkCheckedAt: checkedAt,
    checkedAt,
  }))
  database.close()

  const image = await sharp({
    create: {
      width: 2,
      height: 3,
      channels: 4,
      background: { r: 100, g: 180, b: 40, alpha: 1 },
    },
  }).png().toBuffer()
  const metadata = await sharp(image).metadata()
  assert.equal(metadata.width, 2)
  assert.equal(metadata.height, 3)

  const realFetch = globalThis.fetch
  globalThis.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url === PROVIDER_ENDPOINT)
      return Promise.resolve(providerResponse(init))
    return realFetch(input, init)
  }

  process.parentPort.postMessage({
    type: 'preflight',
    node: process.versions.node,
    electron: process.versions.electron,
    sqlite: 'ok',
    sharp: `${metadata.width}x${metadata.height}`,
  })

  await import(pathToFileURL(config.serverEntry).href)
  process.parentPort.postMessage({ type: 'nitro-imported' })
}

async function runUtilityChild() {
  const config = await new Promise((resolveConfig) => {
    process.parentPort.once('message', event => resolveConfig(event.data))
  })
  try {
    await prepareUtilityProcess(config)
  }
  catch (error) {
    process.parentPort.postMessage({
      type: 'fatal',
      message: error instanceof Error ? error.stack || error.message : String(error),
    })
    process.exitCode = 1
  }
}

async function runMain() {
  assert(existsSync(SERVER_ENTRY), 'Missing .output/server/index.mjs. Run `pnpm build` before the risk probe.')
  console.log('[electron-risk] Starting Electron main process...')
  const { app, utilityProcess } = await import('electron')
  console.log(`[electron-risk] Electron ${process.versions.electron || 'unknown'} imported; waiting for app readiness...`)
  await app.whenReady()
  console.log('[electron-risk] Electron app is ready.')

  const workDir = await mkdtemp(join(tmpdir(), 'miao-electron-risk-'))
  const port = await choosePort()
  let child
  let failed

  try {
    child = utilityProcess.fork(fileURLToPath(import.meta.url), [CHILD_FLAG], {
      cwd: ROOT,
      env: process.env,
      serviceName: 'Miao Nitro Risk Probe',
      stdio: 'pipe',
    })
    child.stdout?.on('data', chunk => process.stdout.write(`[nitro] ${chunk}`))
    child.stderr?.on('data', chunk => process.stderr.write(`[nitro] ${chunk}`))
    child.on('message', (message) => {
      if (message?.type === 'fatal')
        failed = new Error(message.message)
    })
    await new Promise((resolveSpawn, reject) => {
      child.once('spawn', resolveSpawn)
      child.once('exit', code => reject(new Error(`Utility process failed to spawn (exit ${code})`)))
    })
    child.postMessage({ workDir, port, serverEntry: SERVER_ENTRY })

    const preflight = await waitForChildMessage(child, 'preflight')
    assert.equal(preflight.electron, '44.3.0')
    logResult('utilityProcess runtime', `Electron ${preflight.electron}, Node ${preflight.node}`)
    logResult('node:sqlite', preflight.sqlite)
    logResult('sharp', preflight.sharp)

    const baseUrl = `http://127.0.0.1:${port}`
    const healthResponse = await waitForHttp(`${baseUrl}/api/agent/health`)
    assert.deepEqual(await healthResponse.json(), {
      ok: true,
      inProcess: true,
      tools: ['generate_image', 'generate_video', 'concat_videos', 'ask_user'],
    })
    logResult('Nitro startup', baseUrl)

    const projectsResponse = await fetch(`${baseUrl}/api/projects`)
    assert.equal(projectsResponse.status, 200)
    assert(Array.isArray((await projectsResponse.json()).items))
    logResult('SQLite through Nitro', 'project collection opened in isolated temp data')

    const rangeResponse = await fetch(`${baseUrl}/media/risk/range.bin`, {
      headers: { range: 'bytes=3-7' },
    })
    assert.equal(rangeResponse.status, 206)
    assert.equal(rangeResponse.headers.get('content-range'), `bytes 3-7/${PROBE_BYTES.length}`)
    assert.deepEqual(new Uint8Array(await rangeResponse.arrayBuffer()), PROBE_BYTES.slice(3, 8))
    logResult('media Range', rangeResponse.headers.get('content-range'))

    const sseResponse = await fetch(`${baseUrl}/api/agent/v1/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Reply with the risk-probe marker.' }),
    })
    assert.equal(sseResponse.status, 200)
    assert.match(sseResponse.headers.get('content-type') || '', /^text\/event-stream\b/)
    const sseBody = await sseResponse.text()
    assert.match(sseBody, /event: text\ndata: \{"type":"text","delta":"ELECTRON_SSE_OK"\}/)
    assert.match(sseBody, /event: done/)
    logResult('Agent SSE', 'mocked provider streamed through the real Nitro gateway')

    if (failed)
      throw failed
    const shutdown = await stopChild(child)
    child = undefined
    logResult('graceful shutdown', `exit ${shutdown?.code ?? 'unknown'}, signal ${shutdown?.signal ?? 'none'}`)
    console.log('[electron-risk] All risk checks passed.')
  }
  finally {
    if (child?.pid)
      await stopChild(child).catch(() => child.kill())
    await rm(workDir, { recursive: true, force: true })
    app.quit()
  }
}

if (process.argv.includes(CHILD_FLAG)) {
  void runUtilityChild()
}
else {
  void runMain().catch((error) => {
    console.error(`[electron-risk] FAIL\n${error instanceof Error ? error.stack || error.message : String(error)}`)
    process.exitCode = 1
  })
}
