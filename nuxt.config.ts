import process from 'node:process'
import tailwindcss from '@tailwindcss/vite'

const deployedSiteUrl = process.env.NUXT_PUBLIC_SITE_URL || process.env.NUXT_SITE_URL
const siteUrl = deployedSiteUrl || 'http://localhost:3001'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  devtools: { enabled: true },
  devServer: { host: '127.0.0.1', port: 3001 },

  runtimeConfig: {
    public: {
      brandName: 'Miao',
      heroTitle: 'Create beyond the prompt.',
      heroTagline: 'Shape every frame.',
      heroDescription: 'An open creative assistant for foundation models — text, image, and video — on an infinite canvas.',
      apiUrl: '',
      siteUrl,
    },
  },

  css: ['~/assets/css/tailwind.css'],
  features: {
    // Include global Tailwind CSS in SSR HTML, not just Vue component styles.
    // Clarity captures inline styles; external CSS requests can be challenged
    // by Cloudflare, leaving recordings without layout, sizing, or colors.
    inlineStyles: true,
  },
  vite: {
    plugins: [tailwindcss()],
    server: {
      hmr: { port: 24679 },
      // Allow the cloudflared quick-tunnel host to reach the dev server
      // (e.g. https://xxx.trycloudflare.com). Wildcard keeps working when the
      // tunnel URL changes on each restart.
      allowedHosts: ['localhost', '.trycloudflare.com'],
    },
  },

  components: [
    {
      path: '~/components',
      extensions: ['.vue'],
    },
  ],

  modules: [
    'shadcn-nuxt',
    '@vueuse/nuxt',
    '@nuxt/eslint',
    '@nuxt/icon',
    '@pinia/nuxt',
    '@nuxtjs/i18n',
    '@nuxt/fonts',
  ],

  i18n: {
    ...(deployedSiteUrl ? { baseUrl: siteUrl } : {}),
    locales: [
      { code: 'en', language: 'en-US', name: 'English', file: 'en.json' },
      { code: 'zh', language: 'zh-CN', name: '简体中文', file: 'zh-CN.json' },
    ],
    defaultLocale: 'en',
    strategy: 'prefix_except_default',
    langDir: 'locales',
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: 'miao-locale',
      redirectOn: 'no prefix',
      fallbackLocale: 'en',
    },
  },

  shadcn: {
    /**
     * Prefix for all the imported component
     */
    prefix: '',
    /**
     * Directory that the component lives in.
     * @default "~/components/ui"
     */
    componentDir: '~/components/ui',
  },

  eslint: {
    config: {
      standalone: false,
    },
  },

  fonts: {
    defaults: {
      weights: [300, 400, 500, 600, 700, 800],
    },
    providers: {
      google: false,
      googleicons: false,
    },
  },

  app: {
    baseURL: '/',
    head: {
      title: 'Miao',
      meta: [
        {
          name: 'description',
          content: 'Create images and videos with an agent-native workflow and an infinite canvas.',
        },
      ],
    },
  },

  routeRules: {
    '/nuxt-shadcn-dashboard': { redirect: '/' },
    '/nuxt-shadcn-dashboard/**': { redirect: '/**' },
    '/components': { redirect: '/components/accordion' },
    '/my/generations': { redirect: '/projects' },
    '/models/seedream-5-pro': { redirect: '/seedream' },
    '/image-editor': { redirect: '/tools/image-to-image' },
    '/ai-image-editor': { redirect: '/tools/image-to-image' },
    '/tools/ai-image-editor': { redirect: '/tools/image-to-image' },
    '/zh/image-editor': { redirect: '/zh/tools/image-to-image' },
    '/zh/ai-image-editor': { redirect: '/zh/tools/image-to-image' },
    '/zh/tools/ai-image-editor': { redirect: '/zh/tools/image-to-image' },
    '/video-editor': { redirect: '/tools/reference-to-video' },
    '/ai-video-editor': { redirect: '/tools/reference-to-video' },
    '/tools/ai-video-editor': { redirect: '/tools/reference-to-video' },
    '/zh/video-editor': { redirect: '/zh/tools/reference-to-video' },
    '/zh/ai-video-editor': { redirect: '/zh/tools/reference-to-video' },
    '/zh/tools/ai-video-editor': { redirect: '/zh/tools/reference-to-video' },
  },

  imports: {
    dirs: ['./lib'],
  },

  compatibilityDate: '2026-03-13',

  nitro: {
    imports: {
      // Agent runtime is imported explicitly; avoid clashing with shared/* type names.
      exclude: [
        /server\/agent\//,
      ],
    },
  },
})
