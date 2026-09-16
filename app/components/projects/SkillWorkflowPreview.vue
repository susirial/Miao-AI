<script setup lang="ts">
import type { PublicAgentSkill } from '~~/shared/utils/agentSkills'

defineProps<{
  skillId: PublicAgentSkill['id']
}>()
</script>

<template>
  <span
    class="relative flex size-24 shrink-0 overflow-hidden rounded-xl bg-surface"
    aria-hidden="true"
  >
    <!-- Annotated image edit: photo frame + numbered pins -->
    <span v-if="skillId === 'image-annotation-edit'" class="absolute inset-0">
      <span class="absolute inset-3 overflow-hidden rounded-md border border-border bg-card">
        <span class="absolute inset-x-0 top-0 h-[42%] bg-muted/70" />
        <span class="absolute inset-x-2 bottom-2 h-4 rounded-sm bg-muted" />
      </span>
      <span class="absolute top-[22%] left-[16%] flex size-[18px] items-center justify-center rounded-full bg-muted-foreground text-[9px] font-medium leading-none text-card">
        1
      </span>
      <span class="absolute right-[14%] bottom-[24%] flex size-[18px] items-center justify-center rounded-full bg-brand text-[9px] font-medium leading-none text-foreground">
        2
      </span>
    </span>

    <!-- Sketch to image: grid + ink strokes -->
    <svg
      v-else-if="skillId === 'sketch-to-image'"
      viewBox="0 0 96 96"
      class="size-full"
    >
      <g class="stroke-border" fill="none" stroke-width="1">
        <path d="M24 20h48M24 32h48M24 44h48M24 56h48M24 68h48M24 78h48" />
        <path d="M22 22v54M34 20v58M46 20v58M58 20v58M70 20v58M76 22v54" />
      </g>
      <path
        d="M28 66 41 36l9 18 10-24 13 22"
        class="fill-none stroke-foreground"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="1.75"
      />
      <path
        d="M30 74c12-7 24-5 38 1"
        class="fill-none stroke-foreground/40"
        stroke-linecap="round"
        stroke-width="1.5"
      />
    </svg>

    <!-- App Store graphics: overlapping device frames -->
    <span v-else-if="skillId === 'app-store-graphics'" class="absolute inset-0">
      <span class="absolute top-3.5 right-[1.05rem] h-[4.15rem] w-[1.85rem] rounded-[8px] border border-border bg-card">
        <span class="absolute top-1.5 right-[3px] left-[3px] h-9 rounded-[3px] bg-muted" />
      </span>
      <span class="absolute top-[1.15rem] left-[1.05rem] h-[4.35rem] w-8 rounded-[9px] border border-foreground/25 bg-card">
        <span class="absolute top-2 right-1 left-1 h-10 rounded-[3px] bg-muted" />
        <span class="absolute right-2 bottom-1.5 left-2 h-0.5 rounded-full bg-border" />
      </span>
    </span>

    <!-- Long-form video: storyboard strip + play mark -->
    <svg
      v-else
      viewBox="0 0 96 96"
      class="size-full"
    >
      <rect
        x="11"
        y="30"
        width="74"
        height="36"
        rx="7"
        class="fill-card stroke-border"
        stroke-width="1.25"
      />
      <path d="M35.5 30v36M60.5 30v36" class="stroke-border" fill="none" stroke-width="1" />
      <g class="fill-muted-foreground/40">
        <rect x="15" y="34" width="2" height="2" rx="0.5" />
        <rect x="15" y="40" width="2" height="2" rx="0.5" />
        <rect x="15" y="54" width="2" height="2" rx="0.5" />
        <rect x="15" y="60" width="2" height="2" rx="0.5" />
        <rect x="79" y="34" width="2" height="2" rx="0.5" />
        <rect x="79" y="40" width="2" height="2" rx="0.5" />
        <rect x="79" y="54" width="2" height="2" rx="0.5" />
        <rect x="79" y="60" width="2" height="2" rx="0.5" />
      </g>
      <rect x="20" y="38" width="10" height="7" rx="1" class="fill-muted" />
      <rect x="41" y="37" width="14" height="14" rx="1.5" class="fill-muted" />
      <rect x="66" y="41" width="9" height="14" rx="1" class="fill-muted" />
      <path d="M45 41.5 53.5 44.2 45 46.9Z" class="fill-foreground" />
    </svg>
  </span>
</template>
