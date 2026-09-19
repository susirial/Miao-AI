import { GenerationJob } from '../models/generationJob'
import { applyAgnesHttpsOrigins, collectAgnesVideoUrlFields, replaceAgnesVideoUrlFields } from './agnesVideoUrls'
import { publicOriginUrlsFromJobs } from './generationResults'
import { connectDatabase } from './sqlite'
import { canonicalMediaUrl, storedMediaKey } from './storedMediaUrl.mjs'

export async function resolvePublicOriginUrls(sources: string[]) {
  const locals = [...new Set(
    sources
      .map(canonicalMediaUrl)
      .filter(url => storedMediaKey(url) !== null),
  )]
  if (!locals.length)
    return new Map<string, string>()

  await connectDatabase()
  const jobs = await GenerationJob.find({
    state: 'success',
    deleted: { $ne: true },
    category: { $ne: 'Video' },
    resultUrls: { $in: locals },
  }).select('state deleted category resultUrls resultAssets').lean()

  return publicOriginUrlsFromJobs(jobs, sources)
}

export async function resolvePublicOriginUrl(source: string) {
  const resolved = await resolvePublicOriginUrls([source])
  return resolved.get(source) || resolved.get(canonicalMediaUrl(source)) || ''
}

export async function remapAgnesUrlOnlySources(sources: string[], kind = 'Reference image') {
  const origins = await resolvePublicOriginUrls(sources)
  return applyAgnesHttpsOrigins(sources, origins, kind)
}

export async function materializeAgnesVideoSources(raw: Record<string, unknown>) {
  const fields = collectAgnesVideoUrlFields(raw)
  const sources = [...new Set(fields.flatMap(field => field.values))]
  if (!sources.length)
    return raw
  const origins = await resolvePublicOriginUrls(sources)
  return replaceAgnesVideoUrlFields(raw, origins)
}
