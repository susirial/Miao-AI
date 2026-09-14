<script setup lang="ts">
import { AlertTriangle, CheckCircle2 } from 'lucide-vue-next'
import { useServiceConnection } from '~/composables/useServiceConnection'

const { dialogOpen: open, openDialog } = useServiceConnection()
const { t } = useI18n()
const connected = ref(false)

async function refresh() {
  try {
    const status = await $fetch<{ connected: boolean }>('/api/settings/services')
    connected.value = Boolean(status.connected)
  }
  catch {
    connected.value = false
  }
}

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  refresh()
  timer = setInterval(refresh, 30000)
})
onUnmounted(() => clearInterval(timer))
watch(open, (value, previous) => {
  if (previous && !value)
    void refresh()
})
</script>

<template>
  <button
    type="button"
    class="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
    :class="connected ? 'text-success' : 'text-destructive'"
    :aria-label="t('service.title')"
    aria-haspopup="dialog"
    :aria-expanded="open"
    :title="connected ? t('service.ready') : t('service.configure')"
    @click="openDialog"
  >
    <CheckCircle2 v-if="connected" class="size-4" />
    <AlertTriangle v-else class="size-4" />
    <span>{{ connected ? t('service.servicesReady') : t('service.configureServices') }}</span>
  </button>
</template>
