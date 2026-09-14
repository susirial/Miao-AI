<script setup lang="ts">
import { ArrowRight } from 'lucide-vue-next'
import { getFrontierModelCards } from '@/constants/aiModels'

definePageMeta({
  layout: 'landing',
})

const { t } = useI18n()
const localePath = useLocalePath()
const { public: publicConfig } = useRuntimeConfig()
const models = getFrontierModelCards().slice(0, 6)
const currentYear = new Date().getFullYear()

const featured = computed(() => ({
  title: t('landing.featureAgentTitle'),
  description: t('landing.featureAgentDescription'),
}))
const supportingFeatures = computed(() => [
  { title: t('landing.featureCanvasTitle'), description: t('landing.featureCanvasDescription') },
  { title: t('landing.featureProjectsTitle'), description: t('landing.featureProjectsDescription') },
])

const workflow = computed(() => [
  { title: t('landing.workflowOneTitle'), description: t('landing.workflowOneDescription') },
  { title: t('landing.workflowTwoTitle'), description: t('landing.workflowTwoDescription') },
  { title: t('landing.workflowThreeTitle'), description: t('landing.workflowThreeDescription') },
])

const faqs = computed(() => [
  { question: t('landing.faqOneQuestion'), answer: t('landing.faqOneAnswer') },
  { question: t('landing.faqTwoQuestion'), answer: t('landing.faqTwoAnswer') },
  { question: t('landing.faqThreeQuestion'), answer: t('landing.faqThreeAnswer') },
  { question: t('landing.faqFourQuestion'), answer: t('landing.faqFourAnswer') },
])

const seoTitle = computed(() => t('seo.homeTitle'))
const seoDescription = computed(() => t('seo.defaultDescription'))
useSeoMeta({
  title: seoTitle,
  description: seoDescription,
  ogTitle: seoTitle,
  ogDescription: seoDescription,
})
</script>

