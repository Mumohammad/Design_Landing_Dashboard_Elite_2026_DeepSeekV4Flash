# Taste implementation and verification — 3 November 2026

The release checkout retains the existing Next.js/React stack, Inter/Cairo typography, tenant branding, routes and business actions. The original audit and chosen directions are recorded in [the pre-change audit](TASTE-DESIGN-AUDIT-20261029.md). [The refreshed inventory](TASTE-DESIGN-INVENTORY-20261103.md) lists all 77 page entries, six layouts, 152 reusable components and 89 module-local components after upstream reconciliation. An entry in that inventory does not certify every permission, data state or CRUD operation.

## Implemented design

The landing page uses the chosen type-only statement direction: a strong bilingual hero, one primary action, product-specific operational sections, working module filtering and an illustrative cost calculator. Dashboard screens share flat semantic surfaces, quiet metric strips, neutral navigation, consistent form controls, logical RTL alignment, visible keyboard/touch actions and responsive tables. Light and dark themes retain semantic status colours. The app direction remains achromatic-ledger; upstream ADR020's semantic sidebar supersedes the earlier gradient exception.

This continuation fixes two defects found in the actual browser captures. Driver import, rider-card and export actions now wrap within their container instead of clipping the Export button at 390px. The result count remains readable and both filters have a minimum 44px height at tablet as well as phone widths. Mobile and expanded-desktop sidebar buttons no longer mount invisible tooltip layers. Those layers consumed the first Escape key and left the mobile sheet open; tooltips remain available for collapsed desktop navigation. Four component regression tests cover this distinction.

## Visual critique

ROUND 3 — original captures retained, before the targeted regression fixes

Seen in one second: a Saudi logistics workspace with a direct bilingual public message and a quiet operational dashboard.

Idea (one sentence): connected driver, vehicle, order and financial records become the page's argument and the dashboard's ledger structure.

Live thing: module filtering and an illustrative fleet cost calculator, with readable content without JavaScript.

Layout words by section: hero=statement / platforms=roster / operations=working-interface / costs=calculator / workflow=sequence / pricing=comparison / questions=disclosure.

Scores: design 6.5 · usability 5 · creativity 6 · content 7 → overall 6.0.

Caps applied: the original inspector FAIL and visibly clipped phone action cap the original result; fewer than four real photographs/footage caps page design. The idea also works for a nearby logistics competitor, so creativity is not exceptional. This is below the skill's 7.5 target; it is not an award-level design claim.

Top three problems, with evidence and action:

1. `app-en/drivers-390-light-fold.png`: Export CSV runs off the right edge and the count breaks vertically. Fixed by wrapping the action group, keeping controls/counts intact and increasing filter touch targets. Targeted rebuilt-browser verification passed at 390px and 768px in English and Arabic; all three action buttons fit and both filters measure at least 44px high.
2. `sidebar-en-768.png` and `sidebar-ar-768.png`: first Escape leaves the sheet and scroll lock active. Diagnosed as an invisible tooltip layer; fixed by mounting tooltips only in collapsed desktop navigation. Targeted verification passed in both languages at 768px: first Escape closes, focus returns to the opener and scrolling unlocks.
3. `landing-en/landing-1440-light-page.png`: the typography-only direction still has many type sizes and competing paragraph edges. The 35-capture audit records 67 warnings, including type rhythm, alignment and absent footage. No unlicensed stock imagery, invented customers, fabricated metrics or nonfunctional controls were added to conceal those limits.

The original round recorded 104 successful functional checks, four failures, one Taste FAIL, no browser runtime errors and one no-JavaScript document-root locale mismatch. The four failures consist of the two sidebar cases and two ZATCA opener cases. Later diagnosis established that ZATCA has an accounting data-read error; the original detector missed that copy. Its zero-data-block count must not be used as evidence that accounting or ZATCA is ready. Disabled provider access is not a successful onboarding test.

## Release boundary

The prior clean `423d503` candidate passed 2,724 unit tests, TypeScript, lint, 332 release guards, the optimized production build and PDF runtime asset verification. Those results precede this continuation's UI fixes.

Fresh checks on UI commit `1197066dd38d06603d579304b18d8b94c789adcd` passed all 2,728 unit tests (548 reported suites), TypeScript, ESLint (zero errors, 28 warnings), the optimized production build and PDF runtime asset verification. Source hashes remained unchanged during both runs. These checks used dummy loopback configuration for static/unit checks and the approved staging backend for the build. The combined working tree also contains unfinished preview-auth infrastructure; its six guard failures are preserved in the separate validation receipt. A successful application build is not a successful release gate.

Eight targeted browser checks passed on the rebuilt UI commit, including dedicated staging login, English/Arabic tablet keyboard behavior, phone/tablet driver controls and the exact-commit/staging-only isolation guard. No browser runtime errors or blocked requests were recorded. The test signed out, closed its browser contexts and stopped the owned local server. The English and Arabic phone screenshots were visually inspected. These are supplemental functional regressions, not a fourth full Taste design round or certification of the remaining module workflows. Local evidence is retained under `supabase/.temp/taste-ui-validation-20261103`, `supabase/.temp/taste-ui-build-20261103` and the visualization folder `taste-refresh/ui-regression-2026-11-03T03-13-51-062Z`.

Unfinished preview-OIDC infrastructure remains separate, uncommitted work. The current combined working tree has six release-guard failures because mocked CSP checks encounter the new preview-identity requirement. This prevents release approval. No merge, hosted migration or production deployment is represented as completed by this visual continuation.

Staging accounting reads, full hosted CRUD acceptance, the complete fresh backup/restore supplement, protected-preview CI access and final release checks remain open. Invoice geometry is close to the supplied samples, but production Linux typography and full pixel identity are unverified. ZATCA authority acceptance remains unverified and production submission remains gated. Leaked-password protection remains unavailable on the current plan, which the owner chose to retain.
