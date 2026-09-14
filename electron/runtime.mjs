import { createServer } from 'node:net'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

export async function allocateLoopbackPort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  if (!address || typeof address === 'string')
    throw new Error('Could not allocate a loopback port')
  return address.port
}

export function isLoopbackUrl(value) {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && LOOPBACK_HOSTS.has(url.hostname.replace(/^\[|\]$/g, '').toLowerCase())
  }
  catch {
    return false
  }
}

export function isAllowedAppNavigation(value, appOrigin) {
  try {
    return new URL(value).origin === appOrigin
  }
  catch {
    return false
  }
}

export function isSafeExternalUrl(value) {
  try {
    return ['https:', 'http:', 'mailto:'].includes(new URL(value).protocol)
  }
  catch {
    return false
  }
}

export function desktopStartUrl(baseUrl, locale) {
  const path = String(locale || '').toLowerCase().startsWith('zh')
    ? '/zh/projects'
    : '/projects'
  return new URL(path, `${baseUrl.replace(/\/$/, '')}/`).href
}

export function waitForUtilityReady(child, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    let timer
    let onMessage
    let onExit
    const cleanup = () => {
      clearTimeout(timer)
      child.off('message', onMessage)
      child.off('exit', onExit)
    }
    onMessage = (message) => {
      if (message?.type === 'ready') {
        cleanup()
        resolve(message)
      }
      else if (message?.type === 'fatal') {
        cleanup()
        reject(new Error(message.message || 'The local service failed to start'))
      }
    }
    onExit = (code) => {
      cleanup()
      reject(new Error(`The local service exited during startup (code ${code ?? 'unknown'})`))
    }
    timer = setTimeout(() => {
      cleanup()
      reject(new Error('Timed out while starting the local service'))
    }, timeoutMs)
    timer.unref?.()
    child.on('message', onMessage)
    child.on('exit', onExit)
  })
}
