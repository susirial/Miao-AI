<script setup lang="ts">
import type { ConfirmationPayload } from '~/composables/useAgentLab'
import { Clock3 } from 'lucide-vue-next'
import { SEEDREAM_5_ASPECT_RATIOS, SEEDREAM_5_RESOLUTIONS } from '~~/shared/constants/aiModels'
import { isMediaUrl, isMediaVideoUrl } from '~~/shared/utils/mediaUrl'
import { SEEDANCE_2_ASPECT_RATIOS, SEEDANCE_2_DURATIONS, SEEDANCE_2_RESOLUTIONS } from '~~/shared/utils/seedance2'
import AspectRatioIcon from '@/components/ai-generator/AspectRatioIcon.vue'
import { UPLOAD_FIELD_LABELS } from '@/lib/aiModelSchema'

const props = withDefaults(defineProps<{
  confirmation: ConfirmationPayload
  state?: 'pending' | 'confirmed' | 'cancelled' | 'blocked'
  resolvedParams?: ConfirmationPayload['params']
  pending?: boolean
  working?: boolean
  readOnly?: boolean
}>(), {
  working: false,
  readOnly: false,
})

const emit = defineEmits<{
  confirm: [params: ConfirmationPayload['params']]
  cancel: []
}>()

const { open: openMedia } = useMediaLightbox()
function showPrompt(params: ConfirmationPayload['params']) {
  return Boolean(params.prompt)
}

function visibleModelInput(params: ConfirmationPayload['params']) {
  const input = {
    ...(params.prompt ? { prompt: params.prompt } : {}),
    ...params.modelInput,
  }
  return Object.fromEntries(Object.entries(input).filter(([key]) => !key.startsWith('_') && (key !== 'prompt' || showPrompt(params))))
}
const expandedParamKeys = ref<Record<string, boolean>>({})
const summaryPromptExpanded = ref(false)
function paramValueText(value: unknown) {
  return typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')
}
function paramNeedsClamp(value: unknown) {
  const text = paramValueText(value)
  return text.length > 120 || text.split('\n').length > 3
}
function isParamExpanded(jobId: string, key: string) {
  return Boolean(expandedParamKeys.value[`${jobId}:${key}`])
}
function toggleParamExpand(jobId: string, key: string) {
  const id = `${jobId}:${key}`
  expandedParamKeys.value = { ...expandedParamKeys.value, [id]: !expandedParamKeys.value[id] }
}

const prompt = ref('')
const aspectRatio = ref('1:1')
const resolution = ref('1K')
const duration = ref(5)

watch(
  () => props.confirmation,
  (value) => {
    expandedParamKeys.value = {}
    summaryPromptExpanded.value = false
    const video = value.kind === 'video'
    const imageToVideo = value.params.videoMode === 'image'
    prompt.value = value.params.prompt
    aspectRatio.value = value.params.aspectRatio || (video
      ? (imageToVideo ? 'adaptive' : '16:9')
      : '1:1')
    const nextResolution = value.params.resolution || (video ? '480p' : '1K')
    resolution.value = nextResolution
    const nextDuration = value.params.duration || 5
    duration.value = nextDuration
  },
  { immediate: true },
)

