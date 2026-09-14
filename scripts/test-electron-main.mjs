import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createServer } from 'node:net'
import { test } from 'node:test'
import {
  allocateLoopbackPort,
  desktopStartUrl,
  isAllowedAppNavigation,
  isLoopbackUrl,
  isSafeExternalUrl,
  waitForUtilityReady,
} from '../electron/runtime.mjs'

test('desktop runtime allocates a free loopback port', async () => {
  const port = await allocateLoopbackPort()
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
})

test('desktop navigation accepts only the app origin and safe external protocols', () => {
  assert.equal(isLoopbackUrl('http://127.0.0.1:43123'), true)
  assert.equal(isLoopbackUrl('http://localhost:3001'), true)
  assert.equal(isLoopbackUrl('https://example.com'), false)
  assert.equal(isAllowedAppNavigation('http://127.0.0.1:43123/projects', 'http://127.0.0.1:43123'), true)
  assert.equal(isAllowedAppNavigation('http://127.0.0.1:43124/projects', 'http://127.0.0.1:43123'), false)
  assert.equal(isSafeExternalUrl('https://github.com/susirial/Miao-AI'), true)
  assert.equal(isSafeExternalUrl('mailto:hello@example.com'), true)
  assert.equal(isSafeExternalUrl('file:///etc/passwd'), false)
  assert.equal(isSafeExternalUrl('javascript:alert(1)'), false)
})

test('desktop starts on the localized projects workspace', () => {
  assert.equal(desktopStartUrl('http://127.0.0.1:43123', 'en-US'), 'http://127.0.0.1:43123/projects')
  assert.equal(desktopStartUrl('http://127.0.0.1:43123/', 'zh-CN'), 'http://127.0.0.1:43123/zh/projects')
})

test('desktop startup handshake distinguishes readiness and fatal service errors', async () => {
  const readyChild = new EventEmitter()
  const ready = waitForUtilityReady(readyChild)
  readyChild.emit('message', { type: 'ready', baseUrl: 'http://127.0.0.1:43123' })
  assert.deepEqual(await ready, { type: 'ready', baseUrl: 'http://127.0.0.1:43123' })

  const failedChild = new EventEmitter()
  const failed = waitForUtilityReady(failedChild)
  failedChild.emit('message', { type: 'fatal', message: 'startup failed' })
  await assert.rejects(failed, /startup failed/)
})
