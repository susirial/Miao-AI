<script setup lang="ts">
import type { SketchElement, SketchPoint } from '~~/shared/utils/sketchToImage'
import { Pencil, Redo2, Trash2, Type, Undo2 } from 'lucide-vue-next'
import { SKETCH_HEIGHT, SKETCH_WIDTH, sketchPoint } from '~~/shared/utils/sketchToImage'

interface SketchCanvasCopy {
  toolbar: string
  pen: string
  text: string
  inkColor: string
  penWidth: string
  thin: string
  medium: string
  thick: string
  undo: string
  redo: string
  clear: string
  board: string
  emptyTitle: string
  emptyDescription: string
  textPlaceholder: string
  drawHint: string
  textHint: string
  blankError: string
  exportError: string
}

const props = withDefaults(defineProps<{
  disabled?: boolean
  copy?: Partial<SketchCanvasCopy>
}>(), {
  disabled: false,
  copy: () => ({}),
})

const emit = defineEmits<{
  editing: [hasText: boolean]
}>()

const { t } = useI18n()
const ui = computed<SketchCanvasCopy>(() => ({
  toolbar: t('sketch.toolbar'),
  pen: t('sketch.pen'),
  text: t('sketch.text'),
  inkColor: t('sketch.inkColor'),
  penWidth: t('sketch.penWidth'),
  thin: t('sketch.thin'),
  medium: t('sketch.medium'),
  thick: t('sketch.thick'),
  undo: t('sketch.undo'),
  redo: t('sketch.redo'),
  clear: t('sketch.clear'),
  board: t('sketch.board'),
  emptyTitle: t('sketch.emptyTitle'),
  emptyDescription: t('sketch.emptyDescription'),
  textPlaceholder: t('sketch.textPlaceholder'),
  drawHint: t('sketch.drawHint'),
  textHint: t('sketch.textHint'),
  blankError: t('sketch.blankError'),
  exportError: t('sketch.exportError'),
  ...props.copy,
}))

const model = defineModel<SketchElement[]>({ default: () => [] })
const elements = ref<SketchElement[]>(model.value)
watch(model, (value) => { elements.value = value }, { flush: 'sync' })

function setElements(value: SketchElement[]) {
  elements.value = value
  model.value = value
}

const mode = ref<'pen' | 'text'>('pen')
const color = ref('#26251e')
const width = ref(5)
const surface = useTemplateRef('surface')
const textInput = useTemplateRef('textInput')
const activeStroke = ref<Extract<SketchElement, { kind: 'stroke' }> | null>(null)
const textPosition = ref<SketchPoint | null>(null)
const textDraft = ref('')
const undoStack = ref<SketchElement[][]>([])
const redoStack = ref<SketchElement[][]>([])
let pointerId: number | null = null

watch(textDraft, value => emit('editing', Boolean(value.trim())), { flush: 'sync' })

function change(next: SketchElement[]) {
  undoStack.value = [...undoStack.value.slice(-49), elements.value]
  redoStack.value = []
  setElements(next)
}

function commitText() {
  if (textPosition.value && textDraft.value.trim()) {
    change([...elements.value, {
      kind: 'text',
      color: color.value,
      size: 36,
      ...textPosition.value,
      text: textDraft.value.trim(),
    }])
  }
  textPosition.value = null
  textDraft.value = ''
}

function cancelText() {
  textPosition.value = null
  textDraft.value = ''
}

function setMode(next: 'pen' | 'text') {
  commitText()
  mode.value = next
}

function point(event: PointerEvent) {
  return sketchPoint(event.clientX, event.clientY, surface.value!.getBoundingClientRect())
}

function start(event: PointerEvent) {
  if (props.disabled || event.button !== 0 || pointerId !== null)
    return
  commitText()
  if (mode.value === 'text') {
    const position = point(event)
    textPosition.value = {
      x: Math.min(position.x, SKETCH_WIDTH - 220),
      y: Math.max(45, Math.min(position.y, SKETCH_HEIGHT - 10)),
    }
    void nextTick(() => textInput.value?.focus({ preventScroll: true }))
    return
  }
  event.preventDefault()
  pointerId = event.pointerId
  surface.value?.setPointerCapture(event.pointerId)
  const first = point(event)
  activeStroke.value = {
    kind: 'stroke',
    color: color.value,
    width: width.value,
    points: [first, { ...first, x: first.x + 0.01 }],
  }
}

