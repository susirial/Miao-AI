import { existsSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

let fatalReported = false

function post(message) {
  process.parentPort?.postMessage(message)
}

function fatal(error) {
  if (fatalReported)
    return
  fatalReported = true
  post({
    type: 'fatal',
    message: error instanceof Error ? error.stack || error.message : String(error),
  })
  process.exitCode = 1
  setTimeout(() => process.exit(1), 50)
}

async function waitForHealth(baseUrl, token, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/agent/health`, {
        headers: { 'x-miao-desktop-token': token },
      })
      if (response.ok)
        return
      lastError = new Error(`Health check returned ${response.status}`)
    }
    catch (error) {
      lastError = error
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`The local service did not become ready: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

async function start(config) {
  const port = Number(config?.port)
  const serverEntry = String(config?.serverEntry || '')
  const dataDir = String(config?.dataDir || '')
  const workDir = String(config?.workDir || '')
  const token = String(config?.token || '')
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('Invalid local service port')
  if (!isAbsolute(serverEntry) || !existsSync(serverEntry))
    throw new Error(`Missing Nitro server entry: ${serverEntry}`)
  if (!isAbsolute(dataDir) || !isAbsolute(workDir))
    throw new Error('Desktop data paths must be absolute')
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new Error('Invalid desktop session token')

  process.chdir(workDir)
  const baseUrl = `http://127.0.0.1:${port}`
  Object.assign(process.env, {
    HOST: '127.0.0.1',
    NITRO_HOST: '127.0.0.1',
    PORT: String(port),
    NITRO_PORT: String(port),
    NODE_ENV: 'production',
    MIAO_DATA_DIR: dataDir,
    MIAO_DESKTOP_TOKEN: token,
    NUXT_PUBLIC_I18N_BASE_URL: baseUrl,
    NUXT_PUBLIC_SITE_URL: baseUrl,
  })

  await import(pathToFileURL(serverEntry).href)
  await waitForHealth(baseUrl, token)
  post({ type: 'ready', baseUrl })
}

process.on('uncaughtException', fatal)
process.on('unhandledRejection', fatal)
process.parentPort?.once('message', event => void start(event.data).catch(fatal))
