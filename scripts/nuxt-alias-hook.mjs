const root = new URL('../', import.meta.url).href
const hasExt = /\.(?:[cm]?[jt]s|json)$/

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('~~/')) {
    const path = specifier.slice(3)
    return nextResolve(`./${hasExt.test(path) ? path : `${path}.ts`}`, { ...context, parentURL: root })
  }
  if (specifier.startsWith('.') && !hasExt.test(specifier.split('?')[0]))
    return nextResolve(`${specifier}.ts`, context)
  return nextResolve(specifier, context)
}
