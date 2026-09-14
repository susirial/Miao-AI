import type { AgentGenerationSpec } from './mediaModels'
import type { AgentSession } from './session'
import type { AgentEvent, AgentImage } from './types'
import { isGenerationFailureRetryable } from '../../shared/types/generation'
import { GenerationJob } from '../models/generationJob'
import { agentResultTaskId } from '../utils/agentJobs'
import { generationResultUrls } from '../utils/generationResults'
import { refreshGenerationJob } from '../utils/generationPipeline'
import { persistNow, upsertImage } from './session'
import { acquireGenerationSlot } from './slots'

const AGENT_QUEUE_WAIT_MS = 40 * 60 * 1000
const AGENT_QUEUE_POLL_MS = 2500

function wait(ms: number, signal?: AbortSignal) {
  if (signal?.aborted)
    return Promise.reject(new Error('Generation wait was stopped'))
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimeout(timer)
      reject(new Error('Generation wait was stopped'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export async function runQueuedAgentGeneration(input: {
  session: AgentSession
  callId: string
  toolName: string
  image: AgentImage
  spec: AgentGenerationSpec
  emit: (event: AgentEvent) => void
  signal?: AbortSignal
}) {
  const { session, callId, toolName, image, spec, emit, signal } = input
  const generating: AgentImage = {
    ...image,
    id: callId,
    modelId: spec.modelId,
    modelInput: spec.input,
    status: 'generating',
    url: '',
    error: '',
  }
  upsertImage(session, generating)
  persistNow(session)
  emit({ type: 'status', status: 'generating' })
  emit({ type: 'image', image: generating })
  emit({ type: 'tool', name: toolName, status: 'start', callId })
  let savedJob = false
  let terminalFailure = false
  try {
    if (signal?.aborted)
      throw new Error('Generation stopped')
    const slot = await acquireGenerationSlot({
      sessionId: session.id,
      callId,
      projectId: session.projectId,
      meta: {
        kind: generating.kind,
        prompt: generating.prompt,
        aspectRatio: generating.aspectRatio,
        resolution: generating.resolution,
        duration: generating.duration,
        sourceUrl: generating.sourceUrl,
        inputUrls: generating.inputUrls,
        referenceVideoUrls: generating.referenceVideoUrls,
        videoMode: generating.videoMode,
        videoFamily: generating.videoFamily,
        modelId: spec.modelId,
        modelInput: spec.input,
        requestModel: spec.backendModelId,
        provider: spec.provider,
        backendModelId: spec.backendModelId,
        protocolVersion: spec.protocolVersion,
        providerMetadata: spec.providerMetadata,
        requestBody: spec.requestBody,
        category: spec.category,
        task: spec.task,
      },
    })
    savedJob = true
    if (slot.queued) {
      emit({ type: 'status', status: 'queued' })
      emit({ type: 'queue', limit: slot.limit, active: slot.active, message: slot.message })
    }
    const deadline = Date.now() + AGENT_QUEUE_WAIT_MS
    while (Date.now() < deadline) {
      if (signal?.aborted) {
        persistNow(session)
        return JSON.stringify({ ok: false, pending: true, error: 'Generation continues in the background' })
      }
      const stored = await GenerationJob.findOne({
        taskId: agentResultTaskId(callId),
        deleted: { $ne: true },
      })
      if (!stored)
        throw new Error('Generation job was not saved')
      const job = await refreshGenerationJob(stored)
      if (job.providerTaskId && generating.providerTaskId !== job.providerTaskId) {
        generating.providerTaskId = job.providerTaskId
        upsertImage(session, generating)
        persistNow(session)
      }
      if (job.state === 'fail') {
        const message = job.failMsg || 'Generation failed'
        const failCode = String(job.failCode || '').trim()
        const failed: AgentImage = {
          ...generating,
          status: 'fail',
          url: '',
          error: message,
          failCode,
          retryable: isGenerationFailureRetryable(failCode),
        }
        upsertImage(session, failed)
        persistNow(session)
        emit({ type: 'image', image: failed })
        return JSON.stringify({
          ok: false,
          error: message,
          failCode,
          retryable: failed.retryable,
        })
      }
      if (job.state === 'success') {
        const resultUrls = generationResultUrls(job)
        if (!resultUrls.length) {
          terminalFailure = true
          throw new Error('Generation completed without result URLs')
        }
        for (const [index, url] of resultUrls.entries()) {
          const next: AgentImage = {
            ...generating,
            id: index ? `${callId}_${index}` : callId,
            name: generating.name,
            status: 'success',
            url,
            error: '',
          }
          upsertImage(session, next)
          emit({ type: 'image', image: next })
        }
        persistNow(session)
        return JSON.stringify({
          ok: true,
          taskId: job.taskId,
          providerTaskId: job.providerTaskId,
          model: spec.modelId,
          name: generating.name,
          urls: resultUrls,
          prompt: generating.prompt,
          aspect_ratio: generating.aspectRatio,
          resolution: generating.resolution,
          duration: generating.duration,
        })
      }
      emit({ type: 'status', status: job.state === 'queued' ? 'queued' : 'generating' })
      await wait(AGENT_QUEUE_POLL_MS, signal)
    }
    persistNow(session)
    return JSON.stringify({ ok: false, pending: true, error: 'Generation continues in the background' })
  }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Generation failed'
    if (savedJob && !terminalFailure) {
      persistNow(session)
      return JSON.stringify({ ok: false, pending: true, error: 'Generation continues in the background' })
    }
    const failCode = String((error as { failCode?: unknown })?.failCode || '').trim()
    const failed: AgentImage = {
      ...generating,
      status: 'fail',
      url: '',
      error: message,
      failCode,
      retryable: isGenerationFailureRetryable(failCode),
    }
    upsertImage(session, failed)
    persistNow(session)
    emit({ type: 'image', image: failed })
    return JSON.stringify({
      ok: false,
      error: message,
      failCode,
      retryable: failed.retryable,
    })
  }
  finally {
    emit({ type: 'tool', name: toolName, status: 'end', callId })
  }
}
