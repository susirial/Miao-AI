<script setup lang="ts">
const props = defineProps<{
  open: boolean
  pending?: boolean
  error?: string
  busy?: boolean
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  'confirm': []
}>()

const { t } = useI18n()

function onOpenChange(open: boolean) {
  if (props.pending && !open)
    return
  emit('update:open', open)
}
</script>

<template>
  <AlertDialog :open="open" @update:open="onOpenChange">
    <AlertDialogContent class="rounded-2xl border-border bg-card shadow-none sm:max-w-md">
      <AlertDialogHeader class="gap-2">
        <AlertDialogTitle>
          {{ t('chat.deleteTitle') }}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {{ t(busy ? 'chat.deleteBusy' : 'chat.deleteDescription') }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <p v-if="error" class="text-sm text-destructive">
        {{ error }}
      </p>
      <AlertDialogFooter>
        <AlertDialogCancel class="rounded-lg shadow-none" :disabled="pending">
          {{ t('common.cancel') }}
        </AlertDialogCancel>
        <Button
          class="rounded-lg bg-destructive text-white shadow-none hover:bg-destructive/90 disabled:opacity-40"
          :disabled="pending || busy"
          @click="emit('confirm')"
        >
          <Spinner v-if="pending" class="size-4" />
          {{ pending ? t('chat.deletePending') : t('chat.deleteAgent') }}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
