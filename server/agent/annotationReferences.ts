import type { ImageAnnotationEdit } from '~~/shared/utils/imageAnnotations'
import type { AgentSession } from './session'
import { AgentChat } from '../models/agentChat'
import { GenerationJob } from '../models/generationJob'
import { connectDatabase } from '../utils/sqlite'
import { canonicalMediaUrl } from '../utils/storedMediaUrl.mjs'

export async function validateAnnotationReferences(edit: ImageAnnotationEdit, session: AgentSession) {
  const references = [...new Set(edit.points.flatMap(point => (point.references || []).map(reference => reference.url)))]
  return validateProjectImageReferences(references, session)
}

export async function validateProjectImageReferences(references: string[], session: AgentSession) {
  const requested = references.map(canonicalMediaUrl)
  if (requested.some((url, index) => !url || url !== references[index]))
    throw new Error('Select each referenced image from the project list.')
  const allowed = new Set(
    session.images
      .filter(image => image.status === 'success' && image.kind !== 'video')
      .map(image => canonicalMediaUrl(image.url))
      .filter(Boolean),
  )
  const missing = requested.filter(url => !allowed.has(url))
  if (!missing.length)
    return
  if (!session.projectId)
    throw new Error('Reference images must belong to this project.')

  await connectDatabase()
  const scope = { projectId: session.projectId }
  const [jobs, chats] = await Promise.all([
    GenerationJob.find({
      ...scope,
      state: 'success',
      deleted: { $ne: true },
      category: { $ne: 'Video' },
      resultUrls: { $in: missing },
    }).select('resultUrls').lean(),
    AgentChat.find({
      ...scope,
      'images.url': { $in: missing },
    }).select('images').lean(),
  ])
  for (const job of jobs) {
    for (const url of job.resultUrls || [])
      allowed.add(canonicalMediaUrl(url))
  }
  for (const chat of chats) {
    for (const image of chat.images || []) {
      if (image.status === 'success' && image.kind !== 'video')
        allowed.add(canonicalMediaUrl(image.url))
    }
  }
  if (requested.some(url => !allowed.has(url)))
    throw new Error('A reference image is no longer available in this project. Select it again.')
}
