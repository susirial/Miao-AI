import { testServiceConnections } from '../../utils/serviceConnection'
import { ServiceSettingsRevisionError, updateServiceSettings } from '../../utils/serviceSettings'

export default defineEventHandler(async (event) => {
  const origin = getHeader(event, 'origin')
  if (origin && origin !== getRequestURL(event).origin)
    throw createError({ statusCode: 403, statusMessage: 'Invalid request origin' })

  const body = await readBody<Record<string, unknown>>(event)
  const stringFields = [
    'selectedTextModel',
    'arkKey',
    'deepSeekKey',
    'zaiKey',
    'tosAccessKeyId',
    'tosSecretAccessKey',
    'tosBucket',
    'tosPrefix',
    'revision',
  ]
  if (
    !body
    || typeof body !== 'object'
    || Array.isArray(body)
    || stringFields.some(key => body[key] !== undefined && (typeof body[key] !== 'string' || body[key].length > 4096))
    || (typeof body.tosBucket === 'string' && body.tosBucket.length > 63)
    || (typeof body.tosPrefix === 'string' && body.tosPrefix.length > 256)
  ) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid connection settings' })
  }

  setHeader(event, 'Cache-Control', 'no-store')
  try {
    const settings = updateServiceSettings({
      selectedTextModel: body.selectedTextModel as string | undefined,
      arkKey: body.arkKey as string | undefined,
      deepSeekKey: body.deepSeekKey as string | undefined,
      zaiKey: body.zaiKey as string | undefined,
      tosAccessKeyId: body.tosAccessKeyId as string | undefined,
      tosSecretAccessKey: body.tosSecretAccessKey as string | undefined,
      tosBucket: body.tosBucket as string | undefined,
      tosPrefix: body.tosPrefix as string | undefined,
    }, body.revision as string | undefined)
    return await testServiceConnections(settings)
  }
  catch (error) {
    if (error instanceof ServiceSettingsRevisionError)
      throw createError({ statusCode: 409, statusMessage: error.message })
    if (error instanceof TypeError)
      throw createError({ statusCode: 400, statusMessage: 'Invalid connection settings' })
    throw error
  }
})
