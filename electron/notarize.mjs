import { join } from 'node:path'
import process from 'node:process'
import { notarize } from '@electron/notarize'

export default async function notarizeMacApp(context) {
  if (context.electronPlatformName !== 'darwin')
    return

  const appleId = String(process.env.APPLE_ID || '').trim()
  const appleIdPassword = String(process.env.APPLE_APP_SPECIFIC_PASSWORD || '').trim()
  const teamId = String(process.env.APPLE_TEAM_ID || '').trim()
  if (!appleId && !appleIdPassword && !teamId) {
    process.stdout.write('[notarize] Apple credentials are not set; skipping notarization.\n')
    return
  }
  if (!appleId || !appleIdPassword || !teamId)
    throw new Error('APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID must all be set for notarization.')

  const appName = context.packager.appInfo.productFilename
  await notarize({
    appBundleId: context.packager.appInfo.id,
    appPath: join(context.appOutDir, `${appName}.app`),
    appleId,
    appleIdPassword,
    teamId,
  })
}
