<script setup lang="ts">
import { Languages } from 'lucide-vue-next'

const { locale, setLocale, t } = useI18n({ useScope: 'global' })
const currentLocale = computed(() => String(unref(locale)).toLowerCase().startsWith('zh') ? 'zh' : 'en')

async function switchLanguage(event: Event) {
  const code = (event.target as HTMLSelectElement).value
  if (code === currentLocale.value)
    return
  if (code !== 'en' && code !== 'zh')
    return
  await setLocale(code)
}
</script>

<template>
  <label class="relative inline-flex h-9 items-center rounded-lg border border-border bg-card text-sm text-foreground transition-colors hover:bg-accent">
    <Languages class="pointer-events-none ml-2.5 size-4 text-muted-foreground" aria-hidden="true" />
    <span class="sr-only">{{ t('language.label') }}</span>
    <select
      :key="currentLocale"
      :value="currentLocale"
      class="h-full cursor-pointer appearance-none bg-transparent pr-7 pl-2 text-xs font-medium outline-none"
      :aria-label="t('language.label')"
      @change="switchLanguage"
    >
      <option value="en" :selected="currentLocale === 'en'">
        {{ t('language.english') }}
      </option>
      <option value="zh" :selected="currentLocale === 'zh'">
        {{ t('language.chinese') }}
      </option>
    </select>
    <Icon name="i-lucide-chevron-down" class="pointer-events-none absolute right-2 size-3 text-muted-foreground" />
  </label>
</template>