function move(event: PointerEvent) {
  if (pointerId !== event.pointerId || !activeStroke.value)
    return
  const samples = event.getCoalescedEvents?.() || []
  activeStroke.value.points.push(...(samples.length ? samples : [event]).map(point))
}

function finish(event?: PointerEvent) {
  if (event && pointerId !== event.pointerId)
    return
  if (event?.type === 'pointerup')
    move(event)
  const id = pointerId
  pointerId = null
  if (activeStroke.value)
    change([...elements.value, activeStroke.value])
  activeStroke.value = null
  if (id !== null && surface.value?.hasPointerCapture(id))
    surface.value.releasePointerCapture(id)
}

function cancelPointer(event: PointerEvent) {
  if (pointerId === event.pointerId)
    finish(event)
}

function undo() {
  commitText()
  const previous = undoStack.value.at(-1)
  if (!previous)
    return
  redoStack.value = [...redoStack.value, elements.value]
  undoStack.value = undoStack.value.slice(0, -1)
  setElements(previous)
}

function redo() {
  const next = redoStack.value.at(-1)
  if (!next)
    return
  undoStack.value = [...undoStack.value, elements.value]
  redoStack.value = redoStack.value.slice(0, -1)
  setElements(next)
}

function clear() {
  cancelText()
  if (elements.value.length)
    change([])
}

async function saveDraft() {
  commitText()
  finish()
  await nextTick()
}

async function exportFile() {
  await saveDraft()
  if (!elements.value.some(element => element.kind === 'stroke' || element.text.trim()))
    throw new Error(ui.value.blankError)

  const canvas = document.createElement('canvas')
  canvas.width = SKETCH_WIDTH
  canvas.height = SKETCH_HEIGHT
  const context = canvas.getContext('2d')
  if (!context)
    throw new Error(ui.value.exportError)

  // The exported asset is intentionally white regardless of the application theme.
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  for (const element of elements.value) {
    if (element.kind === 'text') {
      context.fillStyle = element.color
      context.font = `${element.size}px Arial, sans-serif`
      context.fillText(element.text, element.x, element.y)
      continue
    }
    context.strokeStyle = element.color
    context.lineWidth = element.width
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.beginPath()
    element.points.forEach((item, index) => index ? context.lineTo(item.x, item.y) : context.moveTo(item.x, item.y))
    context.stroke()
  }

  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
    value => value ? resolve(value) : reject(new Error(ui.value.exportError)),
    'image/png',
  ))
  return new File([blob], 'sketch.png', { type: 'image/png' })
}

defineExpose({ clear, exportFile, redo, saveDraft, undo })
</script>

