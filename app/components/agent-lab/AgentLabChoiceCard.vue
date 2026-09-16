<script setup lang="ts">
import type { ImageAnnotationPoint, ImageAnnotationReference } from '~~/shared/utils/imageAnnotations'
import type { ChoiceAnswer, ChoicePayload, ChoiceQuestion } from '~/composables/useAgentLab'
import { standaloneImageEditQuestions, withCustomChoiceOption } from '~~/shared/utils/agentChoices'

const props = withDefaults(defineProps<{
  choice: ChoicePayload
  state?: 'pending' | 'answered' | 'skipped'
  answers?: ChoiceAnswer[]
  pending?: boolean
  sourceImages?: { id: string, url: string }[]
  referenceImages?: ImageAnnotationReference[]
  uploadImage?: (file: File) => Promise<ImageAnnotationReference>
}>(), {
  pending: false,
})

const emit = defineEmits<{
  submit: [answers: ChoiceAnswer[]]
  skip: []
  browseAssets: []
}>()
const { t } = useI18n()

const questions = computed(() => standaloneImageEditQuestions(props.choice.questions).map(question => ({
  ...question,
  options: withCustomChoiceOption(question.options, {
    label: t('choice.other'),
    description: t('choice.otherHint'),
  }),
})))

const isPending = computed(() => (props.state || 'pending') === 'pending')
const promptExpanded = ref(false)
const questionPromptExpanded = ref<Record<string, boolean>>({})
function textNeedsExpand(value: string) {
  return value.trim().length > 140 || value.trim().split('\n').length > 2
}
const selections = ref<Record<string, { optionId: string, text: string }>>({})
const sourceUrl = ref('')
const annotationPointsByImage = ref<Record<string, ImageAnnotationPoint[]>>({})
const annotationPoints = computed({
  get: () => annotationPointsByImage.value[sourceUrl.value] || [],
  set: (points: ImageAnnotationPoint[]) => { annotationPointsByImage.value[sourceUrl.value] = points },
})
const annotating = computed(() => selections.value.image_edit_method?.optionId === 'annotate')
const uploading = ref(false)

watch(() => props.sourceImages, (images) => {
  if (!images?.some(image => image.url === sourceUrl.value))
    sourceUrl.value = images?.[0]?.url || ''
}, { immediate: true })

watch(
  () => props.choice.id,
  () => {
    promptExpanded.value = false
    questionPromptExpanded.value = {}
    selections.value = {}
    annotationPointsByImage.value = {}
    for (const answer of props.answers || []) {
      if (answer.annotationEdit) {
        sourceUrl.value = answer.annotationEdit.imageUrl
        annotationPointsByImage.value[answer.annotationEdit.imageUrl] = answer.annotationEdit.points.map(point => ({ ...point }))
      }
      if (answer.optionId)
        selections.value[answer.questionId] = { optionId: answer.optionId, text: answer.text || '' }
    }
    const method = questions.value.find(question => question.id === 'image_edit_method')
    if (method?.options.some(option => option.id === 'annotate') && method.recommendedId === 'annotate' && !selections.value.image_edit_method)
      selections.value.image_edit_method = { optionId: 'annotate', text: '' }
  },
  { immediate: true },
)

function selectedOption(question: ChoiceQuestion) {
  const current = selections.value[question.id]
  if (!current)
    return null
  return question.options.find(item => item.id === current.optionId) || null
}

function selectOption(question: ChoiceQuestion, optionId: string) {
  if (!isPending.value || props.pending || uploading.value)
    return
  const option = question.options.find(item => item.id === optionId)
  if (!option)
    return
  const previous = selections.value[question.id]
  selections.value = {
    ...selections.value,
    [question.id]: {
      optionId,
      text: option.custom ? (previous?.optionId === optionId ? previous.text : '') : '',
    },
  }
}

function setCustomText(questionId: string, value: string) {
  const current = selections.value[questionId]
  if (!current)
    return
  selections.value = {
    ...selections.value,
    [questionId]: {
      ...current,
      text: value,
    },
  }
}

const canSubmit = computed(() => {
  if (!isPending.value || props.pending || uploading.value)
    return false
  if (annotating.value && (!sourceUrl.value || !annotationPoints.value.length || annotationPoints.value.some(point => !point.text.trim())))
    return false
  const references = new Set(annotationPoints.value.flatMap(point => point.references || []).map(reference => reference.url))
  if (references.size > 8)
    return false
  return questions.value.every((question) => {
    const option = selectedOption(question)
    if (!option)
      return false
    if (option.custom)
      return Boolean(selections.value[question.id]?.text.trim())
    return true
  })
})

