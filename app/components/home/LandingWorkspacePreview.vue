<script setup lang="ts">
const { t } = useI18n()
</script>

<template>
  <div class="overflow-hidden rounded-2xl border border-border bg-card">
    <div class="flex h-11 items-center justify-between border-b border-border px-4">
      <span class="text-xs font-medium">{{ t('landing.workspaceLabel') }}</span>
      <span class="font-mono text-[11px] text-muted-foreground">1280 × 720</span>
    </div>

    <div class="grid min-h-[360px] md:grid-cols-[minmax(0,1fr)_300px] lg:min-h-[470px] lg:grid-cols-[minmax(0,1fr)_360px]">
      <section class="landing-canvas relative min-h-[300px] overflow-hidden border-b border-border bg-surface md:border-r md:border-b-0">
        <div class="absolute top-3 left-3 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[11px] text-muted-foreground">
          {{ t('landing.canvasLabel') }}
        </div>

        <article class="absolute top-[20%] left-[8%] w-[34%] min-w-32 rounded-xl border border-border bg-card p-2">
          <div class="aspect-[4/3] overflow-hidden rounded-lg bg-muted">
            <div class="flex h-full items-end p-3">
              <div class="h-1/2 w-2/5 rounded-md bg-foreground/12" />
            </div>
          </div>
          <p class="px-1 pt-2 text-[11px] font-medium">
            {{ t('landing.assetOne') }}
          </p>
        </article>

        <article class="absolute top-[14%] right-[8%] w-[29%] min-w-28 rounded-xl border border-border bg-card p-2">
          <div class="flex aspect-[3/4] items-center justify-center rounded-lg bg-muted">
            <div class="flex size-12 items-center justify-center rounded-lg border border-border bg-card">
              <Icon name="i-lucide-play" class="size-4 text-muted-foreground" />
            </div>
          </div>
          <p class="px-1 pt-2 text-[11px] font-medium">
            {{ t('landing.assetTwo') }}
          </p>
        </article>

        <article class="absolute bottom-[9%] left-[39%] w-[34%] min-w-32 rounded-xl border border-brand bg-card p-2">
          <div class="landing-shimmer aspect-video overflow-hidden rounded-lg bg-muted" />
          <div class="flex items-center justify-between px-1 pt-2">
            <p class="text-[11px] font-medium">
              {{ t('landing.assetThree') }}
            </p>
            <span class="font-mono text-[10px] text-foreground">
              {{ t('canvas.generating') }}
            </span>
          </div>
        </article>

        <div class="absolute bottom-3 left-3 flex items-center gap-1 rounded-lg border border-border bg-card p-1">
          <span class="flex size-7 items-center justify-center rounded-md bg-accent"><Icon name="i-lucide-mouse-pointer-2" class="size-3.5" /></span>
          <span class="flex size-7 items-center justify-center rounded-md"><Icon name="i-lucide-hand" class="size-3.5" /></span>
        </div>
        <div class="absolute right-3 bottom-3 rounded-lg border border-border bg-card px-2.5 py-1.5 font-mono text-[11px] tabular-nums">
          82%
        </div>
      </section>

      <section class="flex min-h-0 flex-col bg-card">
        <div class="flex h-11 items-center border-b border-border px-4">
          <span class="text-xs font-medium">{{ t('landing.chatLabel') }}</span>
        </div>
        <div class="flex flex-1 flex-col gap-4 p-4">
          <div class="ml-8 rounded-xl bg-secondary px-3 py-2.5 text-xs leading-relaxed">
            {{ t('landing.prompt') }}
          </div>
          <div class="flex items-start gap-2">
            <span class="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg bg-foreground text-[10px] font-semibold text-background">M</span>
            <p class="text-xs leading-relaxed text-muted-foreground">
              {{ t('landing.generating') }}
            </p>
          </div>
        </div>
        <div class="m-3 rounded-xl border border-border bg-background p-3">
          <p class="text-xs text-muted-foreground">
            {{ t('chat.messageLabel') }}
          </p>
          <div class="mt-6 flex items-center justify-between">
            <Icon name="i-lucide-paperclip" class="size-4 text-muted-foreground" />
            <span class="flex size-7 items-center justify-center rounded-lg bg-foreground text-background">
              <Icon name="i-lucide-arrow-up" class="size-4" />
            </span>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.landing-canvas {
  background-image: radial-gradient(circle, var(--border) 1px, transparent 1px);
  background-size: 24px 24px;
}

.landing-shimmer {
  position: relative;
}

.landing-shimmer::after {
  position: absolute;
  inset: 0;
  content: '';
  background: linear-gradient(105deg, transparent 25%, color-mix(in srgb, white 72%, transparent) 45%, transparent 65%);
  transform: translateX(-100%);
  animation: landing-shimmer 1.7s ease-in-out infinite;
}

@keyframes landing-shimmer {
  to { transform: translateX(100%); }
}

@media (prefers-reduced-motion: reduce) {
  .landing-shimmer::after { animation: none; }
}
</style>
