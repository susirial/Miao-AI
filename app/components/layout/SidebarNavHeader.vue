<script setup lang="ts">
const { t } = useI18n()
const localePath = useLocalePath()
</script>

<template>
  <SidebarMenu>
    <SidebarMenuItem>
      <SidebarMenuButton size="lg" as-child class="h-auto! py-1.5">
        <NuxtLink :to="localePath('/projects')" class="flex-col items-start gap-1">
          <AppLogo size="lg" />
          <span class="text-[10px] font-medium uppercase tracking-widest text-muted-foreground group-data-[collapsible=icon]:hidden">
            {{ t('navigation.openSourceEdition') }}
          </span>
        </NuxtLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  </SidebarMenu>
</template>
