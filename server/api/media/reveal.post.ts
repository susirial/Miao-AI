import { revealLocalMedia, RevealLocalMediaError } from '../../utils/revealLocalMedia'

export default defineEventHandler(async (event) => {
  const body = await readBody(event) as { url?: unknown }
  const url = typeof body?.url === 'string' ? body.url.trim() : ''
  if (!url)
    throw createError({ statusCode: 400, statusMessage: 'A local media URL is required' })
  try {
    await revealLocalMedia(url)
    setHeader(event, 'Cache-Control', 'private, no-store')
    return { ok: true }
  }
  catch (error) {
    const statusCode = error instanceof RevealLocalMediaError ? error.statusCode : 500
    throw createError({
      statusCode,
      statusMessage: error instanceof Error ? error.message : 'Could not open the file folder',
    })
  }
})
