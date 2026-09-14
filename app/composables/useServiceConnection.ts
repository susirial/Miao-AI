import type { ServiceCapability } from '~~/shared/types/provider'

export function useServiceConnection() {
  const dialogOpen = useState<boolean>('service-connection-dialog', () => false)

  function openDialog() {
    dialogOpen.value = true
  }

  async function readStatus() {
    try {
      return await $fetch<{
        connected: boolean
        textReady: boolean
        imageReady: boolean
        videoReady: boolean
      }>('/api/settings/services', { timeout: 5000 })
    }
    catch {
      return null
    }
  }

  async function ensureCapability(capability: ServiceCapability) {
    const status = await readStatus()
    const ready = status && {
      text: status.textReady,
      image: status.imageReady,
      video: status.videoReady,
    }[capability]
    if (ready)
      return true
    openDialog()
    return false
  }

  async function ensureConnected() {
    const status = await readStatus()
    if (status?.connected)
      return true
    openDialog()
    return false
  }

  return { dialogOpen, openDialog, ensureCapability, ensureConnected }
}
