import { randomBytes } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, Menu, session, shell, utilityProcess } from 'electron'
import {
  allocateLoopbackPort,
  desktopStartUrl,
  isAllowedAppNavigation,
  isLoopbackUrl,
  isSafeExternalUrl,
  waitForUtilityReady,
} from './runtime.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const isSmokeTest = process.env.MIAO_ELECTRON_SMOKE === '1'
const smokeHoldMs = Math.min(10_000, Math.max(100, Number(process.env.MIAO_ELECTRON_SMOKE_HOLD_MS) || 100))
let mainWindow
let localService
let localServiceReady = false
let quitting = false
let quitReady = false
let logFile = ''
let applicationBaseUrl = ''

function log(message) {
  const line = `${new Date().toISOString()} ${message}`
  process.stdout.write(`[miao] ${message}\n`)
  if (!logFile)
    return
  try {
    appendFileSync(logFile, `${line}\n`, 'utf8')
  }
  catch {
    // Logging must never prevent the desktop app from starting.
  }
}

function packagedPath(...parts) {
  return join(process.resourcesPath, ...parts)
}

function runtimePaths() {
  if (app.isPackaged) {
    return {
      childEntry: packagedPath('app.asar.unpacked', 'electron', 'nitro-child.mjs'),
      serverEntry: packagedPath('app-server', 'server', 'index.mjs'),
    }
  }
  return {
    childEntry: join(ROOT, 'electron', 'nitro-child.mjs'),
    serverEntry: join(ROOT, '.output', 'server', 'index.mjs'),
  }
}

function configuredDevUrl() {
  if (app.isPackaged)
    return ''
  const value = String(process.env.MIAO_ELECTRON_DEV_URL || '').trim()
  if (!value)
    return ''
  if (!isLoopbackUrl(value))
    throw new Error('MIAO_ELECTRON_DEV_URL must be a loopback HTTP(S) URL')
  return new URL(value).href.replace(/\/$/, '')
}

function streamChildLogs(child) {
  child.stdout?.on('data', chunk => log(`[service] ${String(chunk).trimEnd()}`))
  child.stderr?.on('data', chunk => log(`[service:error] ${String(chunk).trimEnd()}`))
}

async function stopLocalService(child = localService) {
  if (!child?.pid)
    return
  if (child === localService)
    localService = undefined
  const exited = new Promise(resolve => child.once('exit', resolve))
  try {
    process.kill(child.pid, 'SIGTERM')
  }
  catch {
    return
  }
  const timer = new Promise((_, reject) => {
    const timeout = setTimeout(() => reject(new Error('shutdown timeout')), 5_000)
    timeout.unref?.()
  })
  try {
    await Promise.race([exited, timer])
  }
  catch {
    child.kill()
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 2_000))])
  }
}

async function startLocalService() {
  const paths = runtimePaths()
  if (!existsSync(paths.serverEntry))
    throw new Error(`Missing production server at ${paths.serverEntry}. Run pnpm build first.`)
  if (!existsSync(paths.childEntry))
    throw new Error(`Missing Electron service entry at ${paths.childEntry}`)

  const token = randomBytes(32).toString('hex')
  const dataDir = join(app.getPath('userData'), 'data')
  mkdirSync(dataDir, { recursive: true })

  for (let attempt = 1; attempt <= 3; attempt++) {
    const port = await allocateLoopbackPort()
    const child = utilityProcess.fork(paths.childEntry, [], {
      cwd: app.getPath('userData'),
      env: process.env,
      serviceName: 'Miao Local Service',
      stdio: 'pipe',
    })
    localService = child
    streamChildLogs(child)
    child.on('exit', (code, signal) => {
      log(`Local service exited (code ${code ?? 'unknown'}, signal ${signal ?? 'none'})`)
      if (child === localService)
        localService = undefined
      if (localServiceReady && !quitting) {
        localServiceReady = false
        dialog.showErrorBox('Miao local service stopped', 'Restart Miao to continue. Your local data is safe.')
        app.quit()
      }
    })

    const ready = waitForUtilityReady(child)
    child.postMessage({
      port,
      token,
      dataDir,
      workDir: app.getPath('userData'),
      serverEntry: paths.serverEntry,
    })
    try {
      const result = await ready
      localServiceReady = true
      log(`Local service ready at ${result.baseUrl}`)
      return { baseUrl: result.baseUrl, token }
    }
    catch (error) {
      await stopLocalService(child)
      if (attempt === 3 || !String(error).includes('EADDRINUSE'))
        throw error
      log(`Loopback port collision; retrying local service startup (${attempt}/3)`)
    }
  }
  throw new Error('Could not start the local service')
}

const CLIPBOARD_WRITE_PERMISSIONS = new Set(['clipboard-sanitized-write', 'clipboard-write'])

