<script setup lang="ts">
import type { ChoiceAnswer, ChoicePayload } from '~/composables/useAgentLab'
import { ImagePlus, X } from 'lucide-vue-next'
import { SKETCH_MAX_INPUTS } from '~~/shared/utils/sketchToImage'

interface SketchReferenceImage {
  url: string
  name: string
}

interface SketchChoiceAnswer extends ChoiceAnswer {
  referenceImages?: SketchReferenceImage[]
}

interface SketchChoiceCopy {
  title: string
  reviewStep: string
  skipped: string
  saved: string
  pending: string
  uploadImages: string
  chooseProject: string
  uploading: string
  referencesLabel: string
  removeImage: string
  noAssets: string
  adjustPlaceholder: string
  notesPlaceholder: string
  continue: string
  generate: string
  inputLimit: (count: number) => string
  uploadFailed: string
}

const props = withDefaults(defineProps<{
  choice: ChoicePayload
  state?: 'pending' | 'answered' | 'skipped'
  answers?: SketchChoiceAnswer[]
  pending?: boolean
  readOnly?: boolean
  referenceImages?: SketchReferenceImage[]
  sourceImages?: { id: string, url: string }[]
  uploadImage?: (file: File) => Promise<SketchReferenceImage>
  copy?: Partial<SketchChoiceCopy>
}>(), {
  pending: false,
  readOnly: false,
  answers: () => [],
  referenceImages: () => [],
  sourceImages: () => [],
  copy: () => ({}),
})

const emit = defineEmits<{
  submit: [answers: SketchChoiceAnswer[]]
  browseAssets: []
}>()

const { t } = useI18n()
const ui = computed<SketchChoiceCopy>(() => ({
  title: t('skills.items.sketch-to-image.name'),
  reviewStep: t('sketch.reviewStep'),
  skipped: t('sketch.skipped'),
  saved: t('sketch.saved'),
  pending: t('sketch.pending'),
  uploadImages: t('sketch.uploadImages'),
  chooseProject: t('sketch.chooseProject'),
  uploading: t('sketch.uploading'),
  referencesLabel: t('sketch.referencesLabel'),
  removeImage: t('sketch.removeImage'),
  noAssets: t('sketch.noAssets'),
  adjustPlaceholder: t('sketch.adjustPlaceholder'),
  notesPlaceholder: t('sketch.notesPlaceholder'),
  continue: t('sketch.continue'),
  generate: t('sketch.generate'),
  inputLimit: count => t('sketch.inputLimit', { count }),
  uploadFailed: t('sketch.uploadFailed'),
  ...props.copy,
}))
const question = computed(() => props.choice.questions[0]!)
const active = computed(() => !props.readOnly && (!props.state || props.state === 'pending'))
const selected = ref('')
const note = ref('')
const references = ref<SketchReferenceImage[]>([])
const uploading = ref(false)
const error = ref('')
const picker = useTemplateRef('picker')
const browsing = ref(false)
const locked = computed(() => props.pending || uploading.value || !active.value)
const addingImages = computed(() => question.value.id === 'sketch_references' && selected.value === 'yes')
const addingText = computed(() => selected.value === 'adjust' || Boolean(question.value.options.find(option => option.id === selected.value)?.custom))
const occupiedCount = computed(() => Math.max(1, new Set(props.sourceImages.map(image => image.url)).size))
const limit = computed(() => Math.max(0, SKETCH_MAX_INPUTS - occupiedCount.value))
const available = computed(() => props.referenceImages.filter(image =>
  !props.sourceImages.some(source => source.url === image.url),
))
const canContinue = computed(() =>
  !locked.value
  && Boolean(selected.value)
  && (!addingImages.value || references.value.length > 0)
  && (!addingText.value || Boolean(note.value.trim())),
)

watch(() => props.choice.id, () => {
  selected.value = ''
  note.value = ''
  references.value = []
  error.value = ''
  browsing.value = false
})

function toggleReference(image: SketchReferenceImage) {
  if (locked.value)
    return
  if (references.value.some(item => item.url === image.url)) {
    references.value = references.value.filter(item => item.url !== image.url)
    error.value = ''
    return
  }
  if (references.value.length >= limit.value) {
    error.value = ui.value.inputLimit(limit.value)
    return
  }
  references.value = [...references.value, image]
  error.value = ''
}

async function upload(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = ''
  if (!props.uploadImage || locked.value || !files.length)
    return
  if (files.length + references.value.length > limit.value) {
    error.value = ui.value.inputLimit(limit.value)
    return
  }

  uploading.value = true
  error.value = ''
  try {
    for (const file of files) {
      const image = await props.uploadImage(file)
      if (!references.value.some(item => item.url === image.url))
        references.value = [...references.value, image]
    }
  }
  catch (cause) {
    error.value = cause instanceof Error ? cause.message : ui.value.uploadFailed
  }
  finally {
    uploading.value = false
  }
}

function submit() {
  if (!canContinue.value)
    return
  const option = question.value.options.find(item => item.id === selected.value)
  emit('submit', [{
    questionId: question.value.id,
    optionId: selected.value,
    label: option?.label,
    ...(addingText.value ? { text: note.value.trim() } : {}),
    ...(addingImages.value ? { referenceImages: references.value } : {}),
  }])
}

function resolvedSummary() {
  const answer = props.answers[0]
  return answer?.text || answer?.label || (props.state === 'skipped' ? ui.value.skipped : ui.value.saved)
}
</script>

