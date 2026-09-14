<script setup lang="ts">
import type { SidebarMenuButtonVariants } from '~/components/ui/sidebar'
import type { NavLink } from '~/types/nav'
import { useSidebar } from '~/components/ui/sidebar'

const props = withDefaults(defineProps<{
  item: NavLink
  size?: SidebarMenuButtonVariants['size']
}>(), {
  size: 'default',
})

const { setOpenMobile } = useSidebar()
const route = useRoute()
const { t } = useI18n()
const localePath = useLocalePath()
const target = computed(() => localePath(props.item.link))

const isActive = computed(() => {
  if (target.value === '/' || target.value === '/zh')
    return route.path === target.value
  return route.path === target.value || route.path.startsWith(`${target.value}/`)
})
</script>

<template>
  <SidebarMenu>
    <SidebarMenuItem>
      <SidebarMenuButton as-child :tooltip="t(item.title)" :size="size" :data-active="isActive">
        <NuxtLink :to="target" @click="setOpenMobile(false)">
          <Icon :name="item.icon || ''" />
          <span>{{ t(item.title) }}</span>
          <span v-if="item.new" class="rounded-md bg-brand px-1.5 py-0.5 text-xs text-brand-foreground leading-none no-underline group-hover:no-underline">
            {{ t('common.new') }}
          </span>
        </NuxtLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  </SidebarMenu>
</template>

<style scoped>

</style>
