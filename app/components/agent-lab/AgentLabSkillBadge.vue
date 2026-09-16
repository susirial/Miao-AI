<script setup lang="ts">
import type { PublicAgentSkill } from '~~/shared/utils/agentSkills'
import { X } from 'lucide-vue-next'

const props = defineProps<{
  skill: PublicAgentSkill
  removable?: boolean
  disabled?: boolean
}>()
const emit = defineEmits<{ remove: [] }>()
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
  <span
    :title="description"
    class="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-1 align-middle text-xs font-medium text-foreground shadow-[0_1px_0_rgb(0_0_0/0.03)]"
  >
    <Icon :name="skill.icon" class="size-3.5 shrink-0 text-primary" />
    <span class="truncate">{{ name }}</span>
    <span class="text-[10px] font-normal text-muted-foreground">Skill</span>
    <button
      v-if="removable"
      type="button"
      :disabled="disabled"
      :aria-label="t('skills.remove', { name })"
      class="rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      @click="emit('remove')"
    >
      <X class="size-3" />
    </button>
  </span>
</template>
