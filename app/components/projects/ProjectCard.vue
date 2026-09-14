<script setup lang="ts">
import type { GenerationProjectPublic } from '~~/shared/types/project'
import { isMediaVideoUrl } from '~~/shared/utils/mediaUrl'

const props = withDefaults(defineProps<{
  project: GenerationProjectPublic
  showActions?: boolean
}>(), {
  showActions: false,
})

const emit = defineEmits<{
  edit: []
  delete: []
}>()
const { locale, t } = useI18n()
const localePath = useLocalePath()

const coverFailed = ref(false)
const coverUrl = computed(() => props.project.coverUrl || '')
const isVideoCover = computed(() => Boolean(coverUrl.value) && isMediaVideoUrl(coverUrl.value))
const showCover = computed(() => Boolean(coverUrl.value) && !coverFailed.value)
const showPlaceholder = computed(() => !showCover.value)
const projectInitial = computed(() => props.project.name.trim().charAt(0).toLocaleUpperCase() || 'M')
const updatedTime = computed(() => {
  const date = new Date(props.project.updatedAt)
  if (Number.isNaN(date.getTime()))
    return ''
  const diffSeconds = Math.round((date.getTime() - Date.now()) / 1000)
  const language = locale.value === 'zh' ? 'zh-CN' : 'en-US'
  const relative = new Intl.RelativeTimeFormat(language, { numeric: 'auto' })
  if (Math.abs(diffSeconds) < 60)
    return t('projects.justNow')
  if (Math.abs(diffSeconds) < 60 * 60)
    return relative.format(Math.round(diffSeconds / 60), 'minute')
  if (Math.abs(diffSeconds) < 24 * 60 * 60)
    return relative.format(Math.round(diffSeconds / (60 * 60)), 'hour')
  if (Math.abs(diffSeconds) < 7 * 24 * 60 * 60)
    return relative.format(Math.round(diffSeconds / (24 * 60 * 60)), 'day')
  return new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric' }).format(date)
})

watch(coverUrl, () => {
  coverFailed.value = false
})
</script>

<template>
  <article class="group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-none transition-colors duration-150 hover:border-foreground/20">
    <NuxtLink
      :to="localePath(`/projects/${project.id}`)"
      class="flex min-w-0 flex-1 flex-col focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
      :aria-disabled="project.deleting"
      @click="project.deleting && $event.preventDefault()"
    >
      <div class="relative aspect-4/3 overflow-hidden bg-muted">
        <video
          v-if="showCover && isVideoCover"
          :key="coverUrl"
          :src="coverUrl"
          muted
          playsinline
          preload="metadata"
          class="pointer-events-none size-full object-cover transition-transform duration-150 group-hover:scale-[1.015]"
          @error="coverFailed = true"
        />
        <img
          v-else-if="showCover"
          :key="coverUrl"
          :src="coverUrl"
          :alt="t('projects.coverAlt', { name: project.name })"
          class="size-full object-cover transition-transform duration-150 group-hover:scale-[1.015]"
          @error="coverFailed = true"
        >
        <div
          v-if="showPlaceholder"
          class="flex h-full items-center justify-center bg-surface p-6"
        >
          <div class="flex aspect-4/3 w-24 items-center justify-center rounded-xl border border-border bg-card">
            <span class="font-mono text-3xl font-medium tracking-[-0.08em] text-muted-foreground/70">
              {{ projectInitial }}
            </span>
          </div>
        </div>
        <div
          v-if="project.deleting || project.activeJobCount > 0"
          class="absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-lg border border-border bg-card/95 px-2 py-1 text-[11px] font-medium backdrop-blur"
        >
          <span class="size-1.5 rounded-full" :class="project.deleting ? 'bg-destructive' : 'bg-brand'" />
          {{ project.deleting ? t('projects.deleting') : t('projects.generating') }}
        </div>
      </div>
      <div class="flex min-h-24 flex-col gap-1 p-4 pb-3">
        <h3 class="flex min-w-0 items-center gap-1.5 text-sm font-medium text-foreground">
          <span class="truncate">{{ project.name }}</span>
        </h3>
        <p
          v-if="project.description"
          class="line-clamp-2 text-xs leading-5 text-muted-foreground"
        >
          {{ project.description }}
        </p>
        <p v-else class="text-xs leading-5 text-muted-foreground/70">
          {{ t('projects.noDescription') }}
        </p>
      </div>
    </NuxtLink>
    <div class="flex min-h-10 items-center justify-between gap-2 border-t border-border px-4 py-2.5">
      <div class="flex min-w-0 items-center gap-2 font-mono text-[11px] text-muted-foreground">
        <span class="shrink-0">{{ t('projects.assetCount', project.assetCount) }}</span>
        <span aria-hidden="true">·</span>
        <span class="truncate">{{ t('projects.updated', { time: updatedTime }) }}</span>
      </div>
      <DropdownMenu
        v-if="showActions"
        :modal="false"
      >
        <DropdownMenuTrigger as-child>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            class="shrink-0 rounded-lg shadow-none"
            :aria-label="t('projects.actionsFor', { name: project.name })"
          >
            <Icon
              name="i-lucide-ellipsis-vertical"
              class="size-4"
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="min-w-36">
          <DropdownMenuItem
            v-if="!project.isDefault"
            @click="emit('edit')"
          >
            {{ t('projects.edit') }}
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            @click="emit('delete')"
          >
            {{ t('common.delete') }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </article>
</template>