function installDesktopSessionSecurity(baseUrl, token) {
  const origin = new URL(baseUrl).origin
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(CLIPBOARD_WRITE_PERMISSIONS.has(permission))
  })
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return CLIPBOARD_WRITE_PERMISSIONS.has(permission)
  })
  if (token) {
    session.defaultSession.webRequest.onBeforeSendHeaders(
      { urls: [`${origin}/*`] },
      (details, callback) => {
        callback({
          requestHeaders: {
            ...details.requestHeaders,
            'X-Miao-Desktop-Token': token,
          },
        })
      },
    )
  }
}

function openExternal(value) {
  if (isSafeExternalUrl(value))
    void shell.openExternal(value)
}

function createApplicationMenu() {
  const viewItems = [
    { role: 'resetZoom' },
    { role: 'zoomIn' },
    { role: 'zoomOut' },
  ]
  if (!app.isPackaged) {
    viewItems.push(
      { type: 'separator' },
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
    )
  }
  const template = [
    ...(process.platform === 'darwin'
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        }]
      : []),
    { role: 'editMenu' },
    { label: 'View', submenu: viewItems },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [{
        label: 'Miao on GitHub',
        click: () => openExternal('https://github.com/susirial/Miao-AI'),
      }],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

async function createMainWindow(baseUrl) {
  const appOrigin = new URL(baseUrl).origin
  const window = new BrowserWindow({
    title: 'Miao',
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#f7f7f4',
    webPreferences: {
      contextIsolation: true,
      devTools: !app.isPackaged,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      webSecurity: true,
    },
  })
  mainWindow = window

  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (isAllowedAppNavigation(url, appOrigin))
      return
    event.preventDefault()
    openExternal(url)
  })
  window.webContents.on('will-attach-webview', event => event.preventDefault())
  window.webContents.on('render-process-gone', (_event, details) => {
    log(`Renderer process exited: ${details.reason}`)
    if (!quitting)
      dialog.showErrorBox('Miao window stopped', 'Reload or restart Miao to continue. Your local data is safe.')
  })
  window.once('ready-to-show', () => {
    if (!isSmokeTest)
      window.show()
  })
  window.on('closed', () => {
    if (mainWindow === window)
      mainWindow = undefined
  })

  await window.loadURL(baseUrl)
  if (isSmokeTest) {
    log('Packaged smoke test passed')
    process.stdout.write('MIAO_ELECTRON_SMOKE_OK\n')
    setTimeout(() => app.quit(), smokeHoldMs)
  }
  return window
}

async function startApplication() {
  app.setName('Miao')
  app.setAboutPanelOptions({
    applicationName: 'Miao',
    applicationVersion: app.getVersion(),
    copyright: 'MIT License',
  })
  app.setAppLogsPath()
  logFile = join(app.getPath('logs'), 'miao.log')
  log(`Starting Miao ${app.getVersion()} (${process.arch})`)

  const devUrl = configuredDevUrl()
  const runtime = devUrl ? { baseUrl: devUrl, token: '' } : await startLocalService()
  if (isSmokeTest && runtime.token) {
    const unauthorized = await fetch(`${runtime.baseUrl}/api/agent/health`)
    if (unauthorized.status !== 403)
      throw new Error(`Desktop token boundary failed (expected 403, received ${unauthorized.status})`)
  }
  const localeCookies = await session.defaultSession.cookies.get({
    url: runtime.baseUrl,
    name: 'miao-locale',
  })
  const savedLocale = localeCookies[0]?.value
  const preferredLocale = savedLocale === 'en' || savedLocale === 'zh'
    ? savedLocale
    : app.getLocale()
  applicationBaseUrl = desktopStartUrl(runtime.baseUrl, preferredLocale)
  installDesktopSessionSecurity(runtime.baseUrl, runtime.token)
  createApplicationMenu()
  await createMainWindow(applicationBaseUrl)
}

function focusMainWindow() {
  if (!mainWindow)
    return
  if (mainWindow.isMinimized())
    mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function failApplication(error) {
  const message = error instanceof Error ? error.stack || error.message : String(error)
  log(`Fatal startup error: ${message}`)
  process.exitCode = 1
  dialog.showErrorBox('Miao could not start', message)
  app.quit()
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
}
else {
  app.on('second-instance', focusMainWindow)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && applicationBaseUrl)
      void createMainWindow(applicationBaseUrl).catch(failApplication)
    else
      focusMainWindow()
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
      app.quit()
  })
  app.on('before-quit', (event) => {
    quitting = true
    if (quitReady || !localService)
      return
    event.preventDefault()
    void stopLocalService().finally(() => {
      quitReady = true
      app.quit()
    })
  })
  void app.whenReady().then(startApplication).catch(failApplication)
}
