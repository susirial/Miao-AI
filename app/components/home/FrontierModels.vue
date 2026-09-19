<script setup lang="ts">
import type { FrontierModelCard } from '@/constants/aiModels'
import { openFrontierGenerator } from '@/composables/useAiGeneratorForm'
import { getFrontierModelCards } from '@/constants/aiModels'

const emit = defineEmits<{
  select: [card: FrontierModelCard]
}>()
const cards = getFrontierModelCards()

function onSelect(card: FrontierModelCard) {
  emit('select', card)
  void openFrontierGenerator(card.modelId)
}
</script>

<template>
  <section class="flex flex-col gap-4">
    <div class="flex flex-col gap-1.5">
      <h2 class="text-2xl font-normal tracking-[-0.03em] md:text-3xl">
        Frontier AI models
      </h2>
      <p class="text-sm text-muted-foreground">
        The latest AI image and video models in one workspace.
      </p>
    </div>

    <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <button
        v-for="card in cards"
        :key="card.modelId"
        type="button"
        class="flex flex-col items-start rounded-2xl border border-border bg-card p-4 text-left shadow-none transition-colors duration-150 hover:border-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:p-5"
        :aria-label="`Open ${card.title} in Generator`"
        @click="onSelect(card)"
      >
        <img
          v-if="card.logo"
          :src="card.logo"
          alt=""
          width="32"
          height="32"
          class="mb-3 h-8 w-auto max-w-[4.5rem] object-contain"
          aria-hidden="true"
        >
        <h3 class="text-base font-medium text-foreground">
          {{ card.title }}
        </h3>
        <p
          v-if="card.company"
          class="mt-1 text-sm text-muted-foreground"
        >
          By {{ card.company }}
        </p>
        <p class="mt-2 text-sm text-muted-foreground">
          {{ card.task }}
        </p>
      </button>
    </div>
  </section>
</template>
