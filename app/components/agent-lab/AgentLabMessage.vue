<script setup lang="ts">
import type { AgentImage } from '~/composables/useAgentLab'
import { Check, Copy } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { displayModelMentions } from '~~/shared/utils/agentModels'
import { AGENT_INTERRUPT_NOTE, AGENT_STOP_NOTE, AGENT_STOP_WITH_GENERATIONS_NOTE } from '~~/shared/utils/agentStopNote'
import { copyTextToClipboard } from '~/utils/clipboard'
import { copyableUserInstruction } from '~/utils/toolAgentRequest'

const props = defineProps<{
  message: { role: 'user' | 'assistant', content: string, kind?: string, streaming?: boolean }
  images: AgentImage[]
  hasInFlightGenerations?: boolean
  lazy?: boolean
}>()

const { t } = useI18n()
const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | undefined
const displayContent = computed(() => {
  if (props.message.role !== 'assistant')
    return props.message.content
  if (props.message.content === AGENT_INTERRUPT_NOTE)
    return t('chat.interrupted')
  if (props.message.content === AGENT_STOP_WITH_GENERATIONS_NOTE)
    return t(props.hasInFlightGenerations ? 'chat.stoppedWithGenerations' : 'chat.stopped')
  if (props.message.content === AGENT_STOP_NOTE)
    return t('chat.stopped')
  return props.message.content
})

const copyText = computed(() => {
  if (props.message.role !== 'user' || props.message.kind === 'error')
    return ''
  return copyableUserInstruction(props.message.content)
})

async function copyInstruction() {
  if (!copyText.value || !import.meta.client)
    return
  try {
    await copyTextToClipboard(copyText.value)
    copied.value = true
    toast.success(t('chat.copiedInstruction'), { duration: 2000 })
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      copied.value = false
    }, 1500)
  }
  catch {
    copied.value = false
    toast.error(t('chat.copyInstructionFailed'))
  }
}

onBeforeUnmount(() => {
  clearTimeout(copiedTimer)
})
</script>

<template>
  <p v-if="message.kind === 'error'" class="text-xs text-destructive" role="alert">
    {{ displayModelMentions(displayContent) }}
  </p>
  <article v-else-if="message.content" class="flex" :class="message.role === 'user' ? 'justify-end' : 'justify-start'">
    <div
      class="max-w-[92%]"
      :class="copyText ? 'group/user-msg relative' : ''"
    >
      <div
        class="rounded-xl px-3 py-2 text-sm leading-6"
        :class="message.role === 'user' ? 'bg-foreground text-background' : 'border border-border bg-card text-foreground'"
      >
        <AgentLabUserMessage v-if="message.role === 'user'" :content="message.content" />
        <AgentLabMarkdown v-else :source="displayContent" :streaming="message.streaming" :media-urls="images.map(image => image.url)" />
      </div>
      <button
        v-if="copyText"
        type="button"
        class="agent-lab-copy-instruction absolute top-full right-0 z-10 flex pt-1 text-muted-foreground transition-[color,opacity] duration-150 hover:text-foreground focus-visible:text-foreground focus-visible:outline-none focus-visible:[&>span]:ring-2 focus-visible:[&>span]:ring-ring motion-reduce:transition-none"
        :class="copied ? 'text-foreground' : ''"
        :aria-label="copied ? t('chat.copiedInstruction') : t('chat.copyInstruction')"
        @click.stop="copyInstruction"
      >
        <span class="flex size-6 items-center justify-center rounded-lg">
          <Check v-if="copied" class="size-3.5" aria-hidden="true" />
          <Copy v-else class="size-3.5" aria-hidden="true" />
        </span>
      </button>
    </div>
  </article>
  <div v-if="$slots.default || images.length" class="flex flex-col gap-1.5">
    <slot />
    <div v-if="images.length" class="flex flex-wrap gap-2" :class="message.role === 'user' ? 'justify-end' : 'justify-start'">
      <AgentLabChatThumb v-for="image in images" :key="image.id" :image="image" :lazy="lazy" />
    </div>
  </div>
</template>

<style scoped>
@media (hover: hover) {
  .agent-lab-copy-instruction {
    pointer-events: none;
    opacity: 0;
  }

  .group\/user-msg:hover .agent-lab-copy-instruction,
  .group\/user-msg:focus-within .agent-lab-copy-instruction {
    pointer-events: auto;
    opacity: 1;
  }
}
</style>
