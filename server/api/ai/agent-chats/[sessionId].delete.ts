import { isAgentSessionId } from '../../../utils/agentChats'
import { deleteAgentConversation } from '../../../utils/agentChatDeletion'
import { connectDatabase } from '../../../utils/sqlite'

export default defineEventHandler(async (event) => {
  const sessionId = String(getRouterParam(event, 'sessionId') || '').trim()
  if (!isAgentSessionId(sessionId)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid session',
    })
  }
  const query = getQuery(event)
  const body = await readBody<{
    projectId?: string
    retainImages?: unknown
  }>(event).catch(() => ({} as { projectId?: string, retainImages?: unknown }))
  await connectDatabase()
  try {
    return await deleteAgentConversation({
      sessionId,
      projectId: String(body?.projectId || query.projectId || ''),
      retainImages: body?.retainImages,
    })
  }
  catch (error) {
    const statusCode = Number((error as { statusCode?: unknown }).statusCode || 500)
    throw createError({
      statusCode: statusCode >= 400 && statusCode < 600 ? statusCode : 500,
      statusMessage: error instanceof Error ? error.message : 'Could not delete the conversation',
    })
  }
})
