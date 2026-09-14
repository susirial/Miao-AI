import type { AgentResultItem } from '../../utils/agentJobs'
import { recordAgentResults } from '../../utils/agentJobs'
import { toPublicApiError } from '../../utils/httpError'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    projectId?: string
    items?: AgentResultItem[]
  }>(event)
  const projectId = String(body?.projectId || '').trim()
  const items = Array.isArray(body?.items) ? body.items : []
  if (!projectId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'projectId is required',
    })
  }
  try {
    return await recordAgentResults(projectId, items)
  }
  catch (error) {
    const statusCode = Number((error as { statusCode?: number })?.statusCode || 0)
    if (statusCode < 400 || statusCode >= 500)
      console.error('[agent-results]', error)
    throw toPublicApiError(error, 'Could not save canvas results')
  }
})
