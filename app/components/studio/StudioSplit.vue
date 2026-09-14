<script setup lang="ts">
import { GripHorizontal, PanelRightClose, PanelRightOpen } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  storageKey?: string
}>(), {
  storageKey: 'miao-studio-split',
})
const { t } = useI18n()

const DEFAULT_WIDTH = 420
const MIN_WIDTH = 360
const MAX_WIDTH = 560
const MAX_RATIO = 0.46
const STEP = 16
const HANDLE_SIZE = 16
const DEFAULT_BOTTOM_RATIO = 0.58

const container = ref<HTMLElement | null>(null)
const rightWidth = ref(DEFAULT_WIDTH)
const bottomRatio = ref(DEFAULT_BOTTOM_RATIO)
const bottomHeight = ref(320)
const bottomMax = ref(0)
const dragging = ref(false)
const collapsed = ref(false)

const mobileStorageKey = computed(() => `${props.storageKey}-bottom-ratio`)
const collapsedStorageKey = computed(() => `${props.storageKey}-collapsed`)
const legacyStorageKey = computed(() => props.storageKey === 'miao-studio-split' ? 'polox-studio-split' : '')

function paneMax() {
  return Math.max(0, (container.value?.clientHeight || 0) - HANDLE_SIZE)
}

function clampWidth(width: number) {
  const viewportMax = Math.max(MIN_WIDTH, Math.floor((container.value?.clientWidth || 1280) * MAX_RATIO))
  return Math.min(MAX_WIDTH, viewportMax, Math.max(MIN_WIDTH, Math.round(width)))
}

function setBottomHeight(height: number) {
  const max = paneMax()
  bottomMax.value = max
  const next = Math.min(max, Math.max(0, Math.round(height)))
  bottomHeight.value = next
  bottomRatio.value = max > 0 ? next / max : DEFAULT_BOTTOM_RATIO
}

function syncBottomFromRatio() {
  const max = paneMax()
  if (max)
    setBottomHeight(max * bottomRatio.value)
}

function persistWidth() {
  if (import.meta.client)
    localStorage.setItem(props.storageKey, String(rightWidth.value))
}

function persistBottom() {
  if (import.meta.client)
    localStorage.setItem(mobileStorageKey.value, String(bottomRatio.value))
}

function persistCollapsed() {
  if (import.meta.client)
    localStorage.setItem(collapsedStorageKey.value, collapsed.value ? '1' : '0')
}

function togglePanel() {
  collapsed.value = !collapsed.value
  persistCollapsed()
}

onMounted(() => {
  const legacyKey = legacyStorageKey.value
  const savedWidth = Number(localStorage.getItem(props.storageKey)
    ?? (legacyKey ? localStorage.getItem(legacyKey) : null))
  rightWidth.value = clampWidth(Number.isFinite(savedWidth) && savedWidth >= MIN_WIDTH ? savedWidth : DEFAULT_WIDTH)

  const savedRatio = Number(localStorage.getItem(mobileStorageKey.value)
    ?? (legacyKey ? localStorage.getItem(`${legacyKey}-bottom-ratio`) : null))
  if (Number.isFinite(savedRatio) && savedRatio >= 0 && savedRatio <= 1)
    bottomRatio.value = savedRatio
  collapsed.value = localStorage.getItem(collapsedStorageKey.value) === '1'
  syncBottomFromRatio()
})

useEventListener('resize', () => {
  rightWidth.value = clampWidth(rightWidth.value)
  syncBottomFromRatio()
})

function bindDrag(handle: HTMLElement, pointerId: number, onMove: (event: PointerEvent) => void, onDone: () => void) {
  handle.setPointerCapture(pointerId)
  dragging.value = true
  const move = (event: PointerEvent) => onMove(event)
  const up = (event: PointerEvent) => {
    handle.releasePointerCapture(event.pointerId)
    dragging.value = false
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', up)
    onDone()
  }
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', up)
}

