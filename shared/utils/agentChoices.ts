interface CustomChoiceOption {
  id: string
  label: string
  description?: string
  custom?: boolean
}

/**
 * Also used by restored cards so older sessions can accept custom answers.
 * The option id never depends on the copy, so the client may localize the label.
 */
export function withCustomChoiceOption<T extends CustomChoiceOption>(
  options: T[],
  copy?: { label?: string, description?: string },
): Array<T | CustomChoiceOption> {
  if (options.some(option => option.custom))
    return options
  const ids = new Set(options.map(option => option.id))
  let id = 'other'
  for (let suffix = 2; ids.has(id); suffix++)
    id = `other_${suffix}`
  return [...options, {
    id,
    label: copy?.label || 'Other',
    description: copy?.description || 'Type your own answer.',
    custom: true,
  }]
}

/** Image edit method selection must be a standalone, recoverable checkpoint. */
export function standaloneImageEditQuestions<T extends { id: string, recommendedId?: string }>(questions: T[]): T[] {
  const method = questions.find(question => question.id === 'image_edit_method')
  return method ? [{ ...method, recommendedId: 'annotate' }] : questions
}
