# Native browser Preview verification transport

The owner has delegated implementation choices and requested continued fixes,
tested feature-branch publication and a coordinated release without weakened
protections. This design changes test transport only. It does not authorize a
Production release, data repair, permission/secret change or billing change.

## Problem and evidence

Head 13b8abc passes core Linux CI and disposable SQL/browser checks. Hosted E2E
still fails with vehicle schema drift and two flaky tests; six hosted acceptance
groups fail, including unhandled `route.fulfill: Route is already handled!` errors.
API responses can also be disposed before a later route fulfillment. Earlier
strict draining/fixture-timeout experiments were rejected after actual failures.
An ordinary loopback cancellation probe does not reproduce those active-route
errors. Do not hide them or present that probe as a regression proof.

## Approaches

- Further fetch/fulfill and draining changes retain the problematic response
  lifetime and synthesize document redirects. Prior experiments do not support
  this approach.
- Broad browser headers can follow redirects and leak credentials. A shared
  automation secret expands access; OIDC plus the optional cookie header did not
  return a bypass cookie in the actual read-only probe. No protection change is
  approved for this fix.
- A loopback HTTPS verification proxy keeps native browser navigation, cookies,
  streams and redirects. It inserts OIDC only on the approved upstream origin.
  This is the implementer's chosen approach under the owner's delegated choices.

## Contract

- Reuse Node, Playwright and installed jsrsasign; no new dependencies or app routes.
- Bind only 127.0.0.1 on an ephemeral port. Require fresh random proxy credentials.
  Generated TLS key/certificate, proxy credentials and OIDC tokens remain in memory.
- Browser-to-local-proxy TLS uses an ephemeral test certificate. Every upstream
  HTTPS connection independently verifies the real certificate/hostname using
  Node's default trust store. No foreign upstream TLS validation is weakened.
- Only `headersFor` may supply the OIDC header. It retains current exact-origin,
  issuer/audience/expiry/refresh checks. Remove inherited OIDC and proxy credentials
  before all upstream requests; only the exact approved origin receives OIDC.
- Keep native statuses, redirects, cookies, body bytes, downloads and WebSocket
  upgrades. Do not follow redirects server-side or invent successful app responses.
- Reject malformed authorities, mismatched Host, plain HTTP and private/reserved
  upstream addresses. Resolve once and pin that validated address for the socket.
  Synthetic tests may explicitly supply a loopback target/trust capability.
- Stream requests/responses with backpressure and bounded concurrency/timeouts.
  Cancellation closes only owned upstream work. Errors have fixed safe responses;
  request bodies, URLs, headers, credentials and raw diagnostics are never logged.
- Prove the browser context actually uses this proxy before accepting native mode.
  Keep scoped direct HTTP/API access for preflights and response-loss verification.
  Browser route helpers use native continuation in proxy mode, preserving injected
  failures and response-loss checks.
- Keep the existing transport as a compatibility path until callers explicitly
  start the proxy. Hosted release E2E and the coordinator must opt in and fail
  closed on setup/probe failure; do not silently fall back during acceptance.

## Acceptance

Real local Chromium tests must prove exact-origin headers, foreign redirects,
POST/redirect semantics, cookie/session continuity, new tabs, concurrent requests,
streaming/downloads, upstream certificate rejection, request fault injection,
abort/close cleanup and absence of persisted credentials. Run existing guards,
lint/types and full checks as appropriate. Obtain fresh independent review and
exact-head hosted acceptance. Any failing experiment remains failed evidence.

Schema/history, recovery, invoice identity and provider acceptance remain separate
launch gates. A transport pass cannot replace financial or CRUD assertions.
