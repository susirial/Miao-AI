<script setup lang="ts">
import type { NavGroup, NavLink, NavSectionTitle } from '~/types/nav'
import { navMenu } from '~/constants/menus'

function resolveNavItemComponent(item: NavLink | NavGroup | NavSectionTitle): any {
  if ('children' in item)
    return resolveComponent('LayoutSidebarNavGroup')

  return resolveComponent('LayoutSidebarNavLink')
}

const { sidebar } = useAppSettings()
const { t } = useI18n()
</script>

<template>
  <Sidebar :collapsible="sidebar?.collapsible" :side="sidebar?.side" :variant="sidebar?.variant" class="border-0">
    <SidebarHeader class="gap-2 px-2 pt-2">
      <LayoutSidebarNavHeader />
    </SidebarHeader>
    <SidebarContent class="px-1">
      <template v-for="(nav, indexGroup) in navMenu" :key="indexGroup">
        <SidebarGroup>
          <SidebarGroupLabel v-if="nav.heading">
            {{ t(nav.heading) }}
          </SidebarGroupLabel>
          <component :is="resolveNavItemComponent(item)" v-for="(item, index) in nav.items" :key="index" :item="item" />
        </SidebarGroup>
        <LayoutSidebarNavRecentProjects v-if="indexGroup === 0" />
      </template>
    </SidebarContent>
    <SidebarRail />
  </Sidebar>
</template>

<style scoped>

</style>
