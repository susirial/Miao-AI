<script setup lang="ts">
import type { ProviderId, PublicProviderStatus } from '~~/shared/types/provider'
import { CheckCircle2, ChevronDown, Circle, LoaderCircle } from 'lucide-vue-next'
import { TEXT_MODEL_CATALOG } from '~~/shared/constants/modelCatalog'
import { useServiceConnection } from '~/composables/useServiceConnection'

interface ConnectionStatus {
  version: 4
  revision: string
  connected: boolean
  textReady: boolean
  imageReady: boolean
  videoReady: boolean
  selectedTextModel: string
  selectedImageFamily: string
  selectedVideoFamily: string
  selectedImageReady: boolean
  selectedVideoReady: boolean
  selectedTextProvider: ProviderId
  selectedTextCapabilities: {
    vision: boolean
    tools: boolean
    reasoning: boolean
  }
  providers: Record<ProviderId, PublicProviderStatus>
  tosConfigured: boolean
  tosOk: boolean
  tosCheckedAt: string
  tosBucket: string
  tosPrefix: string
  tosRegion: 'cn-beijing'
  tosEndpoint: 'https://tos-cn-beijing.volces.com'
  checkedAt: string
}

interface TestResult {
  ok: boolean
  message: string
  skipped?: boolean
  mediaGenerationVerified?: false
}

type TestResults = Record<'ark' | 'deepSeek' | 'zai' | 'agnes' | 'tos', TestResult>
type KeyField = 'arkKey' | 'deepSeekKey' | 'zaiKey' | 'agnesKey'

const status = ref<ConnectionStatus | null>(null)
const { dialogOpen: open } = useServiceConnection()
const { t } = useI18n()
const testing = ref(false)
const MASKED_KEY = '********'
const keys = reactive<Record<KeyField, string>>({
  arkKey: '',
  deepSeekKey: '',
  zaiKey: '',
  agnesKey: '',
})
const selectedTextModel = ref(TEXT_MODEL_CATALOG[0]!.id)
const tosOpen = ref(false)
const tosSection = ref<HTMLElement | null>(null)
const tosContentId = 'service-reference-storage-content'
const tos = reactive({
  accessKeyId: '',
  secretAccessKey: '',
  bucket: '',
  prefix: '',
})

function providerLabel(provider: ProviderId) {
  if (provider === 'ark')
    return t('service.providerArk')
  if (provider === 'deepseek')
    return t('service.providerDeepSeek')
  if (provider === 'zai')
    return t('service.providerZai')
  return t('service.providerAgnes')
}

function modelDescription(model: (typeof TEXT_MODEL_CATALOG)[number]) {
  return model.provider === 'ark'
    ? `${providerLabel(model.provider)} · ${model.description}`
    : model.description
}