function emitSubmit() {
  if (!canSubmit.value)
    return
  emit('submit', questions.value.map((question) => {
    const current = selections.value[question.id]
    const option = selectedOption(question)
    return {
      questionId: question.id,
      optionId: current?.optionId,
      label: option?.label,
      text: current?.text.trim() || undefined,
      ...(question.id === 'image_edit_method' && current?.optionId === 'annotate'
        ? { annotationEdit: { imageUrl: sourceUrl.value, points: annotationPoints.value.map(point => ({ ...point })) } }
        : {}),
    }
  }))
}

function optionLabel(question: ChoiceQuestion, answer?: ChoiceAnswer) {
  if (!answer || answer.skipped)
    return ''
  // Prefer the rendered option so a localized label wins over the stored one.
  const label = question.options.find(item => item.id === answer.optionId)?.label || answer.label
  if (answer.text && label)
    return `${label}: ${answer.text}`
  return answer.text || label || answer.optionId || ''
}

const resolvedAnswers = computed(() => {
  const byId = new Map((props.answers || []).map(item => [item.questionId, item]))
  return questions.value.map((question) => {
    const answer = byId.get(question.id)
    return {
      question,
      answer,
      skipped: Boolean(answer?.skipped || props.state === 'skipped'),
      summary: optionLabel(question, answer),
    }
  })
})
</script>

