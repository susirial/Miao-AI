<script setup lang="ts">
const props = withDefaults(defineProps<{
  tone?: 'generating' | 'attention'
  radius?: number
}>(), {
  tone: 'generating',
  radius: 16,
})

const strokeRadius = computed(() => Math.max(0, props.radius - 1))
</script>

<template>
  <span
    class="pointer-events-none absolute -inset-px overflow-hidden"
    :style="{ '--agent-border-color': tone === 'attention' ? 'var(--foreground)' : 'var(--brand)' }"
    aria-hidden="true"
  >
    <svg class="block size-full" focusable="false">
      <rect
        class="agent-lab-border-line"
        x="1"
        y="1"
        width="calc(100% - 2px)"
        height="calc(100% - 2px)"
        :rx="strokeRadius"
        pathLength="100"
      />
    </svg>
  </span>
</template>

<style scoped>
.agent-lab-border-line {
  fill: none;
  stroke: var(--agent-border-color);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-dasharray: 9 91;
  vector-effect: non-scaling-stroke;
  animation: agent-lab-border-line 2.6s linear infinite;
}

@keyframes agent-lab-border-line {
  to {
    stroke-dashoffset: -100;
  }
}

@media (prefers-reduced-motion: reduce) {
  .agent-lab-border-line {
    display: none;
  }
}
</style>
