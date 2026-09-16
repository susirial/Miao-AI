export default defineNuxtPlugin(() => {
  const router = useRouter()
  const { close } = useMediaLightbox()
  const { unlockBodyScroll } = useBodyScrollUnlock()

  function sweep() {
    close()
    nextTick(() => requestAnimationFrame(() => unlockBodyScroll()))
  }

  router.afterEach(sweep)
  window.addEventListener('pageshow', () => nextTick(() => unlockBodyScroll()))
})
