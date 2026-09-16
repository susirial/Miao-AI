<script setup lang="ts">
import type { ImageAnnotationPoint } from '~~/shared/utils/imageAnnotations'
import { Hand, MapPin, Maximize, MousePointer2, ZoomIn, ZoomOut } from 'lucide-vue-next'

const props = defineProps<{ src: string, disabled?: boolean }>()
const emit = defineEmits<{ load: [], error: [] }>()
const { t } = useI18n()
const points = defineModel<ImageAnnotationPoint[]>({ default: () => [] })
const activeIndex = defineModel<number>('activeIndex', { default: -1 })
const viewport = ref<HTMLDivElement>()
const image = ref<HTMLImageElement>()
const loaded = ref(false)
const zoom = ref(1)
const tool = ref<'point' | 'select' | 'pan'>('point')
let dragging: { pointerId: number, index: number } | null = null
let panning: { pointerId: number, x: number, y: number, left: number, top: number } | null = null
const colors = ['#bef264', '#67e8f9', '#fdba74', '#c4b5fd', '#86efac', '#f9a8d4', '#fde047', '#93c5fd']

function coordinates(event: PointerEvent) {
  const rect = image.value!.getBoundingClientRect()
  return {
    x: Math.round(Math.max(0, Math.min(1000, (event.clientX - rect.left) / rect.width * 1000))),
    y: Math.round(Math.max(0, Math.min(1000, (event.clientY - rect.top) / rect.height * 1000))),
  }
}
function start(event: PointerEvent) {
  if (props.disabled || !loaded.value || event.button !== 0 || !event.isPrimary)
    return
  const target = event.target as HTMLElement
  const marker = target.closest<HTMLElement>('[data-point-index]')
  if (marker && tool.value !== 'pan') {
    const index = Number(marker.dataset.pointIndex)
    if (points.value[index]) {
      activeIndex.value = index
      dragging = { pointerId: event.pointerId, index }
      viewport.value?.setPointerCapture(event.pointerId)
      event.preventDefault()
    }
    return
  }
  if (tool.value === 'pan') {
    panning = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: viewport.value?.scrollLeft || 0,
      top: viewport.value?.scrollTop || 0,
    }
    viewport.value?.setPointerCapture(event.pointerId)
    return
  }
  if (tool.value === 'point' && points.value.length < 16) {
    const point = coordinates(event)
    activeIndex.value = points.value.length
    points.value = [...points.value, { ...point, text: '' }]
  }
  else {
    activeIndex.value = -1
  }
}
function move(event: PointerEvent) {
  if (dragging?.pointerId === event.pointerId) {
    const next = coordinates(event)
    points.value = points.value.map((point, index) => index === dragging!.index ? { ...point, ...next } : point)
  }
  if (panning?.pointerId === event.pointerId && viewport.value) {
    viewport.value.scrollLeft = panning.left - (event.clientX - panning.x)
    viewport.value.scrollTop = panning.top - (event.clientY - panning.y)
  }
}
function finish(event: PointerEvent) {
  if (dragging?.pointerId === event.pointerId)
    dragging = null
  if (panning?.pointerId === event.pointerId)
    panning = null
  if (viewport.value?.hasPointerCapture(event.pointerId))
    viewport.value.releasePointerCapture(event.pointerId)
}
function setZoom(next: number) {
  zoom.value = Math.max(0.5, Math.min(4, Math.round(next * 100) / 100))
}
watch(() => props.src, () => {
  loaded.value = false
  zoom.value = 1
  activeIndex.value = -1
})
</script>

<template>
  <div class="min-w-0 overflow-hidden rounded-xl border border-border bg-muted/20">
    <div class="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-border px-2 py-1.5 sm:px-3">
      <div class="flex min-w-0 flex-wrap items-center gap-1" role="toolbar" :aria-label="t('annotation.tools')">
        <button
          v-for="item in [{ id: 'point', icon: MapPin, label: t('annotation.addPoint') }, { id: 'select', icon: MousePointer2, label: t('annotation.movePoint') }, { id: 'pan', icon: Hand, label: t('annotation.pan') }]"
          :key="item.id"
          type="button"
          class="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :class="tool === item.id ? 'border-foreground bg-foreground text-background' : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground'"
          :aria-label="item.label"
          :title="item.label"
          :aria-pressed="tool === item.id"
          :disabled="disabled"
          @click="tool = item.id as typeof tool"
        >
          <component :is="item.icon" class="size-3.5 shrink-0" />
          <span>{{ item.label }}</span>
        </button>
      </div>
      <div class="flex items-center gap-1">
        <button type="button" class="inline-flex size-8 items-center justify-center rounded-lg hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30" :disabled="disabled || zoom <= 0.5" :aria-label="t('annotation.zoomOut')" :title="t('annotation.zoomOut')" @click="setZoom(zoom - 0.25)">
          <ZoomOut class="size-4" />
        </button>
        <span class="w-10 text-center text-xs tabular-nums">{{ Math.round(zoom * 100) }}%</span>
        <button type="button" class="inline-flex size-8 items-center justify-center rounded-lg hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30" :disabled="disabled || zoom >= 4" :aria-label="t('annotation.zoomIn')" :title="t('annotation.zoomIn')" @click="setZoom(zoom + 0.25)">
          <ZoomIn class="size-4" />
        </button>
        <button type="button" class="inline-flex size-8 items-center justify-center rounded-lg hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30" :disabled="disabled" :aria-label="t('annotation.fit')" :title="t('annotation.fit')" @click="setZoom(1)">
          <Maximize class="size-4" />
        </button>
      </div>
    </div>
    <div
      ref="viewport"
      class="h-[340px] overflow-auto overscroll-contain md:h-[480px]"
      :class="tool === 'pan' ? (panning ? 'cursor-grabbing' : 'cursor-grab') : tool === 'point' ? 'cursor-crosshair' : 'cursor-default'"
      @pointerdown="start"
      @pointermove="move"
      @pointerup="finish"
      @pointercancel="finish"
    >
      <div class="grid min-h-full min-w-full place-items-center p-4">
        <div class="relative shrink-0 touch-none select-none" :style="{ width: `${zoom * 100}%`, maxWidth: 'none' }">
          <img
            ref="image"
            :src="src"
            alt="Image to annotate"
            draggable="false"
            class="block h-auto w-full max-w-none"
            @load="loaded = true; emit('load')"
            @error="loaded = false; emit('error')"
          >
          <p
            v-if="loaded && !points.length && tool === 'point' && !disabled"
            class="pointer-events-none absolute inset-0 flex items-center justify-center p-4"
          >
            <span class="rounded-lg border border-border bg-background/95 px-3 py-2 text-center text-xs text-foreground">
              {{ t('annotation.clickToAdd') }}
            </span>
          </p>
          <button
            v-for="(point, index) in points"
            :key="index"
            type="button"
            :data-point-index="index"
            class="absolute flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-lg border border-zinc-950 text-xs font-semibold text-zinc-950 shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            :class="activeIndex === index ? 'ring-2 ring-white' : ''"
            :style="{ left: `${point.x / 10}%`, top: `${point.y / 10}%`, backgroundColor: colors[index % colors.length] }"
            :aria-label="t('annotation.point', { number: index + 1 })"
            :disabled="disabled"
          >
            {{ index + 1 }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
