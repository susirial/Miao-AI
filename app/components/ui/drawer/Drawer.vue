<script lang="ts" setup>
import type { DrawerRootProps } from 'vaul-vue'
import { DrawerRoot } from 'vaul-vue'

type DrawerProps = Omit<DrawerRootProps, 'fadeFromIndex'>

const props = defineProps<DrawerProps>()

const emits = defineEmits<{
  'drag': [percentageDragged: number]
  'release': [open: boolean]
  'close': []
  'update:open': [open: boolean]
  'update:activeSnapPoint': [value: string | number]
  'animationEnd': [open: boolean]
}>()
</script>

<template>
  <DrawerRoot
    data-slot="drawer"
    :active-snap-point="props.activeSnapPoint"
    :close-threshold="props.closeThreshold"
    :should-scale-background="props.shouldScaleBackground ?? true"
    :set-background-color-on-scale="props.setBackgroundColorOnScale"
    :scroll-lock-timeout="props.scrollLockTimeout"
    :fixed="props.fixed"
    :dismissible="props.dismissible"
    :modal="props.modal"
    :open="props.open"
    :default-open="props.defaultOpen"
    :nested="props.nested"
    :direction="props.direction"
    :no-body-styles="props.noBodyStyles"
    :handle-only="props.handleOnly"
    :prevent-scroll-restoration="props.preventScrollRestoration"
    :snap-points="props.snapPoints"
    @drag="emits('drag', $event)"
    @release="emits('release', $event)"
    @close="emits('close')"
    @update:open="emits('update:open', $event)"
    @update:active-snap-point="emits('update:activeSnapPoint', $event)"
    @animation-end="emits('animationEnd', $event)"
  >
    <slot />
  </DrawerRoot>
</template>