function onHorizontalPointerDown(event: PointerEvent) {
  if (collapsed.value)
    return
  const handle = event.currentTarget as HTMLElement
  const startX = event.clientX
  const startWidth = rightWidth.value
  bindDrag(handle, event.pointerId, (moveEvent) => {
    rightWidth.value = clampWidth(startWidth - (moveEvent.clientX - startX))
  }, persistWidth)
}

function onVerticalPointerDown(event: PointerEvent) {
  if (collapsed.value)
    return
  event.preventDefault()
  const handle = event.currentTarget as HTMLElement
  const startY = event.clientY
  const startHeight = bottomHeight.value
  bindDrag(handle, event.pointerId, (moveEvent) => {
    setBottomHeight(startHeight + startY - moveEvent.clientY)
  }, persistBottom)
}

function onHorizontalKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    rightWidth.value = clampWidth(rightWidth.value + STEP)
    persistWidth()
  }
  if (event.key === 'ArrowRight') {
    event.preventDefault()
    rightWidth.value = clampWidth(rightWidth.value - STEP)
    persistWidth()
  }
}

function onVerticalKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    setBottomHeight(bottomHeight.value + STEP)
    persistBottom()
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    setBottomHeight(bottomHeight.value - STEP)
    persistBottom()
  }
}
</script>

<template>
  <div
    ref="container"
    class="flex min-h-0 flex-1 flex-col lg:flex-row"
    :class="dragging ? 'select-none' : ''"
    :style="{
      '--studio-right-width': `${collapsed ? 0 : rightWidth}px`,
      '--studio-bottom-height': `${collapsed ? 0 : bottomHeight}px`,
    }"
  >
    <div class="relative isolate flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <slot name="left" />
    </div>

    <div
      class="group relative z-20 flex h-4 shrink-0 cursor-row-resize touch-none items-center justify-center lg:hidden"
      role="separator"
      aria-orientation="horizontal"
      :aria-label="t('workspace.resizeConversation')"
      :aria-valuenow="collapsed ? 0 : bottomHeight"
      :aria-valuemin="0"
      :aria-valuemax="bottomMax"
      tabindex="0"
      @pointerdown="onVerticalPointerDown"
      @keydown="onVerticalKeydown"
    >
      <span class="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border group-hover:bg-foreground/35 group-focus-visible:bg-ring" />
      <button
        type="button"
        class="relative z-10 flex h-6 w-10 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :aria-label="collapsed ? t('workspace.openConversation') : t('workspace.closeConversation')"
        @pointerdown.stop
        @click.stop="togglePanel"
      >
        <PanelRightOpen v-if="collapsed" class="size-3.5" />
        <GripHorizontal v-else class="size-3.5" />
      </button>
    </div>

    <div
      class="group relative z-20 hidden w-4 shrink-0 cursor-col-resize touch-none items-center justify-center lg:flex"
      role="separator"
      aria-orientation="vertical"
      :aria-label="t('workspace.resizeConversation')"
      :aria-valuenow="collapsed ? 0 : rightWidth"
      :aria-valuemin="0"
      :aria-valuemax="MAX_WIDTH"
      tabindex="0"
      @pointerdown="onHorizontalPointerDown"
      @keydown="onHorizontalKeydown"
    >
      <span class="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border group-hover:bg-foreground/35 group-focus-visible:bg-ring" />
      <button
        type="button"
        class="relative z-10 flex h-9 w-5 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :aria-label="collapsed ? t('workspace.openConversation') : t('workspace.closeConversation')"
        @pointerdown.stop
        @click.stop="togglePanel"
      >
        <PanelRightOpen v-if="collapsed" class="size-3.5" />
        <PanelRightClose v-else class="size-3.5" />
      </button>
    </div>

    <aside
      class="flex min-h-0 min-w-0 flex-col overflow-hidden border-t border-border bg-card transition-[width,height] duration-200 max-lg:h-[var(--studio-bottom-height)] max-lg:shrink-0 lg:w-[var(--studio-right-width)] lg:flex-none lg:border-t-0 lg:border-l"
      :class="collapsed ? 'pointer-events-none opacity-0' : 'opacity-100'"
      :aria-label="t('workspace.conversation')"
    >
      <slot name="right" />
    </aside>
  </div>
</template>
