<script setup lang="ts">
import type { ImageAnnotationPoint, ImageAnnotationReference } from '~~/shared/utils/imageAnnotations'
import { MapPin, Trash2 } from 'lucide-vue-next'

const props = defineProps<{
  src: string
  disabled?: boolean
  referenceImages?: ImageAnnotationReference[]
  uploadImage?: (file: File) => Promise<ImageAnnotationReference>
}>()
const emit = defineEmits<{ uploading: [value: boolean], browseAssets: [] }>()
const { t } = useI18n()
const points = defineModel<ImageAnnotationPoint[]>({ default: () => [] })
const activeIndex = ref(-1)
const failed = ref(false)
const uploading = ref(false)
const uploadedImages = ref<ImageAnnotationReference[]>([])
const referenceImages = computed(() => [...new Map([
  ...(props.referenceImages || []),
  ...uploadedImages.value,
].map(image => [image.url, image])).values()])
const editorId = useId()

function updatePoint(index: number, value: ImageAnnotationPoint) {
  if (!props.disabled)
    points.value = points.value.map((point, itemIndex) => itemIndex === index ? value : point)
}
function removePoint(index: number) {
  if (props.disabled || uploading.value)
    return
  points.value = points.value.filter((_, itemIndex) => itemIndex !== index)
  activeIndex.value = Math.min(activeIndex.value, points.value.length - 1)
}
async function uploadReference(file: File) {
  const asset = await props.uploadImage!(file)
  uploadedImages.value = [...uploadedImages.value.filter(image => image.url !== asset.url), asset]
  return asset
}
</script>

<template>
  <div class="@container/annotation min-w-0">
    <div class="grid min-w-0 overflow-hidden rounded-xl border border-border @min-[680px]/annotation:grid-cols-[minmax(0,1fr)_240px]">
      <ToolsImageAnnotationCanvas
        :key="src"
        v-model="points"
        v-model:active-index="activeIndex"
        :src="src"
        :disabled="disabled || uploading"
        class="rounded-none border-0"
        @load="failed = false"
        @error="failed = true"
      />
      <aside class="flex min-w-0 flex-col border-t border-border bg-card @min-[680px]/annotation:max-h-[525px] @min-[680px]/annotation:border-t-0 @min-[680px]/annotation:border-l" :aria-label="t('annotation.list')">
        <div class="flex h-11 shrink-0 items-center border-b border-border px-3">
          <h3 class="text-sm font-medium">
            {{ t('annotation.list') }} <span class="ml-1 text-xs text-muted-foreground">{{ points.length }}/16</span>
          </h3>
        </div>
        <div v-if="!points.length" class="flex flex-1 flex-col items-center justify-center gap-3 px-5 py-10 text-center text-muted-foreground">
          <MapPin class="size-6" />
          <p class="text-xs leading-relaxed">
            {{ t('annotation.empty') }}
          </p>
        </div>
        <ol v-else class="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
          <li v-for="(point, index) in points" :key="index" class="min-w-0 rounded-lg border p-2" :class="index === activeIndex ? 'border-primary/35 bg-primary/5' : 'border-transparent'">
            <div class="mb-2 flex items-center justify-between gap-2">
              <button type="button" class="flex min-w-0 items-center gap-2 text-sm" :disabled="disabled || uploading" @click="activeIndex = index">
                <span class="flex size-7 items-center justify-center rounded-lg bg-primary text-xs font-semibold text-primary-foreground">{{ index + 1 }}</span>
                {{ t('annotation.point', { number: index + 1 }) }}
              </button>
              <button type="button" class="inline-flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-background hover:text-foreground" :disabled="disabled || uploading" :aria-label="t('annotation.removePoint', { number: index + 1 })" @click="removePoint(index)">
                <Trash2 class="size-3.5" />
              </button>
            </div>
            <ToolsAnnotationPointInput
              :id="`${editorId}-${index}`"
              :model-value="point"
              :label="t('annotation.editLabel', { number: index + 1 })"
              :disabled="disabled || uploading"
              :reference-images="referenceImages"
              :upload-image="uploadImage ? uploadReference : undefined"
              @update:model-value="updatePoint(index, $event)"
              @uploading="uploading = $event; emit('uploading', $event)"
              @browse-assets="emit('browseAssets')"
            />
          </li>
        </ol>
      </aside>
      <p v-if="failed" role="alert" class="col-span-full p-3 text-sm text-destructive">
        {{ t('annotation.loadFailed') }}
      </p>
    </div>
  </div>
</template>
