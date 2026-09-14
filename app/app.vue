<script setup lang="ts">
import { ConfigProvider } from 'reka-ui'
import { Toaster } from '@/components/ui/sonner'
import 'vue-sonner/style.css'

const { theme } = useAppSettings()
const { locale, t } = useI18n()
const localeHead = useLocaleHead()
useHead(() => ({
  meta: [
    { charset: 'utf-8' },
    { name: 'viewport', content: 'width=device-width, initial-scale=1' },
    { key: 'theme-color', name: 'theme-color', content: '#f7f7f4' },
    ...(localeHead.value.meta || []),
  ],
  link: localeHead.value.link || [],
  htmlAttrs: {
    lang: localeHead.value.htmlAttrs?.lang || locale.value,
    dir: 'ltr',
  },
  bodyAttrs: {
    class: `color-${theme.value?.color || 'green'} theme-${theme.value?.type || 'gallery'}`,
  },
}))
const { public: publicConfig } = useRuntimeConfig()
const title = publicConfig.brandName
const description = computed(() => t('seo.defaultDescription'))
useSeoMeta({
  title,
  description,
  ogTitle: title,
  ogDescription: description,
  twitterTitle: title,
  twitterDescription: description,
})
const textDirection = useTextDirection({ initialValue: 'ltr' })
const dir = computed(() => textDirection.value === 'rtl' ? 'rtl' : 'ltr')
</script>

<template>
  <Body class="overscroll-none bg-background text-foreground antialiased" :class="[`color-${theme?.color || 'green'}`, `theme-${theme?.type || 'gallery'}`]">
    <ConfigProvider :dir="dir">
      <div id="app" vaul-drawer-wrapper class="relative">
        <NuxtLayout>
          <NuxtPage />
        </NuxtLayout>

        <ClientOnly>
          <MediaLightbox />
          <ServiceConnectionDialog />
        </ClientOnly>
      </div>

      <Toaster
        position="bottom-right"
        theme="light"
        rich-colors
        close-button
      />
    </ConfigProvider>
  </Body>
</template>
