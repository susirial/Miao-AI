<script setup lang="ts">
type LogoSize = 'sm' | 'md' | 'lg'

const props = withDefaults(defineProps<{
  showName?: boolean
  size?: LogoSize
}>(), {
  showName: true,
  size: 'md',
})

const { public: publicConfig } = useRuntimeConfig()

const nameSizeClass: Record<LogoSize, string> = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-2xl',
}
</script>

<template>
  <span class="inline-flex min-w-0 items-center">
    <span
      v-if="showName"
      class="truncate font-semibold leading-none tracking-[-0.04em] text-foreground"
      :class="nameSizeClass[props.size]"
    >
      {{ publicConfig.brandName }}
    </span>
  </span>
</template>