<template>
  <Card class="relative w-full min-w-0 gap-4 rounded-2xl border-border py-4 shadow-none" :class="active ? 'ring-1 ring-ring/50' : ''">
    <CardHeader class="gap-1.5 px-4">
      <div class="flex items-center justify-between gap-3">
        <CardTitle class="text-sm font-medium">
          {{ choice.prompt || ui.title }}
        </CardTitle>
        <Badge variant="outline" class="shrink-0 rounded-lg border-border text-[10px] text-muted-foreground">
          {{ active ? ui.pending : state === 'skipped' ? ui.skipped : ui.saved }}
        </Badge>
      </div>
      <CardDescription v-if="active">
        {{ question.title || ui.reviewStep }}
      </CardDescription>
    </CardHeader>

    <CardContent v-if="active" class="grid min-w-0 gap-4 px-4">
      <p class="whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
        {{ question.prompt }}
      </p>

      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          v-for="option in question.options"
          :key="option.id"
          type="button"
          class="min-h-14 rounded-xl border px-3 py-2 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          :class="selected === option.id ? 'border-foreground bg-accent' : 'border-border bg-muted/35 hover:bg-accent'"
          :aria-pressed="selected === option.id"
          :disabled="locked"
          @click="selected = option.id; error = ''"
        >
          <span class="block text-sm font-medium">{{ option.label }}</span>
          <span v-if="option.description" class="mt-0.5 block text-xs leading-5 text-muted-foreground">{{ option.description }}</span>
        </button>
      </div>

      <section v-if="addingImages" class="space-y-3 rounded-xl border border-border bg-muted/30 p-3" :aria-label="ui.referencesLabel">
        <div class="flex flex-wrap items-center gap-2">
          <Button v-if="uploadImage" type="button" variant="outline" size="sm" class="rounded-lg shadow-none" :disabled="locked || references.length >= limit" @click="picker?.click()">
            <ImagePlus class="size-4" />
            {{ ui.uploadImages }}
          </Button>
          <Button type="button" variant="outline" size="sm" class="rounded-lg shadow-none" :disabled="locked" @click="browsing = !browsing; emit('browseAssets')">
            {{ ui.chooseProject }}
          </Button>
          <input ref="picker" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden @change="upload">
          <p class="text-xs text-muted-foreground">
            {{ ui.inputLimit(limit) }}
          </p>
        </div>

        <p v-if="uploading" role="status" class="text-xs text-muted-foreground">
          {{ ui.uploading }}
        </p>

        <div v-if="references.length" class="grid grid-cols-3 gap-2 sm:grid-cols-5">
          <button
            v-for="image in references"
            :key="image.url"
            type="button"
            class="group relative aspect-square overflow-hidden rounded-xl border border-foreground bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            :disabled="locked"
            :aria-label="`${ui.removeImage}: ${image.name}`"
            @click="toggleReference(image)"
          >
            <img :src="image.url" :alt="image.name" class="size-full object-cover">
            <span class="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-foreground/85 px-1 py-1 text-[10px] text-background">
              <X class="size-3" />{{ ui.removeImage }}
            </span>
          </button>
        </div>

        <div v-if="browsing" class="grid max-h-60 grid-cols-3 gap-2 overflow-y-auto rounded-xl border border-border bg-card p-2 sm:grid-cols-4">
          <button
            v-for="image in available"
            :key="image.url"
            type="button"
            class="min-w-0 overflow-hidden rounded-lg border p-1 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            :class="references.some(item => item.url === image.url) ? 'border-foreground bg-accent' : 'border-border hover:bg-accent'"
            :disabled="locked"
            :aria-pressed="references.some(item => item.url === image.url)"
            @click="toggleReference(image)"
          >
            <img :src="image.url" :alt="image.name" class="h-20 w-full rounded-md object-cover">
            <span class="mt-1 block truncate px-1 text-xs">{{ image.name }}</span>
          </button>
          <p v-if="!available.length" class="col-span-full px-2 py-4 text-sm text-muted-foreground">
            {{ ui.noAssets }}
          </p>
        </div>
      </section>

      <Textarea
        v-if="addingText"
        v-model="note"
        :disabled="locked"
        :maxlength="4000"
        rows="5"
        class="rounded-xl bg-input/30 shadow-none"
        :placeholder="question.id === 'sketch_understanding' ? ui.adjustPlaceholder : ui.notesPlaceholder"
        :aria-label="question.prompt"
      />
      <p v-if="error" role="alert" class="text-sm text-destructive">
        {{ error }}
      </p>
    </CardContent>

    <CardContent v-else class="min-w-0 space-y-3 px-4">
      <p class="whitespace-pre-wrap break-words text-sm text-foreground">
        {{ question.prompt }}
      </p>
      <p class="whitespace-pre-wrap break-words text-sm text-muted-foreground">
        {{ resolvedSummary() }}
      </p>
      <div v-if="answers[0]?.referenceImages?.length" class="flex flex-wrap gap-2">
        <img v-for="image in answers[0].referenceImages" :key="image.url" :src="image.url" :alt="image.name" class="size-16 rounded-xl border border-border object-cover">
      </div>
    </CardContent>

    <CardFooter v-if="active" class="justify-end border-t border-border px-4 pt-3">
      <Button
        type="button"
        size="sm"
        class="rounded-lg bg-brand text-brand-foreground shadow-none hover:bg-brand/90"
        :disabled="!canContinue"
        @click="submit"
      >
        {{ question.id === 'sketch_understanding' && selected === 'correct' ? ui.generate : ui.continue }}
      </Button>
    </CardFooter>
  </Card>
</template>
