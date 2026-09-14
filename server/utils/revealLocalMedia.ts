import { spawn } from 'node:child_process'
import { dirname } from 'node:path'
import process from 'node:process'
import { storedMediaFile } from './localMedia'
import { storedMediaKey } from './storedMediaUrl.mjs'

interface RevealChild {
  kill: () => void
  once: (event: 'error' | 'close', listener: (value?: unknown) => void) => void
}

type SpawnFn = (command: string, args: readonly string[], options: { stdio: 'ignore' }) => RevealChild

export class RevealLocalMediaError extends Error {
  statusCode: number

  constructor(message: string, statusCode: number) {
    super(message)
    this.name = 'RevealLocalMediaError'
    this.statusCode = statusCode
  }
}

export function revealCommand(platform: NodeJS.Platform, filePath: string) {
  if (platform === 'darwin')
    return { command: 'open', args: ['-R', filePath] }
  if (platform === 'win32')
    return { command: 'explorer', args: [`/select,${filePath}`] }
  return { command: 'xdg-open', args: [dirname(filePath)] }
}

function runReveal(command: string, args: string[], spawnFn: SpawnFn, platform: NodeJS.Platform) {
  return new Promise<void>((resolve, reject) => {
    const child = spawnFn(command, args, { stdio: 'ignore' })
    const timer = setTimeout(() => {
      child.kill()
      reject(new RevealLocalMediaError('Timed out while opening the file folder', 504))
    }, 8_000)
    child.once('error', (error) => {
      clearTimeout(timer)
      const message = error instanceof Error ? error.message : 'Could not open the file folder'
      reject(new RevealLocalMediaError(message, 500))
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (code && platform !== 'win32')
        reject(new RevealLocalMediaError('Could not open the file folder', 500))
      else
        resolve()
    })
  })
}

export async function revealLocalMedia(url: string, options: {
  spawn?: SpawnFn
  platform?: NodeJS.Platform
} = {}) {
  const key = storedMediaKey(url)
  if (!key)
    throw new RevealLocalMediaError('This file is not stored locally', 400)

  let file
  try {
    file = await storedMediaFile(key)
  }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Media file not found'
    throw new RevealLocalMediaError(
      message.includes('Invalid') ? message : 'Media file not found',
      message.includes('Invalid') ? 400 : 404,
    )
  }

  const platform = options.platform ?? process.platform
  const { command, args } = revealCommand(platform, file.path)
  const spawnFn: SpawnFn = options.spawn ?? ((cmd, spawnArgs, spawnOptions) => spawn(cmd, [...spawnArgs], spawnOptions) as unknown as RevealChild)
  await runReveal(command, args, spawnFn, platform)
}
