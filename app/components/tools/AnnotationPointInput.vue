<script setup lang="ts">
import type { ImageAnnotationPoint, ImageAnnotationReference } from '~~/shared/utils/imageAnnotations'
import { Paperclip, X } from 'lucide-vue-next'

const props = defineProps<{
  id: string
  label: string
  disabled?: boolean
  referenceImages?: ImageAnnotationReference[]
  uploadImage?: (file: File) => Promise<ImageAnnotationReference>
}>()
const emit = defineEmits<{ browseAssets: [], uploading: [value: boolean] }>()
const { t } = useI18n()
const point = defineModel<ImageAnnotationPoint>({ required: true })
const input = useTemplateRef('input')
const picker = useTemplateRef('picker')
const uploading = ref(false)
const error = ref('')
const mention = ref<{ start: number, end: number, query: string } | null>(null)
const activeIndex = ref(0)
const listId = `${props.id}-assets`
const matches = computed(() => (props.referenceImages || []).filter(asset =>
  asset.name.toLowerCase().includes(mention.value?.query.toLowerCase() || '')))
const optionCount = computed(() => matches.value.length + (props.uploadImage ? 1 : 0))

function updateMention() {
  const element = input.value
  if (!element)
    return
  const end = element.selectionStart
  const match = /@([^@\n]*)$/.exec(element.value.slice(0, end))
  mention.value = match ? { start: end - match[0].length, end, query: match[1]! } : null
  if (mention.value)
    emit('browseAssets')
}
function updateText(event: Event) {
  point.value = { ...point.value, text: (event.target as HTMLTextAreaElement).value }
  updateMention()
}
function insert(asset: ImageAnnotationReference) {
  const references = point.value.references?.some(reference => reference.url === asset.url)
    ? point.value.references
    : [...(point.value.references || []), { url: asset.url, name: asset.name.slice(0, 100) }]
  point.value = { ...point.value, references }
  mention.value = null
  error.value = ''
}
function removeReference(asset: ImageAnnotationReference) {
  point.value = { ...point.value, references: point.value.references?.filter(reference => reference.url !== asset.url) }
}
function chooseUpload() {
  if (!props.disabled && !uploading.value)
    picker.value?.click()
}
async function upload(event: Event) {
  const element = event.target as HTMLInputElement
  const file = element.files?.[0]
  element.value = ''
  if (!file || !props.uploadImage || uploading.value)
    return
  uploading.value = true
  emit('uploading', true)
  error.value = ''
  mention.value = null
  try {
    insert(await props.uploadImage(file))
  }
  catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Upload failed'
  }
  finally {
    uploading.value = false
    emit('uploading', false)
  }
}
function onKeydown(event: KeyboardEvent) {
  if (!mention.value || event.isComposing)
    return
  if (event.key === 'Escape') {
    event.preventDefault()
    mention.value = null
  }
  else if (optionCount.value && ['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) {
    event.preventDefault()
    if (event.key === 'Enter') {
      if (props.uploadImage && activeIndex.value === 0)
        chooseUpload()
      else
        insert(matches.value[activeIndex.value - (props.uploadImage ? 1 : 0)]!)
    }
    else {
      activeIndex.value = (activeIndex.value + (event.key === 'ArrowDown' ? 1 : -1) + optionCount.value) % optionCount.value
    }
  }
}
</script>

<template>
  <div class="min-w-0 flex-1">
    <div class="overflow-hidden rounded-lg border border-input bg-background focus-within:ring-2 focus-within:ring-ring">
      <textarea
        :id="id"
        ref="input"
        :value="point.text"
        :disabled="disabled || uploading"
        maxlength="1000"
        rows="2"
        :aria-label="label"
        :aria-expanded="Boolean(mention)"
        :aria-controls="mention ? listId : undefined"
        :placeholder="t('annotation.placeholder')"
        class="block w-full min-w-0 resize-y border-0 bg-transparent px-3 py-2 text-sm outline-none"
        @input="updateText"
        @click="updateMention"
        @keydown="onKeydown"
        @blur="mention = null"
      />
      <div v-if="point.references?.length" class="flex flex-wrap gap-2 px-3 pb-3" :aria-label="t('annotation.references')">
        <span v-for="asset in point.references" :key="asset.url" :title="asset.name" class="relative block size-12 shrink-0">
          <img :src="asset.url" :alt="asset.name" class="size-full rounded-lg border object-cover">
          <button type="button" :disabled="disabled || uploading" :aria-label="t('annotation.removeReference', { name: asset.name })" class="absolute -top-1 -right-1 rounded-full border bg-background p-0.5 hover:bg-accent" @click="removeReference(asset)"><X class="size-3" /></button>
        </span>
      </div>
    </div>
    <div v-if="mention" :id="listId" role="listbox" class="mt-1 max-h-48 overflow-y-auto rounded-lg border bg-popover p-1">
      <button v-if="uploadImage" type="button" class="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs hover:bg-accent" @pointerdown.prevent @click="chooseUpload">
        <Paperclip class="size-4" />{{ t('annotation.uploadReference') }}
      </button>
      <button v-for="asset in matches" :key="asset.url" type="button" class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-accent" @pointerdown.prevent @click="insert(asset)">
        <img :src="asset.url" alt="" class="size-8 rounded object-cover">
        <span class="min-w-0 truncate">{{ asset.name }}</span>
      </button>
      <p v-if="!matches.length" class="px-2 py-3 text-xs text-muted-foreground">
        {{ t('annotation.noAssets') }}
      </p>
    </div>
    <input ref="picker" type="file" accept="image/jpeg,image/png,image/webp,image/gif" class="hidden" @change="upload">
    <p v-if="uploading" class="mt-1 text-xs text-muted-foreground">
      {{ t('annotation.uploading') }}
    </p>
    <p v-if="error" role="alert" class="mt-1 text-xs text-destructive">
      {{ error }}
    </p>
  </div>
</template>