<template>
  <AgentLabSketchChoice
    v-if="choice.questions.length === 1 && ['sketch_references', 'sketch_understanding'].includes(choice.questions[0]!.id)"
    :key="choice.id"
    :choice="choice"
    :state="state"
    :answers="answers"
    :pending="pending"
    :reference-images="referenceImages"
    :source-images="sourceImages"
    :upload-image="uploadImage"
    @submit="emit('submit', $event)"
    @browse-assets="emit('browseAssets')"
  />
  <Card
    v-else
    class="relative w-full gap-4 rounded-2xl border-blue-500/70 py-4 shadow-none"
  >
    <AgentLabCardBorder v-if="isPending" tone="attention" />
    <CardHeader class="gap-1.5 px-4">
      <div class="flex items-center justify-between gap-2">
        <CardTitle class="text-sm font-medium whitespace-pre-wrap" :class="!promptExpanded && textNeedsExpand(choice.prompt || '') ? 'line-clamp-2' : ''">
          {{ choice.prompt || t('choice.fallbackPrompt') }}
        </CardTitle>
        <button v-if="textNeedsExpand(choice.prompt || '')" type="button" class="inline-flex size-6 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" :aria-expanded="promptExpanded" :aria-label="t('choice.expandPrompt')" @click="promptExpanded = !promptExpanded">
          <Icon name="lucide:chevron-down" class="size-3.5 transition-transform" :class="promptExpanded ? 'rotate-180' : ''" />
        </button>
        <Badge
          v-if="state === 'skipped'"
          variant="outline"
        >
          {{ t('choice.agentDecides') }}
        </Badge>
        <Badge
          v-else-if="state === 'answered'"
          variant="outline"
        >
          {{ t('choice.saved') }}
        </Badge>
      </div>
      <CardDescription v-if="isPending && choice.recommendation">
        {{ choice.recommendation }}
      </CardDescription>
      <p
        v-else-if="isPending"
        class="text-xs text-muted-foreground"
      >
        {{ t('choice.skipHint') }}
      </p>
    </CardHeader>

    <CardContent v-if="isPending" class="px-4">
      <div class="flex flex-col gap-5">
        <section v-if="annotating" class="flex min-w-0 flex-col gap-3" :aria-label="t('choice.annotateSection')">
          <p class="text-sm text-foreground">
            {{ t('annotation.clickToAdd') }}
          </p>
          <div v-if="(sourceImages?.length || 0) > 1" class="flex flex-wrap gap-2" :aria-label="t('choice.chooseSource')">
            <button
              v-for="image in sourceImages"
              :key="image.id"
              type="button"
              class="rounded-lg border p-1"
              :class="sourceUrl === image.url ? 'border-primary bg-primary/5' : 'border-border'"
              :aria-pressed="sourceUrl === image.url"
              :disabled="pending || uploading"
              @click="sourceUrl = image.url"
            >
              <img :src="image.url" alt="" class="size-16 rounded object-contain">
            </button>
          </div>
          <ToolsImageAnnotationEditor
            v-if="sourceUrl"
            :key="sourceUrl"
            v-model="annotationPoints"
            :src="sourceUrl"
            :disabled="pending"
            :reference-images="referenceImages"
            :upload-image="uploadImage"
            @uploading="uploading = $event"
            @browse-assets="emit('browseAssets')"
          />
          <p v-else role="status" class="text-sm text-muted-foreground">
            {{ t('annotation.missingSource') }}
          </p>
          <p v-if="new Set(annotationPoints.flatMap(point => point.references || []).map(reference => reference.url)).size > 8" role="alert" class="text-xs text-destructive">
            {{ t('annotation.referenceLimit') }}
          </p>
        </section>
        <fieldset
          v-for="question in questions.filter(item => !(annotating && item.id === 'image_edit_method'))"
          :key="question.id"
          class="min-w-0"
        >
          <legend class="mb-2 flex min-w-0 flex-col gap-0.5">
            <span
              v-if="question.title"
              class="text-[11px] font-medium tracking-wide text-muted-foreground uppercase"
            >
              {{ question.title }}
            </span>
            <span class="text-sm font-medium whitespace-pre-wrap text-foreground" :class="!questionPromptExpanded[question.id] && textNeedsExpand(question.prompt) ? 'line-clamp-2' : ''">
              {{ question.prompt }}
            </span>
            <button v-if="textNeedsExpand(question.prompt)" type="button" class="mt-1 inline-flex size-6 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted" :aria-expanded="Boolean(questionPromptExpanded[question.id])" :aria-label="t('choice.expandQuestion')" @click="questionPromptExpanded = { ...questionPromptExpanded, [question.id]: !questionPromptExpanded[question.id] }">
              <Icon name="lucide:chevron-down" class="size-3.5 transition-transform" :class="questionPromptExpanded[question.id] ? 'rotate-180' : ''" />
            </button>
          </legend>
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              v-for="option in question.options"
              :key="option.id"
              type="button"
              class="flex min-h-16 flex-col items-start gap-1 rounded-xl border px-3 py-2.5 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              :class="selectedOption(question)?.id === option.id
                ? 'border-foreground bg-accent'
                : 'border-border bg-muted/35 hover:bg-accent'"
              :disabled="pending"
              :aria-pressed="selectedOption(question)?.id === option.id"
              @click="selectOption(question, option.id)"
            >
              <span class="flex w-full items-start justify-between gap-2">
                <span class="text-sm font-medium text-foreground">
                  {{ option.label }}
                </span>
                <Badge
                  v-if="question.recommendedId === option.id"
                  variant="outline"
                  class="shrink-0 border-border text-[10px] text-muted-foreground"
                >
                  {{ t('choice.suggested') }}
                </Badge>
              </span>
              <span
                v-if="option.description"
                class="text-xs leading-5 text-muted-foreground"
              >
                {{ option.description }}
              </span>
            </button>
          </div>
          <Input
            v-if="selectedOption(question)?.custom"
            :id="`agent-choice-${choice.id}-${question.id}`"
            :model-value="selections[question.id]?.text || ''"
            :disabled="pending"
            class="mt-2 h-10 rounded-xl bg-input/30 shadow-none"
            :placeholder="t('choice.customPlaceholder')"
            :aria-label="t('choice.customLabel', { question: question.prompt })"
            @update:model-value="setCustomText(question.id, String($event))"
            @keydown.enter.prevent="emitSubmit()"
          />
        </fieldset>
      </div>
    </CardContent>

    <CardContent v-else class="px-4">
      <div class="flex flex-col gap-3">
        <div
          v-for="item in resolvedAnswers"
          :key="item.question.id"
          class="min-w-0"
        >
          <p class="text-xs text-muted-foreground">
            {{ item.question.title || item.question.prompt }}
          </p>
          <p class="mt-0.5 text-sm text-foreground">
            {{ item.skipped ? t('choice.agentDecides') : (item.summary || t('choice.saved')) }}
          </p>
          <ol v-if="item.answer?.annotationEdit" class="mt-2 space-y-1 text-sm">
            <li v-for="(point, index) in item.answer.annotationEdit.points" :key="index">
              {{ index + 1 }}. {{ point.text }}
            </li>
          </ol>
        </div>
      </div>
    </CardContent>

    <CardFooter v-if="isPending" class="justify-end gap-2 border-t border-border px-4 pt-3">
      <Button
        variant="outline"
        size="sm"
        class="rounded-lg shadow-none"
        :disabled="pending || uploading"
        @click="emit('skip')"
      >
        {{ t('choice.skip') }}
      </Button>
      <Button
        size="sm"
        class="rounded-lg shadow-none"
        :disabled="!canSubmit"
        @click="emitSubmit"
      >
        <Spinner v-if="pending" />
        {{ annotating ? t('choice.confirmEdits') : t('choice.continue') }}
      </Button>
    </CardFooter>
  </Card>
</template>
