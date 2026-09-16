const OPEN_OVERLAY_SELECTOR = [
  '[data-slot="dialog-overlay"][data-state="open"]',
  '[data-slot="sheet-overlay"][data-state="open"]',
  '[data-slot="drawer-overlay"][data-state="open"]',
  '[data-slot="alert-dialog-overlay"][data-state="open"]',
].join(',')

export function hasOpenModalOverlay() {
  return import.meta.client && Boolean(document.querySelector(OPEN_OVERLAY_SELECTOR))
}

export function unlockBodyScroll(options?: { force?: boolean }) {
  if (!import.meta.client)
    return
  const lightbox = useState('miao-media-lightbox', () => null)
  if (!options?.force && (lightbox.value || hasOpenModalOverlay()))
    return
  const body = document.body
  body.style.pointerEvents = ''
  body.style.overflow = ''
  body.style.paddingRight = ''
  body.style.marginRight = ''
  document.documentElement.style.overflow = ''
  document.documentElement.style.removeProperty('--scrollbar-width')
}

export function useBodyScrollUnlock() {
  return { unlockBodyScroll, hasOpenModalOverlay }
}
