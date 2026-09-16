import type { ImageAnnotationEdit } from '~~/shared/utils/imageAnnotations'
import type { AgentSession } from './session'
import { Buffer } from 'node:buffer'
import sharp from 'sharp'
import { annotationMarkersSvg } from '~~/shared/utils/imageAnnotations'
import { readStoredMedia } from '../utils/localMedia'
import { downloadExportMedia } from '../utils/mediaExport'
import { uploadAgentImage } from './upload'

const MAX_SOURCE_BYTES = 30 * 1024 * 1024
const SOURCE_TIMEOUT_MS = 30_000

async function loadSourceImage(url: string, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(SOURCE_TIMEOUT_MS)
  const downloadSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
  const local = await readStoredMedia(url, MAX_SOURCE_BYTES, downloadSignal)
  if (local)
    return local.bytes
  return (await downloadExportMedia(url, MAX_SOURCE_BYTES, downloadSignal)).bytes
}

export async function renderAnnotationImage(edit: ImageAnnotationEdit, sessionId: string, signal?: AbortSignal) {
  let source: Uint8Array
  try {
    source = await loadSourceImage(edit.imageUrl, signal)
  }
  catch (error) {
    if (signal?.aborted)
      throw error
    const detail = error instanceof Error ? error.message : ''
    if (/size limit|exceeds|30mb/i.test(detail))
      throw new Error('Source images must be 30MB or smaller.')
    throw new Error('Could not safely load the source image. Please try again.')
  }
  const { data, info } = await sharp(Buffer.from(source), { limitInputPixels: 64_000_000 })
    .rotate()
    .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer({ resolveWithObject: true })
  const bytes = await sharp(data)
    .composite([{ input: Buffer.from(annotationMarkersSvg(edit.points, info.width, info.height)) }])
    .png()
    .toBuffer()
  return uploadAgentImage(sessionId, { bytes, mime: 'image/png' })
}

export function confirmedAnnotationEdit(session: Pick<AgentSession, 'messages'>): ImageAnnotationEdit | null {
  for (const message of [...session.messages].reverse()) {
    if (message.role === 'user' && !message.internal)
      break
    if (message.role !== 'tool' || typeof message.content !== 'string')
      continue
    try {
      const result = JSON.parse(message.content) as {
        ok?: boolean
        answers?: Array<{
          questionId?: string
          optionId?: string
          annotationEdit?: ImageAnnotationEdit
        }>
      }
      const answer = result.ok
        ? result.answers?.find(item =>
            item.questionId === 'image_edit_method'
            && item.optionId === 'annotate',
          )
        : undefined
      if (answer?.annotationEdit?.annotatedImageUrl)
        return answer.annotationEdit
    }
    catch {
      // Ignore unrelated tool output.
    }
  }
  return null
}

export function annotationReferenceImages(edit: ImageAnnotationEdit, additional: string[] = []) {
  const ordered = [
    edit.imageUrl,
    edit.annotatedImageUrl,
    ...edit.points.flatMap(point => (point.references || []).map(reference => reference.url)),
    ...additional,
  ]
  const seen = new Set<string>()
  const references: string[] = []
  for (const url of ordered) {
    if (!url || seen.has(url))
      continue
    seen.add(url)
    references.push(url)
    if (references.length === 10)
      break
  }
  return references
}
