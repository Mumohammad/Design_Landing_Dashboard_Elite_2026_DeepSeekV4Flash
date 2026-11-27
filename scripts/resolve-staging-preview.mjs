import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { assertTrustedPreviewEvent, waitForPreviewManifest, PreviewManifestError, PREVIEW_REPOSITORY, PREVIEW_BACKEND } from './lib/staging-preview-manifest.mjs'
import { assertAcceptanceTarget, preflightAcceptanceTarget } from './lib/coordinated-acceptance.mjs'
import { createVerificationAccess, VerificationAccessError } from './lib/verification-access.mjs'

function readEvent(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw new PreviewManifestError('PREVIEW_CONTEXT')
  const info = fs.lstatSync(file)
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1048576) throw new PreviewManifestError('PREVIEW_CONTEXT')
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

/** Selection checks the new origin before updating any inherited target values. */
export async function preflightSelectedPreview(target, accessOptions = {}) {
  const access = createVerificationAccess(target.appUrl, accessOptions)
  return preflightAcceptanceTarget({ ...target, fetchImpl: access.fetch })
}

export async function configureStagingPreview({ env = process.env, event, resolve = waitForPreviewManifest, preflight = target => preflightSelectedPreview(target, { env }), writeEnv = value => fs.appendFileSync(env.GITHUB_ENV, value) } = {}) {
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_EVENT_NAME !== 'pull_request' || env.GITHUB_REPOSITORY !== PREVIEW_REPOSITORY || typeof env.GITHUB_ENV !== 'string' || !path.isAbsolute(env.GITHUB_ENV) || /[\r\n]/.test(env.GITHUB_ENV)) throw new PreviewManifestError('PREVIEW_CONTEXT')
  const commit = env.STAGING_MANIFEST_COMMIT
  assertTrustedPreviewEvent(event ?? readEvent(env.GITHUB_EVENT_PATH), commit, env.GITHUB_REPOSITORY)
  const appUrl = await resolve(commit, env.GH_TOKEN)
  const backendUrl = 'https://' + PREVIEW_BACKEND + '.supabase.co'
  assertAcceptanceTarget(backendUrl, appUrl, commit)
  await preflight({ backendUrl, appUrl, expectedCommit: commit })
  // Only public values enter subsequent steps. The GitHub token stays here;
  // app preflight obtains its separate, short-lived, origin-scoped identity.
  writeEnv('BASE_URL=' + appUrl + '\nVERIFY_APP_URL=' + appUrl + '\n')
  return { check: 'exact staging Preview selected', commit, appUrl, backend: PREVIEW_BACKEND, source: 'same-repository manifest', result: 'PASS' }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await configureStagingPreview())) }
  catch (error) {
    console.error(JSON.stringify({ check: 'exact staging Preview selected', code: error instanceof PreviewManifestError ? error.code : error instanceof VerificationAccessError ? 'PREVIEW_ACCESS' : 'PREVIEW_PREFLIGHT_OR_CONFIGURATION', result: 'FAIL' }))
    process.exitCode = 1
  }
}
