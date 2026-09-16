// Only labels from this map reach the system prompt, so a client-supplied
// locale can never inject instructions.
const AGENT_LOCALE_LABELS: Record<string, string> = {
  en: 'English',
  zh: 'Simplified Chinese (简体中文)',
}

export function agentLocaleLabel(value: unknown) {
  const code = String(value || '').trim().toLowerCase().split(/[-_]/)[0] || ''
  return AGENT_LOCALE_LABELS[code] || ''
}

export function normalizeAgentLocale(value: unknown) {
  const code = String(value || '').trim().toLowerCase().split(/[-_]/)[0] || ''
  return AGENT_LOCALE_LABELS[code] ? code : ''
}
