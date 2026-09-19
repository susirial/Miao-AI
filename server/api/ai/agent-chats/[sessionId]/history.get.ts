import { AgentChat } from '../../../../models/agentChat'
import { isAgentSessionId } from '../../../../utils/agentChats'
import { readAgentHistory } from '../../../../utils/agentHistory'
import { connectDatabase } from '../../../../utils/sqlite'

export default defineEventHandler(async (event) => {
  const sessionId = String(getRouterParam(event, 'sessionId') || '')
  if (!isAgentSessionId(sessionId))
    throw createError({ statusCode: 400, statusMessage: 'Invalid session' })
  await connectDatabase()
  const chat = await AgentChat.findOne({ sessionId }).select('deletedAt')
  if (!chat || chat.deletedAt)
    throw createError({ statusCode: 404, statusMessage: 'Agent chat not found' })
  return readAgentHistory(sessionId, getQuery(event))
})
