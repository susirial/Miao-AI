<script setup lang="ts">
import { studioToolBySlug } from '@/constants/usefulTools'

const route = useRoute()
const { t } = useI18n()
const localePath = useLocalePath()

function titleForSegment(item: string, href: string) {
  if (item === 'tools')
    return t('navigation.usefulTools')

  if (item === 'projects')
    return t('navigation.projects')

  if (item === 'agent')
    return t('navigation.studioAgent')

  if (item === 'seedream')
    return 'Seedream 5.0 Pro'

  if (href.startsWith('/projects/') && item !== 'projects')
    return t('navigation.project')

  if (href.startsWith('/tools/')) {
    const slug = href.slice('/tools/'.length).split('/')[0] || ''
    return studioToolBySlug(slug)?.title
      || item.replace(/-/g, ' ').replace(/\b\w/g, char => char.toUpperCase())
  }

  return item
    .replace(/-/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

function setLinks() {
  const segments = route.path.split('/').filter(item => item && item !== 'zh' && item !== 'en')
  const projectsHome = { title: t('navigation.projects'), href: localePath('/projects') }

  if (!segments.length)
    return [projectsHome]

  const breadcrumbs = segments.map((item, index) => {
    const rawHref = item === 'tools'
      ? '/projects'
      : `/${segments.slice(0, index + 1).join('/')}`
    return {
      title: titleForSegment(item, rawHref),
      href: localePath(rawHref),
    }
  })

  if (segments[0] === 'projects')
    return breadcrumbs
  return [projectsHome, ...breadcrumbs]
}

const links = computed<{
  title: string
  href: string
}[]>(() => setLinks())
const showBreadcrumb = computed(() => {
  const path = route.path.replace(/^\/(zh|en)(?=\/|$)/, '') || '/'
  return path !== '/' && path !== '/projects'
})
</script>

<template>
  <header class="sticky top-0 z-10 flex h-(--header-height) items-center gap-4 border-b border-border/70 bg-background/95 px-4 backdrop-blur md:peer-data-[variant=inset]:top-0 md:rounded-tl-xl md:rounded-tr-xl md:px-6">
    <div class="flex items-center gap-4">
      <SidebarTrigger />
      <div v-if="showBreadcrumb" class="hidden items-center gap-4 md:flex">
        <Separator orientation="vertical" class="h-5 bg-border/70" />
        <BaseBreadcrumbCustom :links="links" />
      </div>
    </div>
    <div class="ml-auto flex items-center">
      <ServiceConnection />
      <LanguageSwitcher class="ml-2" />
      <slot />
    </div>
  </header>
</template>

<style scoped>

</style>
