# Exact-commit staging Preview selection

The trusted release jobs select their immutable app URL from public deployment metadata in this repository's separate **codex/staging-preview-registry** branch, at **release/staging-previews.json**. That branch is data-only, disables its own automatic Vercel deployments, and must never be merged into application branches.

This removes routine repository-variable editing from the release path. It does not complete, weaken or automate GitHub account confirmation. Other PR branches keep their existing configured staging URL. The release branch has no fallback to an old URL if its exact manifest entry is missing or invalid.

## Publishing an entry

1. Finish relevant local tests/checks and preserve the exact source tree. Publish the feature commit with a non-forced, expected-head update.
2. Create its isolated Preview with the reviewed tracked source, required dependency patches and licensed private fonts; exclude environment files, backups and logs.
3. Verify Vercel reports the expected project, team, release branch, exact commit and READY immutable deployment. Run the real read-only health, exact-commit, exclusive staging-CSP and authentication-redirect preflight.
4. Add only public metadata for that commit to the registry. Preserve existing entries and other registry files. Use the expected previous registry head and never force an update.
5. Observe actual CI selection and acceptance. A registry entry records independently checked facts; it is not a test pass or authorization for Production.

An entry contains exactly: commit, appUrl, deploymentId, projectId, teamId, backendProject, environment, branch and verifiedAt. It must identify Vercel project prj_0FJTFtAXzBZMUP9rPyU7XtiEYteX, team team_j3ptCX4b6u3KnlTRbe8mRhKG, Preview environment, branch codex/production-modules-completion and staging backend viowrovartosrkqukjxy. The URL must be a canonical immutable elite-dashboard deployment within that team; aliases, credentials, queries, paths, fragments, ports, loopback and Production targets are rejected. Never store secrets, signed URLs, business records or access tokens. The file is bounded to 64 KiB / 128 entries; deliberately archive older metadata before those limits are reached.

## CI boundaries

The selector requires a same-repository pull request from the release branch to master and an exact event/head commit match. It reads a fixed same-repository GitHub Contents API URL with the job's existing contents-read token, refuses redirects, bounds streaming/parsing, and limits publication polling to five minutes. Authentication/schema errors fail immediately. Only a missing exact entry or transient registry availability may be retried. The E2E job reserves these five minutes in its 25-minute total timeout; existing acceptance and cleanup time limits remain in place.

The GitHub read token is sent only to api.github.com. Selection preflight creates its own reader with the existing ephemeral Preview identity scoped to the newly selected immutable origin. This keeps inherited target values untouched during validation; the normal verification origin-agreement guard remains enforced for subsequent tests. Live health, exact commit and exclusive staging-CSP checks still run before the selector exports BASE_URL/VERIFY_APP_URL or any synthetic fixtures can be allocated. Only public URLs enter the runner environment file. Neither token enters that file, registry data or diagnostic output.

Both hosted jobs still run their existing required configuration, preflight, app tests, financial invariants, role/tenant gates and fixture retirement. No Production access rule, branch protection, secret or database permission is changed by this selector. Pure/behavioral tests cover stale/forked contexts, wrong targets/projects/backends, redirects, oversized input, missing publication, safe retry limits, failure redaction, environment-write ordering and both workflow insertion points. Hosted success must be observed separately.

References: [GitHub Contents API and raw media type](https://docs.github.com/en/rest/repos/contents#get-repository-content), [GitHub environment files](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands#setting-an-environment-variable), [Vercel Git deployment control](https://vercel.com/docs/project-configuration/git-configuration#git.deploymentenabled).
