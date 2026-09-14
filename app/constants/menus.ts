import type { NavMenu } from '~/types/nav'
import { IMAGE_EDITOR_PATH, VIDEO_EDITOR_PATH } from '@/constants/usefulTools'

export const navMenu: NavMenu[] = [
  {
    heading: '',
    items: [
      {
        title: 'navigation.projects',
        icon: 'i-lucide-folder',
        link: '/projects',
      },
    ],
  },
  {
    heading: 'navigation.usefulTools',
    items: [
      {
        title: 'tools.imageEditor',
        icon: 'i-lucide-image',
        link: IMAGE_EDITOR_PATH,
      },
      {
        title: 'tools.videoEditor',
        icon: 'i-lucide-clapperboard',
        link: VIDEO_EDITOR_PATH,
      },
    ],
  },
]
