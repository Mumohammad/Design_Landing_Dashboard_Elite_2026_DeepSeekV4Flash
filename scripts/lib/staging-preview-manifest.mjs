export const PREVIEW_REPOSITORY = 'Mumohammad/Design_Landing_Dashboard_Elite_2026_DeepSeekV4Flash'
export const PREVIEW_REGISTRY_REF = 'codex/staging-preview-registry'
export const PREVIEW_REGISTRY_PATH = 'release/staging-previews.json'
export const PREVIEW_REGISTRY_URL = 'https://api.github.com/repos/' + PREVIEW_REPOSITORY + '/contents/' + PREVIEW_REGISTRY_PATH + '?ref=' + encodeURIComponent(PREVIEW_REGISTRY_REF)
export const PREVIEW_PROJECT = 'prj_0FJTFtAXzBZMUP9rPyU7XtiEYteX'
export const PREVIEW_TEAM = 'team_j3ptCX4b6u3KnlTRbe8mRhKG'
export const PREVIEW_BACKEND = 'viowrovartosrkqukjxy'
export const PREVIEW_BRANCH = 'codex/production-modules-completion'
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value)
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const keysAre = (value, keys) => object(value) && Object.keys(value).sort().join('|') === [...keys].sort().join('|')
export class PreviewManifestError extends Error {
  constructor(code) { super('Exact staging Preview manifest could not be verified'); this.name = 'PreviewManifestError'; this.code = code }
}
const fail = code => { throw new PreviewManifestError(code) }

export function assertTrustedPreviewEvent(event, expectedCommit, repository) {
  if (repository !== PREVIEW_REPOSITORY || !sha(expectedCommit) || event?.pull_request?.head?.sha !== expectedCommit || event.pull_request.head.ref !== PREVIEW_BRANCH || event.pull_request.head.repo?.full_name !== PREVIEW_REPOSITORY || event.pull_request.base?.ref !== 'master' || event.pull_request.base.repo?.full_name !== PREVIEW_REPOSITORY) fail('PREVIEW_CONTEXT')
}

/** Public deployment metadata only. These claims never replace live preflight. */
export function previewFromManifest(manifest, expectedCommit) {
  if (!sha(expectedCommit) || !keysAre(manifest, ['schemaVersion', 'repository', 'previews']) || manifest.schemaVersion !== 1 || manifest.repository !== PREVIEW_REPOSITORY || !object(manifest.previews) || Object.keys(manifest.previews).length > 128) fail('PREVIEW_MANIFEST_INVALID')
  for (const [commit, entry] of Object.entries(manifest.previews)) {
    if (!sha(commit) || !keysAre(entry, ['commit', 'appUrl', 'deploymentId', 'projectId', 'teamId', 'backendProject', 'environment', 'branch', 'verifiedAt']) || entry.commit !== commit || entry.projectId !== PREVIEW_PROJECT || entry.teamId !== PREVIEW_TEAM || entry.backendProject !== PREVIEW_BACKEND || entry.environment !== 'preview' || entry.branch !== PREVIEW_BRANCH || typeof entry.deploymentId !== 'string' || !/^dpl_[A-Za-z0-9]{10,64}$/.test(entry.deploymentId) || typeof entry.verifiedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(entry.verifiedAt) || !Number.isFinite(Date.parse(entry.verifiedAt))) fail('PREVIEW_MANIFEST_INVALID')
    let url
    try { url = new URL(entry.appUrl) } catch { fail('PREVIEW_MANIFEST_INVALID') }
    if (typeof entry.appUrl !== 'string' || url.origin !== entry.appUrl || url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash || url.pathname !== '/' || !/^elite-dashboard-[a-z0-9]+-elitesaasc-5643\.vercel\.app$/.test(url.hostname)) fail('PREVIEW_MANIFEST_INVALID')
  }
  if (!Object.hasOwn(manifest.previews, expectedCommit)) fail('PREVIEW_MANIFEST_PENDING')
  return manifest.previews[expectedCommit].appUrl
}

async function boundedJson(response) {
  const reader = response.body?.getReader()
  if (!reader) fail('PREVIEW_MANIFEST_INVALID')
  const parts = []; let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 65536) fail('PREVIEW_MANIFEST_INVALID')
      parts.push(value)
    }
    return JSON.parse(Buffer.concat(parts).toString('utf8'))
  } catch (error) {
    await reader.cancel().catch(() => {})
    if (error instanceof PreviewManifestError) throw error
    fail('PREVIEW_MANIFEST_INVALID')
  } finally { reader.releaseLock() }
}

export async function readPreviewManifest(expectedCommit, token, { fetchImpl = fetch } = {}) {
  if (!sha(expectedCommit) || typeof token !== 'string' || !token || token.length > 4096 || /[\r\n]/.test(token)) fail('PREVIEW_CONTEXT')
  let response
  try {
    response = await fetchImpl(PREVIEW_REGISTRY_URL, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { Accept: 'application/vnd.github.raw+json', Authorization: 'Bearer ' + token, 'X-GitHub-Api-Version': '2026-03-10' } })
  } catch { fail('PREVIEW_REGISTRY_UNAVAILABLE') }
  if (response.status !== 200) await response.body?.cancel().catch(() => {})
  if (response.status === 404) fail('PREVIEW_MANIFEST_PENDING')
  if ([401,403].includes(response.status)) fail('PREVIEW_REGISTRY_AUTH')
  if (response.status >= 500) fail('PREVIEW_REGISTRY_UNAVAILABLE')
  if (response.status !== 200) fail('PREVIEW_MANIFEST_INVALID')
  return previewFromManifest(await boundedJson(response), expectedCommit)
}

export async function waitForPreviewManifest(expectedCommit, token, { read = readPreviewManifest, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), timeoutMs = 300000 } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000) fail('PREVIEW_CONTEXT')
  const deadline = now() + timeoutMs
  while (now() < deadline) {
    try { return await read(expectedCommit, token) }
    catch (error) { if (!(error instanceof PreviewManifestError) || !['PREVIEW_MANIFEST_PENDING','PREVIEW_REGISTRY_UNAVAILABLE'].includes(error.code)) throw error }
    await sleep(Math.min(5000, Math.max(0, deadline - now())))
  }
  fail('PREVIEW_MANIFEST_PENDING')
}
