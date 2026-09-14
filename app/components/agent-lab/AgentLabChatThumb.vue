<script setup lang="ts">
import type { AgentImage } from '~/composables/useAgentLab'

const props = defineProps<{
  image: AgentImage
  lazy?: boolean
}>()

const { t } = useI18n()
const { open } = useMediaLightbox()
const navigateToMedia = useCanvasMediaNavigation()
const isVideo = computed(() => props.image.kind === 'video')
const ready = computed(() => props.image.status === 'success' && Boolean(props.image.url))
const label = computed(() => {
  if (props.image.status === 'fail') {
    if (isVideo.value)
      return props.image.error || 'Video generation failed'
    return props.image.error || 'Generation failed'
  }
  if (props.image.status === 'generating') {
    if (isVideo.value)
      return 'Generating video'
    return 'Generating still'
  }
  return props.image.prompt || (isVideo.value ? 'Generated video' : 'Generated still')
})

function openPreview() {
  if (!ready.value)
    return
  if (navigateToMedia) {
    void navigateToMedia(props.image.url)
    return
  }
  open({
    url: props.image.url,
    kind: isVideo.value ? 'video' : 'image',
    alt: label.value,
  })
}
</script>

<template>
  <button
    v-if="ready"
    type="button"
    :title="label"
    :aria-label="label"
    class="overflow-hidden rounded-xl border border-border bg-muted/40 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    @click="openPreview"
  >
    <video
      v-if="isVideo"
      :src="image.url"
      muted
      playsinline
      :preload="lazy ? 'none' : 'metadata'"
      class="size-20 object-cover"
    />
    <img
      v-else
      :src="image.url"
      :loading="lazy ? 'lazy' : undefined"
      decoding="async"
      :alt="label"
      class="size-20 object-cover"
    >
  </button>
  <div
    v-else
    class="relative flex size-20 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted/40"
    :title="label"
    :aria-label="label"
    :aria-busy="image.status === 'generating'"
  >
    <template v-if="image.status === 'generating'">
      <span class="chat-thumb-shimmer absolute inset-0" aria-hidden="true" />
      <span class="relative z-10 text-[10px] font-medium text-muted-foreground">{{ t('canvas.generating') }}</span>
    </template>
    <span v-else class="px-1.5 text-center text-[10px] leading-3 text-muted-foreground">
      {{ image.error || 'Failed' }}
    </span>
  </div>
</template>

<style scoped>
.agent-cutout-board {
  background-color: var(--muted);
  background-image:
    linear-gradient(45deg, var(--input) 25%, transparent 25%),
    linear-gradient(-45deg, var(--input) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, var(--input) 75%),
    linear-gradient(-45deg, transparent 75%, var(--input) 75%);
  background-size: 16px 16px;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
}
.chat-thumb-shimmer {
  background: linear-gradient(105deg, transparent 25%, color-mix(in srgb, white 78%, transparent) 46%, transparent 67%);
  transform: translateX(-100%);
  animation: chat-thumb-shimmer 1.7s ease-in-out infinite;
}
@keyframes chat-thumb-shimmer { to { transform: translateX(100%); } }
@media (prefers-reduced-motion: reduce) { .chat-thumb-shimmer { animation: none; display: none; } }
</style>
