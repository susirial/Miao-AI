export async function copyTextToClipboard(text: string) {
  const value = String(text ?? '')
  if (!value || !import.meta.client)
    throw new Error('Nothing to copy')

  try {
    await navigator.clipboard.writeText(value)
    return
  }
  catch {
    // Electron denies clipboard-write unless allowlisted; fall back to a user-gesture copy.
  }

  const input = document.createElement('textarea')
  input.value = value
  input.setAttribute('readonly', '')
  input.style.position = 'fixed'
  input.style.left = '-9999px'
  document.body.appendChild(input)
  input.select()
  const copied = document.execCommand('copy')
  input.remove()
  if (!copied)
    throw new Error('Copy failed')
}
