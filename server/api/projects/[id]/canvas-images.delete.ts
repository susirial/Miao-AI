import { canvasProject } from '../../../utils/canvasLayout'
import { removeRetainedCanvasImages } from '../../../utils/agentChatDeletion'

export default defineEventHandler(async (event) => {
  const { projectId } = await canvasProject(event)
  const body = await readBody<{
    imageIds?: unknown
  }>(event)
  const imageIds = Array.isArray(body?.imageIds)
    ? body.imageIds.map(id => String(id || '').trim()).filter(Boolean)
    : []
  try {
    return await removeRetainedCanvasImages(projectId, imageIds)
  }
  catch (error) {
    const statusCode = Number((error as { statusCode?: unknown }).statusCode || 500)
    throw createError({
      statusCode: statusCode >= 400 && statusCode < 600 ? statusCode : 500,
      statusMessage: error instanceof Error ? error.message : 'Could not delete canvas images',
    })
  }
})
