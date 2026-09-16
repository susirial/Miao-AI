<script setup lang="ts">
import type { PublicAgentSkill } from '~~/shared/utils/agentSkills'
import SkillWorkflowPreview from '@/components/projects/SkillWorkflowPreview.vue'

const props = defineProps<{
  skill: PublicAgentSkill
}>()
const emit = defineEmits<{
  click: []
}>()

const { t, te } = useI18n()
const name = computed(() => {
  const key = `skills.items.${props.skill.id}.name`
  return te(key) ? t(key) : props.skill.name
})
const description = computed(() => {
  const key = `skills.items.${props.skill.id}.description`
  return te(key) ? t(key) : props.skill.description
})
</script>

<template>
  <button
    type="button"
    class="group flex min-h-11 w-full items-center gap-3.5 rounded-2xl border border-border bg-card p-3 text-left shadow-none transition-[color,background-color,border-color,transform] duration-150 hover:border-foreground/20 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100"
    @click="emit('click')"
  >
    <SkillWorkflowPreview :skill-id="skill.id" />
    <span class="flex min-w-0 flex-1 flex-col justify-center gap-1">
      <span class="text-sm font-medium tracking-[-0.01em] text-pretty text-foreground">
        {{ name }}
      </span>
      <span class="line-clamp-2 text-xs leading-5 text-muted-foreground">
        {{ description }}
      </span>
      <Kbd
        :title="`/${skill.id}`"
        class="mt-0.5 h-auto max-w-full self-start truncate rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] font-normal text-muted-foreground transition-colors duration-150 group-hover:text-foreground motion-reduce:transition-none"
      >
        /{{ skill.id }}
      </Kbd>
    </span>
  </button>
</template>