const kind = computed(() => props.confirmation.kind || 'image')
const isImage = computed(() => kind.value === 'image')
const isVideo = computed(() => kind.value === 'video')
const isImageToVideo = computed(() => {
  if (!isVideo.value)
    return false
  const mode = props.confirmation.params.videoMode
  if (mode)
    return mode === 'image'
  return aspectRatio.value === 'adaptive'
})
const videoAspectRatios = computed(() => SEEDANCE_2_ASPECT_RATIOS)
const videoResolutions = computed(() => SEEDANCE_2_RESOLUTIONS)
const videoDurations = computed(() => SEEDANCE_2_DURATIONS)
const promptError = computed(() => {
  if (!isImage.value && !isVideo.value)
    return ''
  return prompt.value.trim() ? '' : 'Prompt is required'
})
const isBatch = computed(() => Boolean(props.confirmation.params.modelId) || (props.confirmation.count || 1) > 1)
const canConfirm = computed(() => !props.readOnly && (isBatch.value || !promptError.value) && !props.pending)
const isPending = computed(() => !props.readOnly && (props.state || 'pending') === 'pending')
const shownParams = computed(() => props.resolvedParams || props.confirmation.params)
const paramSummary = computed(() => {
  const params = shownParams.value
  const parts: string[] = []
  if (params.aspectRatio)
    parts.push(params.aspectRatio)
  if (params.resolution)
    parts.push(params.resolution)
  if (params.videoMode === 'reference')
    parts.push('Reference')
  if (kind.value === 'video') {
    parts.push('Seedance 2.0')
  }
  if ((kind.value === 'video' || kind.value === 'mixed') && params.duration)
    parts.push(`${params.duration}s`)
  return parts.join(' · ')
})
const liveReason = computed(() => {
  if (props.readOnly)
    return props.confirmation.reason || 'Saved generation settings'
  if (!isVideo.value)
    return props.confirmation.reason || 'Confirm these settings to continue.'
  const count = Math.max(1, Number(props.confirmation.count) || 1)
  if (count > 1)
    return `Confirm ${count} videos.`
  return `Confirm this video.`
})
const inputUrls = computed(() =>
  (props.confirmation.inputUrls || []).filter(isMediaUrl),
)
const imageInputs = computed(() => inputUrls.value.filter(url => !isMediaVideoUrl(url)))
const videoInputs = computed(() => inputUrls.value.filter(url => isMediaVideoUrl(url)))
const imageInputLabel = computed(() => {
  if (kind.value === 'video') {
    if (props.confirmation.params.videoMode === 'reference')
      return UPLOAD_FIELD_LABELS.reference_image_urls
    if (isImageToVideo.value)
      return UPLOAD_FIELD_LABELS.first_frame_url
  }
  if (props.confirmation.task === 'Reference to Image')
    return UPLOAD_FIELD_LABELS.reference_images || UPLOAD_FIELD_LABELS.reference_image_urls
  return UPLOAD_FIELD_LABELS.input_urls
})
const imageInputMax = computed(() => {
  if (kind.value === 'video' && props.confirmation.params.videoMode === 'reference')
    return 9
  if (kind.value === 'video')
    return 1
  if (props.confirmation.task === 'Image to Image')
    return 1
  return 10
})
const videoInputMax = computed(() => 3)
const mediaGroups = computed(() => {
  const groups: Array<{ label: string, max: number, urls: string[] }> = []
  if (imageInputs.value.length) {
    groups.push({
      label: imageInputLabel.value || 'Input image',
      max: imageInputMax.value,
      urls: imageInputs.value,
    })
  }
  if (videoInputs.value.length) {
    groups.push({
      label: UPLOAD_FIELD_LABELS.reference_video_urls || 'Reference video',
      max: videoInputMax.value,
      urls: videoInputs.value,
    })
  }
  return groups
})
const hasInputs = computed(() => mediaGroups.value.length > 0)
const imageTask = computed(() => {
  if (imageInputs.value.length > 1)
    return 'Reference to Image'
  if (hasInputs.value)
    return 'Image to Image'
  return 'Text to Image'
})
const modelLabel = computed(() => {
  const name = props.confirmation.modelName?.trim()
  const rawTask = props.confirmation.task?.trim()
  const task = kind.value === 'image' && hasInputs.value && rawTask === 'Text to Image'
    ? imageTask.value
    : rawTask
  if (name && task)
    return `${name} ${task}`
  if (name)
    return name
  if (kind.value === 'video') {
    const model = 'Seedance 2.0'
    const taskName = props.confirmation.params.videoMode === 'reference'
      ? 'Reference to Video'
      : isImageToVideo.value
        ? 'Image to Video'
        : 'Text to Video'
    return `${model} ${taskName}`
  }
  if (kind.value === 'mixed')
    return 'Multiple models Mixed jobs'
  return `Seedream 5.0 Pro ${imageTask.value}`
})

function openInput(url: string, label: string) {
  openMedia({
    url,
    kind: isMediaVideoUrl(url) ? 'video' : 'image',
    alt: label,
  })
}

const title = computed(() => {
  if (kind.value === 'video') {
    return props.confirmation.params.videoMode === 'reference'
      ? 'Confirm reference video'
      : 'Confirm video'
  }
  if (kind.value === 'mixed')
    return 'Confirm jobs'
  return 'Confirm generation'
})

function isUncertain(field: ConfirmationPayload['uncertainFields'][number]) {
  return Boolean(props.confirmation.uncertainFields?.includes(field))
}

function setResolution(value: unknown) {
  const next = Array.isArray(value) ? value[0] : value
  if (typeof next !== 'string')
    return
  const allowed = isVideo.value ? videoResolutions.value : SEEDREAM_5_RESOLUTIONS
  if ((allowed as readonly string[]).includes(next))
    resolution.value = next
}

