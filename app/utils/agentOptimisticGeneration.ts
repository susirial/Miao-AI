import type { AgentImage, ConfirmationPayload } from '~/composables/useAgentLab'

export function buildOptimisticGenerationImages(
  payload: Pick<ConfirmationPayload, 'jobs' | 'kind'>,
  existingIds: Iterable<string> = [],
) {
  const known = new Set(existingIds)
  const staged: AgentImage[] = []
  for (const job of payload.jobs || []) {
    if (!job.id || known.has(job.id))
      continue
    known.add(job.id)
    const video = payload.kind === 'video' || /video/i.test(job.task)
    staged.push({
      id: job.id,
      optimistic: true,
      kind: video ? 'video' : 'still',
      status: 'generating',
      name: job.name,
      prompt: job.params.prompt,
      aspectRatio: job.params.aspectRatio,
      resolution: job.params.resolution,
      duration: job.params.duration,
      videoMode: job.params.videoMode,
      videoFamily: job.params.videoFamily,
      modelId: job.params.modelId,
      modelInput: job.params.modelInput,
      inputUrls: job.inputUrls,
      sourceUrl: job.inputUrls[0],
      url: '',
      error: '',
    })
  }
  return staged
}