<template>
  <div class="@container/sketch w-full min-w-0" data-sketch-canvas>
    <div class="min-w-0 overflow-hidden rounded-2xl border border-border bg-card">
      <div class="flex h-11 items-center justify-between gap-2 border-b border-border px-3">
        <div class="flex items-center gap-1" role="toolbar" :aria-label="ui.toolbar">
          <button
            v-for="tool in ([{ id: 'pen', label: ui.pen, icon: Pencil }, { id: 'text', label: ui.text, icon: Type }] as const)"
            :key="tool.id"
            type="button"
            class="inline-flex size-8 items-center justify-center rounded-lg border transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
            :class="mode === tool.id ? 'border-foreground bg-foreground text-background' : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground'"
            :aria-label="tool.label"
            :title="tool.label"
            :aria-pressed="mode === tool.id"
            :disabled="disabled"
            @click="setMode(tool.id)"
          >
            <component :is="tool.icon" class="size-4" />
          </button>
          <span class="mx-1 h-4 w-px bg-border" aria-hidden="true" />
          <label class="sr-only" for="sketch-ink-color">{{ ui.inkColor }}</label>
          <input
            id="sketch-ink-color"
            v-model="color"
            type="color"
            :aria-label="ui.inkColor"
            :title="ui.inkColor"
            :disabled="disabled"
            class="size-8 rounded-lg border border-border bg-background p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
          >
          <label class="sr-only" for="sketch-pen-width">{{ ui.penWidth }}</label>
          <select
            id="sketch-pen-width"
            v-model.number="width"
            :aria-label="ui.penWidth"
            :disabled="disabled || mode !== 'pen'"
            class="h-8 rounded-lg border border-border bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
          >
            <option :value="3">
              {{ ui.thin }}
            </option>
            <option :value="5">
              {{ ui.medium }}
            </option>
            <option :value="10">
              {{ ui.thick }}
            </option>
          </select>
        </div>

        <div class="flex items-center gap-1">
          <Button type="button" variant="ghost" size="icon" class="size-8 rounded-lg" :aria-label="ui.undo" :title="ui.undo" :disabled="disabled || (!undoStack.length && !textDraft.trim())" @click="undo">
            <Undo2 class="size-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon" class="size-8 rounded-lg" :aria-label="ui.redo" :title="ui.redo" :disabled="disabled || !redoStack.length" @click="redo">
            <Redo2 class="size-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon" class="size-8 rounded-lg" :aria-label="ui.clear" :title="ui.clear" :disabled="disabled || (!elements.length && !textDraft.trim())" @click="clear">
            <Trash2 class="size-4" />
          </Button>
        </div>
      </div>

      <div class="flex h-[280px] items-center justify-center overflow-hidden bg-muted/30 p-3 @min-[720px]/sketch:h-[480px] @min-[720px]/sketch:p-5">
        <div class="relative aspect-[3/2] w-full max-w-[672px] overflow-hidden rounded-xl border border-border bg-white">
          <svg
            ref="surface"
            :viewBox="`0 0 ${SKETCH_WIDTH} ${SKETCH_HEIGHT}`"
            class="block size-full touch-none select-none"
            :class="[mode === 'pen' ? 'cursor-crosshair' : 'cursor-text', disabled ? 'opacity-60' : '']"
            role="img"
            :aria-label="ui.board"
            @pointerdown="start"
            @pointermove="move"
            @pointerup="finish"
            @pointercancel="cancelPointer"
            @lostpointercapture="cancelPointer"
          >
            <template v-for="(element, index) in elements" :key="index">
              <polyline
                v-if="element.kind === 'stroke'"
                :points="element.points.map(item => `${item.x},${item.y}`).join(' ')"
                fill="none"
                :stroke="element.color"
                :stroke-width="element.width"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <text v-else :x="element.x" :y="element.y" :fill="element.color" :font-size="element.size" font-family="Arial, sans-serif" xml:space="preserve">{{ element.text }}</text>
            </template>
            <polyline
              v-if="activeStroke"
              :points="activeStroke.points.map(item => `${item.x},${item.y}`).join(' ')"
              fill="none"
              :stroke="activeStroke.color"
              :stroke-width="activeStroke.width"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>

          <div v-if="!elements.length && !activeStroke && !textPosition" class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 px-5 text-center text-muted-foreground">
            <Pencil class="mb-1 size-5" />
            <p class="text-sm font-medium">
              {{ ui.emptyTitle }}
            </p>
            <p class="text-xs leading-5">
              {{ ui.emptyDescription }}
            </p>
          </div>

          <input
            v-if="textPosition"
            ref="textInput"
            v-model="textDraft"
            maxlength="200"
            :disabled="disabled"
            :aria-label="ui.text"
            :placeholder="ui.textPlaceholder"
            class="absolute h-9 max-w-[90%] rounded-lg border border-ring bg-card px-2 text-base text-foreground outline-none ring-2 ring-ring/20"
            :style="{
              left: `${textPosition.x / SKETCH_WIDTH * 100}%`,
              top: `${Math.max(0, textPosition.y / SKETCH_HEIGHT * 100 - 6)}%`,
              width: `${Math.min(65, (SKETCH_WIDTH - textPosition.x) / SKETCH_WIDTH * 100)}%`,
              color,
            }"
            @pointerdown.stop
            @keydown.enter="!$event.isComposing && ($event.preventDefault(), commitText())"
            @keydown.esc.prevent="cancelText"
            @blur="commitText"
          >
        </div>
      </div>
    </div>
    <p class="px-1 pt-2 text-[11px] text-muted-foreground" role="status">
      {{ mode === 'text' ? ui.textHint : ui.drawHint }}
    </p>
  </div>
</template>
