import { Buffer } from 'node:buffer'
import { timingSafeEqual } from 'node:crypto'
import process from 'node:process'

function matchesToken(actual: string, expected: string) {
  const actualBytes = Buffer.from(actual)
  const expectedBytes = Buffer.from(expected)
  return actualBytes.length === expectedBytes.length
    && timingSafeEqual(actualBytes, expectedBytes)
}

export default defineEventHandler((event) => {
  const expected = String(process.env.MIAO_DESKTOP_TOKEN || '').trim()
  if (!expected)
    return
  if (getRequestURL(event).pathname.startsWith('/_i18n/'))
    return
  const actual = String(getHeader(event, 'x-miao-desktop-token') || '')
  if (!matchesToken(actual, expected)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Desktop session token is invalid',
    })
  }
})
