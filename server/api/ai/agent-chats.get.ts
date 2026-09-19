import { listAgentChats, toWorkspaceAgentChat } from '../../utils/agentChats'
import { listRemovedSessionIds, listRetainedCanvasImages } from '../../utils/agentChatDeletion'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const projectId = String(query.projectId || '').trim()
  const knownSessionIds = String(query.knownSessionIds || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean)
  const chats = await listAgentChats(projectId)
  return {
    items: chats.map(chat => toWorkspaceAgentChat(chat)),
    retainedCanvasImages: projectId ? await listRetainedCanvasImages(projectId) : [],
    removedSessionIds: await listRemovedSessionIds(knownSessionIds),
  }
})