const keyFields = computed(() => [
  { field: 'arkKey' as const, provider: 'ark' as const, label: t('service.arkApiKey'), placeholder: t('service.arkApiKeyPlaceholder'), href: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey' },
  { field: 'deepSeekKey' as const, provider: 'deepseek' as const, label: t('service.deepSeekApiKey'), placeholder: t('service.deepSeekApiKeyPlaceholder'), href: 'https://platform.deepseek.com/api_keys' },
  { field: 'zaiKey' as const, provider: 'zai' as const, label: t('service.zaiApiKey'), placeholder: t('service.zaiApiKeyPlaceholder'), href: 'https://z.ai/manage-apikey/apikey-list' },
  { field: 'agnesKey' as const, provider: 'agnes' as const, label: t('service.agnesApiKey'), placeholder: t('service.agnesApiKeyPlaceholder'), href: 'https://platform.agnes-ai.com/' },
])

function showSavedKeys() {
  for (const item of keyFields.value)
    keys[item.field] = status.value?.providers[item.provider].configured ? MASKED_KEY : ''
  tos.accessKeyId = status.value?.tosConfigured ? MASKED_KEY : ''
  tos.secretAccessKey = status.value?.tosConfigured ? MASKED_KEY : ''
  tos.bucket = status.value?.tosBucket || ''
  tos.prefix = status.value?.tosPrefix || ''
}

function selectKey(event: FocusEvent) {
  (event.target as HTMLInputElement).select()
}

const error = ref('')
const results = ref<TestResults | null>(null)
const selectedModel = computed(() => TEXT_MODEL_CATALOG.find(model => model.id === selectedTextModel.value) ?? TEXT_MODEL_CATALOG[0]!)
const resultRows = computed(() => results.value
  ? [
      { id: 'ark', label: t('service.providerArk'), result: results.value.ark },
      { id: 'deepseek', label: t('service.providerDeepSeek'), result: results.value.deepSeek },
      { id: 'zai', label: t('service.providerZai'), result: results.value.zai },
      { id: 'agnes', label: t('service.providerAgnes'), result: results.value.agnes },
      { id: 'tos', label: 'TOS', result: results.value.tos },
    ].filter(row => !row.result.skipped)
  : [])
const nothingToTest = computed(() => Boolean(results.value) && resultRows.value.length === 0)
const testNotice = ref<HTMLElement | null>(null)
const capabilityRows = computed(() => [
  { label: t('service.text'), ready: Boolean(status.value?.textReady) },
  { label: t('service.image'), ready: Boolean(status.value?.imageReady) },
  { label: t('service.video'), ready: Boolean(status.value?.videoReady) },
])

async function refresh() {
  try { status.value = await $fetch<ConnectionStatus>('/api/settings/services') }
  catch { status.value = null }
}

watch(open, async (value) => {
  for (const item of keyFields.value)
    keys[item.field] = ''
  if (!value)
    return
  tosOpen.value = false
  results.value = null
  error.value = ''
  await nextTick()
  await refresh()
  showSavedKeys()
  selectedTextModel.value = status.value?.selectedTextModel || TEXT_MODEL_CATALOG[0]!.id
})

function submittedKey(field: KeyField) {
  return keys[field] === MASKED_KEY ? undefined : keys[field]
}

function submittedTosSecret(value: string) {
  return value === MASKED_KEY ? undefined : value
}

function clearTos() {
  tos.accessKeyId = ''
  tos.secretAccessKey = ''
  tos.bucket = ''
  tos.prefix = ''
}

async function toggleTos() {
  tosOpen.value = !tosOpen.value
  if (!tosOpen.value)
    return
  await nextTick()
  tosSection.value?.scrollIntoView({ block: 'nearest' })
}

function providerState(provider: ProviderId) {
  const value = status.value?.providers[provider]
  if (value?.ok)
    return 'Verified'
  if (value?.configured)
    return 'Not verified'
  return 'Not configured'
}

function providerCapabilityDescription(provider: ProviderId) {
  if (provider === 'ark')
    return t('service.arkCapabilities')
  if (provider === 'agnes')
    return t('service.agnesCapabilities')
  return ''
}

async function testConnection() {
  testing.value = true
  results.value = null
  error.value = ''
  if (status.value)
    status.value.connected = false
  try {
    const result = await $fetch<ConnectionStatus & TestResults & { superseded: boolean }>('/api/settings/services', {
      method: 'POST',
      body: {
        revision: status.value?.revision,
        selectedTextModel: selectedTextModel.value,
        arkKey: submittedKey('arkKey'),
        deepSeekKey: submittedKey('deepSeekKey'),
        zaiKey: submittedKey('zaiKey'),
        agnesKey: submittedKey('agnesKey'),
        tosAccessKeyId: submittedTosSecret(tos.accessKeyId),
        tosSecretAccessKey: submittedTosSecret(tos.secretAccessKey),
        tosBucket: tos.bucket,
        tosPrefix: tos.prefix,
      },
      timeout: 65000,
    })
    status.value = result
    results.value = result
    if (!result.tos.skipped && !result.tos.ok)
      tosOpen.value = true
    if (result.superseded)
      error.value = 'Settings changed in another window. Test the current settings again.'
    showSavedKeys()
    await nextTick()
    testNotice.value?.scrollIntoView({ block: 'nearest' })
  }
  catch {
    error.value = 'Connection test could not finish. Settings may have changed in another window.'
    await refresh()
  }
  finally { testing.value = false }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-2xl bg-card p-0 shadow-none sm:max-w-2xl">
      <DialogHeader class="border-b px-5 py-4 pr-12">
        <DialogTitle>{{ t('service.title') }}</DialogTitle>
        <DialogDescription>{{ t('service.description') }}</DialogDescription>
      </DialogHeader>

      <form class="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] overflow-hidden" @submit.prevent="testConnection">
        <div class="space-y-5 overflow-y-auto p-5">
          <section class="space-y-3" aria-labelledby="text-model-heading">
            <div>
              <h3 id="text-model-heading" class="text-sm font-medium">
                {{ t('service.textModel') }}
              </h3>
              <p class="text-xs text-muted-foreground">
                {{ t('service.textModelDescription') }}
              </p>
            </div>
            <Select v-model="selectedTextModel" :disabled="testing">
              <SelectTrigger class="h-10 w-full rounded-lg bg-secondary">
                <SelectValue :placeholder="t('service.selectModel')" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="model in TEXT_MODEL_CATALOG" :key="model.id" :value="model.id">
                  {{ model.name }}
                </SelectItem>
              </SelectContent>
            </Select>
            <div class="rounded-xl border bg-background/50 p-3">
              <div class="flex flex-wrap items-center gap-2">
                <span class="text-sm font-medium">{{ selectedModel.name }}</span>
                <Badge variant="outline" class="rounded-lg">
                  {{ providerLabel(selectedModel.provider) }}
                </Badge>
                <Badge v-if="selectedModel.capabilities.vision" variant="secondary" class="rounded-lg">
                  Vision
                </Badge>
                <Badge v-if="selectedModel.capabilities.tools" variant="secondary" class="rounded-lg">
                  Tools
                </Badge>
                <Badge v-if="selectedModel.capabilities.reasoning" variant="secondary" class="rounded-lg">
                  Reasoning
                </Badge>
              </div>
              <p class="mt-1 text-xs text-muted-foreground">
                {{ modelDescription(selectedModel) }}
              </p>
              <p v-if="selectedModel.id === 'zai/glm-5.3'" class="mt-2 text-xs text-warning">
                {{ t('service.glmVisionWarning') }}
              </p>
              <p v-if="selectedModel.provider === 'agnes'" class="mt-2 text-xs text-warning">
                {{ t('service.agnesVisionWarning') }}
              </p>
            </div>
          </section>

          <Separator />

          <section class="space-y-3" aria-labelledby="provider-keys-heading">
            <div>
              <h3 id="provider-keys-heading" class="text-sm font-medium">
                {{ t('service.providerKeys') }}
              </h3>
              <p class="text-xs text-muted-foreground">
                {{ t('service.providerKeysDescription') }}
              </p>
            </div>
            <div class="grid gap-3 sm:grid-cols-2">
              <div v-for="item in keyFields" :key="item.field" class="space-y-2 rounded-xl border bg-background/50 p-3">
                <div class="flex items-center justify-between gap-3">
                  <Label :for="item.field">{{ item.label }}</Label>
                  <a :href="item.href" target="_blank" rel="noopener noreferrer" class="text-xs text-foreground underline underline-offset-4 hover:opacity-80" :aria-label="t('service.opensNewTab', { label: item.label })">{{ t('service.getKey') }}</a>
                </div>
                <Input :id="item.field" v-model="keys[item.field]" class="rounded-lg bg-secondary" type="password" autocomplete="off" :disabled="testing" :placeholder="item.placeholder" @focus="selectKey" />
                <p class="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <CheckCircle2 v-if="status?.providers[item.provider].ok" class="size-3 text-success" />
                  <Circle v-else class="size-3" />
                  {{ providerState(item.provider) }}
                </p>
                <p v-if="providerCapabilityDescription(item.provider)" class="text-[11px] leading-relaxed text-muted-foreground">
                  {{ providerCapabilityDescription(item.provider) }}
                </p>
              </div>
            </div>
          </section>

          <div ref="tosSection" class="scroll-m-3 overflow-hidden rounded-xl border bg-background/50">
            <button
              type="button"
              class="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
              :aria-controls="tosContentId"
              :aria-expanded="tosOpen"
              @click="toggleTos"
            >
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="text-sm font-medium">{{ t('service.referenceStorage') }}</span>
                  <Badge variant="outline" class="rounded-lg">
                    {{ t('service.optional') }}
                  </Badge>
                  <span v-if="status?.tosOk" class="text-[11px] font-medium text-success">{{ t('service.verified') }}</span>
                  <span v-else-if="status?.tosConfigured" class="text-[11px] text-muted-foreground">{{ t('service.notVerified') }}</span>
                </div>
                <p class="mt-0.5 text-xs text-muted-foreground">
                  {{ t('service.referenceDescription') }}
                </p>
              </div>
              <ChevronDown class="size-4 shrink-0 text-muted-foreground transition-transform duration-150" :class="{ 'rotate-180': tosOpen }" />
            </button>
            <div v-show="tosOpen" :id="tosContentId" class="border-t">
              <div class="space-y-3 p-3">
                <div class="flex items-center justify-between gap-3">
                  <p class="text-xs text-muted-foreground">
                    TOS · cn-beijing · fixed HTTPS endpoint
                  </p>
                  <Button type="button" variant="ghost" size="sm" class="h-7 px-2 text-xs text-muted-foreground" :disabled="testing" @click="clearTos">
                    {{ t('service.clear') }}
                  </Button>
                </div>
                <div class="grid gap-3 sm:grid-cols-2">
                  <div class="space-y-2">
                    <Label for="tos-access-key-id">{{ t('service.accessKey') }}</Label>
                    <Input id="tos-access-key-id" v-model="tos.accessKeyId" class="rounded-lg bg-secondary" type="password" autocomplete="off" :disabled="testing" placeholder="Enter TOS access key ID" @focus="selectKey" />
                  </div>
                  <div class="space-y-2">
                    <Label for="tos-secret-access-key">{{ t('service.secretKey') }}</Label>
                    <Input id="tos-secret-access-key" v-model="tos.secretAccessKey" class="rounded-lg bg-secondary" type="password" autocomplete="off" :disabled="testing" placeholder="Enter TOS secret access key" @focus="selectKey" />
                  </div>
                  <div class="space-y-2">
                    <Label for="tos-bucket">{{ t('service.bucket') }}</Label>
                    <Input id="tos-bucket" v-model="tos.bucket" class="rounded-lg bg-secondary" autocomplete="off" :disabled="testing" maxlength="63" placeholder="my-reference-media" pattern="[a-z0-9][a-z0-9-]{1,61}[a-z0-9]" />
                  </div>
                  <div class="space-y-2">
                    <Label for="tos-prefix">{{ t('service.objectPrefix') }}</Label>
                    <Input id="tos-prefix" v-model="tos.prefix" class="rounded-lg bg-secondary" autocomplete="off" :disabled="testing" maxlength="256" placeholder="miao/reference-media" />
                  </div>
                </div>
                <div class="grid gap-1 rounded-lg border px-3 py-2 text-[11px] text-muted-foreground sm:grid-cols-[5rem_1fr]">
                  <span>{{ t('service.region') }}</span>
                  <span class="font-mono text-foreground">cn-beijing</span>
                  <span>{{ t('service.endpoint') }}</span>
                  <span class="break-all font-mono text-foreground">https://tos-cn-beijing.volces.com</span>
                </div>
                <p class="text-[11px] text-muted-foreground">
                  The connection test uses read-only bucket metadata. Uploaded objects are retained for reuse; manage their lifecycle with your bucket policy.
                </p>
                <p v-if="results && !results.tos.skipped" role="status" aria-live="polite" class="text-xs" :class="results.tos.ok ? 'text-success' : 'text-destructive'">
                  {{ results.tos.ok ? '✓' : '⚠' }} {{ results.tos.message }}
                </p>
              </div>
            </div>
          </div>

          <div class="grid grid-cols-3 gap-2" :aria-label="t('service.capabilityReadiness')">
            <div v-for="capability in capabilityRows" :key="capability.label" class="rounded-lg border px-3 py-2 text-center">
              <p class="text-[11px] text-muted-foreground">
                {{ capability.label }}
              </p>
              <p class="mt-0.5 text-xs font-medium" :class="capability.ready ? 'text-success' : 'text-muted-foreground'">
                {{ capability.ready ? t('service.readyLabel') : t('service.notReady') }}
              </p>
            </div>
          </div>

          <div v-if="results && resultRows.length" class="space-y-2 rounded-xl border p-3 text-sm" role="status" aria-live="polite">
            <p v-for="row in resultRows" :key="row.id" :class="row.result.ok ? 'text-success' : 'text-destructive'">
              {{ row.result.ok ? '✓' : '⚠' }} <span class="font-medium">{{ row.label }}:</span> {{ row.result.message }}
            </p>
          </div>
          <p v-else-if="nothingToTest" ref="testNotice" role="status" aria-live="polite" class="text-sm text-warning">
            {{ t('service.nothingToTest') }}
          </p>
          <p v-if="error" role="alert" aria-live="assertive" class="text-sm text-destructive">
            {{ error }}
          </p>
        </div>

        <DialogFooter class="border-t bg-card px-5 py-4">
          <Button type="submit" :disabled="testing || !selectedTextModel">
            <LoaderCircle v-if="testing" class="mr-2 size-4 animate-spin" />
            {{ testing ? t('service.testing') : t('service.saveTest') }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
