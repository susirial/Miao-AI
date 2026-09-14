<script setup>
const router = useRouter()
const { t } = useI18n()
const localePath = useLocalePath()
</script>

<template>
  <div class="h-svh">
    <div class="m-auto h-full w-full flex flex-col items-center justify-center gap-2">
      <h1 class="text-[7rem] font-bold leading-tight">
        404
      </h1>
      <span class="font-medium">{{ t('error.title') }}</span>
      <p class="text-center text-muted-foreground">
        {{ t('error.description') }}
      </p>
      <div class="mt-6 flex gap-4">
        <Button variant="outline" @click="router.back()">
          {{ t('error.back') }}
        </Button>
        <Button @click="router.push(localePath('/'))">
          {{ t('error.home') }}
        </Button>
      </div>
    </div>
  </div>
</template>

<style scoped>

</style>
