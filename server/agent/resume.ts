import type { AgentSession } from './session'
import type { AgentImage } from './types'
import { isGenerationFailureRetryable } from '../../shared/types/generation'
import { GenerationJob } from '../models/generationJob'
import { agentResultTaskId } from '../utils/agentJobs'
import { generationResultUrls } from '../utils/generationResults'
import { connectDatabase } from '../utils/sqlite'
import { activeLlmSnapshot } from '../ai/llm/registry'
import { describeErrorChain, safeLlmSnapshot } from '../ai/llm/requestLog'
import { SESSION_ORPHAN_MS } from './policy'
import { adoptStoredSnapshot, bootSessions, persistNow, upsertImage } from './session'
import { fetchRemoteInflightSessions, fetchRemotePendingConfirmSessions, fetchRemoteRecentAutoSessions } from './sessionStore'
import { completeGenerationSlot } from './slots'

const continueInFlight = new Set<string>()
const RESUME_INTERVAL_MS = 20000
let resumeTimer: ReturnType<typeof setInterval> | undefined
let resumePromise: Promise<void> | null = null
async function maybeContinueSession(session: AgentSession) {
  if (session.busy || session.stopRequested || continueInFlight.has(session.id))
    return
  if (session.images.some(item => item.status === 'generating'))
    return
  continueInFlight.add(session.id)
  try {
    const { continueAgentSession } = await import('./loop')
    await continueAgentSession(session.id)
  }
  catch (error) {
    console.error('[agent session continue]', {
      sessionId: session.id,
      ...safeLlmSnapshot(activeLlmSnapshot()),
      error: describeErrorChain(error),
    }, error)
  }
  finally {
    continueInFlight.delete(session.id)
  }
}
async function recoverImageFromJob(session: AgentSession, image: AgentImage) {
  if (image.status !== 'generating')
    return image
  try {
    await connectDatabase()
    const taskId = agentResultTaskId(image.id)
    const job = await GenerationJob.findOne({
      taskId,
      deleted: { $ne: true },
    })
    if (!job)
      return image
    const providerTaskId = String(job.providerTaskId || '').trim()
    if (providerTaskId && !String(image.providerTaskId || '').trim()) {
      const next = { ...image, providerTaskId }
      upsertImage(session, next)
      persistNow(session)
      return next
    }
    const resultUrls = generationResultUrls(job)
    const url = resultUrls[0] || ''
    if (job.state === 'success' || job.state === 'archiving' || job.state === 'moderating') {
      if (!url)
        return image
      const next: AgentImage = {
        ...image,
        providerTaskId: providerTaskId || image.providerTaskId,
        status: 'success',
        url,
        error: '',
        failCode: '',
        retryable: undefined,
      }
      upsertImage(session, next)
      if (image.modelId) {
        for (const [index, resultUrl] of resultUrls.entries()) {
          if (index)
            upsertImage(session, { ...next, id: `${image.id}_${index}`, url: resultUrl })
        }
      }
      persistNow(session)
      return next
    }
    if (job.state === 'fail') {
      const next: AgentImage = {
        ...image,
        providerTaskId: providerTaskId || image.providerTaskId,
        status: 'fail',
        url: '',
        error: String(job.failMsg || 'Generation failed'),
        failCode: String(job.failCode || ''),
        retryable: isGenerationFailureRetryable(job.failCode),
      }
      upsertImage(session, next)
      if (next.retryable === false)
        session.retryBlocked = true
      persistNow(session)
      return next
    }
  }
  catch (error) {
    console.error('[agent resume job recover]', session.id, image.id, error)
  }
  return image
}
function failOrphanGenerating(session: AgentSession) {
  if (session.busy)
    return
  const orphanMs = Math.min(SESSION_ORPHAN_MS, 2 * 60 * 1000)
  if (Date.now() - session.updatedAt < orphanMs)
    return
  let changed = false
  for (const image of session.images) {
    if (image.status !== 'generating')
      continue
    if (image.modelId)
      continue
    const message = 'Generation was interrupted. Retry this shot.'
    upsertImage(session, {
      ...image,
      status: 'fail',
      error: image.error || message,
    })
    changed = true
    void completeGenerationSlot({
      callId: image.id,
      bffUrl: session.bffUrl,
      error: image.error || message,
    })
  }
  if (changed)
    persistNow(session)
}
export function scheduleSessionResume(session: AgentSession) {
  void (async () => {
    for (const raw of [...session.images]) {
      if (raw.status !== 'generating')
        continue
      const image = await recoverImageFromJob(session, raw)
      if (image.status !== 'generating')
        continue
      // New preset and registered jobs are polled and archived by the shared pipeline.
      if (image.modelId)
        continue
    }
    failOrphanGenerating(session)
    await resumeAutoConfirm(session)
    await maybeContinueSession(session)
  })().catch(error => console.error('[agent session recovery]', session.id, error))
}
async function resumeAutoConfirm(session: AgentSession) {
  if (!session.pendingConfirmation || session.busy)
    return
  try {
    const { continueServerAutoConfirm, shouldServerAutoConfirm } = await import('./loop')
    if (!shouldServerAutoConfirm(session.confirmPolicy, session.pendingConfirmation.payload))
      return
    await continueServerAutoConfirm(session.id)
  }
  catch (error) {
    console.error('[agent auto-confirm resume]', session.id, error)
  }
}
async function resumeRemoteInflight() {
  const seen = new Set<string>()
  const snapshots = [
    ...await fetchRemoteInflightSessions(),
    ...await fetchRemotePendingConfirmSessions(),
    ...await fetchRemoteRecentAutoSessions(),
  ]
  for (const snapshot of snapshots) {
    if (seen.has(snapshot.id))
      continue
    seen.add(snapshot.id)
    const session = adoptStoredSnapshot(snapshot)
    scheduleSessionResume(session)
  }
}
async function resumeAll() {
  if (resumePromise)
    return resumePromise
  resumePromise = (async () => {
    const { finishIncompleteChatDeletions, loadPersistentSessionTombstones } = await import('../utils/agentChatDeletion')
    await loadPersistentSessionTombstones()
    await finishIncompleteChatDeletions()
    for (const session of bootSessions())
      scheduleSessionResume(session)
    await resumeRemoteInflight()
  })()
    .catch((error) => {
      console.error('[agent session resume]', error)
    })
    .finally(() => {
      resumePromise = null
    })
  return resumePromise
}
export function startSessionResumeLoop() {
  if (import.meta.prerender)
    return
  if (resumeTimer)
    return
  void resumeAll()
  resumeTimer = setInterval(() => {
    void resumeAll()
  }, RESUME_INTERVAL_MS)
}