<template>
  <div>
    <header class="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
      <div class="mx-auto flex h-16 max-w-[1200px] items-center gap-6 px-4 sm:px-6">
        <NuxtLink :to="localePath('/')" class="text-lg font-medium tracking-[-0.04em]">
          {{ publicConfig.brandName }}
        </NuxtLink>
        <nav class="hidden items-center gap-6 text-sm text-muted-foreground md:flex" :aria-label="t('navigation.home')">
          <a href="#product" class="transition-colors hover:text-foreground">{{ t('landing.navProduct') }}</a>
          <a href="#models" class="transition-colors hover:text-foreground">{{ t('landing.navModels') }}</a>
          <a href="#workflow" class="transition-colors hover:text-foreground">{{ t('landing.navWorkflow') }}</a>
        </nav>
        <div class="ml-auto flex items-center gap-2">
          <LanguageSwitcher />
          <Button as-child class="hidden h-9 rounded-lg px-3 sm:inline-flex">
            <NuxtLink :to="localePath('/projects')">
              {{ t('landing.openApp') }}
            </NuxtLink>
          </Button>
        </div>
      </div>
    </header>

    <main>
      <section class="mx-auto max-w-[1200px] px-4 pt-16 pb-16 sm:px-6 md:pt-20 md:pb-24">
        <div class="max-w-3xl">
          <h1 class="text-[clamp(2.75rem,7vw,4.5rem)] font-normal leading-[1.05] tracking-[-0.06em] text-balance">
            <span class="block">{{ t('landing.title') }}</span>
            <span class="block">{{ t('landing.titleAccent') }}</span>
          </h1>
          <p class="mt-6 max-w-xl text-base leading-7 text-muted-foreground md:text-lg">
            {{ t('landing.description') }}
          </p>
          <div class="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
            <Button as-child variant="brand" size="lg" class="h-11 rounded-lg px-5">
              <NuxtLink :to="localePath('/projects')">
                {{ t('landing.startCreating') }}
                <ArrowRight class="size-4" />
              </NuxtLink>
            </Button>
            <Button as-child size="lg" variant="outline" class="h-11 rounded-lg px-5">
              <a href="#workflow">{{ t('landing.seeWorkflow') }}</a>
            </Button>
          </div>
        </div>

        <div id="product" class="mt-14 scroll-mt-24 md:mt-16">
          <HomeLandingWorkspacePreview />
        </div>
      </section>

      <section id="models" class="scroll-mt-20 border-y border-border bg-card">
        <div class="mx-auto grid max-w-[1200px] gap-10 px-4 py-16 sm:px-6 md:grid-cols-[0.8fr_1.2fr] md:items-end md:py-24">
          <div>
            <h2 class="max-w-lg text-3xl font-normal tracking-[-0.04em] text-balance md:text-5xl">
              {{ t('landing.modelsTitle') }}
            </h2>
            <p class="mt-5 max-w-lg text-sm leading-6 text-muted-foreground md:text-base">
              {{ t('landing.modelsDescription') }}
            </p>
          </div>
          <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div v-for="model in models" :key="model.modelId" class="flex min-h-24 flex-col justify-between rounded-xl border border-border bg-background p-4">
              <img v-if="model.logo" :src="model.logo" alt="" class="size-7 object-contain" aria-hidden="true">
              <span v-else class="font-mono text-[11px] text-muted-foreground">{{ model.task }}</span>
              <div class="mt-4">
                <p class="text-sm font-medium">
                  {{ model.title }}
                </p>
                <p class="mt-0.5 font-mono text-xs text-muted-foreground">
                  {{ model.task }}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 md:py-28">
        <h2 class="max-w-2xl text-3xl font-normal tracking-[-0.04em] text-balance md:text-5xl">
          {{ t('landing.featuresTitle') }}
        </h2>
        <div class="mt-12 grid gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-[1.15fr_0.85fr]">
          <article class="bg-card p-6 md:min-h-80 md:p-8">
            <h3 class="text-2xl font-normal tracking-[-0.03em] md:text-3xl">
              {{ featured.title }}
            </h3>
            <p class="mt-4 max-w-md text-sm leading-6 text-muted-foreground">
              {{ featured.description }}
            </p>
          </article>
          <div class="grid gap-px bg-border">
            <article v-for="feature in supportingFeatures" :key="feature.title" class="bg-card p-6 md:p-8">
              <h3 class="text-lg font-medium tracking-[-0.02em]">
                {{ feature.title }}
              </h3>
              <p class="mt-3 text-sm leading-6 text-muted-foreground">
                {{ feature.description }}
              </p>
            </article>
          </div>
        </div>
      </section>

      <section id="workflow" class="scroll-mt-20 border-y border-border bg-surface">
        <div class="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 md:py-28">
          <h2 class="max-w-2xl text-3xl font-normal tracking-[-0.04em] text-balance md:text-5xl">
            {{ t('landing.workflowTitle') }}
          </h2>
          <ol class="mt-12 border-t border-border">
            <li v-for="(step, index) in workflow" :key="step.title" class="grid gap-3 border-b border-border py-7 md:grid-cols-[72px_0.8fr_1fr] md:items-start">
              <span class="font-mono text-xs text-muted-foreground">{{ String(index + 1).padStart(2, '0') }}</span>
              <h3 class="text-lg font-medium tracking-tight">
                {{ step.title }}
              </h3>
              <p class="max-w-xl text-sm leading-6 text-muted-foreground">
                {{ step.description }}
              </p>
            </li>
          </ol>
        </div>
      </section>

      <section class="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 md:py-28">
        <div class="grid overflow-hidden rounded-2xl border border-border bg-card md:grid-cols-2">
          <div class="p-7 md:p-12">
            <h2 class="text-3xl font-normal tracking-[-0.04em] md:text-5xl">
              {{ t('landing.openSourceTitle') }}
            </h2>
            <p class="mt-5 max-w-lg text-sm leading-6 text-muted-foreground md:text-base">
              {{ t('landing.openSourceDescription') }}
            </p>
          </div>
          <div class="flex min-h-72 items-center justify-center border-t border-border bg-foreground p-8 text-background md:border-t-0 md:border-l">
            <div class="w-full max-w-sm font-mono text-xs leading-6">
              <p class="text-background/55">
                $ pnpm dev
              </p>
              <p class="mt-4">
                Miao ready at http://localhost:3001
              </p>
              <p class="mt-1 text-background/55">
                Local projects · Local media · Your API keys
              </p>
              <span class="mt-5 block h-4 w-2 animate-pulse bg-brand" />
            </div>
          </div>
        </div>
      </section>

      <section class="border-y border-border bg-card">
        <div class="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 md:py-28">
          <h2 class="max-w-xl text-3xl font-normal tracking-[-0.04em] md:text-5xl">
            {{ t('landing.faqTitle') }}
          </h2>
          <div class="mt-10 border-t border-border">
            <details v-for="faq in faqs" :key="faq.question" class="group border-b border-border py-5">
              <summary class="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium">
                {{ faq.question }}
                <Icon name="i-lucide-plus" class="size-4 shrink-0 transition-transform group-open:rotate-45" />
              </summary>
              <p class="max-w-2xl pt-4 pr-8 text-sm leading-6 text-muted-foreground">
                {{ faq.answer }}
              </p>
            </details>
          </div>
        </div>
      </section>

      <section class="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 md:py-28">
        <div class="rounded-2xl border border-border bg-surface px-6 py-14 text-center md:px-12 md:py-20">
          <h2 class="mx-auto max-w-3xl text-3xl font-normal tracking-[-0.05em] text-balance md:text-6xl">
            {{ t('landing.ctaTitle') }}
          </h2>
          <p class="mx-auto mt-5 max-w-xl text-sm leading-6 text-muted-foreground md:text-base">
            {{ t('landing.ctaDescription') }}
          </p>
          <Button as-child size="lg" class="mt-8 h-11 rounded-lg px-5">
            <NuxtLink :to="localePath('/projects')">
              {{ t('landing.startCreating') }}
              <ArrowRight class="size-4" />
            </NuxtLink>
          </Button>
        </div>
      </section>
    </main>

    <footer class="border-t border-border bg-card">
      <div class="mx-auto flex max-w-[1200px] flex-col gap-4 px-4 py-8 text-sm sm:px-6 md:flex-row md:items-center">
        <span class="font-medium tracking-[-0.03em]">{{ publicConfig.brandName }}</span>
        <span class="text-xs text-muted-foreground">{{ t('landing.footerTagline') }}</span>
        <span class="text-xs text-muted-foreground md:ml-auto">© {{ currentYear }} Miao</span>
      </div>
    </footer>
  </div>
</template>