function emitConfirm() {
  if (props.readOnly)
    return
  if (props.confirmation.params.modelId) {
    emit('confirm', props.confirmation.params)
    return
  }
  emit('confirm', {
    prompt: prompt.value.trim(),
    aspectRatio: aspectRatio.value,
    resolution: resolution.value,
    ...(isVideo.value
      ? {
          duration: duration.value,
          videoMode: props.confirmation.params.videoMode,
          videoFamily: props.confirmation.params.videoFamily,
        }
      : {}),
  })
}
</script>

<template>
  <Card
    class="relative w-full gap-4 rounded-2xl border-border py-4 shadow-none"
    :class="working ? 'border-brand' : isPending || state === 'confirmed' ? 'border-foreground/40' : undefined"
  >
    <AgentLabCardBorder
      v-if="working || isPending"
      :tone="working ? 'generating' : 'attention'"
    />
    <CardHeader class="gap-1.5 px-4">
      <div class="flex items-center justify-between gap-2">
        <CardTitle class="text-sm font-medium">
          {{ title }}
        </CardTitle>
        <Badge
          v-if="state === 'confirmed' && working"
          variant="outline"
          class="border-brand/60 text-foreground"
        >
          Generating
        </Badge>
        <Badge v-else-if="state === 'cancelled'" variant="outline">
          Cancelled
        </Badge>
        <Badge v-else-if="state === 'blocked'" variant="outline">
          Not started
        </Badge>
      </div>
      <p class="flex items-center gap-2 text-sm leading-5 text-foreground">
        <AgentLabModelLogo :model-id="confirmation.params.modelId" :model-name="modelLabel" />
        <span>{{ modelLabel }}</span>
      </p>
      <CardDescription>
        {{ liveReason }}
      </CardDescription>
      <p v-if="readOnly" class="text-xs capitalize text-muted-foreground">
        {{ state || 'pending' }}
      </p>
      <p
        v-if="confirmation.approvedBy === 'agent'"
        class="text-xs text-muted-foreground"
      >
        Approved by agent
      </p>
    </CardHeader>

    <CardContent v-if="isBatch" class="px-4">
      <div v-if="confirmation.jobs?.length" class="divide-y divide-border overflow-hidden rounded-lg border border-border">
        <details v-for="(job, index) in confirmation.jobs" :key="job.id" class="group px-3 py-2.5">
          <summary class="flex cursor-pointer list-none items-start gap-3 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span class="pt-0.5 text-xs tabular-nums text-muted-foreground">{{ String(index + 1).padStart(2, '0') }}</span>
            <img v-if="job.inputUrls[0] && !isMediaVideoUrl(job.inputUrls[0])" :src="job.inputUrls[0]" alt="Reference" class="h-12 w-16 shrink-0 rounded object-cover" loading="lazy">
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium" :title="job.name">
                {{ job.name }}
              </p>
              <p class="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <AgentLabModelLogo :model-id="job.params.modelId" :model-name="job.modelName" />
                <span>{{ [job.modelName, job.params.aspectRatio, job.params.resolution, job.params.duration ? `${job.params.duration}s` : ''].filter(Boolean).join(' · ') }}</span>
              </p>
              <p v-if="showPrompt(job.params) && job.params.prompt" class="mt-1 line-clamp-1 text-xs text-muted-foreground group-open:hidden">
                {{ job.params.prompt }}
              </p>
            </div>
            <span class="text-xs text-muted-foreground group-open:rotate-180" aria-hidden="true">⌄</span>
          </summary>
          <div class="mt-3 space-y-2 border-t border-border pt-3">
            <p class="text-xs text-muted-foreground">
              {{ job.task }}
            </p>
            <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <template v-for="(value, key) in visibleModelInput(job.params)" :key="key">
                <dt class="text-muted-foreground">
                  {{ String(key).replaceAll('_', ' ') }}
                </dt>
                <dd class="flex min-w-0 items-start gap-1">
                  <span class="min-w-0 flex-1 whitespace-pre-wrap break-all" :class="!isParamExpanded(job.id, String(key)) && paramNeedsClamp(value) ? 'line-clamp-3' : ''">
                    {{ paramValueText(value) }}
                  </span>
                  <button
                    v-if="paramNeedsClamp(value)"
                    type="button"
                    class="inline-flex size-6 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    :aria-expanded="isParamExpanded(job.id, String(key))"
                    :aria-label="`${isParamExpanded(job.id, String(key)) ? 'Collapse' : 'Expand'} ${String(key)}`"
                    @click.stop.prevent="toggleParamExpand(job.id, String(key))"
                  >
                    <Icon name="lucide:chevron-down" class="size-3.5 transition-transform" :class="isParamExpanded(job.id, String(key)) ? 'rotate-180' : ''" />
                  </button>
                </dd>
              </template>
            </dl>
            <div v-if="job.inputUrls.length" class="flex flex-wrap gap-2">
              <button
                v-for="(url, refIndex) in job.inputUrls"
                :key="url"
                type="button"
                class="overflow-hidden rounded-lg border border-border bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                :aria-label="`View reference ${refIndex + 1}`"
                @click="openInput(url, `Reference ${refIndex + 1}`)"
              >
                <video v-if="isMediaVideoUrl(url)" :src="url" muted playsinline preload="metadata" class="size-28 object-contain" />
                <img v-else :src="url" :alt="`Reference ${refIndex + 1}`" loading="lazy" class="size-28 object-contain">
              </button>
            </div>
          </div>
        </details>
      </div>
      <p v-else class="text-xs text-muted-foreground">
        {{ confirmation.count }} tasks. Individual task details are unavailable for this older record.
      </p>
    </CardContent>

    <CardContent v-else-if="isPending && (isImage || isVideo)" class="px-4">
      <FieldGroup class="gap-3">
        <Field v-for="group in mediaGroups" :key="group.label">
          <p class="flex items-baseline gap-1.5 text-xs text-muted-foreground">
            <span>{{ group.label }}</span>
            <span class="tabular-nums">{{ group.urls.length }}/{{ group.max }}</span>
          </p>
          <div class="flex max-w-full flex-wrap items-start gap-2">
            <button
              v-for="url in group.urls"
              :key="url"
              type="button"
              class="size-16 overflow-hidden rounded-xl border border-border bg-muted/35 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              :aria-label="`View ${group.label}`"
              @click="openInput(url, group.label)"
            >
              <video
                v-if="isMediaVideoUrl(url)"
                :src="url"
                muted
                playsinline
                preload="metadata"
                class="size-full object-cover"
              />
              <img
                v-else
                :src="url"
                :alt="group.label"
                class="size-full object-cover"
              >
            </button>
          </div>
        </Field>

        <Field v-if="showPrompt(confirmation.params)" :data-invalid="isUncertain('prompt') || Boolean(promptError)">
          <div class="flex items-center gap-2">
            <FieldLabel :for="`agent-lab-prompt-${confirmation.id}`">
              Prompt
            </FieldLabel>
            <Badge v-if="isUncertain('prompt')" variant="outline">
              Needs review
            </Badge>
          </div>
          <Textarea
            :id="`agent-lab-prompt-${confirmation.id}`"
            v-model="prompt"
            :disabled="pending"
            :aria-invalid="Boolean(promptError)"
            class="min-h-24 rounded-xl bg-input/30 shadow-none"
          />
          <FieldDescription v-if="promptError">
            {{ promptError }}
          </FieldDescription>
        </Field>

        <Field v-if="isImage" :data-invalid="isUncertain('aspect_ratio')">
          <div class="flex items-center gap-2">
            <FieldLabel>
              Aspect ratio
            </FieldLabel>
            <Badge v-if="isUncertain('aspect_ratio')" variant="outline">
              Needs review
            </Badge>
          </div>
          <Select v-model="aspectRatio" :disabled="pending">
            <SelectTrigger class="h-9 w-full gap-1.5 rounded-lg bg-input/30 shadow-none">
              <AspectRatioIcon v-if="aspectRatio" :ratio="aspectRatio" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="ratio in SEEDREAM_5_ASPECT_RATIOS" :key="ratio" :value="ratio">
                <span class="flex items-center gap-2">
                  <AspectRatioIcon :ratio="ratio" />
                  <span>{{ ratio }}</span>
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field v-if="isImage" :data-invalid="isUncertain('resolution')">
          <div class="flex items-center gap-2">
            <FieldLabel>
              Resolution
            </FieldLabel>
            <Badge v-if="isUncertain('resolution')" variant="outline">
              Needs review
            </Badge>
          </div>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            class="w-full"
            :disabled="pending"
            :model-value="resolution"
            @update:model-value="setResolution"
          >
            <ToggleGroupItem
              v-for="item in SEEDREAM_5_RESOLUTIONS"
              :key="item"
              :value="item"
              class="flex-1"
            >
              {{ item }}
            </ToggleGroupItem>
          </ToggleGroup>
        </Field>

        <Field v-if="isVideo && !isImageToVideo" :data-invalid="isUncertain('aspect_ratio')">
          <div class="flex items-center gap-2">
            <FieldLabel>
              Aspect ratio
            </FieldLabel>
            <Badge v-if="isUncertain('aspect_ratio')" variant="outline">
              Needs review
            </Badge>
          </div>
          <Select v-model="aspectRatio" :disabled="pending">
            <SelectTrigger class="h-9 w-full gap-1.5 rounded-lg bg-input/30 shadow-none">
              <AspectRatioIcon v-if="aspectRatio" :ratio="aspectRatio" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="ratio in videoAspectRatios" :key="ratio" :value="ratio">
                <span class="flex items-center gap-2">
                  <AspectRatioIcon :ratio="ratio" />
                  <span>{{ ratio }}</span>
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field v-if="isVideo" :data-invalid="isUncertain('resolution')">
          <div class="flex items-center gap-2">
            <FieldLabel>
              Resolution
            </FieldLabel>
            <Badge v-if="isUncertain('resolution')" variant="outline">
              Needs review
            </Badge>
          </div>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            class="grid w-full grid-cols-4"
            :disabled="pending"
            :model-value="resolution"
            @update:model-value="setResolution"
          >
            <ToggleGroupItem
              v-for="item in videoResolutions"
              :key="item"
              :value="item"
              class="px-1"
            >
              {{ item }}
            </ToggleGroupItem>
          </ToggleGroup>
        </Field>

        <Field v-if="isVideo" :data-invalid="isUncertain('duration')">
          <div class="flex items-center gap-2">
            <FieldLabel>
              Duration
            </FieldLabel>
            <Badge v-if="isUncertain('duration')" variant="outline">
              Needs review
            </Badge>
          </div>
          <Select :model-value="String(duration)" :disabled="pending" @update:model-value="value => duration = Number(value) || 5">
            <SelectTrigger class="h-9 w-full gap-1.5 rounded-lg bg-input/30 shadow-none">
              <Clock3 class="size-3.5 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="item in videoDurations" :key="item" :value="String(item)">
                {{ item }}s
              </SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </FieldGroup>
    </CardContent>

    <CardContent v-else class="px-4">
      <p v-if="modelLabel" class="flex items-center gap-1.5 text-xs text-muted-foreground">
        <AgentLabModelLogo :model-id="confirmation.params.modelId" :model-name="modelLabel" />
        <span>{{ modelLabel }}</span>
      </p>
      <div v-if="hasInputs" class="mt-2 flex flex-col gap-2">
        <div v-for="group in mediaGroups" :key="group.label" class="flex flex-col gap-1.5">
          <p class="flex items-baseline gap-1.5 text-xs text-muted-foreground">
            <span>{{ group.label }}</span>
            <span class="tabular-nums">{{ group.urls.length }}/{{ group.max }}</span>
          </p>
          <div class="flex max-w-full flex-wrap items-start gap-2">
            <button
              v-for="url in group.urls"
              :key="url"
              type="button"
              class="size-16 overflow-hidden rounded-xl border border-border bg-muted/35 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              :aria-label="`View ${group.label}`"
              @click="openInput(url, group.label)"
            >
              <video
                v-if="isMediaVideoUrl(url)"
                :src="url"
                muted
                playsinline
                preload="metadata"
                class="size-full object-cover"
              />
              <img
                v-else
                :src="url"
                :alt="group.label"
                class="size-full object-cover"
              >
            </button>
          </div>
        </div>
      </div>
      <div v-if="showPrompt(shownParams) && shownParams.prompt" class="mt-2 flex items-start gap-1">
        <p class="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm leading-6 text-foreground" :class="!summaryPromptExpanded && !readOnly ? 'line-clamp-3' : ''">
          {{ shownParams.prompt }}
        </p>
        <button v-if="!readOnly && paramNeedsClamp(shownParams.prompt)" type="button" class="inline-flex size-6 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" :aria-expanded="summaryPromptExpanded" aria-label="Expand prompt" @click="summaryPromptExpanded = !summaryPromptExpanded">
          <Icon name="lucide:chevron-down" class="size-3.5 transition-transform" :class="summaryPromptExpanded ? 'rotate-180' : ''" />
        </button>
      </div>
      <p v-if="paramSummary" class="mt-2 text-xs text-muted-foreground">
        {{ paramSummary }}
      </p>
    </CardContent>

    <CardFooter v-if="isPending" class="justify-end gap-2 border-t border-border px-4 pt-3">
      <Button variant="outline" size="sm" class="rounded-lg shadow-none" :disabled="pending" @click="emit('cancel')">
        Cancel
      </Button>
      <Button
        size="sm"
        class="rounded-lg shadow-none"
        :disabled="!canConfirm"
        @click="emitConfirm"
      >
        <Spinner v-if="pending" />
        Generate
      </Button>
    </CardFooter>
  </Card>
</template>
